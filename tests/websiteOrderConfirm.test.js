// COD confirmation cycle: New -> Contacted -> Confirmed (pieces put aside,
// not a sale), the stock at every step, what the customer confirmed on the
// phone, the shipping label.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const orderBook = require('../electron/website/orders/orderBook');
const { labelHtml, safeSvg } = require('../electron/website/orders/shippingLabel');
const labelService = require('../electron/services/labelService');
const { bestSellers } = require('../electron/services/storeRankings');
const { applyMigrations } = require('../electron/database/migrations');

const codedError = (code, params) => Object.assign(new Error(code), { code, params });
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const NOW = new Date();
let n = 0;
const remote = (lines, extra = {}) => ({
    id: `o${++n}`, created_at: new Date(Date.now() - 3600e3 + n * 1000).toISOString(), customer_name: 'Amina Benali', first_name: 'Amina', last_name: 'Benali',
    phone: '0661223344', wilaya: '16 - الجزائر', commune: 'القبة', address: 'حي 200 مسكن', delivery: 'home', items: JSON.stringify(lines), ...extra,
});
const jean = (size, color, quantity = 1, unit_price = 3000) => ({ product_id: 'jean', product_name: 'Jean', size, color, quantity, unit_price });
const belt = (quantity = 1) => ({ product_id: 'belt', product_name: 'Ceinture', size: '', color: '', quantity, unit_price: 800 });

