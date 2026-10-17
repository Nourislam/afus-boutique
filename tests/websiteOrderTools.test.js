// The shop's order tools, through the real Worker on a fake Cloudflare and
// AFUS on SQLite: delivery prices worked out by the API, blocked numbers,
// coupons (only their hash leaves AFUS), the page-view counts, the WhatsApp
// confirmation, tracking numbers and Yalidine.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { startFakeCloud } = require('./helpers/fakeCloud.cjs');
const { createWebsiteService } = require('../electron/website/websiteService');
const { createGithubClient } = require('../electron/website/github');
const { createCloudflareClient } = require('../electron/website/cloudflare');
const { createSecureStore } = require('../electron/website/secureStore');
const catalog = require('../electron/services/catalogService');
const { createYalidineClient, parcelOf } = require('../electron/website/couriers/yalidine');
const initSqlJs = require('sql.js');

const ACCOUNT = 'c'.repeat(32);
const fakeSafeStorage = () => ({
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (t) => Buffer.from(`enc:${Buffer.from(t).toString('base64')}`),
    decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
});
const items = JSON.stringify([{ product_id: 'jean', product_name: 'Jean', size: '40', color: 'Noir', quantity: 1, unit_price: 3000 }]);
const checkout = (extra = {}) => ({
    items, first_name: 'Amina', last_name: 'Benali', phone: '0661223344', wilaya: '16 - Alger', commune: 'Kouba',
    delivery: 'home', address: 'Rue 5, Kouba', website: '', ...extra,
});
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
let SQL;
// Yalidine as its client library uses it: answers only for the right key
const calls = [];
const fakeYalidine = createYalidineClient({
    base: 'https://yalidine.test/v1/',
    fetch: async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
        if (init.headers['X-API-ID'] !== 'shop-api-id' || init.headers['X-API-TOKEN'] !== 'shop-api-token') return new Response('{}', { status: 401 });
        if (url.includes('/parcels/') && init.method === 'GET') return Response.json({ data: [{ tracking: 'yal-ABC123', last_status: 'En livraison' }] });
        if (url.endsWith('/parcels') && init.method === 'POST') return Response.json({ [init.body && JSON.parse(init.body)[0].order_id]: { success: true, tracking: 'yal-ABC123', label: 'https://x' } });
        return Response.json({ data: [] });
    },
});

