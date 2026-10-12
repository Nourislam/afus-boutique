import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';
import { clearanceLink, readClearance } from '../src/lib/listFilters';
import { lineStatus, receivingSummary, groupByArticle, arrivedLabelsLink, readArrivedPieces } from '../src/lib/receiving';

const require = createRequire(import.meta.url);
const insights = require('../electron/services/insightsService');
const markdowns = require('../electron/services/markdownService');
const returnService = require('../electron/services/returnService');
const ipcGuard = require('../electron/services/ipcGuard');
const { isPromotionLive, parseIds, bestPromotion } = require('../electron/shared/promotions.mjs');

const NOW = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86400000;
const ago = (days, from = NOW) => new Date(from - days * DAY).toISOString().replace('T', ' ').slice(0, 19);
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code || e.message.split('|')[0]; } return null; };

describe('season / collection report, markdown manager, receiving', () => {
    let api, v;
    let n = 0;
    // A ticket of `qty` pieces `days` days ago (before `from`), purchase cost saved on the line
    const sale = (variant, qty, days, { product = 'jean', price = 3000, cost = 1800, status = 'completed', from = NOW, tax = 0 } = {}) => {
        n += 1;
        const id = `s${n}`;
        api.run(`INSERT INTO sales (id, receipt_number, employee_id, subtotal, tax_amount, discount_amount, total, status, created_at)
                 VALUES (?, ?, 'cash1', ?, ?, 0, ?, ?, ?)`, [id, `R${n}`, qty * price, tax, qty * price, status, ago(days, from)]);
        api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, quantity, unit_price, tax_amount, total, unit_cost)
                 VALUES (?, ?, ?, ?, 'x', ?, ?, ?, ?, ?)`, [`${id}-0`, id, product, variant || null, qty, price, tax, qty * price, cost]);
        return id;
    };
    beforeEach(async () => {
        ({ api, v } = await createShop());
        n = 0;
        api.run('UPDATE products SET created_at = ?', [ago(400)]);
    });

    describe('1. season report', () => {
        beforeEach(() => {
            api.run("UPDATE products SET season = 'winter', collection = 'Denim 26' WHERE id = 'jean'");
            api.run("UPDATE products SET season = 'summer', collection = 'Denim 26' WHERE id = 'belt'");
        });

        it('bought = sold + left, revenue without TVA after returns, profit = revenue - cost of what sold', () => {
            // Jean: 11 in stock. 3 sold at 3 000 (cost 1 800), 1 of them brought back; a voided ticket does not count
            const back = sale(v['J-N-38'], 3, 20);
            sale(v['J-N-40'], 5, 10, { status: 'voided' });
            returnService.createReturn(api, { id: 'r1', sale_id: back, return_number: 'RET-1', total_refund: 3000, employee_id: 'cash1',
                items: [{ sale_item_id: `${back}-0`, quantity: 1, refund_amount: 3000, condition: 'sellable' }] });
            // The return put the piece back: 12 in stock now
            // TVA on the line is not revenue
            sale(v['J-B-40'], 1, 5, { tax: 479 });
            const r = insights.seasonReport(api, { by: 'season' });
            const winter = r.rows.find(x => x.key === 'winter');
            expect(winter).toMatchObject({ articles: 1, sold: 3, stock: 12, bought: 15, sold_cost: 3 * 1800, rate: 20 });
            expect(winter.revenue).toBe(2 * 3000 + (3000 - 479));
            expect(winter.profit).toBe(winter.revenue - 3 * 1800);
            // Left at purchase price: 12 pieces at 1 800; bought = cost of what sold + of what is left
            expect(winter.stock_cost).toBe(12 * 1800);
            expect(winter.bought_cost).toBe(15 * 1800);
            // Clearance takes the articles that still have pieces
            expect(winter.clearance).toEqual(['jean']);
            const summer = r.rows.find(x => x.key === 'summer');
            expect(summer).toMatchObject({ sold: 0, stock: 10, bought: 10, revenue: 0, profit: 0, rate: 0, clearance: ['belt'] });
            expect(r.total).toMatchObject({ bought: 25, sold: 3, stock: 22 });
        });

        it('by collection, and without season / collection the article is left out', () => {
            const r = insights.seasonReport(api, { by: 'collection' });
            expect(r.by).toBe('collection');
            expect(r.rows.map(x => x.key)).toEqual(['Denim 26']);
            expect(r.rows[0]).toMatchObject({ articles: 2, stock: 21 });
            api.run("UPDATE products SET season = NULL, collection = '  '");
            expect(insights.seasonReport(api).rows).toEqual([]);
            expect(insights.seasonReport(api, { by: 'collection' }).rows).toEqual([]);
        });

        it('an article sold out is not in the clearance', () => {
            api.run("UPDATE products SET stock_quantity = 0 WHERE id = 'belt'");
            expect(insights.seasonReport(api).rows.find(x => x.key === 'summer').clearance).toEqual([]);
        });

        it('the clearance only opens a prefilled form (articles, name, percentage)', () => {
            const link = clearanceLink({ ids: ['jean', 'belt'], name: 'Liquidation Hiver', percent: 30 });
            expect(link.startsWith('/offers?tab=promotions&')).toBe(true);
            const params = new URL(link, 'http://app').searchParams;
            expect(readClearance(params)).toEqual({ ids: ['jean', 'belt'], name: 'Liquidation Hiver', value: 30 });
            expect(readClearance(new URLSearchParams(''))).toBeNull();
            expect(readClearance(new URLSearchParams('discountProducts=a&discountValue=500')).value).toBe('');
        });
    });

    describe('3. markdown manager', () => {
        // The jean sells well (7 of 18 in 30 days), the belt does not (nothing sold)
        beforeEach(() => { sale(v['J-N-38'], 7, 10); });
        const suggested = (now = NOW) => markdowns.suggestions(api, { now }).map(r => [r.product_id, r.step]);

        it('suggests 10 % on what does not sell, nothing changes before the owner answers', () => {
            expect(suggested()).toEqual([['belt', 10]]);
            const row = markdowns.suggestions(api, { now: NOW })[0];
            expect(row).toMatchObject({ stock: 10, sold: 0, rate: 0, price: 800, new_price: 720, margin_after: 420, below_cost: false, previous_step: null });
            expect(api.all('SELECT * FROM promotions')).toEqual([]);
            expect(api.all('SELECT * FROM markdowns')).toEqual([]);
            // A new article (less than 30 days) is not judged yet
            api.run("UPDATE products SET created_at = ? WHERE id = 'belt'", [ago(10)]);
            expect(suggested()).toEqual([]);
        });

        it('approve: one promotion on that article for 14 days, then 20 %, then 30 %, then nothing more', () => {
            const first = markdowns.decide(api, { productId: 'belt', percent: 10, approve: true, employeeId: 'owner', name: 'Démarque -10 % Ceinture', now: NOW });
            const promo = api.get('SELECT * FROM promotions WHERE id = ?', [first.promotion_id]);
            expect(promo).toMatchObject({ type: 'percentage', value: 10, applies_to: 'product', auto_apply: 1, is_active: 1, name: 'Démarque -10 % Ceinture' });
            expect(parseIds(promo.applies_to_ids)).toEqual(['belt']);
            expect(isPromotionLive(promo, NOW)).toBe(true);
            expect(isPromotionLive(promo, NOW + 16 * DAY)).toBe(false);
            // The till gives it on the belt only
            expect(bestPromotion([promo], [{ product_id: 'belt', unit_price: 800, quantity: 1 }], { now: NOW }).amount).toBe(80);
            expect(bestPromotion([promo], [{ product_id: 'jean', unit_price: 3000, quantity: 1 }], { now: NOW })).toBeNull();
            // While it runs: not suggested again, and a second approval is refused
            expect(suggested(NOW + 5 * DAY)).toEqual([]);
            expect(codeOf(() => markdowns.decide(api, { productId: 'belt', percent: 20, approve: true, now: NOW + DAY }))).toBe('MARKDOWN_RUNNING');
            // Ended and still not selling: next step
            const later = NOW + 16 * DAY;
            expect(markdowns.suggestions(api, { now: later }).find(r => r.product_id === 'belt')).toMatchObject({ step: 20, previous_step: 10 });
            markdowns.decide(api, { productId: 'belt', percent: 20, approve: true, now: later });
            const third = later + 16 * DAY;
            expect(markdowns.suggestions(api, { now: third }).find(r => r.product_id === 'belt')).toMatchObject({ step: 30, previous_step: 20, new_price: 560 });
            markdowns.decide(api, { productId: 'belt', percent: 30, approve: true, now: third });
            expect(markdowns.suggestions(api, { now: third + 16 * DAY }).find(r => r.product_id === 'belt')).toBeUndefined();
            expect(api.get('SELECT COUNT(*) AS n FROM promotions').n).toBe(3);
        });

        it('refuse: noted, not suggested for 14 days, then back at the same step', () => {
            const row = markdowns.decide(api, { productId: 'belt', percent: 10, approve: false, now: NOW });
            expect(row).toMatchObject({ status: 'refused', promotion_id: null });
            expect(api.all('SELECT * FROM promotions')).toEqual([]);
            expect(suggested(NOW + 13 * DAY)).toEqual([]);
            expect(suggested(NOW + 15 * DAY)).toEqual([['belt', 10]]);
        });

        it('a markdown under the purchase price is flagged; only 10, 20 or 30 %; an article the shop discounted itself is left alone', () => {
            api.run("UPDATE products SET cost = 750 WHERE id = 'belt'");
            expect(markdowns.suggestions(api, { now: NOW })[0]).toMatchObject({ new_price: 720, below_cost: true, margin_after: -30 });
            expect(codeOf(() => markdowns.decide(api, { productId: 'belt', percent: 50, approve: true, now: NOW }))).toBe('MARKDOWN_STEP');
            expect(codeOf(() => markdowns.decide(api, { productId: 'nope', percent: 10, approve: true, now: NOW }))).toBe('MARKDOWN_NO_ARTICLE');
            api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, applies_to_ids, auto_apply)
                     VALUES ('mine', 'Promo', 'percentage', 15, 1, 'product', '["belt"]', 1)`);
            expect(suggested()).toEqual([]);
        });

        it('did it work? pieces a day before against during the markdown', () => {
            markdowns.decide(api, { productId: 'belt', percent: 10, approve: true, now: NOW });
            // One day in: too early
            expect(markdowns.results(api, { now: NOW + DAY })[0]).toMatchObject({ verdict: 'early', running: true, rate_before: 0 });
            // Nothing sold in 5 days: did not work
            expect(markdowns.results(api, { now: NOW + 5 * DAY })[0]).toMatchObject({ verdict: 'no', sold: 0 });
            // 4 pieces sold during it (a voided ticket does not count): worked
            sale(null, 4, -2, { product: 'belt', price: 720, cost: 300 });
            sale(null, 3, -3, { product: 'belt', price: 720, cost: 300, status: 'voided' });
            const r = markdowns.results(api, { now: NOW + 6 * DAY })[0];
            expect(r).toMatchObject({ verdict: 'worked', sold: 4, revenue: 2880, percent: 10, name: 'Ceinture' });
            expect(r.rate_during).toBeCloseTo(4 / 6, 2);
            // A refused one is not in the results
            markdowns.decide(api, { productId: 'jean', percent: 10, approve: false, now: NOW });
            expect(markdowns.results(api, { now: NOW + 6 * DAY }).map(x => x.product_id)).toEqual(['belt']);
        });

        it('only who manages promotions may answer (main process)', () => {
            const rule = ipcGuard.RULES['insights:markdownDecide'];
            expect(ipcGuard.allows(rule, { id: 'c', role: 'cashier' })).toBe(false);
            expect(ipcGuard.allows(rule, { id: 'a', role: 'admin' })).toBe(true);
        });
    });

    describe('2. receiving: ordered against arrived, labels of what arrived', () => {
        const lines = [
            { id: 'a', product_id: 'jean', product_name: 'Jean', variant_id: 'v38', variant_label: 'Noir / 38', quantity: 5, received_quantity: 0, receive_now: 3 },
            { id: 'b', product_id: 'jean', product_name: 'Jean', variant_id: 'v40', variant_label: 'Noir / 40', quantity: 4, received_quantity: 1, receive_now: 3 },
            { id: 'c', product_id: 'belt', product_name: 'Ceinture', variant_id: null, quantity: 2, received_quantity: 0, receive_now: 4 },
            { id: 'd', product_id: 'jean', product_name: 'Jean', variant_id: 'v42', variant_label: 'Noir / 42', quantity: 2, received_quantity: 0, receive_now: 0 },
        ];

        it('each colour / size: short, complete or over, counting earlier deliveries', () => {
            expect(lineStatus(lines[0], 3)).toEqual({ ordered: 5, arrived: 3, diff: -2, status: 'short' });
            expect(lineStatus(lines[1], 3)).toEqual({ ordered: 4, arrived: 4, diff: 0, status: 'full' });
            expect(lineStatus(lines[2], 4)).toMatchObject({ diff: 2, status: 'over' });
            expect(receivingSummary(lines)).toEqual({ lines: 4, full: 1, short: 2, over: 1, missing: 4, extra: 2, pieces: 10 });
            expect(groupByArticle(lines).map(g => [g.name, g.items.map(i => i.id)])).toEqual([['Jean', ['a', 'b', 'd']], ['Ceinture', ['c']]]);
        });

        it('labels: only the pieces of this delivery, a line at 0 is left out', () => {
            const received = lines.filter(l => l.receive_now > 0).map(l => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.receive_now }));
            const link = arrivedLabelsLink(received);
            expect(link.startsWith('/labels?tab=articles&pieces=')).toBe(true);
            expect(readArrivedPieces(new URL(link, 'http://app').searchParams)).toEqual([
                { productId: 'jean', variantId: 'v38', quantity: 3 },
                { productId: 'jean', variantId: 'v40', quantity: 3 },
                { productId: 'belt', variantId: null, quantity: 4 },
            ]);
            expect(arrivedLabelsLink([{ product_id: 'jean', variant_id: 'v', quantity: 0 }])).toBeNull();
            expect(readArrivedPieces(new URLSearchParams('pieces=x::abc,:v:2'))).toEqual([]);
        });
    });
});
