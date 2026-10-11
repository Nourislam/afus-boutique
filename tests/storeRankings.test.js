// New products and best sellers by AFUS's rules, and the website's cash on
// delivery orders: only "money received" is a sale, counted once.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, sell } from './helpers/shop';

const require = createRequire(import.meta.url);
const { newProducts, bestSellers } = require('../electron/services/storeRankings');
const orderBook = require('../electron/website/orders/orderBook');
const { buildPublicData } = require('../electron/website/publicData');
const { renderPage } = require('../electron/website/storefront/render');
const { registry } = require('../electron/website/themes/registry');
const productImport = require('../electron/services/productImportService');

const NOW = Date.now();
const DAY = 86400000;
const ago = (days) => orderBook.sqlTime(new Date(NOW - days * DAY));
const codedError = (code, params) => Object.assign(new Error(code), { code, params });
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const ids = (list) => list.map(r => r.id);
const soldOf = (api) => Object.fromEntries(bestSellers(api, { now: NOW }).map(r => [r.id, r.sold]));
const at = (api, saleId, days) => api.run('UPDATE sales SET created_at = ? WHERE id = ?', [ago(days), saleId]);
function giveBack(api, saleItemId, qty, n = 1) {
    const rid = `ret-${saleItemId}-${n}`;
    api.run('INSERT INTO returns (id, sale_id, return_number, total_refund) VALUES (?, ?, ?, 0)', [rid, saleItemId.split('-')[0], `RET-${rid}`]);
    api.run('INSERT INTO return_items (id, return_id, sale_item_id, product_id, quantity, refund_amount) VALUES (?, ?, ?, NULL, ?, 0)', [`${rid}-i`, rid, saleItemId, qty]);
}
/** An order as the website API sends it (cart lines or one article). */
const remote = (id, extra = {}) => ({
    id, created_at: new Date(NOW - 2 * DAY).toISOString(), customer_name: 'Amina B.', phone: '0661223344', wilaya: '16 - Alger', commune: 'Kouba',
    address: 'Rue 5', delivery: 'home', note: '', product_id: 'jean', product_name: 'Jean',
    items: JSON.stringify([{ product_id: 'jean', product_name: 'Jean', color: 'Noir', size: '40', quantity: 2, unit_price: 3000 }, { product_id: 'belt', product_name: 'Ceinture', color: '', size: '', quantity: 1, unit_price: 800 }]),
    ...extra,
});

describe('New products: added to AFUS in the last 7 days', () => {
    let api;
    beforeEach(async () => {
        ({ api } = await createShop());
        api.run("UPDATE products SET created_at = ? WHERE id = 'jean'", [ago(30)]);
        api.run("UPDATE products SET created_at = ? WHERE id = 'belt'", [ago(2)]);
    });

    it('7 days back from now, newest first; older, inactive or future ones are not new', () => {
        const save = (id, name) => require('../electron/services/catalogService').saveProduct(api, { id, name, price: 1000, cost: 400, stock_quantity: 3 }, [], { isNew: true });
        save('shirt', 'Chemise'); save('cap', 'Casquette'); save('old', 'Ancien'); save('off', 'Retiré'); save('soon', 'Bientôt');
        api.run("UPDATE products SET created_at = ? WHERE id = 'shirt'", [ago(7 - 1 / 1440)]); // 7 days less one minute
        api.run("UPDATE products SET created_at = ? WHERE id = 'old'", [ago(7 + 1 / 1440)]); // one minute too old
        api.run("UPDATE products SET created_at = ? WHERE id = 'off'", [ago(1)]);
        api.run("UPDATE products SET is_active = 0 WHERE id = 'off'");
        api.run("UPDATE products SET created_at = ? WHERE id = 'soon'", [ago(-1)]);
        // 'cap' keeps the time SQLite gave it (now)
        expect(ids(newProducts(api, { now: NOW + 1000 }))).toEqual(['cap', 'belt', 'shirt']);
    });

    it('however the article was added (product form, Excel import), and the date format of either', () => {
        const report = api.transaction(() => productImport.importProducts(api, [
            { row: 2, name: 'Robe importée', color: 'Rouge', size: 'M', stock_quantity: 4, price: 2500, cost: 1200 },
            { row: 3, name: 'Robe importée', color: 'Rouge', size: 'L', stock_quantity: 2, price: 2500, cost: 1200 },
        ]));
        expect(report.rejected, JSON.stringify(report.rejected)).toEqual([]);
        const imported = api.get("SELECT id FROM products WHERE name = 'Robe importée'");
        expect(imported).toBeTruthy();
        api.run("UPDATE products SET created_at = ? WHERE id = 'belt'", [new Date(NOW - 3 * DAY).toISOString()]); // ISO text
        const list = ids(newProducts(api, { now: NOW + 1000 }));
        expect(list).toContain('belt');
        expect(list).toContain(imported.id);
        expect(list).not.toContain('jean');
    });

    it('not related to sales: a new article without sales is new, an old best seller is not', () => {
        const s = sell(api, 's1', [{ product: 'jean', variant: null, qty: 5, price: 3000 }]);
        at(api, s.id, 1);
        expect(ids(newProducts(api, { now: NOW }))).toEqual(['belt']);
        expect(ids(bestSellers(api, { now: NOW }))).toEqual(['jean']);
    });
});

