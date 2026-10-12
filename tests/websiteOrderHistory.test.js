// Website orders inside AFUS: the nine statuses, the customer recognised by
// phone, their history and figures; the migration of orders already kept.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const orderBook = require('../electron/website/orders/orderBook');
const { phoneKey } = require('../electron/website/orders/phone');
const { applyMigrations, getColumns } = require('../electron/database/migrations');
const { readInternal } = require('../electron/website/publicData/internal');
const ipcGuard = require('../electron/services/ipcGuard');

const codedError = (code, params) => Object.assign(new Error(code), { code, params });
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
let n = 0;
const order = (phone, extra = {}) => ({
    id: `o${++n}`, created_at: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(), customer_name: extra.name || 'Amina Benali', first_name: 'Amina', last_name: 'Benali',
    phone, wilaya: '16 - Alger', commune: 'Kouba', address: 'Rue 5', delivery: 'home',
    items: JSON.stringify([{ product_id: 'belt', product_name: 'Ceinture', quantity: extra.qty || 1, unit_price: 800 }]),
});
const set = (api, id, status) => orderBook.setStatus(api, { id, status, employeeId: 'owner', now: new Date(Date.UTC(2026, 9, 2)), codedError });

describe('the customer is recognised by phone', () => {
    it('one number however it is written; not a number: no customer', () => {
        for (const p of ['0661223344', '0661 22 33 44', '+213 661 22 33 44', '00213661223344', '213661223344', '0661-22-33-44', '661223344']) expect(phoneKey(p), p).toBe('0661223344');
        expect(phoneKey('021 23 45 67')).toBe('021234567');
        for (const p of ['', null, 'abc', '12']) expect(phoneKey(p)).toBe('');
    });
});

describe('website order management in AFUS', () => {
    let api;
    beforeEach(async () => { ({ api } = await createShop()); n = 0; });

    it('nine statuses; Contacted and Returned; a returned or cancelled order is never paid until set back to New; every step kept', () => {
        expect(orderBook.STATUSES).toEqual(['new', 'contacted', 'confirmed', 'preparing', 'shipped', 'delivered', 'money_received', 'returned', 'cancelled']);
        orderBook.importOrders(api, [order('0661223344')]);
        for (const st of ['contacted', 'confirmed', 'preparing', 'shipped', 'returned']) set(api, 'o1', st);
        expect(codeOf(() => set(api, 'o1', 'money_received'))).toBe('WEBSITE_ORDER_CANCELLED');
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
        // The parcel is checked before the order is taken again
        expect(codeOf(() => set(api, 'o1', 'new'))).toBe('WEBSITE_RETURN_PENDING');
        orderBook.checkReturn(api, { id: 'o1', lines: [{ line: 0, sellable: 1, damaged: 0 }], codedError });
        set(api, 'o1', 'new');
        set(api, 'o1', 'delivered');
        set(api, 'o1', 'money_received');
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(1);
        expect(codeOf(() => set(api, 'o1', 'returned'))).toBe('WEBSITE_ORDER_FINAL');
        const h = orderBook.customerHistory(api, '0661223344');
        expect(h.list[0].events.map(e => e.status)).toEqual(['new', 'contacted', 'confirmed', 'preparing', 'shipped', 'returned', 'return_checked', 'new', 'delivered', 'money_received']);
    });

    it('the figures per customer: orders, delivered, returned, cancelled, successful purchases and their total (less till refunds)', () => {
        orderBook.importOrders(api, [
            order('0661 22 33 44', { qty: 2 }), order('+213661223344'), order('00213661223344'), order('0661223344'), order('0661223344'), order('0661223344'),
            order('0770112233', { name: 'Sofiane K.' }),
        ]);
        for (const id of ['o1', 'o2']) set(api, id, 'delivered');
        set(api, 'o1', 'money_received'); // 1 600
        set(api, 'o2', 'money_received'); // 800, then 300 refunded at the till
        set(api, 'o3', 'delivered');
        set(api, 'o4', 'shipped');
        set(api, 'o4', 'returned');
        set(api, 'o5', 'cancelled');
        const sale2 = api.get("SELECT sale_id FROM website_orders WHERE id = 'o2'").sale_id;
        api.run("INSERT INTO returns (id, sale_id, return_number, total_refund) VALUES ('r1', ?, 'RET-1', 300)", [sale2]);
        const [amina] = orderBook.customerStats(api, { phones: ['0661223344'] });
        expect(amina).toMatchObject({ phone: '0661223344', name: 'Amina Benali', orders: 6, delivered: 3, returned: 1, cancelled: 1, successful: 2, total: 1600 + 800 - 300 });
        const sofiane = orderBook.customerHistory(api, '0770 11 22 33');
        expect(sofiane).toMatchObject({ name: 'Sofiane K.', orders: 1, successful: 0, total: 0 });
        expect(sofiane.list.map(o => o.id)).toEqual(['o7']);
        // Two customers, the latest first; search by a piece of the phone or the name
        expect(orderBook.customerStats(api).map(c => c.phone)).toEqual(['0770112233', '0661223344']);
        expect(orderBook.customerStats(api, { search: '6122' }).map(c => c.phone)).toEqual(['0661223344']);
        expect(orderBook.customerStats(api, { search: '+213 770' }).map(c => c.phone)).toEqual(['0770112233']);
        expect(orderBook.customerStats(api, { search: 'sofiane' }).map(c => c.phone)).toEqual(['0770112233']);
        expect(orderBook.customerHistory(api, 'nope')).toBeNull();
        // The screen's filters
        expect(orderBook.statusCounts(api)).toEqual({ money_received: 2, delivered: 1, returned: 1, cancelled: 1, new: 2 });
        expect(orderBook.listOrders(api, { status: 'returned' }).map(o => o.id)).toEqual(['o4']);
    });

    it('AFUS only: the website never reads these tables; the channels are the owner\'s', () => {
        orderBook.importOrders(api, [order('0661223344')]);
        const sql = [];
        const spy = { all: (q, p) => { sql.push(q); return api.all(q, p); }, get: (q, p) => { sql.push(q); return api.get(q, p); } };
        readInternal(spy);
        expect(sql.join('\n')).not.toMatch(/website_order/);
        for (const ch of ['website:orders', 'website:customers', 'website:customerHistory', 'website:setOrderStatus']) expect(ipcGuard.RULES[ch], ch).toBe('admin');
    });
});

