import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// The real database module and demo service, on real files in a temporary data folder
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-demo-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app: { getPath: () => dir } } };
const init = require('../electron/database/init');
const api = require('../electron/database/api');
const demo = require('../electron/services/demoService');
const catalog = require('../electron/services/catalogService');
const dashboard = require('../electron/services/dashboardService');
const salesStats = require('../electron/services/salesStatsService');
const pinService = require('../electron/services/pinService');
const ShiftService = require('../electron/services/shiftService');
const { EcommerceSyncManager } = require('../electron/ecommerce/EcommerceSyncManager');

const REAL_FILE = path.join(dir, 'afus-boutique.db');
const realHash = () => crypto.createHash('sha256').update(fs.readFileSync(REAL_FILE)).digest('hex');
const fileHash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const count = (table, where = '') => api.get(`SELECT COUNT(*) AS n FROM ${table} ${where}`).n;
const RANGE = { startDate: '2000-01-01', endDate: '2999-01-01' };

describe('demo shop: its own database, never the shop\'s', () => {
    let realBefore;
    let demoCounts;

    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // The real shop with its own article, employee and sale
        await init.initDatabase();
        api.run("INSERT INTO employees (id, name, pin, role) VALUES ('real-admin', 'Amina', 'x', 'admin')");
        catalog.saveProduct(api, { id: 'real-jean', name: 'Jean réel', price: 3000 }, [{ size: '38', sku: 'REAL-38', stock_quantity: 5 }], { isNew: true });
        api.run("INSERT INTO sales (id, receipt_number, subtotal, total, status) VALUES ('real-sale', 'R-1', 3000, 3000, 'completed')");
        api.run("INSERT INTO settings (key, value) VALUES ('setup_completed', '\"true\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        init.saveDatabase();
        realBefore = { hash: realHash(), sales: count('sales'), products: count('products'), employees: count('employees') };
    });
    afterAll(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('entering creates the demo shop in demo/, the real file is not touched', async () => {
        expect(init.isDemo()).toBe(false);
        const result = await demo.enter({ lang: 'fr' });
        expect(result.created).toBe(true);
        expect(init.isDemo()).toBe(true);
        expect(init.getDbPath()).toBe(path.join(dir, 'demo', 'afus-boutique-demo.db'));
        expect(init.getDbPath()).not.toBe(REAL_FILE);
        expect(fs.existsSync(init.getDbPath())).toBe(true);
        expect(realHash()).toBe(realBefore.hash);
        // Nothing of the real shop in the demo
        expect(api.get("SELECT id FROM products WHERE id = 'real-jean'")).toBe(null);
        expect(api.get("SELECT id FROM employees WHERE id = 'real-admin'")).toBe(null);
    });

    it('the demo shop is complete: articles, variants, pictures, 3 months of sales, returns, kridi, staff, drawers, customers, suppliers', () => {
        demoCounts = {
            products: count('products'), variants: count('product_variants'), sales: count('sales'), returns: count('returns'),
            credit: count('credit_sales'), creditPayments: count('credit_payments'), employees: count('employees'),
            customers: count('customers'), suppliers: count('suppliers'), orders: count('purchase_orders'), receivings: count('receivings'),
            closed: count('shifts', 'WHERE end_time IS NOT NULL'), open: count('shifts', 'WHERE end_time IS NULL'), expenses: count('cash_expenses'),
        };
        expect(demoCounts.products).toBe(60);
        expect(demoCounts.variants).toBeGreaterThan(300);
        expect(demoCounts.sales).toBeGreaterThan(400);
        expect(demoCounts.returns).toBeGreaterThan(10);
        expect(demoCounts.credit).toBeGreaterThan(10);
        expect(demoCounts.creditPayments).toBeGreaterThan(3);
        expect(demoCounts.employees).toBe(2);
        expect(demoCounts.customers).toBe(10);
        expect(demoCounts.suppliers).toBe(4);
        expect(demoCounts.receivings).toBe(3);
        expect(demoCounts.closed).toBe(90);
        expect(demoCounts.open).toBe(1);
        expect(demoCounts.expenses).toBeGreaterThan(10);
        // Sales spread over three months
        const span = api.get('SELECT julianday(MAX(created_at)) - julianday(MIN(created_at)) AS days FROM sales').days;
        expect(span).toBeGreaterThan(85);
        // Every article has a local picture, the shop its logo
        const images = api.all('SELECT image_path FROM products');
        expect(images.every(r => r.image_path && fs.existsSync(path.join(dir, 'demo', 'images', r.image_path)))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'images', images[0].image_path))).toBe(false);
        // Stock: some sizes sold out, some running low, none negative
        expect(count('product_variants', 'WHERE stock_quantity = 0')).toBeGreaterThan(5);
        expect(count('product_variants', 'WHERE stock_quantity BETWEEN 1 AND 2')).toBeGreaterThan(5);
        expect(count('product_variants', 'WHERE stock_quantity < 0')).toBe(0);
        // Every variant has its SKU and its own barcode
        expect(count('product_variants', "WHERE sku IS NULL OR sku = '' OR barcode IS NULL")).toBe(0);
        expect(api.get('SELECT COUNT(DISTINCT barcode) AS n FROM product_variants').n).toBe(demoCounts.variants);
    });

    it('the demo figures add up like real ones (reports, dashboard, kridi, drawers)', () => {
        const stats = salesStats.salesStats(api, RANGE);
        expect(stats.total_revenue).toBeGreaterThan(1000000);
        expect(stats.total_refunds).toBeGreaterThan(0);
        expect(dashboard.bestSellers(api, RANGE).products.length).toBeGreaterThan(3);
        // Kridi: each customer's balance is what is still owed on their tickets
        for (const c of api.all('SELECT id, credit_balance FROM customers')) {
            const owed = api.get('SELECT COALESCE(SUM(amount_due - amount_paid), 0) AS n FROM credit_sales WHERE customer_id = ?', [c.id]).n;
            expect(Math.round(c.credit_balance)).toBe(Math.round(owed));
        }
        expect(api.get("SELECT COUNT(*) AS n FROM credit_sales WHERE status != 'paid' AND due_date < ?", [new Date().toISOString()]).n).toBeGreaterThan(0);
        // Every closed drawer: counted cash close to what the program expects
        // (the demo computes it while building; checked here with the program's own formula)
        const shifts = new ShiftService();
        const closed = api.all('SELECT id FROM shifts WHERE end_time IS NOT NULL');
        expect(closed.length).toBe(90);
        for (const s of closed) {
            const d = shifts.getShiftStats(s.id).cash_difference;
            expect(d).toBeGreaterThanOrEqual(-100);
            expect(d).toBeLessThanOrEqual(50);
        }
        // Demo staff: an owner and a cashier with the PINs shown on the login screen
        const staff = api.all('SELECT id, role, pin FROM employees ORDER BY role');
        expect(staff.map(s => s.role)).toEqual(['admin', 'cashier']);
        expect(pinService.verifyPin(staff.find(s => s.role === 'admin').pin, '1111')).toBe(true);
        expect(pinService.verifyPin(staff.find(s => s.role === 'cashier').pin, '2222')).toBe(true);
    });

    it('selling, kridi and stock changes in the demo stay in the demo file', () => {
        const variant = api.get('SELECT * FROM product_variants WHERE stock_quantity > 2 LIMIT 1');
        api.transaction(() => {
            api.run("INSERT INTO sales (id, receipt_number, subtotal, total, status) VALUES ('demo-test-sale', 'T-1', 1000, 1000, 'completed')");
            catalog.adjustStock(api, { productId: variant.product_id, variantId: variant.id, delta: -1, type: 'sale' });
            api.run("INSERT INTO customers (id, name) VALUES ('demo-test-customer', 'Test')");
        });
        expect(count('sales')).toBe(demoCounts.sales + 1);
        expect(realHash()).toBe(realBefore.hash);
    });

    it('training inside the demo works on a copy of the demo; leaving training gives the demo back as it was', () => {
        const demoFile = init.getDbPath();
        const before = { hash: fileHash(demoFile), sales: count('sales') };
        expect(init.startSandbox()).toBe(true);
        api.run("INSERT INTO sales (id, receipt_number, subtotal, total, status) VALUES ('training-sale', 'TR-1', 500, 500, 'completed')");
        init.saveDatabase();
        expect(count('sales')).toBe(before.sales + 1);
        expect(fileHash(demoFile)).toBe(before.hash);
        init.stopSandbox();
        expect(count('sales')).toBe(before.sales);
        expect(init.isDemo()).toBe(true);
        expect(realHash()).toBe(realBefore.hash);
    });

    it('reset gives the demo shop back as at the start, the real file is not touched', async () => {
        await demo.reset({ lang: 'fr' });
        expect(init.isDemo()).toBe(true);
        expect(api.get("SELECT id FROM customers WHERE id = 'demo-test-customer'")).toBe(null);
        expect(api.get("SELECT id FROM sales WHERE id = 'demo-test-sale'")).toBe(null);
        expect(count('products')).toBe(60);
        expect(count('sales')).toBeGreaterThan(400);
        expect(realHash()).toBe(realBefore.hash);
    });

    it('a reset refuses outside the demo, and only ever removes the demo folder', async () => {
        await demo.exit();
        await expect(demo.reset({})).rejects.toThrow(/DEMO_NOT_ACTIVE/);
        expect(fs.existsSync(REAL_FILE)).toBe(true);
    });

    it('leaving the demo opens the shop\'s own data exactly as it was; nothing is copied over', () => {
        expect(init.isDemo()).toBe(false);
        expect(init.getDbPath()).toBe(REAL_FILE);
        expect(count('sales')).toBe(realBefore.sales);
        expect(count('products')).toBe(realBefore.products);
        expect(count('employees')).toBe(realBefore.employees);
        expect(api.get("SELECT id FROM products WHERE id LIKE 'demo-%'")).toBe(null);
        expect(api.get("SELECT key FROM settings WHERE key = 'demo_shop'")).toBe(null);
        expect(realHash()).toBe(realBefore.hash);
    });

    it('a real sale after leaving is saved in the real file; the demo keeps its own data', async () => {
        api.run("INSERT INTO sales (id, receipt_number, subtotal, total, status) VALUES ('real-sale-2', 'R-2', 1000, 1000, 'completed')");
        init.saveDatabase();
        const afterReal = realHash();
        expect(afterReal).not.toBe(realBefore.hash);
        // Back in the demo: opened as it is (not created again), without the real sale
        const again = await demo.enter({ lang: 'fr' });
        expect(again.created).toBe(false);
        expect(api.get("SELECT id FROM sales WHERE id = 'real-sale-2'")).toBe(null);
        expect(count('products')).toBe(60);
        expect(realHash()).toBe(afterReal);
        await demo.exit();
        expect(api.get("SELECT id FROM sales WHERE id = 'real-sale-2'")).not.toBe(null);
    });

    it('a restart always opens the shop\'s own data', async () => {
        await demo.enter({ lang: 'fr' });
        expect(init.isDemo()).toBe(true);
        // What the program does at start: the profile is the shop's
        init.setProfile('real');
        await init.initDatabase();
        expect(init.isDemo()).toBe(false);
        expect(api.get("SELECT id FROM products WHERE id = 'real-jean'")).not.toBe(null);
        expect(fs.existsSync(path.join(dir, 'demo', 'afus-boutique-demo.db'))).toBe(true);
    });

    it('the demo file path can never be the shop\'s file', () => {
        init.setProfile('demo');
        expect(path.resolve(init.getDbPath())).not.toBe(path.resolve(init.realDbPath()));
        expect(init.getDataRoot()).toBe(path.join(dir, 'demo'));
        init.setProfile('real');
        expect(init.getDataRoot()).toBe(dir);
        expect(() => init.setProfile('other')).toThrow();
    });
});