describe('COD confirmation and the stock', () => {
    let api, v;
    const stockOf = (sku) => api.get('SELECT stock_quantity AS n FROM product_variants WHERE id = ?', [v[sku]]).n;
    const productStock = (id) => api.get('SELECT stock_quantity AS n FROM products WHERE id = ?', [id]).n;
    const snapshot = () => JSON.stringify([...api.all('SELECT id, stock_quantity FROM product_variants ORDER BY id'), ...api.all('SELECT id, stock_quantity FROM products ORDER BY id')]);
    const set = (id, status) => orderBook.setStatus(api, { id, status, employeeId: 'owner', now: NOW, codedError });
    const confirm = (id, details) => orderBook.confirmOrder(api, { id, details, employeeId: 'owner', now: NOW, codedError });
    const logs = (type) => api.all('SELECT variant_id, product_id, quantity_change FROM inventory_logs WHERE type = ? ORDER BY rowid', [type]);
    const sales = () => api.get('SELECT COUNT(*) AS n FROM sales').n;

    beforeEach(async () => { ({ api, v } = await createShop()); n = 0; });

    it('New and Contacted touch nothing; Confirmed puts the pieces aside: out of the stock that can be sold, no sale, not a best seller', () => {
        orderBook.importOrders(api, [remote([jean('40', 'Noir', 2), belt(3)])]);
        const before = snapshot();
        set('o1', 'contacted');
        expect(snapshot()).toBe(before);
        const r = confirm('o1');
        expect(r.order).toMatchObject({ status: 'confirmed', reserved: 1, number: 'W-000001' });
        expect(stockOf('J-N-40')).toBe(0); // 2 - 2
        expect(productStock('belt')).toBe(7); // 10 - 3
        expect(productStock('jean')).toBe(11 - 2); // the article's total follows its variants
        expect(logs('website_reserve')).toEqual([
            { variant_id: v['J-N-40'], product_id: 'jean', quantity_change: -2 },
            { variant_id: null, product_id: 'belt', quantity_change: -3 },
        ]);
        expect(sales()).toBe(0);
        expect(bestSellers(api, { now: Date.now() })).toEqual([]);
        // Preparing, shipped, delivered: still put aside, nothing moves
        const reserved = snapshot();
        for (const st of ['preparing', 'shipped', 'delivered']) { set('o1', st); expect(snapshot(), st).toBe(reserved); }
    });

    it('Money received: the pieces put aside are the ones sold — the stock does not move again; one sale', () => {
        orderBook.importOrders(api, [remote([jean('40', 'Noir', 2), belt(1)])]);
        confirm('o1');
        set('o1', 'shipped');
        const reserved = snapshot();
        const r = set('o1', 'money_received');
        expect(snapshot()).toBe(reserved);
        expect(logs('website_release').map(l => l.quantity_change)).toEqual([2, 1]);
        expect(logs('sale').map(l => l.quantity_change)).toEqual([-2, -1]);
        expect(sales()).toBe(1);
        expect(api.get("SELECT reserved FROM website_orders WHERE id = 'o1'").reserved).toBe(0);
        expect(api.all('SELECT variant_id FROM sale_items WHERE sale_id = ? ORDER BY product_id', [r.sale.saleId]).map(x => x.variant_id)).toEqual([null, v['J-N-40']]);
        expect(api.get('SELECT SUM(reserved_qty) AS n FROM website_order_items').n).toBe(0);
    });

    it('cancelled, returned and checked sellable, or back to New / Contacted: every piece put aside comes back; confirmed again: aside again', () => {
        orderBook.importOrders(api, [remote([jean('38', 'Noir', 2)]), remote([jean('38', 'Noir', 1)]), remote([jean('38', 'Noir', 1)])]);
        const start = snapshot();
        confirm('o1'); confirm('o2'); confirm('o3');
        expect(stockOf('J-N-38')).toBe(0);
        set('o1', 'cancelled');
        expect(stockOf('J-N-38')).toBe(2);
        set('o2', 'shipped'); set('o2', 'returned');
        // On its way back: still out until the shop has it in hand and checks it
        expect(stockOf('J-N-38')).toBe(2);
        orderBook.checkReturn(api, { id: 'o2', lines: [{ line: 0, sellable: 1, damaged: 0 }], codedError });
        expect(stockOf('J-N-38')).toBe(3);
        set('o3', 'contacted');
        expect(snapshot()).toBe(start);
        expect(logs('website_cancel').map(l => l.quantity_change)).toEqual([2]);
        expect(logs('website_return').map(l => l.quantity_change)).toEqual([1]);
        expect(logs('website_unreserve').map(l => l.quantity_change)).toEqual([1]);
        // A returned order set back to New and confirmed again: put aside again (once)
        set('o2', 'new');
        confirm('o2');
        expect(stockOf('J-N-38')).toBe(3);
        set('o2', 'confirmed');
        expect(stockOf('J-N-38')).toBe(3);
        expect(sales()).toBe(0);
    });

    it('never more than the stock that can be sold (other orders and the till\'s reservations already out); nothing changes then', () => {
        orderBook.importOrders(api, [remote([jean('40', 'Noir', 2)]), remote([jean('40', 'Noir', 1)]), remote([jean('40', 'Noir', 1), jean('40', 'Noir', 2)])]);
        confirm('o1');
        const before = snapshot();
        const err = (() => { try { confirm('o2'); } catch (e) { return e; } })();
        expect(err).toMatchObject({ code: 'STOCK_INSUFFICIENT', params: { available: 0 } });
        expect(snapshot()).toBe(before);
        expect(api.get("SELECT status, reserved FROM website_orders WHERE id = 'o2'")).toEqual({ status: 'new', reserved: 0 });
        set('o1', 'cancelled');
        // Two lines of the same piece add up: 1 + 2 > 2
        expect(codeOf(() => confirm('o3'))).toBe('STOCK_INSUFFICIENT');
        expect(stockOf('J-N-40')).toBe(2);
        // A cancelled order is confirmed again only from New
        expect(codeOf(() => confirm('o1'))).toBe('WEBSITE_ORDER_LOCKED');
        set('o1', 'new');
        // The till sees the pieces put aside as gone: an order of 2 confirmed leaves 0 to sell
        confirm('o1');
        expect(stockOf('J-N-40')).toBe(0);
    });

    it('what the customer confirmed on the phone: size, colour, quantity, price, a line removed, the place; the pieces follow', () => {
        orderBook.importOrders(api, [remote([jean('40', 'Noir', 1), belt(2)])]);
        confirm('o1');
        expect([stockOf('J-N-40'), stockOf('J-B-40'), productStock('belt')]).toEqual([1, 3, 8]);
        // The customer wants the blue one, 2 pieces at 2 800, and no belt; picks up at a Yalidine office
        const o = orderBook.updateDetails(api, {
            id: 'o1', employeeId: 'owner', codedError, details: {
                lines: [{ line: 0, color: 'Bleu', size: '40', quantity: 2, unit_price: 2800 }],
                wilaya: '09 - البليدة', commune: 'بوفاريك', delivery: 'office', courier_company: 'Yalidine', office_wilaya: '09 - البليدة', office_commune: 'بوفاريك', courier_office: 'Stop desk centre',
            },
        });
        expect([stockOf('J-N-40'), stockOf('J-B-40'), productStock('belt')]).toEqual([2, 1, 10]);
        expect(o.items.map(i => [i.color, i.size, i.quantity, i.unit_price, i.reserved_qty])).toEqual([['Bleu', '40', 2, 2800, 2]]);
        expect(o).toMatchObject({ wilaya: '09 - البليدة', commune: 'بوفاريك', delivery: 'office', courier_company: 'Yalidine', courier_office: 'Stop desk centre', reserved: 1 });
        // The customer's own address is kept (the label shows the office)
        expect(o.address).toBe('حي 200 مسكن');
        // Wrong choices are refused and change nothing
        const before = snapshot();
        for (const [details, code] of [
            [{ lines: [{ line: 0, color: 'Vert', size: '40' }] }, 'WEBSITE_ORDER_ITEM_GONE'],
            [{ lines: [{ line: 0, quantity: 0 }] }, 'WEBSITE_ORDER_DETAILS'],
            [{ lines: [{ line: 0, quantity: 2.5 }] }, 'WEBSITE_ORDER_DETAILS'],
            [{ lines: [{ line: 0, unit_price: -5 }] }, 'WEBSITE_ORDER_DETAILS'],
            [{ lines: [{ line: 0, quantity: 9 }] }, 'STOCK_INSUFFICIENT'],
            [{ lines: [] }, 'WEBSITE_ORDER_EMPTY'],
            [{ commune: '' }, 'WEBSITE_ORDER_DETAILS'],
            [{ delivery: 'home', address: '' }, 'WEBSITE_ORDER_DETAILS'],
            [{ lines: [{ line: 7 }] }, 'WEBSITE_ORDER_DETAILS'],
        ]) {
            expect(codeOf(() => orderBook.updateDetails(api, { id: 'o1', details, codedError })), JSON.stringify(details)).toBe(code);
            expect(snapshot()).toBe(before);
        }
        // On its way: no more changes
        set('o1', 'shipped');
        expect(codeOf(() => orderBook.updateDetails(api, { id: 'o1', details: { commune: 'X' }, codedError }))).toBe('WEBSITE_ORDER_LOCKED');
        // Paid at the confirmed price
        const r = set('o1', 'money_received');
        expect(r.sale.total).toBe(5600);
        expect([stockOf('J-N-40'), stockOf('J-B-40'), productStock('belt')]).toEqual([2, 1, 10]);
        const events = api.all("SELECT status FROM website_order_events WHERE order_id = 'o1' ORDER BY id").map(e => e.status);
        expect(events).toEqual(['new', 'edited', 'confirmed', 'edited', 'shipped', 'money_received']);
    });

    it('older orders (before this version): delivered or confirmed without pieces aside — taken out once, at the sale', () => {
        orderBook.importOrders(api, [remote([jean('38', 'Noir', 1)]), remote([jean('38', 'Noir', 1)])]);
        // Delivered under the previous version: nothing was put aside
        api.run("UPDATE website_orders SET status = 'delivered', reserved = 0 WHERE id = 'o1'");
        set('o1', 'money_received');
        expect(stockOf('J-N-38')).toBe(3);
        // As a confirmed order of the previous version: no pieces aside
        api.run("UPDATE website_orders SET status = 'shipped', reserved = 0 WHERE id = 'o2'");
        set('o2', 'delivered');
        expect(stockOf('J-N-38')).toBe(3); // not put aside after the fact
        set('o2', 'money_received');
        expect(stockOf('J-N-38')).toBe(2);
        expect(logs('website_release')).toEqual([]);
        expect(sales()).toBe(2);
    });

    it('an article removed after the order was confirmed: the sale is refused (nothing changes); cancelling or the return still work', () => {
        orderBook.importOrders(api, [remote([belt(2)]), remote([belt(1)])]);
        confirm('o1'); confirm('o2');
        set('o1', 'shipped');
        api.run("DELETE FROM products WHERE id = 'belt'");
        expect(codeOf(() => set('o1', 'money_received'))).toBe('WEBSITE_ORDER_ITEM_GONE');
        expect(api.get("SELECT status, reserved FROM website_orders WHERE id = 'o1'")).toEqual({ status: 'shipped', reserved: 1 });
        set('o1', 'returned');
        orderBook.checkReturn(api, { id: 'o1', lines: [{ line: 0, sellable: 2, damaged: 0 }], codedError });
        expect(api.get("SELECT reserved FROM website_orders WHERE id = 'o1'").reserved).toBe(0);
        set('o2', 'cancelled');
        expect(api.get("SELECT reserved FROM website_orders WHERE id = 'o2'").reserved).toBe(0);
    });
});

