import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const insights = require('../electron/services/insightsService');
const returnService = require('../electron/services/returnService');
const { mix, plan, MIN_SOLD } = require('../electron/shared/buyingPlan.mjs');

const NOW = Date.parse('2026-10-11T12:00:00Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

describe('decision figures: run-out, sell-through, matrix, buying plan, stock worth, dormant stock', () => {
    let api, v;
    let n = 0;
    // A ticket of `qty` pieces of a variant (or of the belt), `days` days ago
    const sale = (variant, qty, days, { product = 'jean', price = 3000, status = 'completed' } = {}) => {
        n += 1;
        const id = `s${n}`;
        api.run(`INSERT INTO sales (id, receipt_number, employee_id, subtotal, tax_amount, discount_amount, total, status, created_at)
                 VALUES (?, ?, 'cash1', ?, 0, 0, ?, ?, ?)`, [id, `R${n}`, qty * price, qty * price, status, ago(days)]);
        api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, quantity, unit_price, total, unit_cost)
                 VALUES (?, ?, ?, ?, 'x', ?, ?, ?, 1800)`, [`${id}-0`, id, product, variant || null, qty, price, qty * price]);
        return id;
    };
    beforeEach(async () => {
        ({ api, v } = await createShop());
        n = 0;
        // Articles were created long ago (dormant stock counts only articles older than the period)
        api.run("UPDATE products SET created_at = ?", [ago(400)]);
    });

    it('1. run-out: pieces left / pieces sold a day, only what lasts a week or less', () => {
        // J-N-38: 4 left, 14 sold in 14 days = 1 a day -> 4 days
        for (let d = 1; d <= 14; d++) sale(v['J-N-38'], 1, d);
        // J-B-40: 3 left, 2 sold in 14 days -> 21 days: not listed
        sale(v['J-B-40'], 2, 3);
        // A voided sale and a returned piece do not count
        sale(v['J-N-40'], 5, 2, { status: 'voided' });
        const back = sale(v['J-N-40'], 2, 2);
        returnService.createReturn(api, { id: 'r1', sale_id: back, return_number: 'RET-1', total_refund: 6000, employee_id: 'cash1',
            items: [{ sale_item_id: `${back}-0`, quantity: 2, refund_amount: 6000, condition: 'sellable' }] });
        const rows = insights.runOutSoon(api, { now: NOW, days: 14, horizon: 7 });
        expect(rows.map(r => r.sku)).toEqual(['J-N-38']);
        expect(rows[0]).toMatchObject({ stock: 4, sold: 14, per_day: 1, days_left: 4 });
        // Sold out already (0 left): not "soon", it is in "sold out"
        api.run('UPDATE product_variants SET stock_quantity = 0 WHERE id = ?', [v['J-N-38']]);
        expect(insights.runOutSoon(api, { now: NOW })).toEqual([]);
    });

    it('2. sell-through = sold / (sold + in stock), per article, collection and season', () => {
        api.run("UPDATE products SET collection = 'Denim 2026', season = 'winter' WHERE id = 'jean'");
        api.run("UPDATE products SET collection = 'Basics', season = 'winter' WHERE id = 'belt'");
        // Jean: 11 pieces in stock (4+2+0+3+2); 9 kept -> 9 / 20 = 45 %
        sale(v['J-N-38'], 6, 10); sale(v['J-N-40'], 3, 5);
        // Belt: 10 in stock, 10 sold -> 50 %
        sale(null, 10, 3, { product: 'belt', price: 800 });
        const byArticle = insights.sellThrough(api, { by: 'product' });
        expect(byArticle.rows.find(r => r.key === 'jean')).toMatchObject({ sold: 9, stock: 11, rate: 45 });
        expect(byArticle.rows.find(r => r.key === 'belt')).toMatchObject({ sold: 10, stock: 10, rate: 50 });
        expect(byArticle.total).toEqual({ sold: 19, stock: 21, rate: 47.5 });
        expect(insights.sellThrough(api, { by: 'collection' }).rows.map(r => r.key).sort()).toEqual(['Basics', 'Denim 2026']);
        expect(insights.sellThrough(api, { by: 'season' }).rows).toEqual([expect.objectContaining({ key: 'winter', sold: 19, stock: 21, articles: 2 })]);
        // Only the sales of the period
        expect(insights.sellThrough(api, { by: 'product', since: ago(7) }).rows.find(r => r.key === 'jean')).toMatchObject({ sold: 3 });
    });

    it('3. matrix: colour by size, stock and pieces sold in each cell, totals', () => {
        sale(v['J-N-38'], 2, 4); sale(v['J-B-40'], 1, 4);
        const m = insights.productMatrix(api, 'jean');
        expect(m.colors.map(c => c.key)).toEqual(['Noir', 'Bleu']);
        expect(m.sizes).toEqual(['38', '40', '42', '44']);
        expect(m.cells.find(c => c.color === 'Noir' && c.size === '38')).toMatchObject({ stock: 4, sold: 2 });
        expect(m.cells.find(c => c.color === 'Bleu' && c.size === '40')).toMatchObject({ stock: 3, sold: 1 });
        expect(m.totals).toMatchObject({ stock: 11, sold: 3 });
        expect(m.totals.bySize.find(s => s.size === '40')).toEqual({ size: '40', stock: 5, sold: 1 });
        expect(insights.productMatrix(api, 'nope')).toBeNull();
    });

    it('4. size / colour mix: buy more of what sells above its share, less of what does not', () => {
        const items = [
            { size: 'M', sold: 40, stock: 0 }, { size: 'L', sold: 30, stock: 10 },
            { size: 'XL', sold: 20, stock: 20 }, { size: 'XXL', sold: 10, stock: 50 },
        ];
        const m = mix(items, 'size');
        const advice = Object.fromEntries(m.rows.map(r => [r.key, r.advice]));
        expect(m.sold).toBe(100);
        expect(advice).toEqual({ M: 'up', L: 'up', XL: 'same', XXL: 'down' });
        expect(m.rows.find(r => r.key === 'M').demand).toBeCloseTo(0.4);
        // Too few pieces sold: no advice
        expect(mix([{ size: 'M', sold: MIN_SOLD - 1, stock: 0 }], 'size').rows[0].advice).toBe('unknown');
    });

    it('4. buying plan: whole pieces in proportion to sales, exactly the total, a cell never sold keeps a small share', () => {
        const cells = [{ id: 'a', sold: 31 }, { id: 'b', sold: 34 }, { id: 'c', sold: 14 }, { id: 'd', sold: 17 }, { id: 'e', sold: 4 }, { id: 'f', sold: 0 }];
        const p = plan(cells, 100);
        expect(p.reduce((t, c) => t + c.quantity, 0)).toBe(100);
        expect(p.find(c => c.id === 'b').quantity).toBeGreaterThan(p.find(c => c.id === 'a').quantity);
        expect(p.find(c => c.id === 'f').quantity).toBeGreaterThanOrEqual(0);
        expect(plan(cells, 0).every(c => c.quantity === 0)).toBe(true);
        expect(plan(cells, 7).reduce((t, c) => t + c.quantity, 0)).toBe(7);
        expect(plan([], 10)).toEqual([]);
    });

    it('5. stock worth: bought for, sold for, profit in it, pieces without a cost; 6. dormant stock', () => {
        // Jean: 11 pieces at 1 800 cost; 9 at 3 000 and 2 (the 44) at 3 500. Belt: 10 at 300 / 800
        const w = insights.stockWorth(api, { now: NOW, dormantDays: 60 });
        expect(w).toMatchObject({ cost: 11 * 1800 + 10 * 300, retail: 9 * 3000 + 2 * 3500 + 10 * 800, units: 21, units_without_cost: 0 });
        expect(w.profit).toBe(w.retail - w.cost);
        // Nothing sold in 60 days: both articles are asleep
        expect(w.dormant).toMatchObject({ articles: 2, pieces: 21, cost: w.cost });
        // The jean sells (a piece kept 10 days ago): only the belt stays asleep
        sale(v['J-N-38'], 1, 10);
        const dead = insights.deadStock(api, { now: NOW, days: 60 });
        expect(dead.rows.map(r => r.product_id)).toEqual(['belt']);
        expect(dead.total).toEqual({ articles: 1, pieces: 10, cost: 3000, retail: 8000 });
        // Sold 70 days ago: asleep for 60 days, not for 90
        sale(null, 1, 70, { product: 'belt', price: 800 });
        expect(insights.deadStock(api, { now: NOW, days: 60 }).rows.map(r => r.product_id)).toEqual(['belt']);
        expect(insights.deadStock(api, { now: NOW, days: 90 }).rows.map(r => r.product_id)).toEqual([]);
        // A new article (created inside the period) is not "dormant"
        api.run("UPDATE products SET created_at = ? WHERE id = 'belt'", [ago(5)]);
        expect(insights.deadStock(api, { now: NOW, days: 60 }).rows).toEqual([]);
        // A piece without a purchase price is shown apart (profit would look too high)
        api.run("UPDATE products SET cost = 0 WHERE id = 'belt'");
        expect(insights.stockWorth(api, { now: NOW }).units_without_cost).toBe(10);
    });
});