describe('Best sellers: completed sales of the whole shop, last 7 days', () => {
    let api, v;
    beforeEach(async () => { ({ api, v } = await createShop()); });

    it('till sales of the last 7 days; older ones and pending / voided / cancelled sales do not count', () => {
        at(api, sell(api, 'a', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]).id, 1);
        at(api, sell(api, 'b', [{ product: 'belt', qty: 3, price: 800, name: 'Ceinture' }]).id, 6.9);
        at(api, sell(api, 'c', [{ product: 'belt', qty: 9, price: 800, name: 'Ceinture' }]).id, 7.1); // too old
        for (const [id, status] of [['d', 'voided'], ['e', 'cancelled'], ['f', 'pending']]) {
            at(api, sell(api, id, [{ product: 'jean', variant: v['J-N-40'], qty: 10, price: 3000 }], { status }).id, 1);
        }
        expect(soldOf(api)).toEqual({ belt: 3, jean: 2 });
        expect(ids(bestSellers(api, { now: NOW }))).toEqual(['belt', 'jean']);
    });

    it('returned pieces are taken off line by line (several returns add up, never below 0): no double counting', () => {
        // One sale with two lines of the same article (two colours), another sale of it
        at(api, sell(api, 'a', [{ product: 'jean', variant: v['J-N-38'], qty: 3, price: 3000 }, { product: 'jean', variant: v['J-B-40'], qty: 2, price: 3000 }]).id, 2);
        at(api, sell(api, 'b', [{ product: 'jean', variant: v['J-N-40'], qty: 1, price: 3000 }]).id, 3);
        giveBack(api, 'a-0', 1, 1);
        giveBack(api, 'a-0', 1, 2); // a second return on the same line
        giveBack(api, 'a-1', 5, 1); // more than sold on that line: 0, not -3
        api.run("UPDATE sales SET status = 'partially_refunded' WHERE id = 'a'");
        expect(soldOf(api)).toEqual({ jean: 1 + 1 });
        // A sale fully given back is no best seller
        at(api, sell(api, 'c', [{ product: 'belt', qty: 2, price: 800, name: 'Ceinture' }]).id, 1);
        giveBack(api, 'c-0', 2);
        api.run("UPDATE sales SET status = 'refunded' WHERE id = 'c'");
        expect(soldOf(api)).toEqual({ jean: 2 });
    });
});