describe('order numbers', () => {
    it('W-000001, W-000002 ... in the order they come; the orders already kept get theirs (migration)', async () => {
        const { api, db } = await createShop();
        n = 0;
        orderBook.importOrders(api, [remote([belt()]), remote([belt()])]);
        expect(api.all('SELECT id, number FROM website_orders ORDER BY id')).toEqual([{ id: 'o1', number: 'W-000001' }, { id: 'o2', number: 'W-000002' }]);
        // As before this version: no numbers
        api.run("UPDATE website_orders SET number = ''");
        db.run("DELETE FROM schema_migrations WHERE version = '2026_10_website_order_confirm'");
        db.run('DROP INDEX IF EXISTS idx_website_orders_number');
        applyMigrations(db, { log: () => {} });
        expect(api.all('SELECT id, number FROM website_orders ORDER BY id')).toEqual([{ id: 'o1', number: 'W-000001' }, { id: 'o2', number: 'W-000002' }]);
        orderBook.importOrders(api, [remote([belt()])]);
        expect(api.get("SELECT number FROM website_orders WHERE id = 'o3'").number).toBe('W-000003');
    });
});

describe('the shipping label', () => {
    const codes = { barcode: (t) => labelService.codeSvg('code128', t, { includeText: false, height: 14 }), qr: (t) => labelService.qrSvg(t) };
    const base = {
        id: 'x', number: 'W-000042', customerName: 'Amina Benali', phone: '0661223344', wilaya: '16 - الجزائر', commune: 'القبة',
        delivery: 'home', address: 'حي 200 مسكن، عمارة 3', courier: null, total: 6800, note: 'بعد الخامسة',
        items: [{ productName: 'Jean', size: '40', color: 'Noir', quantity: 2 }, { productName: 'Ceinture', size: '', color: '', quantity: 1 }],
    };
    const shop = { name: 'Boutique Yasmine', phone: '0555 12 34 56', logo: 'data:image/png;base64,iVBORw0KGgo=', currency: 'DZD' };

    it('store, customer, phone, wilaya, commune, address, products with size / colour / quantity, total, COD, order number, barcode and QR', () => {
        const html = labelHtml({ order: base, shop, lang: 'ar', codes });
        for (const part of ['Boutique Yasmine', '0555 12 34 56', 'Amina Benali', '0661223344', '16 - الجزائر', 'القبة', 'حي 200 مسكن، عمارة 3',
            'Jean', '40', 'Noir', 'Ceinture', 'الدفع عند الاستلام', 'W-000042', 'بعد الخامسة', 'توصيل إلى المنزل', 'data:image/png;base64,iVBORw0KGgo=']) {
            expect(html, part).toContain(part);
        }
        expect(html).toMatch(/6[\s\u00a0\u202f]800/);
        expect((html.match(/<svg/g) || []).length).toBe(2);
        expect(html).toContain('size: 100mm 150mm');
        expect(html).toContain('dir="rtl"');
        expect(html).not.toMatch(/<script/i);
    });

    it('courier office instead of the address; French; the customer\'s words are text, never markup', () => {
        const office = { ...base, delivery: 'office', address: 'ignored', courier: { company: 'Yalidine', office: 'Stop desk <b>Kouba</b>', wilaya: '16 - Alger', commune: 'Kouba' }, customerName: '<img src=x onerror=alert(1)>' };
        const html = labelHtml({ order: office, shop: { ...shop, logo: 'javascript:alert(1)' }, lang: 'fr', codes });
        expect(html).toContain('Retrait au bureau');
        expect(html).toContain('Yalidine');
        expect(html).toContain('Stop desk &lt;b&gt;Kouba&lt;/b&gt;');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('ignored');
        expect(html).toContain('dir="ltr"');
        // Only plain SVG codes go in
        expect(safeSvg('<svg onload="x()"></svg>')).toBe('');
        expect(safeSvg('<script>alert(1)</script>')).toBe('');
    });
});