describe('the migration keeps the orders already kept (before customer history)', () => {
    it('adds the phone key and the status history to existing orders; nothing else changes; safe to run again', async () => {
        const { db, api } = await createShop();
        // As a shop had it before: orders without phone key nor history
        db.run('DROP TABLE website_order_events');
        db.run('DROP INDEX IF EXISTS idx_website_orders_phone');
        db.run('ALTER TABLE website_orders DROP COLUMN phone_key');
        db.run("DELETE FROM schema_migrations WHERE version = '2026_10_website_order_history'");
        api.run(`INSERT INTO website_orders (id, received_at, customer_name, phone, status, status_at) VALUES
                 ('old1', '2026-09-01 10:00:00', 'Amina', '0661 22 33 44', 'new', NULL),
                 ('old2', '2026-09-02 10:00:00', 'Amina', '213661223344', 'shipped', '2026-09-03 09:00:00'),
                 ('old3', '2026-09-04 10:00:00', 'Lina', 'pas de numéro', 'cancelled', '2026-09-05 09:00:00')`);
        api.run("INSERT INTO website_order_items (order_id, line, product_id, product_name, quantity) VALUES ('old1', 0, 'belt', 'Ceinture', 1)");
        const before = JSON.stringify(api.all('SELECT id, received_at, customer_name, phone, status, status_at FROM website_orders ORDER BY id'));
        expect(getColumns(db, 'website_orders')).not.toContain('phone_key');

        const applied = applyMigrations(db, { log: () => {} });
        expect(applied).toEqual(['2026_10_website_order_history']);
        expect(JSON.stringify(api.all('SELECT id, received_at, customer_name, phone, status, status_at FROM website_orders ORDER BY id'))).toBe(before);
        expect(api.all('SELECT id, phone_key FROM website_orders ORDER BY id')).toEqual([
            { id: 'old1', phone_key: '0661223344' }, { id: 'old2', phone_key: '0661223344' }, { id: 'old3', phone_key: '' },
        ]);
        expect(api.all('SELECT order_id, status, at FROM website_order_events ORDER BY order_id, id')).toEqual([
            { order_id: 'old1', status: 'new', at: '2026-09-01 10:00:00' },
            { order_id: 'old2', status: 'new', at: '2026-09-02 10:00:00' },
            { order_id: 'old2', status: 'shipped', at: '2026-09-03 09:00:00' },
            { order_id: 'old3', status: 'new', at: '2026-09-04 10:00:00' },
            { order_id: 'old3', status: 'cancelled', at: '2026-09-05 09:00:00' },
        ]);
        expect(orderBook.customerStats(api, { phones: ['0661223344'] })[0]).toMatchObject({ orders: 2 });
        // Again: nothing to do, nothing doubled
        expect(applyMigrations(db, { log: () => {} })).toEqual([]);
        db.run("DELETE FROM schema_migrations WHERE version = '2026_10_website_order_history'");
        applyMigrations(db, { log: () => {} });
        expect(api.get('SELECT COUNT(*) AS n FROM website_order_events').n).toBe(5);
    });
});