describe('website order tools, end to end', () => {
    let api, settings, dir, cloud, store, service, fetchImpl, clock, mode;

    function makeService() {
        store = createSecureStore({ dir, safeStorage: fakeSafeStorage(), platform: 'linux' });
        store.set('github', JSON.stringify({ token: cloud.githubToken(), scopes: ['repo'], login: 'yasmine-shop' }));
        const { at, rt } = cloud.cloudflareTokens();
        store.set('cloudflare', JSON.stringify({ accessToken: at, refreshToken: rt, expiresAt: Date.now() + 3600e3, scopes: [], accountId: ACCOUNT }));
        return createWebsiteService({
            api, getSetting: (k) => settings[k] ?? null, saveSetting: (k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); },
            codedError: catalog.codedError, blockedMode: () => mode, couriers: { yalidine: fakeYalidine },
            github: { client: createGithubClient({ clientId: 'gh', fetch: globalThis.fetch, webBase: cloud.base, apiBase: `${cloud.base}/api`, writeGapMs: 0 }), store },
            cloudflare: { client: createCloudflareClient({ clientId: 'cf', fetch: globalThis.fetch, dashBase: cloud.base, apiBase: `${cloud.base}/client/v4`, workerUrl: (n) => `${cloud.base}/w/${n}` }), store },
            publish: { fetch: (u, i) => fetchImpl(u, i), readImage: () => null, waits: { health: 2000, pages: 3000, site: 2000, every: 20 }, log: () => {}, allowHttp: true },
        });
    }
    const d1 = () => [...cloud.cf.databases.values()][0].db;
    const waitingInD1 = () => d1().exec('SELECT COUNT(*) FROM orders')[0].values[0][0];
    const orderUrl = () => `${cloud.base}/w/boutique-yasmine-api/api/orders`;
    const post = (fields, headers = {}) => fetch(orderUrl(), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields).toString() });
    const sync = () => service.syncOrders({ now: () => clock });

    beforeEach(async () => {
        ({ api } = await createShop());
        settings = {
            store_config: { businessName: 'Boutique Yasmine' },
            website: {
                created: true, name: 'boutique-yasmine', theme: 'classic',
                accounts: {
                    github: { status: 'connected', login: 'yasmine-shop', connectedAt: '2026-10-11T10:00:00Z', scopes: ['repo'] },
                    cloudflare: { status: 'connected', accountName: 'Boutique', accountId: ACCOUNT, connectedAt: '2026-10-11T10:00:00Z' },
                },
            },
        };
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-tools-'));
        SQL = SQL || await initSqlJs();
        cloud = await startFakeCloud({ login: 'yasmine-shop', accounts: [{ id: ACCOUNT, name: 'Boutique' }], subdomain: 'yasmine', d1Factory: async () => new SQL.Database() });
        fetchImpl = globalThis.fetch;
        clock = Date.now();
        mode = null;
        service = makeService();
        service.publishSite();
        await service.publishPending();
        expect(service.view().status).toBe('live');
    });
    afterEach(async () => { await cloud.close(); fs.rmSync(dir, { recursive: true, force: true }); });


    const apiBase = () => `${cloud.base}/w/boutique-yasmine-api`;
    const jsonPost = (fields) => fetch(orderUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }).then(async r => ({ status: r.status, body: await r.json() }));
    const onlyOrder = async () => (await service.orders()).orders[0];
    const clearHits = () => d1().run('DELETE FROM hits');

    it('delivery prices: worked out by the API (never by the page), per wilaya, free over an amount, refused where not delivered; added to what to collect', async () => {
        service.setSettings({ delivery: { home: 600, office: 400, freeOver: 10000, wilayas: [{ code: 16, home: 400 }, { code: 33, off: true }] } });
        await sync(); // the rules go to the API
        // The page claims a delivery price: ignored
        expect((await jsonPost(checkout({ order_key: 'k-fee-alger-000000001', delivery_fee: 0 }))).status).toBe(201);
        const office = { delivery: 'office', address: '', courier_company: 'Yalidine', office_wilaya: '31 - Oran', office_commune: 'Bir El Djir', courier_office: 'Agence' };
        expect((await jsonPost(checkout({ order_key: 'k-fee-oran-0000000001', wilaya: '31 - Oran', commune: 'Bir El Djir', ...office }))).status).toBe(201);
        const big = JSON.stringify([{ product_id: 'jean', product_name: 'Jean', size: '40', color: 'Noir', quantity: 4, unit_price: 3000 }]);
        expect((await jsonPost(checkout({ order_key: 'k-fee-free-0000000001', wilaya: '31 - Oran', commune: 'Es Senia', items: big }))).status).toBe(201);
        // Illizi: not delivered, the order is refused and nothing waits
        const off = await jsonPost(checkout({ order_key: 'k-fee-off-00000000001', wilaya: '33 - Illizi', commune: 'Illizi' }));
        expect(off).toMatchObject({ status: 400, body: { error: 'not_delivered' } });
        // The commune belongs to the wilaya: one of another wilaya is refused (Arabic or Latin
        // name, any accents); a name the list does not know (typed without it) is kept
        const wrong = await jsonPost(checkout({ order_key: 'k-commune-wrong-00001', wilaya: '31 - Oran', commune: 'Kouba' }));
        expect(wrong).toMatchObject({ status: 400, body: { error: 'place' } });
        expect((await jsonPost(checkout({ order_key: 'k-commune-wrong-00002', wilaya: '31 - Oran', commune: 'القبة' }))).status).toBe(400);
        expect((await jsonPost(checkout({ order_key: 'k-commune-wrong-00003', wilaya: '31 - Oran', delivery: 'office', address: '', courier_company: 'Yalidine', office_wilaya: '31 - Oran', office_commune: 'Kouba', courier_office: 'Agence' }))).status).toBe(400);
        clearHits();
        expect(d1().exec('SELECT order_key, delivery_fee FROM orders ORDER BY order_key')[0].values).toEqual([
            ['k-fee-alger-000000001', 400], ['k-fee-free-0000000001', 0], ['k-fee-oran-0000000001', 400],
        ]);
        await sync();
        const o = (await service.orders()).orders;
        const alger = o.find(x => x.wilaya === '16 - Alger');
        expect(alger).toMatchObject({ deliveryFee: 400, coupon: null, toCollect: 3400 });
        // Money received: the sale is the goods (the delivery is the courier's)
        for (const st of ['contacted', 'confirmed', 'shipped', 'delivered']) service.setOrderStatus({ id: alger.id, status: st });
        expect(service.setOrderStatus({ id: alger.id, status: 'money_received' }).sale).toMatchObject({ total: 3000 });
    });

    it('no delivery price set: the order keeps "by phone" (no price), as before', async () => {
        await sync();
        await jsonPost(checkout({ order_key: 'k-fee-none-0000000001' }));
        await sync();
        expect(await onlyOrder()).toMatchObject({ deliveryFee: null, toCollect: 3000 });
    });

    it('blocked numbers: refused by the API after the next sync, in any writing of the number; unblocked: accepted again; suggestions from refused parcels', async () => {
        expect(codeOf(() => service.blockPhone({ phone: '12' }))).toBe('WEBSITE_PHONE_INVALID');
        service.blockPhone({ phone: '+213 661 22 33 44', note: 'refuse' });
        expect(service.view().tools.blocked).toEqual([expect.objectContaining({ phone: '0661223344', note: 'refuse' })]);
        await sync();
        const r = await jsonPost(checkout({ order_key: 'k-block-0000000000001', phone: '0661 22 33 44' }));
        expect(r).toMatchObject({ status: 403, body: { error: 'blocked' } });
        const form = await post(checkout({ order_key: 'k-block-0000000000002' }));
        expect(form.headers.get('location')).toMatch(/order-error\.html$/);
        expect(waitingInD1()).toBe(0);
        // Another number: fine
        expect((await jsonPost(checkout({ order_key: 'k-block-0000000000003', phone: '0770112233' }))).status).toBe(201);
        service.unblockPhone({ phone: '0661223344' });
        await sync();
        expect((await jsonPost(checkout({ order_key: 'k-block-0000000000004' }))).status).toBe(201);
        await sync();
        // Two refused parcels, none paid: suggested; once blocked, not suggested again
        const mine = (await service.orders()).orders.filter(x => x.phone === '0661223344');
        expect(mine).toHaveLength(1);
        await jsonPost(checkout({ order_key: 'k-block-0000000000005' }));
        await sync();
        for (const x of (await service.orders()).orders.filter(o => o.phone === '0661223344')) service.setOrderStatus({ id: x.id, status: 'cancelled' });
        expect(service.blockSuggestions().map(c => c.phone)).toEqual(['0661223344']);
        service.blockPhone({ phone: '0661223344' });
        expect(service.blockSuggestions()).toEqual([]);
    });

    it('coupons: off by default; on, the code is checked by the API from its hash only, kept on the order and taken off the sale once', async () => {
        api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, auto_apply, coupon_code) VALUES ('vip', 'VIP', 'percentage', 10, 1, 'all', 0, 'Vip10')`);
        api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, auto_apply, coupon_code, end_date) VALUES ('old', 'Old', 'fixed', 500, 1, 'all', 0, 'OLD', '2001-01-01')`);
        const check = (code) => fetch(`${apiBase()}/api/coupon?code=${encodeURIComponent(code)}`).then(r => r.json());
        await sync();
        expect(await check('VIP10')).toEqual({ ok: false }); // the feature is off: no coupon sent
        service.setFeatures({ coupons: true });
        expect(service.apiConfig('k').coupons).toHaveLength(1); // the finished one stays in AFUS
        await sync();
        // In D1: hashes only, never the code
        const stored = d1().exec("SELECT value FROM site_meta WHERE key = 'config'")[0].values[0][0];
        expect(stored).not.toMatch(/vip10/i);
        expect(JSON.parse(stored).coupons[0].hash).toMatch(/^[0-9a-f]{64}$/);
        expect(await check(' vip10 ')).toMatchObject({ ok: true, code: 'VIP10', type: 'percentage', value: 10 });
        expect(await check('OLD')).toEqual({ ok: false });
        expect(await check('NOPE')).toEqual({ ok: false });
        // Guessing codes: a few tries only
        clearHits();
        const answers = [];
        for (let i = 0; i < 22; i++) answers.push((await fetch(`${apiBase()}/api/coupon?code=X${i}`)).status);
        expect(answers.slice(0, 20).every(s => s === 200)).toBe(true);
        expect(answers.slice(20)).toEqual([429, 429]);
        clearHits();
        // The order with the coupon: 10% of 3000 off what to collect; the sale has the discount
        await jsonPost(checkout({ order_key: 'k-coupon-000000000001', coupon: 'vip10' }));
        await jsonPost(checkout({ order_key: 'k-coupon-000000000002', coupon: 'WRONG', phone: '0770112233' }));
        await sync();
        const o = (await service.orders()).orders;
        const withCoupon = o.find(x => x.phone === '0661223344');
        expect(withCoupon).toMatchObject({ coupon: { code: 'VIP10', discount: 300 }, toCollect: 2700 });
        expect(o.find(x => x.phone === '0770112233')).toMatchObject({ coupon: null, toCollect: 3000 });
        for (const st of ['contacted', 'confirmed', 'shipped', 'delivered']) service.setOrderStatus({ id: withCoupon.id, status: st });
        expect(service.setOrderStatus({ id: withCoupon.id, status: 'money_received' }).sale).toMatchObject({ total: 2700 });
        expect(api.get("SELECT subtotal, discount_amount, total FROM sales")).toMatchObject({ subtotal: 3000, discount_amount: 300, total: 2700 });
        expect(api.get("SELECT amount FROM payments").amount).toBe(2700);
    });

    it('page views: one count per page and day (no cookie, no person), limited per place, brought into AFUS; stats with the orders', async () => {
        const view = (page) => fetch(`${apiBase()}/api/view`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: page });
        for (let i = 0; i < 3; i++) expect((await view('product-jean')).status).toBe(200);
        await view('home');
        expect((await view('<script>')).status).toBe(400);
        // Another website cannot count
        expect((await fetch(`${apiBase()}/api/view`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' }, body: 'home' })).status).toBe(403);
        // Only AFUS reads the counts
        expect((await fetch(`${apiBase()}/api/views`)).status).toBe(401);
        await jsonPost(checkout({ order_key: 'k-views-0000000000001' }));
        await sync();
        const st = service.stats({ days: 7 });
        expect(st).toMatchObject({ days: 7, totalViews: 4, totalOrders: 1, rate: 25 });
        expect(st.perDay).toHaveLength(7);
        expect(st.products[0]).toMatchObject({ id: 'jean', views: 3, orders: 1 });
        expect(service.view().tools.viewsAt).toBeTruthy();
        // Brought again: not counted twice
        await sync();
        expect(service.stats({ days: 7 }).totalViews).toBe(4);
        // Counted from one place: limited
        clearHits();
        const many = [];
        for (let i = 0; i < 302; i++) many.push((await view('home')).status);
        expect(many.filter(s => s === 429)).toHaveLength(2);
    });

    it('WhatsApp confirmation: the shop\'s own message filled for the order; a link to the customer\'s number', async () => {
        service.setSettings({ delivery: { home: 500 } });
        await sync();
        await jsonPost(checkout({ order_key: 'k-wa-00000000000000001' }));
        await sync();
        const o = await onlyOrder();
        const def = service.confirmMessage({ id: o.id });
        expect(def.text).toContain('Amina Benali');
        expect(def.text).toContain(o.number);
        expect(def.text).toContain('3 500 DA');
        expect(def.url).toBe(`https://wa.me/213661223344?text=${encodeURIComponent(def.text)}`);
        service.setSettings({ confirmMessage: 'Salam {name}, commande {number} : {total} ({delivery}) {unknown}' });
        expect(service.confirmMessage({ id: o.id }).text).toBe(`Salam Amina Benali, commande ${o.number} : 3 500 DA (Rue 5, Kouba، Kouba، 16 - Alger) {unknown}`);
        expect(codeOf(() => service.confirmMessage({ id: 'nope' }))).toBe('WEBSITE_ORDER_NOT_FOUND');
    });

    it('tracking numbers: checked, shown with the courier\'s tracking page; Yalidine: key checked, confirmed home orders sent once, status read', async () => {
        await sync();
        expect((await jsonPost(checkout({ order_key: 'k-track-0000000000001' }))).status).toBe(201);
        const office = { delivery: 'office', address: '', courier_company: 'Yalidine', office_wilaya: '16 - Alger', office_commune: 'Kouba', courier_office: 'Agence Kouba' };
        expect((await jsonPost(checkout({ order_key: 'k-track-0000000000002', phone: '0770112233', ...office }))).status).toBe(201);
        await sync();
        const list = (await service.orders()).orders;
        const h = list.find(x => x.phone === '0661223344');
        const of = list.find(x => x.phone === '0770112233');
        expect(codeOf(() => service.setTracking({ id: h.id, number: 'bad number!' }))).toBe('WEBSITE_TRACKING_INVALID');
        service.setSettings({ trackingLinks: { Yalidine: 'https://yalidine.com/suivre?t={number}' } });
        expect(service.setTracking({ id: of.id, number: 'ABC-1234' })).toMatchObject({ trackingNumber: 'ABC-1234' });
        // Yalidine
        await expect(service.yalidineSend({ id: h.id })).rejects.toMatchObject({ code: 'WEBSITE_COURIER_NOT_LINKED' });
        await expect(service.yalidineLink({ id: 'wrong-id', token: 'wrong-token' })).rejects.toMatchObject({ code: 'WEBSITE_COURIER_KEY' });
        expect(service.view().tools.yalidine.linked).toBe(false);
        await service.yalidineLink({ id: 'shop-api-id', token: 'shop-api-token', fromWilaya: 'Alger' });
        expect(service.view().tools.yalidine.linked).toBe(true);
        // The key is not in the settings (only in the encrypted store)
        expect(JSON.stringify(settings)).not.toContain('shop-api-token');
        await expect(service.yalidineSend({ id: h.id })).rejects.toMatchObject({ code: 'WEBSITE_COURIER_CONFIRM_FIRST' });
        await expect(service.yalidineSend({ id: of.id })).rejects.toMatchObject({ code: 'WEBSITE_COURIER_HOME_ONLY' });
        service.setOrderStatus({ id: h.id, status: 'contacted' });
        service.setOrderStatus({ id: h.id, status: 'confirmed' });
        calls.length = 0;
        const sent = await service.yalidineSend({ id: h.id });
        expect(sent).toMatchObject({ trackingNumber: 'yal-ABC123' });
        expect(calls[0]).toMatchObject({ url: 'https://yalidine.test/v1/parcels', method: 'POST', headers: { 'X-API-ID': 'shop-api-id', 'X-API-TOKEN': 'shop-api-token' } });
        expect(calls[0].body).toEqual([expect.objectContaining({
            order_id: h.number, from_wilaya_name: 'Alger', firstname: 'Amina', familyname: 'Benali', contact_phone: '0661223344',
            to_wilaya_name: 'Alger', to_commune_name: 'Kouba', address: 'Rue 5, Kouba', price: 3000, is_stopdesk: false, freeshipping: false,
        })]);
        await expect(service.yalidineSend({ id: h.id })).rejects.toMatchObject({ code: 'WEBSITE_COURIER_SENT' });
        expect(await service.yalidineRefresh({ id: h.id })).toMatchObject({ courierState: 'En livraison' });
        expect((await service.orders()).orders.find(x => x.id === h.id).trackingUrl).toBe('https://yalidine.com/suivre?t=yal-ABC123');
        service.yalidineForget();
        await expect(service.yalidineRefresh({ id: h.id })).rejects.toMatchObject({ code: 'WEBSITE_COURIER_NOT_LINKED' });
    });
});

describe('Yalidine parcel', () => {
    it('a price told on the website is collected as it is; none told: Yalidine adds its own', () => {
        const base = { number: 'W-1', customerName: 'Amina Benali', phone: '0661223344', wilaya: '16 - Alger', commune: 'Kouba', address: 'Rue 5', items: [], total: 3000 };
        expect(parcelOf({ ...base, deliveryFee: 400, toCollect: 3400 })).toMatchObject({ price: 3400, freeshipping: true, declared_value: 3000 });
        expect(parcelOf({ ...base, deliveryFee: 0, toCollect: 3000 })).toMatchObject({ price: 3000, freeshipping: true });
        expect(parcelOf({ ...base, deliveryFee: null, toCollect: 3000 })).toMatchObject({ price: 3000, freeshipping: false });
    });
});
