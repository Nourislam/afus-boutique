import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { applyMigrations } = require('../electron/database/migrations');
const catalog = require('../electron/services/catalogService');
const dashboard = require('../electron/services/dashboardService');

const WEEK = { startDate: '2026-10-03 00:00:00', endDate: '2026-10-09 23:59:59' };
const SINCE30 = '2026-09-05 00:00:00';

function addColumns(api) {
    const add = (table, column, type) => {
        if (!api.all(`PRAGMA table_info(${table})`).some(c => c.name === column)) api.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    };
    add('customers', 'credit_enabled', 'INTEGER DEFAULT 0');
    add('customers', 'is_active', 'INTEGER DEFAULT 1');
}

function sell(api, id, when, lines) {
    api.run('INSERT INTO sales (id, receipt_number, subtotal, total, created_at) VALUES (?, ?, 0, ?, ?)', [id, id, lines.reduce((s, l) => s + l.total, 0), when]);
    for (const [i, l] of lines.entries()) {
        api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, quantity, unit_price, total, unit_cost)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [`${id}-${i}`, id, l.product_id, l.variant_id || null, l.name, l.qty, l.total / l.qty, l.total, l.cost ?? 0]);
    }
}

describe('home screen figures', () => {
    let api;
    let jean;

    beforeEach(async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        api = createApi(db);
        addColumns(api);
        catalog.saveProduct(api, { id: 'jean', name: 'Jean', price: 3000, cost: 1800 }, [
            { color: 'Noir', size: '38', sku: 'J-38', stock_quantity: 0, min_stock_level: 2 },
            { color: 'Noir', size: '40', sku: 'J-40', stock_quantity: 5, min_stock_level: 2 },
            { color: 'Noir', size: '42', sku: 'J-42', stock_quantity: 1, min_stock_level: 2 },
        ], { isNew: true });
        catalog.saveProduct(api, { id: 'belt', name: 'Ceinture', price: 800, cost: 0, stock_quantity: 10 }, [], { isNew: true });
        catalog.saveProduct(api, { id: 'old', name: 'Veste', price: 9000, cost: 5000, stock_quantity: 3 }, [], { isNew: true });
        api.run("UPDATE products SET created_at = '2026-01-01 10:00:00'");
        jean = Object.fromEntries(catalog.getVariants(api, 'jean').map(v => [v.size, v.id]));
        sell(api, 's1', '2026-10-05 10:00:00', [
            { product_id: 'jean', variant_id: jean['38'], name: 'Jean', qty: 2, total: 6000, cost: 1800 },
            { product_id: 'belt', name: 'Ceinture', qty: 1, total: 800, cost: 0 },
        ]);
        sell(api, 's0', '2026-08-01 10:00:00', [{ product_id: 'old', name: 'Veste', qty: 1, total: 9000, cost: 5000 }]);
    });

    it('ranks the week best sellers with the pieces left', () => {
        const best = dashboard.bestSellers(api, WEEK);
        expect(best.products[0]).toMatchObject({ product_id: 'jean', quantity: 2, revenue: 6000, stock: 6 });
        expect(best.products[1]).toMatchObject({ product_id: 'belt', quantity: 1, stock: 10 });
        expect(best.sizes[0]).toMatchObject({ size: '38', quantity: 2, stock: 0 });
        expect(best.colors[0]).toMatchObject({ quantity: 2, stock: 6 });
    });

    it('finds the sizes at 0 that sell, the ones running low and the missing sizes', () => {
        const out = dashboard.outOfStockSelling(api, SINCE30);
        expect(out.map(r => r.sku)).toEqual(['J-38']);
        expect(out[0].sold).toBe(2);
        expect(dashboard.runningLow(api).map(r => r.sku)).toEqual(['J-42']);
        expect(dashboard.missingSizes(api, SINCE30)).toEqual([{ product_id: 'jean', product_name: 'Jean', missing: ['38'], available: ['40', '42'] }]);
    });

    it('lists the articles not sold for 30 days, new articles left out', () => {
        expect(dashboard.slowMovers(api, SINCE30).map(r => [r.product_id, r.stock, r.last_sale_at])).toEqual([['old', 3, '2026-08-01 10:00:00']]);
        api.run("UPDATE products SET created_at = '2026-10-01 10:00:00' WHERE id = 'old'");
        expect(dashboard.slowMovers(api, SINCE30)).toEqual([]);
    });

    it('counts the articles without purchase price and the ones sold that way', () => {
        expect(dashboard.missingCost(api)).toEqual({ count: 1, names: ['Ceinture'] });
        expect(dashboard.soldWithoutCost(api, WEEK)).toBe(1);
        expect(dashboard.soldWithoutCost(api, { startDate: '2026-08-01 00:00:00', endDate: '2026-08-02 00:00:00' })).toBe(0);
    });

    it('finds late credit, offers ending soon and the credit moves of the day', () => {
        api.run("INSERT INTO customers (id, name) VALUES ('c1', 'Amine'), ('c2', 'Sara')");
        api.run(`INSERT INTO credit_sales (id, customer_id, invoice_number, amount_due, amount_paid, due_date, created_at) VALUES
            ('k1', 'c1', 'K1', 5000, 1000, '2026-10-01', '2026-09-01 10:00:00'),
            ('k2', 'c2', 'K2', 3000, 0, '2026-11-01', '2026-10-05 09:00:00'),
            ('k3', 'c2', 'K3', 2000, 2000, '2026-09-01', '2026-08-01 09:00:00')`);
        api.run("INSERT INTO credit_payments (id, credit_sale_id, amount, payment_method, created_at) VALUES ('p1', 'k1', 1000, 'cash', '2026-10-05 11:00:00')");
        expect(dashboard.overdueCredit(api, '2026-10-05')).toEqual({ customers: 1, amount: 4000 });
        expect(dashboard.creditMoves(api, { startDate: '2026-10-05 00:00:00', endDate: '2026-10-05 23:59:59' }))
            .toEqual({ given: 3000, givenCount: 1, received: 1000, receivedCount: 1 });

        api.run(`INSERT INTO promotions (id, name, type, value, is_active, end_date) VALUES
            ('o1', 'Soldes', 'percentage', 20, 1, '2026-10-06'), ('o2', 'Old', 'percentage', 10, 1, '2026-09-01'), ('o3', 'Off', 'percentage', 10, 0, '2026-10-05')`);
        expect(dashboard.offersEnding(api, '2026-10-05', '2026-10-06').map(o => o.id)).toEqual(['o1']);
    });

    it('groups the sales per local hour and per day', () => {
        sell(api, 's2', '2026-10-05 23:30:00', [{ product_id: 'belt', name: 'Ceinture', qty: 1, total: 800 }]);
        const day = { startDate: '2026-10-05 00:00:00', endDate: '2026-10-06 23:59:59' };
        expect(dashboard.salesSeries(api, day, 'hour', 60).map(r => [r.bucket, r.total])).toEqual([['00', 800], ['11', 6800]]);
        expect(dashboard.salesSeries(api, day, 'day', 60).map(r => [r.bucket, r.count])).toEqual([['2026-10-05', 1], ['2026-10-06', 1]]);
    });

    it('knows a brand-new shop', async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        expect(dashboard.firstSteps(createApi(db))).toEqual({ products: 0, sales: 0, shifts: 0 });
        expect(dashboard.firstSteps(api)).toMatchObject({ products: 3, sales: 2 });
    });
});
