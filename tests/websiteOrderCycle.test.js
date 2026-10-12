// The whole COD cycle: Confirmed -> Preparing -> Shipped -> Delivered ->
// Money received (the completed sale). Every transition, the stock, the
// sale, the revenue, the best sellers; returns checked piece by piece;
// never twice.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const orderBook = require('../electron/website/orders/orderBook');
const rankings = require('../electron/services/storeRankings');
const dashboard = require('../electron/services/dashboardService');
const { salesStats, paymentMethods } = require('../electron/services/salesStatsService');
const { salesJournal } = require('../electron/services/accountingService');
const { createReturn } = require('../electron/services/returnService');
const { applyMigrations, getColumns } = require('../electron/database/migrations');

const codedError = (code, params) => Object.assign(new Error(code), { code, params });
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const RANGE = { startDate: '2000-01-01 00:00:00', endDate: '2100-01-01 00:00:00' };
let n = 0;
const remote = (lines, extra = {}) => ({
    id: `o${++n}`, created_at: new Date(Date.now() - 3600e3).toISOString(), customer_name: 'Amina Benali', first_name: 'Amina', last_name: 'Benali',
    phone: '0661223344', wilaya: '16 - Alger', commune: 'Kouba', address: 'Rue 5', delivery: 'home', items: JSON.stringify(lines), ...extra,
});
const jean = (size, color, quantity = 1) => ({ product_id: 'jean', product_name: 'Jean', size, color, quantity, unit_price: 3000 });
const belt = (quantity = 1) => ({ product_id: 'belt', product_name: 'Ceinture', quantity, unit_price: 800 });

