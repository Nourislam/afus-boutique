import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { applyMigrations } = require('../electron/database/migrations');

// shiftService talks to database/init directly: point it at an in-memory db
async function loadShiftService() {
    const db = await createLegacyDb();
    applyMigrations(db);
    const api = createApi(db);
    const initPath = path.resolve(__dirname, '../electron/database/init.js');
    require.cache[initPath] = {
        id: initPath, filename: initPath, loaded: true,
        exports: { runQuery: (sql, p) => api.all(sql, p), getOne: (sql, p) => api.get(sql, p), runInsert: (sql, p) => api.run(sql, p) },
    };
    const servicePath = path.resolve(__dirname, '../electron/services/shiftService.js');
    delete require.cache[servicePath];
    const ShiftService = require(servicePath);
    return { service: new ShiftService(), api };
}

const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

describe('cash drawer per employee', () => {
    it('expects opening + cash sales + kridi repaid in cash - cash refunds', async () => {
        const { service, api } = await loadShiftService();
        api.run("INSERT INTO employees (id, name, pin, role) VALUES ('e1', 'Amina', '1111', 'cashier'), ('e2', 'Karim', '2222', 'cashier')");
        api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('s1', 'e1', ?, 5000)", [ago(120)]);
        const sale = (id, emp, total, method) => {
            api.run('INSERT INTO sales (id, receipt_number, subtotal, total, employee_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, `R-${id}`, total, total, emp, ago(60)]);
            api.run('INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, ?, ?)', [`p-${id}`, id, method, total]);
            api.run('INSERT INTO sale_items (id, sale_id, product_name, quantity, unit_price, total) VALUES (?, ?, ?, 2, ?, ?)', [`i-${id}`, id, 'Tee', total / 2, total]);
        };
        sale('a', 'e1', 3000, 'cash');
        sale('b', 'e1', 4000, 'card');
        sale('c', 'e1', 2000, 'credit');
        sale('d', 'e2', 9000, 'cash'); // someone else's sale never counts here
        api.run("INSERT INTO returns (id, sale_id, return_number, total_refund, employee_id, created_at) VALUES ('r1', 'a', 'RET-1', 1000, 'e1', ?)", [ago(30)]);
        api.run("INSERT INTO returns (id, sale_id, return_number, total_refund, employee_id, created_at) VALUES ('r2', 'c', 'RET-2', 500, 'e1', ?)", [ago(30)]);
        api.run("INSERT INTO customers (id, name) VALUES ('c1', 'Client')");
        api.run("INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, due_date) VALUES ('cs1', 'c', 'c1', 'INV-1', 2000, '2030-01-01')");
        api.run("INSERT INTO credit_payments (id, credit_sale_id, amount, payment_method, received_by, created_at) VALUES ('cp1', 'cs1', 700, 'cash', 'e1', ?)", [ago(20)]);

        const stats = service.getShiftStats('s1');
        expect(stats.total_transactions).toBe(3);
        expect(stats.total_sales).toBe(9000);
        expect(stats.items_sold).toBe(6);
        expect(stats.total_cash_sales).toBe(3000);
        expect(stats.total_cash_refunds).toBe(1000); // the kridi return lowers the debt, not the drawer
        expect(stats.credit_collected_cash).toBe(700);
        expect(stats.expected_cash).toBe(5000 + 3000 + 700 - 1000);
        expect(stats.duration_minutes).toBeGreaterThanOrEqual(119);

        service.endShift('s1', 7600);
        expect(service.getShiftStats('s1').cash_difference).toBe(-100);
        expect(service.getLastClosedShift().closing_cash).toBe(7600);
        expect(service.getOpenShifts()).toHaveLength(0);

        const activity = service.getEmployeeActivity(ago(24 * 60), new Date(Date.now() + 60000).toISOString());
        const amina = activity.find(a => a.id === 'e1');
        expect(amina.sales_count).toBe(3);
        expect(amina.cash_difference).toBe(-100);
        expect(amina.minutes_worked).toBeGreaterThanOrEqual(119);
        expect(activity.find(a => a.id === 'e2').sales_total).toBe(9000);
    });
});
