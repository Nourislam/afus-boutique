import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, sell, loadShiftService, reopen, stockOf } from './helpers/shop';

const require = createRequire(import.meta.url);
const exchange = require('../electron/services/exchangeService');
const returns = require('../electron/services/returnService');
const salesStats = require('../electron/services/salesStatsService');
const dashboard = require('../electron/services/dashboardService');

const RANGE = { startDate: '2000-01-01 00:00:00', endDate: '2999-12-31 23:59:59' };
const NO_TAX = { enabled: false };
const swap = (api, input, tax = NO_TAX) => api.transaction(() => exchange.createExchange(api, { employee_id: 'cash1', ...input }, tax));
const code = (fn) => { try { fn(); } catch (e) { return e.message.split('|')[0]; } return null; };

describe('exchange (built on the returns)', () => {
    let shop, api, v;
    beforeEach(async () => {
        shop = await createShop();
        ({ api, v } = shop);
        api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('sh1', 'cash1', '2000-01-01T00:00:00.000Z', 1000)");
        // Black 38 x2 sold for cash
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], label: 'Noir / 38', qty: 2, price: 3000 }]);
    });

    it('same price, other size: nothing to pay, both stocks move, linked to the ticket', () => {
        const before = { old: stockOf(api, v['J-N-38']), next: stockOf(api, v['J-N-40']) };
        const r = swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-N-40'] });
        expect(r).toMatchObject({ credit: 3000, new_total: 3000, difference: 0, payment_method: null, original_receipt: 'R-s1' });
        expect(stockOf(api, v['J-N-38'])).toBe(before.old + 1);
        expect(stockOf(api, v['J-N-40'])).toBe(before.next - 1);

        const link = exchange.exchangesOfSale(api, 's1');
        expect(link).toHaveLength(1);
        expect(link[0]).toMatchObject({ return_id: r.return_id, sale_id: r.sale_id, quantity: 1, difference: 0 });
        expect(api.get('SELECT return_number, total_refund FROM returns WHERE id = ?', [r.return_id])).toMatchObject({ total_refund: 3000 });
        expect(api.all('SELECT method, amount FROM payments WHERE sale_id = ?', [r.sale_id])).toEqual([{ method: 'exchange', amount: 3000 }]);
        expect(api.get('SELECT notes, status FROM sales WHERE id = ?', [r.sale_id])).toEqual({ notes: 'exchange:R-s1', status: 'completed' });
        expect(api.get("SELECT status FROM sales WHERE id = 's1'").status).toBe('partially_refunded');

        // Figures: no extra money, the old piece is not counted as sold any more
        const stats = salesStats.salesStats(api, RANGE);
        expect(stats.net_revenue).toBe(6000);
        const best = dashboard.bestSellers(api, RANGE);
        expect(best.sizes.find(s => s.size === '38').quantity).toBe(1);
        expect(best.sizes.find(s => s.size === '40').quantity).toBe(1);
        // The drawer did not move
        expect(loadShiftService(api).getShiftStats('sh1').expected_cash).toBe(1000 + 6000);
    });

    it('a different colour works the same way', () => {
        const r = swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-B-40'] });
        expect(r.difference).toBe(0);
        expect(stockOf(api, v['J-B-40'])).toBe(2);
        expect(api.get('SELECT variant_label FROM sale_items WHERE sale_id = ?', [r.sale_id]).variant_label).toBe('Bleu / 40');
    });

    it('the customer pays the difference (dearer size), the drawer gets it', () => {
        const r = swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-N-44'], payment_method: 'cash' });
        expect(r).toMatchObject({ credit: 3000, new_total: 3500, difference: 500, payment_method: 'cash' });
        expect(api.all('SELECT method, amount FROM payments WHERE sale_id = ? ORDER BY method DESC', [r.sale_id]))
            .toEqual([{ method: 'exchange', amount: 3000 }, { method: 'cash', amount: 500 }]);
        expect(salesStats.salesStats(api, RANGE).net_revenue).toBe(6500);
        expect(loadShiftService(api).getShiftStats('sh1').expected_cash).toBe(1000 + 6000 + 500);
    });

    it('the shop gives the difference back in cash (cheaper article)', () => {
        const r = swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_product_id: 'belt' });
        expect(r).toMatchObject({ credit: 3000, new_total: 800, difference: -2200 });
        expect(api.get("SELECT stock_quantity FROM products WHERE id = 'belt'").stock_quantity).toBe(9);
        expect(api.all('SELECT method, amount FROM payments WHERE sale_id = ?', [r.sale_id])).toEqual([{ method: 'exchange', amount: 800 }]);
        expect(salesStats.salesStats(api, RANGE).net_revenue).toBe(3800);
        const drawer = loadShiftService(api).getShiftStats('sh1');
        expect(drawer.total_cash_refunds).toBe(2200);
        expect(drawer.expected_cash).toBe(1000 + 6000 - 2200);
    });

    it('size not in stock: refused, nothing saved', () => {
        expect(code(() => swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-N-42'] }))).toBe('STOCK_INSUFFICIENT');
        expect(api.get('SELECT COUNT(*) AS n FROM returns').n).toBe(0);
        expect(api.get('SELECT COUNT(*) AS n FROM exchanges').n).toBe(0);
        expect(stockOf(api, v['J-N-38'])).toBe(2);
    });

    it('part of the pieces, then the rest, never more than were sold', () => {
        swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-N-40'] });
        swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-B-40'] });
        expect(code(() => swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-B-40'] }))).toBe('RETURN_TOO_MANY');
        expect(code(() => swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 0, new_variant_id: v['J-B-40'] }))).toBe('EXCHANGE_QUANTITY');
    });

    it('more pieces than sold, or than are left after a return, are refused', () => {
        expect(code(() => swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 3, new_variant_id: v['J-B-40'] }))).toBe('RETURN_TOO_MANY');
        api.transaction(() => returns.createReturn(api, {
            id: 'ret1', sale_id: 's1', return_number: 'RET-1', total_refund: 3000, employee_id: 'cash1',
            items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 3000, condition: 'sellable' }],
        }));
        expect(code(() => swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 2, new_variant_id: v['J-B-40'] }))).toBe('RETURN_TOO_MANY');
        expect(swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-B-40'] }).difference).toBe(0);
    });

    it('the same piece, a voided/cancelled ticket or a kridi ticket are refused (returns too)', () => {
        expect(code(() => swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-N-38'] }))).toBe('EXCHANGE_SAME_PIECE');
        for (const status of ['voided', 'cancelled']) {
            api.run('UPDATE sales SET status = ? WHERE id = ?', [status, 's1']);
            expect(code(() => swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-N-40'] }))).toBe('SALE_NOT_COUNTED');
            expect(code(() => api.transaction(() => returns.createReturn(api, {
                id: `r-${status}`, sale_id: 's1', return_number: 'RET-X', total_refund: 1, items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 1, condition: 'sellable' }],
            })))).toBe('SALE_NOT_COUNTED');
        }
        sell(api, 'k1', [{ product: 'jean', variant: v['J-N-40'], qty: 1, price: 3000 }], { method: 'credit' });
        expect(code(() => swap(api, { sale_id: 'k1', sale_item_id: 'k1-0', quantity: 1, new_variant_id: v['J-B-40'] }))).toBe('EXCHANGE_CREDIT_SALE');
    });

    it('credit = what was really paid: ticket discount and TVA of that day', () => {
        // 2 pieces, 10% off the ticket: each piece was paid 2 700
        sell(api, 'd1', [{ product: 'jean', variant: v['J-N-40'], qty: 2, price: 3000 }], { discount: 600 });
        const r = swap(api, { sale_id: 'd1', sale_item_id: 'd1-0', quantity: 1, new_variant_id: v['J-B-40'] });
        expect(r).toMatchObject({ credit: 2700, new_total: 3000, difference: 300 });

        // TVA 19% added on top that day; today TVA 9% added on top
        sell(api, 't1', [{ product: 'belt', qty: 1, price: 800, name: 'Ceinture' }], { tax: 152, inclusive: false });
        const t = swap(api, { sale_id: 't1', sale_item_id: 't1-0', quantity: 1, new_variant_id: v['J-B-40'] }, { enabled: true, rate: 9, inclusive: false });
        expect(t.credit).toBe(952);
        expect(t.new_total).toBe(3270);
        expect(api.get('SELECT tax_amount FROM sales WHERE id = ?', [t.sale_id]).tax_amount).toBe(270);
    });

    it('a damaged piece is not put back on sale', () => {
        swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-N-40'], condition: 'damaged' });
        expect(stockOf(api, v['J-N-38'])).toBe(2);
        expect(stockOf(api, v['J-N-40'])).toBe(1);
    });

    it('everything is still there after closing and reopening the program', async () => {
        const r = swap(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-N-44'] });
        const again = await reopen(shop.db);
        expect(exchange.exchangesOfSale(again.api, 's1')).toEqual([expect.objectContaining({ id: r.id, difference: 500, new_receipt: r.receipt_number })]);
        expect(stockOf(again.api, v['J-N-38'])).toBe(3);
        expect(stockOf(again.api, v['J-N-44'])).toBe(1);
        expect(salesStats.salesStats(again.api, RANGE).net_revenue).toBe(6500);
        expect(returns.returnableQuantity(again.api, 's1-0')).toBe(1);
    });
});
