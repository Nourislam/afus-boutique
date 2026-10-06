import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// The real database module, on a real file in a temporary folder
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-training-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app: { getPath: () => dir } } };
const init = require('../electron/database/init');
const api = require('../electron/database/api');
const training = require('../electron/services/trainingService');
const exchanges = require('../electron/services/exchangeService');
const catalog = require('../electron/services/catalogService');
const salesStats = require('../electron/services/salesStatsService');

const fileHash = () => crypto.createHash('sha256').update(fs.readFileSync(init.getDbPath())).digest('hex');
const RANGE = { startDate: '2000-01-01', endDate: '2999-01-01' };
const sell = (id, variant, qty, price, method = 'cash') => api.transaction(() => {
    api.run(`INSERT INTO sales (id, receipt_number, employee_id, subtotal, total, status) VALUES (?, ?, 'e1', ?, ?, 'completed')`, [id, `R-${id}`, qty * price, qty * price]);
    api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, variant_label, product_name, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)`,
        [`${id}-0`, id, variant.product_id, variant.id, variant.size, qty, price, qty * price]);
    catalog.adjustStock(api, { productId: variant.product_id, variantId: variant.id, delta: -qty, type: 'sale' });
    api.run('INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, ?, ?)', [`p-${id}`, id, method, qty * price]);
});

describe('training mode works on a copy, the shop data never changes', () => {
    let realVariant;
    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        await init.initDatabase();
        api.run("INSERT INTO employees (id, name, pin, role) VALUES ('e1', 'Amina', 'x', 'cashier')");
        api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('sh1', 'e1', '2000-01-01T00:00:00Z', 1000)");
        catalog.saveProduct(api, { id: 'jean', name: 'Jean', price: 3000 }, [{ size: '38', sku: 'J-38', stock_quantity: 5 }, { size: '40', sku: 'J-40', stock_quantity: 5 }], { isNew: true });
        realVariant = catalog.getVariants(api, 'jean')[0];
        sell('real1', realVariant, 1, 3000);
        init.saveDatabase();
    });
    afterAll(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('sales, exchange, kridi and drawer closing in training leave stock, cash, reports and the file as they were', () => {
        const before = {
            hash: fileHash(),
            stock: catalog.getVariants(api, 'jean').map(v => v.stock_quantity),
            stats: salesStats.salesStats(api, RANGE),
            sales: api.get('SELECT COUNT(*) AS n FROM sales').n,
            shift: api.get("SELECT end_time FROM shifts WHERE id = 'sh1'").end_time,
        };
        expect(init.isSandbox()).toBe(false);
        expect(init.startSandbox()).toBe(true);
        expect(init.startSandbox()).toBe(false); // already in training
        expect(init.isSandbox()).toBe(true);

        // Training article and customer exist only in the copy
        const seeded = training.seed(api, { productName: 'قميص تدريب', customerName: 'زبون تدريب' });
        training.seed(api, {}); // twice: nothing duplicated
        expect(api.all('SELECT name FROM products WHERE id = ?', [seeded.productId])).toEqual([{ name: 'قميص تدريب' }]);
        expect(api.get('SELECT credit_enabled FROM customers WHERE id = ?', [seeded.customerId]).credit_enabled).toBe(1);
        const base = training.progress(api);

        // The five exercises, done for real in the copy
        const [s, m] = catalog.getVariants(api, seeded.productId);
        sell('t1', s, 1, 2500);
        api.transaction(() => {
            api.run(`INSERT INTO sales (id, receipt_number, subtotal, total, status) VALUES ('t2', 'R-t2', 5000, 5000, 'completed')`);
            api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, quantity, unit_price, total) VALUES ('t2-0','t2',?,?,'x',1,2500,2500), ('t2-1','t2',?,?,'x',1,2500,2500)`, [s.product_id, s.id, m.product_id, m.id]);
        });
        api.transaction(() => exchanges.createExchange(api, { sale_id: 't1', sale_item_id: 't1-0', quantity: 1, new_variant_id: m.id, employee_id: 'e1' }, { enabled: false }));
        sell('t3', realVariant, 2, 3000, 'credit');
        api.run("INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, due_date) VALUES ('c1', 't3', ?, 'INV-T', 6000, '2030-01-01')", [seeded.customerId]);
        api.run("UPDATE shifts SET end_time = '2026-01-01T00:00:00Z', closing_cash = 9999 WHERE id = 'sh1'");
        const done = training.progress(api);
        expect(done.sales - base.sales).toBe(4); // t1, t2, t3 + the exchange's new ticket
        expect(done.twoSizeSales - base.twoSizeSales).toBe(1);
        expect(done.exchanges - base.exchanges).toBe(1);
        expect(done.creditSales - base.creditSales).toBe(1);
        expect(done.closedShifts - base.closedShifts).toBe(1);
        init.saveDatabase(); // what every write does: must not touch the file in training
        expect(fileHash()).toBe(before.hash);
        expect(catalog.getVariants(api, 'jean')[0].stock_quantity).toBe(before.stock[0] - 2); // the copy did change

        // Leave training: everything is back
        expect(init.stopSandbox()).toBe(true);
        expect(init.isSandbox()).toBe(false);
        expect(catalog.getVariants(api, 'jean').map(v => v.stock_quantity)).toEqual(before.stock);
        expect(salesStats.salesStats(api, RANGE)).toEqual(before.stats);
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(before.sales);
        expect(api.get("SELECT end_time FROM shifts WHERE id = 'sh1'").end_time).toBe(before.shift);
        expect(api.get('SELECT id FROM products WHERE id = ?', [seeded.productId])).toBeNull();
        expect(api.get('SELECT id FROM customers WHERE id = ?', [seeded.customerId])).toBeNull();
        expect(fileHash()).toBe(before.hash);
    });

    it('after training the shop works and saves normally again', () => {
        sell('real2', realVariant, 1, 3000);
        init.saveDatabase();
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(2);
        expect(init.stopSandbox()).toBe(false);
    });

    it('closing the program in training: the file has no trace of it', async () => {
        init.startSandbox();
        sell('lost', realVariant, 1, 3000);
        init.saveDatabase();
        // A new start reads the file again (and leaves any training copy)
        await init.initDatabase();
        expect(init.isSandbox()).toBe(false);
        expect(api.get("SELECT id FROM sales WHERE id = 'lost'")).toBeNull();
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(2);
    });
});