describe('online store with the demo shop', () => {
    function manager({ demoActive, training = false }) {
        const handlers = {};
        const m = new EcommerceSyncManager({
            store: { runQuery: () => [], getOne: () => null, runInsert: () => ({}) },
            adapters: {}, isEnabled: () => true, ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
        });
        m.init({ isTraining: () => training, isDemo: () => demoActive });
        return { m, call: (channel, ...args) => handlers[channel](null, ...args) };
    }

    it('nothing is sent or linked while the demo shop is open', async () => {
        const { m, call } = manager({ demoActive: true });
        expect(m.blockedReason()).toBe('DEMO_ACTIVE');
        expect((await m.syncAll()).message).toMatch(/^DEMO_ACTIVE/);
        expect((await m.syncConnection('x')).message).toMatch(/^DEMO_ACTIVE/);
        for (const channel of ['ecommerce:addConnection', 'ecommerce:testConnection', 'ecommerce:removeConnection', 'ecommerce:autoMapProducts', 'ecommerce:createMapping', 'ecommerce:deleteMapping', 'ecommerce:oauth:start', 'ecommerce:oauth:complete', 'ecommerce:webhookEvent']) {
            const result = await call(channel, {});
            expect(result.success, channel).toBe(false);
            expect(result.message, channel).toMatch(/^DEMO_ACTIVE/);
        }
        m.stopScheduledSync?.();
    });

    it('training is still told apart, and the real shop is not blocked', async () => {
        expect(manager({ demoActive: false, training: true }).m.blockedReason()).toBe('TRAINING_ACTIVE');
        const { m } = manager({ demoActive: false });
        expect(m.blockedReason()).toBe(null);
        m.stopScheduledSync?.();
    });
});