describe('Website orders, cash on delivery: a sale only when the money is received', () => {
    let api, v;
    const set = (id, status, now = new Date(NOW)) => orderBook.setStatus(api, { id, status, employeeId: 'owner', now, codedError });
    beforeEach(async () => { ({ api, v } = await createShop()); });

    it('New, Confirmed, Preparing, Shipped, Delivered: no sale, nothing counted, stock untouched', () => {
        expect(orderBook.importOrders(api, [remote('o1')])).toBe(1);
        const stock = api.get('SELECT stock_quantity AS n FROM product_variants WHERE id = ?', [v['J-N-40']]).n;
        for (const status of ['new', 'confirmed', 'preparing', 'shipped', 'delivered']) {
            const r = set('o1', status);
            expect(r.order.status).toBe(status);
            expect(r.sale).toBeNull();
            expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
            expect(bestSellers(api, { now: NOW })).toEqual([]);
        }
        expect(api.get('SELECT stock_quantity AS n FROM product_variants WHERE id = ?', [v['J-N-40']]).n).toBe(stock);
    });

    it('Money received = one completed sale: ticket, lines, colour / size, stock out, paid "cod"; counted once', () => {
        orderBook.importOrders(api, [remote('o1')]);
        set('o1', 'delivered');
        const stock = api.get('SELECT stock_quantity AS n FROM product_variants WHERE id = ?', [v['J-N-40']]).n;
        const belt = api.get("SELECT stock_quantity AS n FROM products WHERE id = 'belt'").n;
        const r = set('o1', 'money_received');
        expect(r.order).toMatchObject({ status: 'money_received', sale_id: r.sale.saleId, receipt_number: r.sale.receipt });
        expect(r.sale.total).toBe(2 * 3000 + 800);
        const sale = api.get('SELECT * FROM sales WHERE id = ?', [r.sale.saleId]);
        expect(sale).toMatchObject({ status: 'completed', total: 6800, notes: 'website:o1', employee_id: 'owner' });
        const lines = api.all('SELECT product_id, variant_id, quantity, unit_price FROM sale_items WHERE sale_id = ? ORDER BY product_id', [sale.id]);
        expect(lines).toEqual([
            { product_id: 'belt', variant_id: null, quantity: 1, unit_price: 800 },
            { product_id: 'jean', variant_id: v['J-N-40'], quantity: 2, unit_price: 3000 },
        ]);
        expect(api.all('SELECT method, amount FROM payments WHERE sale_id = ?', [sale.id])).toEqual([{ method: 'cod', amount: 6800 }]);
        expect(api.get('SELECT stock_quantity AS n FROM product_variants WHERE id = ?', [v['J-N-40']]).n).toBe(stock - 2);
        expect(api.get("SELECT stock_quantity AS n FROM products WHERE id = 'belt'").n).toBe(belt - 1);
        expect(soldOf(api)).toEqual({ jean: 2, belt: 1 });

        // Never twice: money received again, any other status, a new import of the same order
        expect(codeOf(() => set('o1', 'money_received'))).toBe('WEBSITE_ORDER_FINAL');
        expect(codeOf(() => set('o1', 'delivered'))).toBe('WEBSITE_ORDER_FINAL');
        expect(codeOf(() => set('o1', 'cancelled'))).toBe('WEBSITE_ORDER_FINAL');
        expect(orderBook.importOrders(api, [remote('o1'), remote('o1')])).toBe(0);
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(1);
        expect(api.get("SELECT COUNT(*) AS n FROM website_order_items WHERE order_id = 'o1'").n).toBe(2);
        expect(soldOf(api)).toEqual({ jean: 2, belt: 1 });
        // One order, one sale at most (also in the database)
        expect(() => api.run("INSERT INTO website_orders (id, received_at, sale_id) VALUES ('x', '2026-01-01 00:00:00', ?)", [sale.id])).toThrow();
    });

    it('with the till: a till sale and a website order of the same article add up, each once', () => {
        at(api, sell(api, 't1', [{ product: 'jean', variant: v['J-N-38'], qty: 1, price: 3000 }]).id, 1);
        orderBook.importOrders(api, [remote('o1'), remote('o2')]);
        set('o1', 'money_received');
        set('o2', 'shipped'); // on its way: not a sale
        expect(soldOf(api)).toEqual({ jean: 1 + 2, belt: 1 });
    });

    it('the 7 days count from the money received, not from the order', () => {
        orderBook.importOrders(api, [remote('o1', { created_at: new Date(NOW - 20 * DAY).toISOString() })]);
        set('o1', 'money_received', new Date(NOW - DAY));
        expect(soldOf(api)).toEqual({ jean: 2, belt: 1 });
        orderBook.importOrders(api, [remote('o2', { created_at: new Date(NOW - DAY).toISOString() })]);
        set('o2', 'money_received', new Date(NOW - 9 * DAY));
        expect(soldOf(api)).toEqual({ jean: 2, belt: 1 });
    });

    it('cancelled: never a sale; set back to New to take it again; a returned website sale is taken off', () => {
        orderBook.importOrders(api, [remote('o1')]);
        set('o1', 'cancelled');
        expect(codeOf(() => set('o1', 'money_received'))).toBe('WEBSITE_ORDER_CANCELLED');
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
        set('o1', 'new');
        const r = set('o1', 'money_received');
        const jeanLine = api.get("SELECT id FROM sale_items WHERE sale_id = ? AND product_id = 'jean'", [r.sale.saleId]).id;
        api.run('INSERT INTO returns (id, sale_id, return_number, total_refund) VALUES (?, ?, ?, 0)', ['r1', r.sale.saleId, 'RET-1']);
        api.run('INSERT INTO return_items (id, return_id, sale_item_id, quantity, refund_amount) VALUES (?, ?, ?, 2, 0)', ['r1i', 'r1', jeanLine]);
        expect(soldOf(api)).toEqual({ belt: 1 });
    });

    it('an article no longer in the catalogue: the sale is not recorded, nothing changes', () => {
        orderBook.importOrders(api, [remote('o1', { items: JSON.stringify([{ product_id: 'jean', color: 'Vert', size: '40', quantity: 1, unit_price: 3000 }]) })]);
        const before = api.get('SELECT COUNT(*) AS n FROM inventory_logs').n;
        expect(codeOf(() => set('o1', 'money_received'))).toBe('WEBSITE_ORDER_ITEM_GONE');
        expect(orderBook.listOrders(api)[0]).toMatchObject({ status: 'new', sale_id: null });
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
        expect(api.get('SELECT COUNT(*) AS n FROM inventory_logs').n).toBe(before);
        expect(codeOf(() => set('o1', 'paid'))).toBe('WEBSITE_ORDER_STATUS');
        expect(codeOf(() => set('nope', 'confirmed'))).toBe('WEBSITE_ORDER_NOT_FOUND');
    });

    it('an order of one article (the article page form) is kept with its one line', () => {
        orderBook.importOrders(api, [remote('o1', { items: '[]', size: '38', color: 'Noir', quantity: 3 })]);
        expect(orderBook.listOrders(api)[0].items).toMatchObject([{ product_id: 'jean', size: '38', color: 'Noir', quantity: 3, unit_price: null }]);
        const r = set('o1', 'money_received');
        // No price sent: the article's own price
        expect(r.sale.total).toBe(3 * 3000);
    });
});

