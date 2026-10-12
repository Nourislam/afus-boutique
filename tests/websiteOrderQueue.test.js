// The website's orders: Website -> the shop's Worker API -> its D1 (a
// waiting room) -> AFUS Desktop -> SQLite. Online, offline, duplicates,
// invalid requests, failed syncs, retries, one shop never another's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { startFakeCloud, d1Binding } = require('./helpers/fakeCloud.cjs');
const { createWebsiteService } = require('../electron/website/websiteService');
const { createGithubClient } = require('../electron/website/github');
const { createCloudflareClient } = require('../electron/website/cloudflare');
const { createSecureStore } = require('../electron/website/secureStore');
const catalog = require('../electron/services/catalogService');
const publishPing = require('../electron/website/publish/ping');
const initSqlJs = require('sql.js');

const ACCOUNT = 'c'.repeat(32);
const SCHEMA = fs.readFileSync(path.join(__dirname, '../electron/website/worker/schema.sql'), 'utf8');
const WORKER = path.join(__dirname, '../electron/website/worker/worker.mjs');
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
let SQL;

describe('the order queue, end to end (the real Worker on a fake Cloudflare, AFUS on SQLite)', () => {
    let api, settings, dir, cloud, store, service, fetchImpl, clock, mode;

    function makeService() {
        store = createSecureStore({ dir, safeStorage: fakeSafeStorage(), platform: 'linux' });
        store.set('github', JSON.stringify({ token: cloud.githubToken(), scopes: ['repo'], login: 'yasmine-shop' }));
        const { at, rt } = cloud.cloudflareTokens();
        store.set('cloudflare', JSON.stringify({ accessToken: at, refreshToken: rt, expiresAt: Date.now() + 3600e3, scopes: [], accountId: ACCOUNT }));
        return createWebsiteService({
            api, getSetting: (k) => settings[k] ?? null, saveSetting: (k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); },
            codedError: catalog.codedError, blockedMode: () => mode,
            github: { client: createGithubClient({ clientId: 'gh', fetch: globalThis.fetch, webBase: cloud.base, apiBase: `${cloud.base}/api`, writeGapMs: 0 }), store },
            cloudflare: { client: createCloudflareClient({ clientId: 'cf', fetch: globalThis.fetch, dashBase: cloud.base, apiBase: `${cloud.base}/client/v4`, workerUrl: (n) => `${cloud.base}/w/${n}` }), store },
            publish: { fetch: (u, i) => fetchImpl(u, i), readImage: () => null, waits: { health: 2000, pages: 3000, site: 2000, every: 20 }, log: () => {}, allowHttp: true },
        });
    }
    const d1 = () => [...cloud.cf.databases.values()][0].db;
    const waitingInD1 = () => d1().exec('SELECT COUNT(*) FROM orders')[0].values[0][0];
    const inSqlite = () => api.get('SELECT COUNT(*) AS n FROM website_orders').n;
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
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-queue-'));
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

    it('AFUS online: the order goes to D1, AFUS saves it in SQLite, acknowledges it, D1 lets it go', async () => {
        expect((await post(checkout({ order_key: 'k-online-000000000001' }))).status).toBe(303);
        expect(waitingInD1()).toBe(1);
        const r = await sync();
        expect(r).toMatchObject({ ok: true, received: 1, waiting: 0 });
        expect(inSqlite()).toBe(1);
        expect(waitingInD1()).toBe(0);
        expect(service.view().sync).toMatchObject({ ok: true, failures: 0, received: 1, waiting: 0 });
        // The order is AFUS's now: shown from SQLite, with its lines
        const o = await service.orders();
        expect(o.orders).toHaveLength(1);
        expect(o.orders[0]).toMatchObject({ customerName: 'Amina Benali', status: 'new', items: [{ productId: 'jean', quantity: 1 }] });
    });

    it('the form on an article\'s page: full name, phone, wilaya, commune, home + address or office; checked again by the API, then in SQLite like any order', async () => {
        const product = (extra = {}) => ({
            source: 'product', items, product_id: 'jean', product_name: 'Jean', customer_name: 'Amina Benali Kaci', phone: '0661 22 33 44',
            wilaya: '16 - Alger', commune: 'Kouba', delivery: 'home', address: 'Rue 5, Kouba', website: '', ...extra,
        });
        // Wrong: refused by the API itself (whatever the page did), nothing waits in D1
        for (const bad of [{ customer_name: 'A' }, { phone: '0861223344' }, { wilaya: 'Alger' }, { commune: '' }, { delivery: '' }, { address: '' }, { website: 'bot' }]) {
            const r = await post(product({ ...bad, order_key: `k-bad-${Object.keys(bad)[0]}-0000000000` }));
            expect(r.status).toBe(303);
            expect(r.headers.get('location'), JSON.stringify(bad)).toMatch(/order-error\.html$/);
        }
        expect(waitingInD1()).toBe(0);
        // Right: home with the address; back to the thanks page without emptying the cart
        const home = await post(product({ order_key: 'k-product-home-000001' }));
        expect(home.headers.get('location')).toMatch(/thanks\.html$/);
        // Courier office: no address asked (the office is settled when the shop calls)
        const office = await post(product({ order_key: 'k-product-office-0001', customer_name: 'Yacine Haddad', delivery: 'office', address: '' }));
        expect(office.headers.get('location')).toMatch(/thanks\.html$/);
        // Sent twice (double press): still one order
        await post(product({ order_key: 'k-product-office-0001', customer_name: 'Yacine Haddad', delivery: 'office', address: '' }));
        expect(waitingInD1()).toBe(2);
        await sync();
        expect(inSqlite()).toBe(2);
        const rows = api.all('SELECT customer_name, first_name, last_name, phone, wilaya, commune, delivery, address, office_wilaya, office_commune FROM website_orders ORDER BY customer_name');
        expect(rows).toEqual([
            { customer_name: 'Amina Benali Kaci', first_name: 'Amina', last_name: 'Benali Kaci', phone: '0661223344', wilaya: '16 - Alger', commune: 'Kouba', delivery: 'home', address: 'Rue 5, Kouba', office_wilaya: '', office_commune: '' },
            { customer_name: 'Yacine Haddad', first_name: 'Yacine', last_name: 'Haddad', phone: '0661223344', wilaya: '16 - Alger', commune: 'Kouba', delivery: 'office', address: '', office_wilaya: '16 - Alger', office_commune: 'Kouba' },
        ]);
        // The chosen size and colour came with the order
        const o = await service.orders();
        expect(o.orders.find(x => x.customerName === 'Amina Benali Kaci').items).toEqual([expect.objectContaining({ productId: 'jean', size: '40', color: 'Noir', quantity: 1 })]);
    });

    it('AFUS offline (closed): orders wait in D1; when it comes back it takes them all, page by page, then D1 is empty', async () => {
        for (let i = 0; i < 3; i++) expect((await post(checkout({ order_key: `k-offline-00000000000${i}`, first_name: `Client${i}` }))).status).toBe(303);
        // Many more waiting (as after days closed): written straight into D1
        const db = d1();
        for (let i = 0; i < 230; i++) {
            db.run(`INSERT INTO orders (id, created_at, product_id, product_name, quantity, customer_name, phone, items) VALUES (?, ?, 'jean', 'Jean', 1, ?, '0661223344', ?)`,
                [`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, new Date(Date.now() + i).toISOString(), `Old ${i}`, items]);
        }
        expect(waitingInD1()).toBe(233);
        expect(inSqlite()).toBe(0);
        const r = await sync();
        expect(r).toMatchObject({ ok: true, received: 233, waiting: 0 });
        expect(inSqlite()).toBe(233);
        expect(waitingInD1()).toBe(0);
    });

    it('duplicates: the same order key gives one order (double press, retry, after it left D1, two at once); a second sync adds nothing', async () => {
        const key = 'k-dup-0000000000000001';
        const a = await post(checkout({ order_key: key }));
        const b = await post(checkout({ order_key: key }));
        expect([a.status, b.status]).toEqual([303, 303]);
        expect(b.headers.get('location')).toContain('thanks.html?cart=1');
        expect(waitingInD1()).toBe(1);
        // JSON: says it is the same order
        const j1 = await fetch(orderUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checkout({ order_key: 'k-json-00000000000001' })) }).then(x => x.json());
        const j2 = await fetch(orderUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checkout({ order_key: 'k-json-00000000000001' })) }).then(x => x.json());
        expect(j2).toMatchObject({ ok: true, id: j1.id, duplicate: true });
        await sync();
        expect(inSqlite()).toBe(2);
        // Sent again after AFUS took it (back button): still no new order
        expect((await post(checkout({ order_key: key }))).status).toBe(303);
        expect(waitingInD1()).toBe(0);
        // Two presses at the same moment
        const both = await Promise.all([post(checkout({ order_key: 'k-race-00000000000001' })), post(checkout({ order_key: 'k-race-00000000000001' }))]);
        expect(both.map(x => x.status)).toEqual([303, 303]);
        expect(waitingInD1()).toBe(1);
        await sync();
        await sync();
        expect(inSqlite()).toBe(3);
    });

    it('failed sync (no internet): nothing taken, nothing lost; retried later, waiting longer each time (1, 2, 4 ... 30 min)', async () => {
        await post(checkout({ order_key: 'k-net-000000000000001' }));
        fetchImpl = async () => { throw new Error('offline'); };
        const steps = [];
        for (let i = 0; i < 7; i++) {
            const r = await sync();
            expect(r).toMatchObject({ ok: false, reason: 'network' });
            const s = service.view().sync;
            steps.push((Date.parse(s.nextAt) - clock) / 60e3);
            expect(s.failures).toBe(i + 1);
        }
        expect(steps).toEqual([1, 2, 4, 8, 16, 30, 30]);
        expect(inSqlite()).toBe(0);
        expect(waitingInD1()).toBe(1);
        // Before the next try: the background sync waits
        expect(await service.syncIfDue({ now: () => clock + 29 * 60e3 })).toMatchObject({ reason: 'later' });
        // Internet back: the next try takes it; the count starts again
        fetchImpl = globalThis.fetch;
        const r = await service.syncIfDue({ now: () => clock + 31 * 60e3 });
        expect(r).toMatchObject({ ok: true, received: 1 });
        expect(service.view().sync).toMatchObject({ ok: true, failures: 0 });
        expect((Date.parse(service.view().sync.nextAt) - (clock + 31 * 60e3)) / 60e3).toBe(5);
        expect(waitingInD1()).toBe(0);
    });

    it('failed sync (SQLite cannot save): no ack, the orders stay in D1; retry saves them once', async () => {
        await post(checkout({ order_key: 'k-save-00000000000001' }));
        const real = api.transaction;
        api.transaction = () => { throw new Error('disk full'); };
        expect(await sync()).toMatchObject({ ok: false, reason: 'save' });
        expect(waitingInD1()).toBe(1);
        expect(cloud.requests.some(r => r.path.endsWith('/api/orders/ack'))).toBe(false);
        api.transaction = real;
        expect(await sync()).toMatchObject({ ok: true, received: 1 });
        expect(inSqlite()).toBe(1);
        expect(waitingInD1()).toBe(0);
    });

    it('failed sync (the ack is lost): saved in SQLite, still in D1; the retry sends the ack again, nothing is added twice', async () => {
        await post(checkout({ order_key: 'k-ack-000000000000001' }));
        fetchImpl = async (u, i) => (String(u).endsWith('/api/orders/ack') ? Promise.reject(new Error('cut')) : globalThis.fetch(u, i));
        expect(await sync()).toMatchObject({ ok: false, reason: 'ack' });
        expect(inSqlite()).toBe(1);
        expect(waitingInD1()).toBe(1);
        fetchImpl = globalThis.fetch;
        expect(await sync()).toMatchObject({ ok: true, received: 0 });
        expect(inSqlite()).toBe(1);
        expect(waitingInD1()).toBe(0);
        // A repeated ack is fine (already gone)
        const id = api.get('SELECT id FROM website_orders').id;
        const again = await publishPing.ackOrders(`${cloud.base}/w/boutique-yasmine-api`, store.get('website-key'), [id], { storeId: store.get('website-store'), allowHttp: true, fetch: globalThis.fetch });
        expect(again).toMatchObject({ ok: true, removed: 0 });
    });

    it('training or the demo shop opened during a sync: nothing goes into that copy, nothing is acknowledged', async () => {
        await post(checkout({ order_key: 'k-train-0000000000001' }));
        fetchImpl = async (u, i) => { const r = await globalThis.fetch(u, i); mode = 'training'; return r; };
        expect(await sync()).toMatchObject({ ok: false, reason: 'save' });
        expect(inSqlite()).toBe(0);
        expect(waitingInD1()).toBe(1);
        // Back in the shop: taken normally
        mode = null;
        fetchImpl = globalThis.fetch;
        expect(await sync()).toMatchObject({ ok: true, received: 1 });
        expect(waitingInD1()).toBe(0);
        // While in training / demo the background sync does nothing
        mode = 'demo';
        expect(await service.syncIfDue({ now: () => clock + 3600e3 })).toMatchObject({ reason: 'idle' });
    });

    it('a website published before the waiting room (older Worker, no ack): orders read after the last one kept, never twice', async () => {
        // The older Worker: says no store, has no ack
        fetchImpl = async (u, i) => {
            if (String(u).includes('/api/orders/ack')) return new Response('{"ok":false}', { status: 404, headers: { 'Content-Type': 'application/json' } });
            const r = await globalThis.fetch(u, i);
            if (!String(u).includes('/api/orders?')) return r;
            const data = await r.json();
            delete data.store;
            const since = new URL(u).searchParams.get('since') || '1970-01-01T00:00:00.000Z';
            data.orders = data.orders.filter(o => o.created_at > since);
            return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        await post(checkout({ order_key: 'k-old-000000000000001' }));
        expect(await sync()).toMatchObject({ ok: true, received: 1 });
        expect(service.view().sync).toMatchObject({ ok: true, legacy: true });
        expect(cloud.requests.some(r => r.path.endsWith('/ack'))).toBe(false);
        expect(await sync()).toMatchObject({ ok: true, received: 0 });
        await new Promise(r => setTimeout(r, 1100));
        await post(checkout({ order_key: 'k-old-000000000000002', first_name: 'Sofiane' }));
        expect(await sync()).toMatchObject({ ok: true, received: 1 });
        expect(inSqlite()).toBe(2);
    });

    it('one sync at a time: two at once make one run', async () => {
        await post(checkout({ order_key: 'k-once-00000000000001' }));
        const [a, b] = await Promise.all([sync(), sync()]);
        expect(a).toBe(b);
        expect(cloud.requests.filter(r => r.method === 'GET' && r.path.endsWith('/api/orders')).length).toBe(1);
        expect(inSqlite()).toBe(1);
    });

    it('the website has no secret: no shop key, no store id in any published file; the API refuses http', async () => {
        const files = cloud.filesOf('boutique-yasmine');
        const all = [...files.values()].map(b => b.toString()).join('\n');
        expect(all).not.toContain(store.get('website-key'));
        expect(all).not.toContain(store.get('website-store'));
        expect(all).not.toMatch(/Authorization|Bearer|X-Afus-Store/);
        // The shop's API address is https; the program never sends the key elsewhere
        expect(await publishPing.fetchOrders('http://shop-api.example.workers.dev', 'k', { storeId: 's' })).toEqual({ ok: false, reason: 'insecure' });
        expect(await publishPing.ackOrders('http://shop-api.example.workers.dev', 'k', [], { storeId: 's' })).toEqual({ ok: false, reason: 'insecure' });
        expect(publishPing.secure('http://127.0.0.1:9/x', false)).toBe(false);
    });
});

describe('the Worker alone: security, validation, limits, one store never another', () => {
    let worker;
    async function shop(name) {
        const db = new SQL.Database();
        db.exec(SCHEMA);
        return { db, env: { DB: d1Binding(db), SHOP_KEY: `key-of-${name}-${'x'.repeat(40)}`, STORE_ID: `store-${name}`, SITE_URL: `https://${name}.github.io/shop/`, SHOP_NAME: name } };
    }
    const req = (url, init = {}) => new Request(url, init);
    const auth = (s, extra = {}) => ({ Authorization: `Bearer ${s.env.SHOP_KEY}`, 'X-Afus-Store': s.env.STORE_ID, 'CF-Connecting-IP': '10.0.0.1', ...extra });
    const form = (fields, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '10.0.0.9', ...headers }, body: new URLSearchParams(fields).toString() });
    const API = 'https://shop-api.yasmine.workers.dev';

    beforeEach(async () => {
        SQL = SQL || await initSqlJs();
        worker = (await import(`${WORKER}?t=${Date.now()}`)).default;
    });

    it('https only; Strict-Transport-Security on every answer', async () => {
        const a = await shop('a');
        expect((await worker.fetch(req('http://shop-api.yasmine.workers.dev/api/health'), a.env)).status).toBe(403);
        const ok = await worker.fetch(req(`${API}/api/health`), a.env);
        expect(ok.status).toBe(200);
        expect(ok.headers.get('Strict-Transport-Security')).toMatch(/max-age=\d+/);
    });

    it('authentication and authorization: key AND store id; wrong ones refused; repeated wrong keys blocked for a while', async () => {
        const a = await shop('a');
        expect((await worker.fetch(req(`${API}/api/orders`), a.env)).status).toBe(401);
        expect((await worker.fetch(req(`${API}/api/orders`, { headers: auth(a, { Authorization: 'Bearer wrong' }) }), a.env)).status).toBe(401);
        expect((await worker.fetch(req(`${API}/api/orders`, { headers: auth(a, { 'X-Afus-Store': 'store-b' }) }), a.env)).status).toBe(403);
        const { 'X-Afus-Store': _drop, ...noStore } = auth(a);
        expect((await worker.fetch(req(`${API}/api/orders`, { headers: noStore }), a.env)).status).toBe(403);
        const good = await worker.fetch(req(`${API}/api/orders`, { headers: auth(a) }), a.env);
        expect(good.status).toBe(200);
        expect(await good.json()).toMatchObject({ ok: true, store: 'store-a', orders: [], waiting: 0 });
        // Ten wrong tries from one place: even the right key is refused there for a while
        for (let i = 0; i < 7; i++) await worker.fetch(req(`${API}/api/orders`, { headers: auth(a, { Authorization: `Bearer guess${i}` }) }), a.env);
        expect((await worker.fetch(req(`${API}/api/orders`, { headers: auth(a) }), a.env)).status).toBe(429);
        // Another place is not blocked
        expect((await worker.fetch(req(`${API}/api/orders`, { headers: auth(a, { 'CF-Connecting-IP': '10.0.0.2' }) }), a.env)).status).toBe(200);
    });

    it('store isolation: each shop its own D1 and keys; shop A\'s key or store id never opens shop B', async () => {
        const a = await shop('a');
        const b = await shop('b');
        await worker.fetch(req(`${API}/api/orders`, form(checkout({ order_key: 'k-iso-a00000000000001' }), { Origin: 'https://a.github.io' })), a.env);
        expect(a.db.exec('SELECT COUNT(*) FROM orders')[0].values[0][0]).toBe(1);
        expect(b.db.exec('SELECT COUNT(*) FROM orders')[0].values[0][0]).toBe(0);
        expect((await worker.fetch(req(`${API}/api/orders`, { headers: auth(a) }), b.env)).status).toBe(401);
        expect((await worker.fetch(req(`${API}/api/orders`, { headers: auth(b, { 'X-Afus-Store': 'store-a' }) }), b.env)).status).toBe(403);
        const id = a.db.exec('SELECT id FROM orders')[0].values[0][0];
        // B's Afus cannot remove A's order
        const ack = await worker.fetch(req(`${API}/api/orders/ack`, { method: 'POST', headers: { ...auth(b), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) }), b.env);
        expect(await ack.json()).toMatchObject({ ok: true, removed: 0 });
        expect(a.db.exec('SELECT COUNT(*) FROM orders')[0].values[0][0]).toBe(1);
        // A Worker answering for another store is refused by AFUS
        const liar = async () => new Response(JSON.stringify({ ok: true, store: 'store-b', orders: [{ id: 'x' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        expect(await publishPing.fetchOrders(API, a.env.SHOP_KEY, { storeId: 'store-a', fetch: liar })).toEqual({ ok: false, reason: 'store' });
    });

    it('validation: bad bodies, a foreign website, bad acks are refused; nothing is stored', async () => {
        const a = await shop('a');
        const count = () => a.db.exec('SELECT COUNT(*) FROM orders')[0].values[0][0];
        const json = (body, headers = {}) => worker.fetch(req(`${API}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.3', ...headers }, body }), a.env);
        expect((await json('{not json')).status).toBe(400);
        expect((await json(JSON.stringify(checkout({ phone: '12' })))).status).toBe(400);
        expect((await json(JSON.stringify(checkout({ items: 'nope' })))).status).toBe(400);
        expect((await json(JSON.stringify(checkout({ website: 'http://spam' })))).status).toBe(400);
        expect((await json('x'.repeat(70 * 1024))).status).toBe(413);
        // A form posted from another website
        expect((await worker.fetch(req(`${API}/api/orders`, form(checkout(), { Origin: 'https://evil.example' })), a.env)).status).toBe(403);
        expect(count()).toBe(0);
        // The checkout's key must look like one (else: no idempotency, still checked)
        expect((await json(JSON.stringify(checkout({ order_key: '<script>' })))).status).toBe(201);
        expect(a.db.exec("SELECT COUNT(*) FROM order_keys")[0].values[0][0]).toBe(0);
        // Acks: JSON only, ids only, at most 200
        const ack = (body, type = 'application/json') => worker.fetch(req(`${API}/api/orders/ack`, { method: 'POST', headers: { ...auth(a), 'Content-Type': type }, body }), a.env);
        expect((await ack('ids=1', 'application/x-www-form-urlencoded')).status).toBe(415);
        expect((await ack('{')).status).toBe(400);
        expect((await ack(JSON.stringify({ ids: ["1' OR 1=1 --"] }))).status).toBe(400);
        expect((await ack(JSON.stringify({ ids: Array.from({ length: 201 }, () => '00000000-0000-4000-8000-000000000000') }))).status).toBe(400);
        expect((await ack(JSON.stringify({ ids: [] }))).status).toBe(200);
        expect(count()).toBe(1);
    });

    it('rate limiting: 5 orders per 10 minutes from one place, also after AFUS took them (counts are kept apart)', async () => {
        const a = await shop('a');
        for (let i = 0; i < 5; i++) expect((await worker.fetch(req(`${API}/api/orders`, form(checkout({ order_key: `k-rate-0000000000000${i}` }))), a.env)).headers.get('location')).toContain('thanks');
        const ids = a.db.exec('SELECT id FROM orders')[0].values.flat();
        await worker.fetch(req(`${API}/api/orders/ack`, { method: 'POST', headers: { ...auth(a), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }), a.env);
        expect(a.db.exec('SELECT COUNT(*) FROM orders')[0].values[0][0]).toBe(0);
        const sixth = await worker.fetch(req(`${API}/api/orders`, form(checkout({ order_key: 'k-rate-00000000000009' }))), a.env);
        expect(sixth.headers.get('location')).toContain('order-error.html');
        // A repeat of an order already made is still answered (no new order, no limit)
        const repeat = await worker.fetch(req(`${API}/api/orders`, form(checkout({ order_key: 'k-rate-00000000000000' }))), a.env);
        expect(repeat.headers.get('location')).toContain('thanks');
        // Another place may order
        expect((await worker.fetch(req(`${API}/api/orders`, form(checkout(), { 'CF-Connecting-IP': '10.0.0.77' })), a.env)).headers.get('location')).toContain('thanks');
    });
});