describe('the COD cycle up to the completed sale', () => {
    let api, v;
    const set = (id, status) => orderBook.setStatus(api, { id, status, employeeId: 'owner', codedError });
    const walk = (id, steps) => steps.forEach(st => set(id, st));
    const check = (id, lines) => orderBook.checkReturn(api, { id, lines, employeeId: 'owner', codedError });
    const stockOf = (sku) => api.get('SELECT stock_quantity AS n FROM product_variants WHERE id = ?', [v[sku]]).n;
    const beltStock = () => api.get("SELECT stock_quantity AS n FROM products WHERE id = 'belt'").n;
    // Everything the shop's figures show, from every screen that counts sales
    const figures = () => {
        const stats = salesStats(api, RANGE);
        return {
            sales: api.get('SELECT COUNT(*) AS n FROM sales').n,
            revenue: stats.total_revenue, net: stats.net_revenue, pieces: stats.items_sold,
            cod: paymentMethods(api, RANGE).find(m => m.method === 'cod')?.total || 0,
            best: rankings.bestSellers(api, { now: Date.now() + 60e3 }).map(r => [r.id, r.sold]),
            home: dashboard.bestSellers(api, RANGE).products.map(p => [p.product_id, p.quantity]),
            journal: salesJournal(api, RANGE).totals.amount_ttc,
        };
    };
    const NOTHING = { sales: 0, revenue: 0, net: 0, pieces: 0, cod: 0, best: [], home: [], journal: 0 };

    beforeEach(async () => { ({ api, v } = await createShop()); n = 0; });

    it('Confirmed, Preparing, Shipped, Delivered: never a sale; Money received: one completed sale in every figure, the stock out once', () => {
        orderBook.importOrders(api, [remote([jean('40', 'Bleu', 2), belt(1)])]);
        const start = [stockOf('J-B-40'), beltStock()];
        for (const st of ['contacted', 'confirmed', 'preparing', 'shipped', 'delivered']) {
            const r = set('o1', st);
            expect(r.sale, st).toBeNull();
            expect(figures(), st).toEqual(NOTHING);
            expect(orderBook.customerStats(api)[0], st).toMatchObject({ successful: 0, total: 0 });
            // Put aside from Confirmed: out of what the till can sell, not sold
            expect([stockOf('J-B-40'), beltStock()], st).toEqual(st === 'contacted' ? start : [start[0] - 2, start[1] - 1]);
        }
        const r = set('o1', 'money_received');
        expect(r.sale).toMatchObject({ total: 6800 });
        const done = figures();
        expect(done).toEqual({ sales: 1, revenue: 6800, net: 6800, pieces: 3, cod: 6800, best: [['jean', 2], ['belt', 1]], home: [['jean', 2], ['belt', 1]], journal: 6800 });
        expect([stockOf('J-B-40'), beltStock()]).toEqual([start[0] - 2, start[1] - 1]);
        expect(orderBook.customerStats(api)[0]).toMatchObject({ successful: 1, total: 6800, delivered: 1 });
        // Sent again (a double click, a second window): nothing more, anywhere
        expect(set('o1', 'money_received').sale).toBeNull();
        for (const st of ['delivered', 'returned', 'cancelled', 'new']) expect(codeOf(() => set('o1', st)), st).toBe('WEBSITE_ORDER_FINAL');
        expect(figures()).toEqual(done);
        expect([stockOf('J-B-40'), beltStock()]).toEqual([start[0] - 2, start[1] - 1]);
        // The inventory log: put aside, released, sold — the pieces left once
        const moves = api.all("SELECT type, SUM(quantity_change) AS n FROM inventory_logs WHERE type LIKE 'website_%' OR type = 'sale' GROUP BY type ORDER BY type");
        expect(moves).toEqual([{ type: 'sale', n: -3 }, { type: 'website_release', n: 3 }, { type: 'website_reserve', n: -3 }]);
        // A sale for this order already there (whatever the order row says): never a second one
        api.run("UPDATE website_orders SET status = 'delivered', sale_id = NULL WHERE id = 'o1'");
        expect(codeOf(() => set('o1', 'money_received'))).toBe('WEBSITE_ORDER_FINAL');
        expect(figures()).toEqual(done);
    });

    it('every transition: the allowed ones keep the stock right, the others are refused and change nothing', () => {
        api.run("UPDATE products SET stock_quantity = 1000 WHERE id = 'belt'");
        const reach = {
            new: [], contacted: ['contacted'], confirmed: ['confirmed'], preparing: ['confirmed', 'preparing'],
            shipped: ['confirmed', 'shipped'], delivered: ['confirmed', 'shipped', 'delivered'],
            money_received: ['confirmed', 'shipped', 'delivered', 'money_received'], returned: ['confirmed', 'shipped', 'returned'], cancelled: ['cancelled'],
        };
        // The pieces are always somewhere: in stock, put aside, or sold
        const balanced = () => {
            const aside = api.get('SELECT COALESCE(SUM(reserved_qty), 0) AS n FROM website_order_items').n;
            const sold = api.get('SELECT COALESCE(SUM(quantity), 0) AS n FROM sale_items').n;
            return beltStock() + aside + sold;
        };
        const state = (id) => JSON.stringify([api.get('SELECT status, reserved, sale_id FROM website_orders WHERE id = ?', [id]), beltStock(),
            api.get('SELECT COUNT(*) AS n FROM sales').n, api.get('SELECT COUNT(*) AS n FROM website_order_events WHERE order_id = ?', [id]).n]);
        let allowed = 0;
        for (const from of orderBook.STATUSES) {
            for (const to of orderBook.STATUSES) {
                const [o] = [remote([belt(2)])];
                orderBook.importOrders(api, [o]);
                walk(o.id, reach[from]);
                const before = state(o.id);
                const pending = from === 'returned';
                const ok = to === from || (!pending && orderBook.NEXT[from].includes(to));
                const code = codeOf(() => set(o.id, to));
                if (ok) {
                    allowed++;
                    expect(code, `${from} -> ${to}`).toBeNull();
                    const after = api.get('SELECT status, reserved FROM website_orders WHERE id = ?', [o.id]);
                    expect(after.status, `${from} -> ${to}`).toBe(to);
                    // Put aside exactly while confirmed..delivered (and a parcel coming back)
                    expect(!!after.reserved, `${from} -> ${to}`).toBe(orderBook.RESERVING.includes(to) || to === 'returned');
                } else {
                    const expected = from === 'money_received' ? 'WEBSITE_ORDER_FINAL'
                        : to === 'money_received' && orderBook.STOPPED.includes(from) ? 'WEBSITE_ORDER_CANCELLED'
                            : pending ? 'WEBSITE_RETURN_PENDING' : 'WEBSITE_ORDER_STEP';
                    expect(code, `${from} -> ${to}`).toBe(expected);
                    expect(state(o.id), `${from} -> ${to}`).toBe(before);
                }
                expect(balanced(), `${from} -> ${to}`).toBe(1000);
            }
        }
        // The sales: one per order paid, never two
        const paid = api.get("SELECT COUNT(*) AS n FROM website_orders WHERE status = 'money_received'").n;
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(paid);
        expect(api.get('SELECT COUNT(DISTINCT notes) AS n FROM sales').n).toBe(paid);
        expect(allowed).toBeGreaterThan(30);
        // The cycle itself, and what can never happen
        expect(orderBook.NEXT.confirmed).toContain('preparing');
        expect(orderBook.NEXT.preparing).toContain('shipped');
        expect(orderBook.NEXT.shipped).toContain('delivered');
        expect(orderBook.NEXT.delivered).toContain('money_received');
        for (const st of ['new', 'contacted', 'confirmed', 'preparing', 'returned', 'cancelled']) expect(orderBook.NEXT[st], st).not.toContain('money_received');
        for (const st of ['shipped', 'delivered']) expect(orderBook.NEXT[st], st).not.toContain('cancelled');
        expect(orderBook.NEXT.money_received).toEqual([]);
    });

    it('Returned: not a sale; the pieces stay out until checked; sellable back in stock, damaged kept out; once only', () => {
        orderBook.importOrders(api, [remote([jean('38', 'Noir', 3), belt(2)])]);
        const start = [stockOf('J-N-38'), beltStock()];
        walk('o1', ['confirmed', 'preparing', 'shipped', 'delivered', 'returned']);
        expect(figures()).toEqual(NOTHING);
        expect([stockOf('J-N-38'), beltStock()]).toEqual([start[0] - 3, start[1] - 2]);
        expect(codeOf(() => set('o1', 'money_received'))).toBe('WEBSITE_ORDER_CANCELLED');
        expect(codeOf(() => set('o1', 'new'))).toBe('WEBSITE_RETURN_PENDING');
        expect(orderBook.nextStatuses(api.get("SELECT * FROM website_orders WHERE id = 'o1'"))).toEqual([]);
        // Wrong counts are refused and change nothing
        const before = [stockOf('J-N-38'), beltStock()];
        for (const lines of [
            [{ line: 0, sellable: 2, damaged: 0 }, { line: 1, sellable: 2, damaged: 0 }], // one piece of the jean missing
            [{ line: 0, sellable: 3, damaged: 1 }, { line: 1, sellable: 2, damaged: 0 }], // too many
            [{ line: 0, sellable: -1, damaged: 4 }, { line: 1, sellable: 2, damaged: 0 }],
            [{ line: 0, sellable: 1.5, damaged: 1.5 }, { line: 1, sellable: 2, damaged: 0 }],
            [{ line: 0, sellable: 3, damaged: 0 }], // the belt not counted
            [{ line: 0, sellable: 3, damaged: 0 }, { line: 1, sellable: 2, damaged: 0 }, { line: 9, sellable: 1, damaged: 0 }],
        ]) {
            expect(codeOf(() => check('o1', lines)), JSON.stringify(lines)).toMatch(/WEBSITE_RETURN_CHECK|WEBSITE_ORDER_DETAILS/);
            expect([stockOf('J-N-38'), beltStock()]).toEqual(before);
        }
        // 2 jeans fine, 1 torn; the 2 belts fine
        const o = check('o1', [{ line: 0, sellable: 2, damaged: 1 }, { line: 1, sellable: 2, damaged: 0 }]);
        expect(o.items.map(i => [i.returned_sellable, i.returned_damaged, i.reserved_qty])).toEqual([[2, 1, 0], [2, 0, 0]]);
        expect([stockOf('J-N-38'), beltStock()]).toEqual([start[0] - 1, start[1]]);
        expect(api.all("SELECT variant_id, product_id, quantity_change FROM inventory_logs WHERE type = 'website_return' ORDER BY rowid"))
            .toEqual([{ variant_id: v['J-N-38'], product_id: 'jean', quantity_change: 2 }, { variant_id: null, product_id: 'belt', quantity_change: 2 }]);
        expect(figures()).toEqual(NOTHING);
        expect(orderBook.customerStats(api)[0]).toMatchObject({ returned: 1, successful: 0, total: 0 });
        // Once only
        expect(codeOf(() => check('o1', [{ line: 0, sellable: 3, damaged: 0 }, { line: 1, sellable: 2, damaged: 0 }]))).toBe('WEBSITE_RETURN_NONE');
        expect([stockOf('J-N-38'), beltStock()]).toEqual([start[0] - 1, start[1]]);
        // Taken again: put aside again, and paid once
        walk('o1', ['new', 'confirmed']);
        expect([stockOf('J-N-38'), beltStock()]).toEqual([start[0] - 4, start[1] - 2]);
        walk('o1', ['shipped', 'delivered', 'money_received']);
        expect(figures()).toMatchObject({ sales: 1, revenue: 3 * 3000 + 2 * 800, pieces: 5, best: [['jean', 3], ['belt', 2]] });
        expect([stockOf('J-N-38'), beltStock()]).toEqual([start[0] - 4, start[1] - 2]);
        expect(api.all("SELECT status FROM website_order_events WHERE order_id = 'o1' ORDER BY id").map(e => e.status)).toEqual([
            'new', 'confirmed', 'preparing', 'shipped', 'delivered', 'returned', 'return_checked', 'new', 'confirmed', 'shipped', 'delivered', 'money_received',
        ]);
    });

    it('Returned a second time: counted afresh; nothing checked twice', () => {
        orderBook.importOrders(api, [remote([belt(2)])]);
        const start = beltStock();
        walk('o1', ['confirmed', 'shipped', 'returned']);
        check('o1', [{ line: 0, sellable: 0, damaged: 2 }]);
        expect(beltStock()).toBe(start - 2); // both damaged: out
        walk('o1', ['new', 'confirmed', 'shipped', 'returned']);
        const o = orderBook.listOrders(api, { id: 'o1' })[0];
        expect(o.items.map(i => [i.returned_sellable, i.returned_damaged, i.reserved_qty])).toEqual([[0, 0, 2]]);
        expect(o.return_checked_at).toBeNull();
        check('o1', [{ line: 0, sellable: 2, damaged: 0 }]);
        expect(beltStock()).toBe(start - 2);
        expect(figures()).toEqual(NOTHING);
    });

    it('Cancelled: never a sale, from any step before the parcel left; the pieces come back once', () => {
        orderBook.importOrders(api, ['new', 'contacted', 'confirmed', 'preparing'].map(() => remote([belt(1)])));
        const start = beltStock();
        walk('o2', ['contacted']); walk('o3', ['confirmed']); walk('o4', ['confirmed', 'preparing']);
        expect(beltStock()).toBe(start - 2);
        for (const id of ['o1', 'o2', 'o3', 'o4']) expect(set(id, 'cancelled').sale).toBeNull();
        expect(beltStock()).toBe(start);
        expect(set('o3', 'cancelled').sale).toBeNull(); // twice: nothing more
        expect(beltStock()).toBe(start);
        expect(figures()).toEqual(NOTHING);
        expect(codeOf(() => set('o1', 'money_received'))).toBe('WEBSITE_ORDER_CANCELLED');
        expect(codeOf(() => set('o1', 'shipped'))).toBe('WEBSITE_ORDER_STEP');
        expect(orderBook.customerStats(api)[0]).toMatchObject({ cancelled: 4, successful: 0 });
        // On its way: not cancelled (the pieces are out of the shop) — it comes back as Returned
        orderBook.importOrders(api, [remote([belt(1)])]);
        walk('o5', ['confirmed', 'shipped']);
        expect(codeOf(() => set('o5', 'cancelled'))).toBe('WEBSITE_ORDER_STEP');
        expect(beltStock()).toBe(start - 1);
    });

    it('after the completed sale: a return at the till takes it off the revenue and the best sellers, once', () => {
        orderBook.importOrders(api, [remote([jean('38', 'Noir', 2)])]);
        walk('o1', ['confirmed', 'shipped', 'delivered']);
        const r = set('o1', 'money_received');
        const line = api.get('SELECT id FROM sale_items WHERE sale_id = ?', [r.sale.saleId]).id;
        const stock = stockOf('J-N-38');
        api.transaction(() => createReturn(api, {
            id: 'ret1', sale_id: r.sale.saleId, return_number: 'RET-1', total_refund: 3000, employee_id: 'owner',
            items: [{ sale_item_id: line, quantity: 1, refund_amount: 3000, condition: 'sellable' }],
        }));
        expect(stockOf('J-N-38')).toBe(stock + 1);
        expect(figures()).toMatchObject({ sales: 1, revenue: 6000, net: 3000, best: [['jean', 1]], home: [['jean', 1]] });
        expect(orderBook.customerStats(api)[0]).toMatchObject({ successful: 1, total: 3000 });
        // The order stays paid; nothing on it can change (the till owns the sale now)
        expect(codeOf(() => set('o1', 'returned'))).toBe('WEBSITE_ORDER_FINAL');
    });

    it('older orders: a parcel returned before this version (nothing aside) is taken again without a check', () => {
        orderBook.importOrders(api, [remote([belt(1)])]);
        api.run("UPDATE website_orders SET status = 'returned', reserved = 0 WHERE id = 'o1'");
        const start = beltStock();
        expect(codeOf(() => check('o1', [{ line: 0, sellable: 1, damaged: 0 }]))).toBe('WEBSITE_RETURN_NONE');
        expect(set('o1', 'new').order.status).toBe('new');
        expect(beltStock()).toBe(start);
        // A status no longer known: back to New or cancelled only
        api.run("UPDATE website_orders SET status = 'pending' WHERE id = 'o1'");
        expect(orderBook.nextStatuses(api.get("SELECT * FROM website_orders WHERE id = 'o1'"))).toEqual(['new', 'cancelled']);
        expect(codeOf(() => set('o1', 'money_received'))).toBe('WEBSITE_ORDER_STEP');
    });
});

describe('the migration for returned parcels', () => {
    it('adds the check columns to orders already kept; nothing else changes; safe to run again', async () => {
        const { db, api } = await createShop();
        n = 0;
        orderBook.importOrders(api, [remote([belt(1)])]);
        db.run('ALTER TABLE website_orders DROP COLUMN return_checked_at');
        db.run('ALTER TABLE website_order_items DROP COLUMN returned_sellable');
        db.run('ALTER TABLE website_order_items DROP COLUMN returned_damaged');
        db.run("DELETE FROM schema_migrations WHERE version = '2026_10_website_order_returns'");
        const before = JSON.stringify(api.all('SELECT * FROM website_orders'));
        expect(applyMigrations(db, { log: () => {} })).toEqual(['2026_10_website_order_returns']);
        expect(getColumns(db, 'website_orders')).toContain('return_checked_at');
        expect(getColumns(db, 'website_order_items')).toEqual(expect.arrayContaining(['returned_sellable', 'returned_damaged']));
        const after = api.all('SELECT * FROM website_orders').map(({ return_checked_at: _, ...o }) => o);
        expect(JSON.stringify(after)).toBe(before);
        expect(applyMigrations(db, { log: () => {} })).toEqual([]);
    });
});