describe('the website shows them by these rules', () => {
    it('"New in" lists the articles of the last 7 days only; "Best sellers" the completed sales of the last 7 days', async () => {
        const { api, v } = await createShop();
        api.run("UPDATE products SET created_at = ? WHERE id = 'jean'", [ago(40)]);
        api.run("UPDATE products SET created_at = ? WHERE id = 'belt'", [ago(1)]);
        at(api, sell(api, 'a', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]).id, 2);
        orderBook.importOrders(api, [remote('o1', { items: JSON.stringify([{ product_id: 'belt', quantity: 5, unit_price: 800 }]) })]);
        orderBook.setStatus(api, { id: 'o1', status: 'shipped', now: new Date(NOW), codedError });
        let snap = buildPublicData(api, { now: NOW });
        expect(snap.newProducts).toEqual(['belt']);
        expect(snap.bestSellers).toEqual(['jean']);
        const page = renderPage({ snapshot: snap, theme: registry.get('classic'), page: 'page', id: 'new', lang: 'fr' });
        expect(page).toContain('data-product="belt"');
        expect(page).not.toContain('data-product="jean"');
        // Money received: the belt sold 5, it leads
        orderBook.setStatus(api, { id: 'o1', status: 'money_received', now: new Date(NOW), codedError });
        snap = buildPublicData(api, { now: NOW + 1000 });
        expect(snap.bestSellers).toEqual(['belt', 'jean']);
        // Nothing new this week: no "New in" link, a plain message on its page
        api.run("UPDATE products SET created_at = ? WHERE id = 'belt'", [ago(9)]);
        snap = buildPublicData(api, { now: NOW });
        expect(snap.newProducts).toEqual([]);
        const home = renderPage({ snapshot: snap, theme: registry.get('classic'), page: 'home', lang: 'fr' });
        expect(home).not.toContain('href="new.html"');
        const empty = renderPage({ snapshot: snap, theme: registry.get('classic'), page: 'page', id: 'new', lang: 'fr' });
        expect(empty).toContain('Pas de nouveauté cette semaine');
    });
});
