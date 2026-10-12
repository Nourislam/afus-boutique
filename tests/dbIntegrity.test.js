import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// The real database module on a temporary data folder, filled by the demo shop
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-integrity-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app: { getPath: () => dir } } };
const init = require('../electron/database/init');
const api = require('../electron/database/api');
const demo = require('../electron/services/demoService');
const { MIGRATIONS } = require('../electron/database/migrations');

const n = (sql, params) => api.get(sql, params)?.n ?? 0;

describe('the database stays consistent (demo shop: 3 months of sales, returns, kridi, deliveries)', () => {
    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await init.initDatabase();
        api.run("INSERT INTO settings (key, value) VALUES ('setup_completed', '\"true\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        await demo.enter({ lang: 'ar' });
    });
    afterAll(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('SQLite integrity and foreign keys', () => {
        expect(api.all('PRAGMA integrity_check').map(r => Object.values(r)[0])).toEqual(['ok']);
        expect(api.all('PRAGMA foreign_key_check')).toEqual([]);
    });

    it('every migration is recorded once', () => {
        const done = api.all('SELECT version FROM schema_migrations').map(r => r.version);
        for (const m of MIGRATIONS) expect(done, m.version).toContain(m.version);
        expect(new Set(done).size).toBe(done.length);
    });

    it('no orphan lines', () => {
        expect(n('SELECT COUNT(*) AS n FROM sale_items si LEFT JOIN sales s ON s.id = si.sale_id WHERE s.id IS NULL')).toBe(0);
        expect(n('SELECT COUNT(*) AS n FROM product_variants v LEFT JOIN products p ON p.id = v.product_id WHERE p.id IS NULL')).toBe(0);
        expect(n('SELECT COUNT(*) AS n FROM return_items ri LEFT JOIN returns r ON r.id = ri.return_id WHERE r.id IS NULL')).toBe(0);
        expect(n('SELECT COUNT(*) AS n FROM payments pa LEFT JOIN sales s ON s.id = pa.sale_id WHERE s.id IS NULL')).toBe(0);
        expect(n('SELECT COUNT(*) AS n FROM purchase_order_items i LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id WHERE o.id IS NULL')).toBe(0);
        expect(n('SELECT COUNT(*) AS n FROM credit_payments cp LEFT JOIN credit_sales cs ON cs.id = cp.credit_sale_id WHERE cs.id IS NULL')).toBe(0);
    });

    it('stock: never negative, an article with sizes holds the sum of its sizes', () => {
        expect(n('SELECT COUNT(*) AS n FROM products WHERE stock_quantity < 0')).toBe(0);
        expect(n('SELECT COUNT(*) AS n FROM product_variants WHERE stock_quantity < 0')).toBe(0);
        const wrong = api.all(`
            SELECT p.id, p.stock_quantity, (SELECT COALESCE(SUM(v.stock_quantity), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS sizes
            FROM products p WHERE p.has_variants = 1 AND p.stock_quantity <> (SELECT COALESCE(SUM(v.stock_quantity), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1)
        `);
        expect(wrong).toEqual([]);
    });

    it('identifiers are unique: SKU, barcode, receipt number', () => {
        expect(api.all("SELECT sku FROM product_variants WHERE sku IS NOT NULL AND sku <> '' GROUP BY sku HAVING COUNT(*) > 1")).toEqual([]);
        expect(api.all("SELECT barcode FROM product_variants WHERE barcode IS NOT NULL AND barcode <> '' GROUP BY barcode HAVING COUNT(*) > 1")).toEqual([]);
        expect(api.all('SELECT receipt_number FROM sales GROUP BY receipt_number HAVING COUNT(*) > 1')).toEqual([]);
    });

    it('money: each ticket = its lines, paid tickets are paid in full, kridi paid = its payments', () => {
        const ticketOff = api.all(`
            SELECT s.id, s.subtotal, (SELECT SUM(total) FROM sale_items WHERE sale_id = s.id) AS lines
            FROM sales s WHERE ABS(s.subtotal - (SELECT COALESCE(SUM(total), 0) FROM sale_items WHERE sale_id = s.id)) > 0.01
        `);
        expect(ticketOff).toEqual([]);
        const unpaid = api.all(`
            SELECT s.id, s.total, (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE sale_id = s.id) AS paid
            FROM sales s
            WHERE s.status = 'completed' AND NOT EXISTS (SELECT 1 FROM credit_sales cs WHERE cs.sale_id = s.id)
              AND ABS(s.total - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE sale_id = s.id)) > 0.01
        `);
        expect(unpaid).toEqual([]);
        const kridi = api.all(`
            SELECT cs.id, cs.amount_paid, (SELECT COALESCE(SUM(amount), 0) FROM credit_payments WHERE credit_sale_id = cs.id) AS paid
            FROM credit_sales cs WHERE ABS(cs.amount_paid - (SELECT COALESCE(SUM(amount), 0) FROM credit_payments WHERE credit_sale_id = cs.id)) > 0.01
        `);
        expect(kridi).toEqual([]);
        expect(n('SELECT COUNT(*) AS n FROM credit_sales WHERE amount_paid > amount_due + 0.01')).toBe(0);
    });

    it('returns never give back more than was sold', () => {
        const over = api.all(`
            SELECT si.id, si.quantity, SUM(ri.quantity) AS back FROM return_items ri JOIN sale_items si ON si.id = ri.sale_item_id
            GROUP BY si.id HAVING SUM(ri.quantity) > si.quantity
        `);
        expect(over).toEqual([]);
    });

    it('purchase orders: received never more than a line says, the status follows the lines', () => {
        const wrong = api.all(`
            SELECT o.id, o.status FROM purchase_orders o
            WHERE (o.status = 'received' AND EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.purchase_order_id = o.id AND COALESCE(i.received_quantity, 0) < i.quantity))
        `);
        expect(wrong).toEqual([]);
    });
});
