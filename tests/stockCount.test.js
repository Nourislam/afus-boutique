import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, reopen, stockOf } from './helpers/shop';

const require = createRequire(import.meta.url);
const counts = require('../electron/services/stockCountService');

const code = (fn) => { try { fn(); } catch (e) { return e.message.split('|')[0]; } return null; };
const beltStock = (api) => api.get("SELECT stock_quantity FROM products WHERE id = 'belt'").stock_quantity;

describe('stock count', () => {
    let shop, api, v;
    beforeEach(async () => {
        shop = await createShop();
        ({ api, v } = shop);
        api.run("INSERT INTO categories (id, name) VALUES ('jeans', 'Jeans'), ('acc', 'Accessoires')");
        api.run("UPDATE products SET category_id = 'jeans' WHERE id = 'jean'");
        api.run("UPDATE products SET category_id = 'acc' WHERE id = 'belt'");
    });

    it('shows shortage, surplus and no difference without touching the stock until confirmed', () => {
        const c = counts.startCount(api, { employeeId: 'boss' });
        // N-38: 4 in the program, 3 found · B-40: 3 / 5 found · N-40: 2 / 2
        for (let i = 0; i < 3; i++) counts.scan(api, c.id, 'J-N-38');
        counts.scan(api, c.id, 'J-B-40', 5);
        counts.scan(api, c.id, 'j-n-40');
        const line = counts.scan(api, c.id, 'J-N-40'); // same code twice = 2 pieces
        expect(line).toMatchObject({ counted: 2, expected: 2, difference: 0 });

        const s = counts.summary(api, c.id);
        expect(s.lines.map(l => [l.sku, l.expected, l.counted, l.difference]).sort()).toEqual([
            ['J-B-40', 3, 5, 2], ['J-N-38', 4, 3, -1], ['J-N-40', 2, 2, 0],
        ]);
        expect(s).toMatchObject({ shortage_pieces: 1, surplus_pieces: 2, unchanged: 1, shortage_value: 1800, surplus_value: 3600 });
        // Nothing changed yet
        expect([stockOf(api, v['J-N-38']), stockOf(api, v['J-B-40'])]).toEqual([4, 3]);

        expect(code(() => counts.confirmCount(api, c.id, { reason: ' ' }))).toBe('COUNT_REASON_REQUIRED');
        const done = api.transaction(() => counts.confirmCount(api, c.id, { reason: 'Inventaire de fin de mois', employeeId: 'boss' }));
        expect(done.count.status).toBe('confirmed');
        expect([stockOf(api, v['J-N-38']), stockOf(api, v['J-B-40']), stockOf(api, v['J-N-40'])]).toEqual([3, 5, 2]);
        const logs = api.all("SELECT type, quantity_change, reason FROM inventory_logs WHERE type = 'count' ORDER BY quantity_change");
        expect(logs).toEqual([
            { type: 'count', quantity_change: -1, reason: 'Stock count: Inventaire de fin de mois' },
            { type: 'count', quantity_change: 2, reason: 'Stock count: Inventaire de fin de mois' },
        ]);
        // A closed count cannot be changed
        expect(code(() => counts.scan(api, c.id, 'J-N-38'))).toBe('COUNT_CLOSED');
        expect(code(() => counts.confirmCount(api, c.id, { reason: 'x' }))).toBe('COUNT_CLOSED');
    });

    it('an unknown code or a whole-article code is refused, nothing is added', () => {
        const c = counts.startCount(api, {});
        expect(code(() => counts.scan(api, c.id, 'NOPE-123'))).toBe('COUNT_CODE_UNKNOWN');
        api.run("UPDATE products SET sku = 'JEAN' WHERE id = 'jean'");
        expect(code(() => counts.scan(api, c.id, 'JEAN'))).toBe('COUNT_NEEDS_VARIANT');
        expect(counts.countLines(api, c.id)).toEqual([]);
    });

    it('one section only: pieces of another section are refused, the rest is listed as not counted', () => {
        const c = counts.startCount(api, { categoryId: 'acc' });
        expect(code(() => counts.scan(api, c.id, 'J-N-38'))).toBe('COUNT_OUT_OF_SCOPE');
        api.run("UPDATE products SET sku = 'BELT' WHERE id = 'belt'");
        counts.scan(api, c.id, 'BELT', 8);
        const s = counts.summary(api, c.id);
        expect(s.lines).toHaveLength(1);
        expect(s.not_counted).toBe(0);
        api.transaction(() => counts.confirmCount(api, c.id, { reason: 'Accessoires' }));
        expect(beltStock(api)).toBe(8);
        // Jeans not touched
        expect(stockOf(api, v['J-N-38'])).toBe(4);

        const all = counts.startCount(api, {});
        counts.scan(api, all.id, 'J-N-38');
        expect(counts.summary(api, all.id).not_counted).toBe(5); // 4 other jeans + the belt
    });

    it('typing a number, removing a line and cancelling never change the stock', () => {
        const c = counts.startCount(api, {});
        expect(code(() => counts.startCount(api, {}))).toBe('COUNT_ALREADY_OPEN');
        const line = counts.scan(api, c.id, 'J-N-38');
        expect(counts.setCounted(api, c.id, line.id, 0)).toMatchObject({ counted: 0, difference: -4 });
        expect(code(() => counts.setCounted(api, c.id, line.id, -1))).toBe('COUNT_QUANTITY');
        counts.removeLine(api, c.id, line.id);
        counts.scan(api, c.id, 'J-B-40', 9);
        counts.cancelCount(api, c.id);
        expect(counts.getCount(api, c.id).status).toBe('cancelled');
        expect([stockOf(api, v['J-N-38']), stockOf(api, v['J-B-40'])]).toEqual([4, 3]);
        expect(api.get("SELECT COUNT(*) AS n FROM inventory_logs WHERE type = 'count'").n).toBe(0);
        // A new count can start after a cancelled one
        expect(counts.startCount(api, {}).status).toBe('open');
    });

    it('a sale made while counting is taken into account when confirming', () => {
        const c = counts.startCount(api, {});
        counts.scan(api, c.id, 'J-N-38', 3); // 3 on the shelf, program says 4
        // One piece sold meanwhile: program now 3, so no correction is needed
        api.run('UPDATE product_variants SET stock_quantity = 3 WHERE id = ?', [v['J-N-38']]);
        const done = api.transaction(() => counts.confirmCount(api, c.id, { reason: 'x' }));
        expect(done.lines[0]).toMatchObject({ expected: 3, counted: 3, difference: 0 });
        expect(stockOf(api, v['J-N-38'])).toBe(3);
    });

    it('the count in progress and the report are still there after reopening the program', async () => {
        const c = counts.startCount(api, { employeeId: 'boss' });
        counts.scan(api, c.id, 'J-N-38', 2);
        let again = await reopen(shop.db);
        expect(counts.currentCount(again.api)).toMatchObject({ id: c.id, status: 'open', employee_name: 'Karim' });
        expect(counts.countLines(again.api, c.id)[0]).toMatchObject({ counted: 2, expected: 4 });
        again.api.transaction(() => counts.confirmCount(again.api, c.id, { reason: 'x' }));
        const db2 = again.db;
        again = await reopen(db2);
        expect(counts.currentCount(again.api)).toBeNull();
        expect(counts.listCounts(again.api)[0]).toMatchObject({ id: c.id, status: 'confirmed', lines: 1, difference: -2 });
        // The report keeps the figures of the day it was confirmed
        again.api.run('UPDATE product_variants SET stock_quantity = 50 WHERE id = ?', [v['J-N-38']]);
        expect(counts.countLines(again.api, c.id)[0]).toMatchObject({ expected: 4, counted: 2, difference: -2 });
    });
});
