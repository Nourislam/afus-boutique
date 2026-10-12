import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { applyMigrations } = require('../electron/database/migrations');
const { NOT_COUNTED, countedSale } = require('../electron/services/saleStatus');
const salesStats = require('../electron/services/salesStatsService');
const dashboard = require('../electron/services/dashboardService');

const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const RANGE = { startDate: ago(24 * 60), endDate: new Date(Date.now() + 60000).toISOString() };

// shiftService talks to database/init directly: point it at the same db
function loadShiftService(api) {
    const initPath = path.resolve(__dirname, '../electron/database/init.js');
    require.cache[initPath] = {
        id: initPath, filename: initPath, loaded: true,
        exports: { runQuery: (sql, p) => api.all(sql, p), getOne: (sql, p) => api.get(sql, p), runInsert: (sql, p) => api.run(sql, p) },
    };
    const servicePath = path.resolve(__dirname, '../electron/services/shiftService.js');
    delete require.cache[servicePath];
    const ShiftService = require(servicePath);
    return new ShiftService();
}

/** One real cash sale (a) and one sale with the given status (v), both by e1 during the open drawer. */
async function shop(status) {
    const db = await createLegacyDb();
    applyMigrations(db);
    const api = createApi(db);
    api.run("INSERT INTO employees (id, name, pin, role) VALUES ('e1', 'Amina', '1111', 'cashier')");
    api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('s1', 'e1', ?, 1000)", [ago(120)]);
    const sale = (id, total, method, saleStatus) => {
        api.run('INSERT INTO sales (id, receipt_number, subtotal, total, employee_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, `R-${id}`, total, total, 'e1', saleStatus, ago(60)]);
        api.run('INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, ?, ?)', [`p-${id}`, id, method, total]);
        api.run('INSERT INTO sale_items (id, sale_id, product_name, quantity, unit_price, total, unit_cost) VALUES (?, ?, ?, 2, ?, ?, 500)',
            [`i-${id}`, id, 'Tee', total / 2, total]);
    };
    sale('a', 3000, 'cash', 'completed');
    sale('v', 8000, 'cash', status);
    // a refund against the not-counted sale must not be taken off either
    api.run("INSERT INTO returns (id, sale_id, return_number, total_refund, employee_id, created_at) VALUES ('r1', 'v', 'RET-1', 4000, 'e1', ?)", [ago(30)]);
    return api;
}

describe('sales that do not count (voided / cancelled)', () => {
    it('one shared rule: unknown or empty status counts, voided and cancelled never', () => {
        expect(NOT_COUNTED).toEqual(['voided', 'cancelled']);
        expect(countedSale('s')).toBe("COALESCE(s.status, 'completed') NOT IN ('voided', 'cancelled')");
        expect(countedSale(null)).toBe("COALESCE(status, 'completed') NOT IN ('voided', 'cancelled')");
    });

    for (const status of NOT_COUNTED) {
        describe(status, () => {
            it('stays out of the sales totals and the payment methods', async () => {
                const api = await shop(status);
                const stats = salesStats.salesStats(api, RANGE);
                expect(stats.total_transactions).toBe(1);
                expect(stats.total_revenue).toBe(3000);
                expect(stats.items_sold).toBe(2);
                expect(stats.total_refunds).toBe(0);
                expect(stats.net_revenue).toBe(3000);
                expect(stats.total_cost).toBe(1000);
                expect(salesStats.paymentMethods(api, RANGE)).toEqual([{ method: 'cash', count: 1, total: 3000 }]);
            });

            it('stays out of the drawer and the employee activity', async () => {
                const api = await shop(status);
                const service = loadShiftService(api);
                const drawer = service.getShiftStats('s1');
                expect(drawer.total_transactions).toBe(1);
                expect(drawer.total_sales).toBe(3000);
                expect(drawer.items_sold).toBe(2);
                expect(drawer.total_cash_sales).toBe(3000);
                const amina = service.getEmployeeActivity(RANGE.startDate, RANGE.endDate).find(a => a.id === 'e1');
                expect(amina.sales_count).toBe(1);
                expect(amina.sales_total).toBe(3000);
            });

            it('stays out of the dashboard figures', async () => {
                const api = await shop(status);
                expect(dashboard.salesSeries(api, RANGE, 'day').reduce((s, r) => s + r.total, 0)).toBe(3000);
                // one article per sale, so the two can be told apart
                api.run("UPDATE sale_items SET product_id = 'p-' || sale_id, product_name = 'Tee ' || sale_id, unit_cost = 0");
                expect(dashboard.bestSellers(api, RANGE).products.map(r => r.product_id)).toEqual(['p-a']);
                expect(dashboard.soldWithoutCost(api, RANGE)).toBe(1);
                api.run("UPDATE sales SET status = 'completed' WHERE id = 'v'");
                expect(dashboard.salesSeries(api, RANGE, 'day').reduce((s, r) => s + r.total, 0)).toBe(11000);
            });
        });
    }
});
