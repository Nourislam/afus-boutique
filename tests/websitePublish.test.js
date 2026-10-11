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
const ipcGuard = require('../electron/services/ipcGuard');
const catalog = require('../electron/services/catalogService');
const initSqlJs = require('sql.js');

const ACCOUNT = 'c'.repeat(32);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const codeOf = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };
const fakeSafeStorage = () => ({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
    decryptString: (buf) => Buffer.from(buf.toString().slice(4), 'base64').toString(),
});
/** Everything of the shop in SQLite (the website must never change it). */
const shopData = (api) => JSON.stringify(['products', 'product_variants', 'categories', 'sales', 'customers']
    .map(t => api.all(`SELECT * FROM ${t} ORDER BY rowid`)).concat([api.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]));

describe('Create Website on the shop\'s own GitHub and Cloudflare (simulated, the real Worker running)', () => {
    let api, settings, dir, cloud, SQL, mode, logs;

    function makeService({ scopes = ['repo'] } = {}) {
        const store = createSecureStore({ dir, safeStorage: fakeSafeStorage(), platform: 'linux' });
        if (!store.has('github')) store.set('github', JSON.stringify({ token: cloud.githubToken(), scopes, login: 'yasmine-shop' }));
        if (!store.has('cloudflare')) {
            const { at, rt } = cloud.cloudflareTokens();
            store.set('cloudflare', JSON.stringify({ accessToken: at, refreshToken: rt, expiresAt: Date.now() + 3600e3, scopes: [], accountId: ACCOUNT }));
        }
        const service = createWebsiteService({
            api,
            getSetting: (key) => settings[key] ?? null,
            saveSetting: (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); },
            codedError: catalog.codedError,
            blockedMode: () => mode,
            github: { client: createGithubClient({ clientId: 'gh-public', fetch: globalThis.fetch, webBase: cloud.base, apiBase: `${cloud.base}/api` }), store },
            cloudflare: {
                client: createCloudflareClient({ clientId: 'cf-public', fetch: globalThis.fetch, dashBase: cloud.base, apiBase: `${cloud.base}/client/v4`, workerUrl: (name) => `${cloud.base}/w/${name}` }),
                store,
            },
            publish: {
                fetch: globalThis.fetch,
                readImage: (name) => (name === 'jean-1.jpg' || name === 'logo.png' ? JPEG : null),
                waits: { health: 2000, pages: 3000, site: 2000, every: 20 },
                log: (e) => logs.push(e),
                // The fake cloud is a local http server (the program itself: https only)
                allowHttp: true,
            },
        });
        return { service, store };
    }

    beforeEach(async () => {
        ({ api } = await createShop());
        api.run("INSERT INTO categories (id, name) VALUES ('c-jeans', 'Jeans')");
        api.run("UPDATE products SET category_id = 'c-jeans', image_path = 'jean-1.jpg', gallery = '[\"missing.jpg\"]' WHERE id = 'jean'");
        api.run("INSERT INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify({ businessName: 'Boutique Yasmine', businessPhone: '0555 12 34 56', defaultLanguage: 'fr' })]);
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
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-publish-'));
        SQL = SQL || await initSqlJs();
        cloud = await startFakeCloud({ login: 'yasmine-shop', accounts: [{ id: ACCOUNT, name: 'Boutique' }], subdomain: 'yasmine', d1Factory: async () => new SQL.Database() });
        mode = null;
        logs = [];
    });
    afterEach(async () => { await cloud.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('one press: repository, Pages, D1, Worker, API, data, pages, published, address answering — nothing technical shown', async () => {
        const { service, store } = makeService();
        const before = shopData(api);
        const v0 = service.view();
        expect(v0.requirements).toEqual({ github: true, githubPermission: false, cloudflare: true, theme: true });
        expect(v0.canPublish).toBe(true);

        const started = service.publishSite();
        expect(started.result).toEqual({ started: true });
        expect(started.status).toBe('publishing');
        expect(service.publishSite().result).toEqual({ started: false, reason: 'running' });
        await service.publishPending();

        const v = service.view();
        expect(v.deploy.status, JSON.stringify([v.deploy, logs])).toBe('done');
        expect(v.deploy.steps.map(s => [s.id, s.status])).toEqual(
            ['repository', 'pages', 'database', 'worker', 'api', 'data', 'build', 'publish', 'live'].map(id => [id, 'done']));
        const siteUrl = `${cloud.base}/pages/yasmine-shop/boutique-yasmine/`;
        expect(v.site).toMatchObject({ url: siteUrl, pending: false });
        expect(v.status).toBe('live');
        expect(v.freeUrl).toBe(siteUrl);
        // The screen sees no name, id or key of what was made
        const shown = JSON.stringify(v);
        expect(v).not.toHaveProperty('resources');
        expect(v).not.toHaveProperty('repository');
        for (const secret of ['boutique-yasmine-api', 'boutique-yasmine-db', '/w/', store.get('website-key'), ACCOUNT]) expect(shown).not.toContain(secret);

        // GitHub: one repository, the website's files, Pages on
        expect([...cloud.gh.repos.keys()]).toEqual(['boutique-yasmine']);
        const files = cloud.filesOf('boutique-yasmine');
        for (const f of ['index.html', 'products.html', 'search.html', 'new.html', 'best.html', 'offers.html', 'categories.html', 'cart.html', 'checkout.html', 'contact.html', 'about.html', 'location.html',
            'assets/store.css', 'assets/store.js', 'search.json', 'category-c-jeans.html', 'product-jean.html', 'product-belt.html', 'thanks.html', 'order-error.html', '404.html', 'catalog.json', '.nojekyll', 'images/jean-1.jpg']) expect(files.has(f), f).toBe(true);
        expect(files.has('README.md')).toBe(true);
        expect(files.get('images/jean-1.jpg').equals(JPEG)).toBe(true);
        expect([...files.keys()].some(f => f.includes('missing'))).toBe(false);
        const all = [...files.values()].map(b => b.toString()).join('\n');
        // Nothing private leaves the program
        expect(all).not.toMatch(/"cost"|stock_quantity|1800|J-N-38/);
        expect(all).not.toContain(store.get('website-key'));
        const product = files.get('product-jean.html').toString();
        const orderUrl = `${cloud.base}/w/boutique-yasmine-api/api/orders`;
        // Orders go through the cart and checkout (no order form on the article page)
        expect(product).not.toContain(`action="${orderUrl}"`);
        expect(product).toContain(`form-action ${cloud.base}`);
        // One script, the website's own file; the cart's checkout sends to the shop's API too
        expect([...product.matchAll(/<script[^>]*>/g)].map(m => m[0])).toEqual(['<script src="assets/store.js" defer>']);
        expect(product).toContain("script-src 'self'");
        expect(files.get('checkout.html').toString()).toContain(`action="${orderUrl}"`);
        // search.json: what the pages show (name, price, picture, availability), nothing else
        const search = JSON.parse(files.get('search.json').toString());
        expect(Object.keys(search).sort()).toEqual(['money', 'products', 'texts', 'version']);
        for (const p of search.products) expect(Object.keys(p).sort()).toEqual(['available', 'id', 'image', 'name', 'price', 'url', 'variants']);
        expect(search.products.find(p => p.id === 'jean')).toMatchObject({ url: 'product-jean.html', image: 'images/jean-1.jpg' });

        // Cloudflare: one D1 database with the website's tables, one Worker with its bindings
        expect([...cloud.cf.databases.values()].map(d => d.name)).toEqual(['boutique-yasmine-db']);
        const db = [...cloud.cf.databases.values()][0].db;
        expect(db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0].values.flat()).toEqual(['hits', 'order_keys', 'orders', 'site_meta']);
        expect(db.exec("SELECT value FROM site_meta WHERE key='published_at'")[0].values[0][0]).toBe(v.publishedAt);
        const worker = cloud.cf.scripts.get('boutique-yasmine-api');
        expect(worker.enabled).toBe(true);
        const b = Object.fromEntries(worker.metadata.bindings.map(x => [x.name, x]));
        expect(b.DB).toMatchObject({ type: 'd1', database_id: [...cloud.cf.databases.keys()][0] });
        expect(b.SHOP_KEY).toMatchObject({ type: 'secret_text', text: store.get('website-key') });
        expect(b.SITE_URL).toMatchObject({ type: 'plain_text', text: siteUrl });

        // The published website answers, with the shop's own articles
        const home = await fetch(siteUrl);
        expect(home.status).toBe(200);
        const page = await fetch(`${siteUrl}product-jean.html`).then(r => r.text());
        expect(page).toContain('Jean');
        expect(page).toContain('Boutique Yasmine');
        expect((await fetch(`${siteUrl}images/jean-1.jpg`)).status).toBe(200);

        // SQLite: not one row or table changed; no product database made anywhere
        expect(shopData(api)).toBe(before);
    });

    it('a customer orders from the article page; the shop\'s API keeps it in D1; Afus reads it with its key only', async () => {
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        const siteUrl = service.view().site.url;
        const orderUrl = `${cloud.base}/w/boutique-yasmine-api/api/orders`;
        const form = (fields) => fetch(orderUrl, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
        const good = { product_id: 'jean', product_name: 'Jean', size: '40', color: 'Noir', quantity: '2', customer_name: 'Amina B.', phone: '0661 22 33 44', wilaya: 'Alger', address: 'Bab Ezzouar', note: 'Le soir', website: '' };

        const r = await form(good);
        expect(r.status).toBe(303);
        expect(r.headers.get('location')).toBe(`${siteUrl}thanks.html`);
        expect((await fetch(r.headers.get('location'))).status).toBe(200);
        // Refused: no phone, a robot's hidden field, an address of another site never followed
        expect((await form({ ...good, phone: '12' })).headers.get('location')).toBe(`${siteUrl}order-error.html`);
        expect((await form({ ...good, website: 'http://spam.example' })).headers.get('location')).toBe(`${siteUrl}order-error.html`);
        const json = await fetch(orderUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...good, customer_name: '<b>Lina</b>' }) });
        expect(json.status).toBe(201);
        // The list is the shop's only
        expect((await fetch(orderUrl)).status).toBe(401);
        expect((await fetch(orderUrl, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);

        const o = await service.orders();
        expect(o.ok).toBe(true);
        expect(o.orders).toHaveLength(2);
        expect(o.orders.find(x => x.customerName === 'Amina B.')).toMatchObject({ productId: 'jean', size: '40', color: 'Noir', quantity: 2, phone: '0661223344', wilaya: 'Alger', note: 'Le soir' });
        // Stored as text (the screen shows it as text)
        expect(o.orders.some(x => x.customerName === '<b>Lina</b>')).toBe(true);

        // Too many requests from one place in a few minutes
        for (let i = 0; i < 4; i++) await form(good);
        expect((await form(good)).headers.get('location')).toBe(`${siteUrl}order-error.html`);
        // Health of the API (public)
        const health = await fetch(`${cloud.base}/w/boutique-yasmine-api/api/health`).then(x => x.json());
        expect(health).toMatchObject({ ok: true, shop: 'Boutique Yasmine' });
        expect(health.publishedAt).toBeTruthy();
    });

    it('a customer orders a whole cart from checkout: lines, wilaya, commune, delivery; Afus shows each line', async () => {
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        const siteUrl = service.view().site.url;
        const orderUrl = `${cloud.base}/w/boutique-yasmine-api/api/orders`;
        const form = (fields) => fetch(orderUrl, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
        const items = [
            { product_id: 'jean', product_name: 'Jean', size: '40', color: 'Noir', quantity: 2, unit_price: 2000 },
            { product_id: 'belt', product_name: 'Ceinture', size: '', color: '', quantity: 1, unit_price: 900 },
        ];
        const cart = { items: JSON.stringify(items), product_id: 'jean', product_name: 'Jean +1', customer_name: 'Sofiane K.', phone: '0770 11 22 33', wilaya: '16 - Alger', commune: 'Kouba', address: 'Rue 5', delivery: 'home', note: '', website: '' };
        const r = await form(cart);
        expect(r.status).toBe(303);
        // The thanks page empties the cart (only after a cart order)
        expect(r.headers.get('location')).toBe(`${siteUrl}thanks.html?cart=1`);
        // Wrong lines are refused, never half kept
        for (const bad of ['not json', '[]x', JSON.stringify([{ product_name: 'no id' }]), JSON.stringify(Array.from({ length: 31 }, () => items[0])), JSON.stringify({ product_id: 'x' })]) {
            expect((await form({ ...cart, items: bad })).headers.get('location'), bad.slice(0, 20)).toBe(`${siteUrl}order-error.html`);
        }
        const o = await service.orders();
        expect(o.orders).toHaveLength(1);
        expect(o.orders[0]).toMatchObject({ customerName: 'Sofiane K.', phone: '0770112233', wilaya: '16 - Alger', commune: 'Kouba', delivery: 'home', quantity: 3, productId: 'jean' });
        expect(o.orders[0].items).toEqual([
            { productId: 'jean', productName: 'Jean', size: '40', color: 'Noir', quantity: 2, unitPrice: 2000 },
            { productId: 'belt', productName: 'Ceinture', size: '', color: '', quantity: 1, unitPrice: 900 },
        ]);
        // A quantity is kept within limits, a delivery outside the two choices is dropped
        await form({ ...cart, items: JSON.stringify([{ ...items[0], quantity: 500, unit_price: -4 }]), delivery: 'drone' });
        const again = (await service.orders()).orders.find(x => x.delivery === '');
        expect(again.items[0]).toMatchObject({ quantity: 20, unitPrice: null });
    });

    it('orders kept in AFUS: fetched once each, a status per order, money received = one sale; shown without internet', async () => {
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        const orderUrl = `${cloud.base}/w/boutique-yasmine-api/api/orders`;
        const form = (fields) => fetch(orderUrl, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
        const items = JSON.stringify([{ product_id: 'jean', product_name: 'Jean', size: '40', color: 'Noir', quantity: 1, unit_price: 3000 }]);
        await form({ items, customer_name: 'Sofiane K.', phone: '0770112233', wilaya: '16 - Alger', delivery: 'home', website: '' });
        let o = await service.orders();
        expect(o).toMatchObject({ ok: true, synced: true });
        expect(o.orders).toHaveLength(1);
        expect(o.orders[0]).toMatchObject({ status: 'new', receipt: null, items: [{ productId: 'jean', size: '40', color: 'Noir', quantity: 1 }] });
        const id = o.orders[0].id;
        // Fetched again: still one (and the status kept in AFUS is not reset)
        service.setOrderStatus({ id, status: 'shipped' });
        o = await service.orders();
        expect(o.orders.map(x => [x.id, x.status])).toEqual([[id, 'shipped']]);
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
        const r = service.setOrderStatus({ id, status: 'money_received' });
        expect(r.sale.total).toBe(3000);
        expect(r.order).toMatchObject({ status: 'money_received', receipt: r.sale.receipt });
        expect(api.get("SELECT COUNT(*) AS n FROM sales WHERE notes = ?", [`website:${id}`]).n).toBe(1);
        expect(await codeOf(() => service.setOrderStatus({ id, status: 'money_received' }))).toBe('WEBSITE_ORDER_FINAL');
        // The customer (by phone), AFUS only: figures and the order with its statuses
        const customers = service.customers({ search: '0770' });
        expect(customers).toEqual([expect.objectContaining({ phone: '0770112233', name: 'Sofiane K.', orders: 1, successful: 1, total: 3000, returned: 0, cancelled: 0, delivered: 1 })]);
        const h = service.customerHistory({ phone: '+213 770 11 22 33' });
        expect(h).toMatchObject({ orders: 1, successful: 1, total: 3000 });
        expect(h.list.map(x => [x.id, x.status, x.events.map(e => e.status)])).toEqual([[id, 'money_received', ['new', 'shipped', 'money_received']]]);
        expect(o.orders[0].customer).toBeTruthy();
        expect(await codeOf(() => service.customerHistory({ phone: '0555000000' }))).toBe('WEBSITE_CUSTOMER_NOT_FOUND');
        // No internet: the list is AFUS's own
        await cloud.close();
        o = await service.orders();
        expect(o).toMatchObject({ ok: true, synced: false, reason: 'network' });
        expect(o.orders.map(x => x.status)).toEqual(['money_received']);
        cloud = await startFakeCloud({ login: 'yasmine-shop', accounts: [{ id: ACCOUNT, name: 'Boutique' }], subdomain: 'yasmine', d1Factory: async () => new SQL.Database() });
        // Demo shop / training: not changed there
        mode = 'demo';
        expect(await codeOf(() => service.setOrderStatus({ id, status: 'new' }))).toBe('WEBSITE_ACCOUNTS_BLOCKED');
        mode = null;
        // Owner only
        expect(ipcGuard.RULES['website:setOrderStatus']).toBe('admin');
    });

    it('checkout (cash on delivery): first / last name, Algerian phone, wilaya, commune; home address or courier office; checked by the API', async () => {
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        const siteUrl = service.view().site.url;
        const orderUrl = `${cloud.base}/w/boutique-yasmine-api/api/orders`;
        const form = (fields) => fetch(orderUrl, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
        const where = async (fields) => (await form(fields)).headers.get('location').replace(siteUrl, '');
        const stock = () => api.all('SELECT id, stock_quantity FROM product_variants ORDER BY id').concat(api.all('SELECT id, stock_quantity FROM products ORDER BY id'));
        const before = stock();
        const items = JSON.stringify([{ product_id: 'jean', product_name: 'Jean', size: '40', color: 'Noir', quantity: 2, unit_price: 3000 }]);
        const home = { items, first_name: 'Amina', last_name: 'Benali', phone: '0661 22 33 44', wilaya: '16 - Alger', commune: 'Kouba', delivery: 'home', address: 'Cité 200 logements, bât. 3', website: '' };
        const office = { ...home, delivery: 'office', address: '', courier_company: 'Yalidine', office_wilaya: '09 - Blida', office_commune: 'Boufarik', courier_office: 'Stop desk Boufarik centre' };
        expect(await where(home)).toBe('thanks.html?cart=1');
        expect(await where({ ...office, phone: '+213 770 11 22 33' })).toBe('thanks.html?cart=1');
        // Refused: each missing or wrong field
        const bad = [
            { first_name: 'A' }, { last_name: '' }, { phone: '0661' }, { phone: '0861223344' }, { phone: '06612233445' }, { phone: 'abc0661223344' },
            { wilaya: 'Alger' }, { wilaya: '59 - Nowhere' }, { commune: '' }, { address: '' }, { delivery: '' }, { delivery: 'drone' },
        ];
        for (const change of bad) expect(await where({ ...home, ...change }), JSON.stringify(change)).toBe('order-error.html');
        for (const change of [{ courier_company: '' }, { office_wilaya: '' }, { office_commune: 'x' }, { courier_office: '' }]) {
            expect(await where({ ...office, ...change }), JSON.stringify(change)).toBe('order-error.html');
        }
        const o = await service.orders();
        expect(o.orders).toHaveLength(2);
        const byDelivery = Object.fromEntries(o.orders.map(x => [x.delivery, x]));
        expect(byDelivery.home).toMatchObject({ firstName: 'Amina', lastName: 'Benali', customerName: 'Amina Benali', phone: '0661223344', wilaya: '16 - Alger', commune: 'Kouba', address: 'Cité 200 logements, bât. 3', courier: null, status: 'new' });
        expect(byDelivery.office).toMatchObject({ phone: '0770112233', courier: { company: 'Yalidine', wilaya: '09 - Blida', commune: 'Boufarik', office: 'Stop desk Boufarik centre' }, status: 'new' });
        expect(byDelivery.office.items).toEqual([{ productId: 'jean', productName: 'Jean', size: '40', color: 'Noir', quantity: 2, unitPrice: 3000 }]);
        // Ordering is not selling: no sale and not one piece out of stock
        expect(api.get('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
        expect(stock()).toEqual(before);
    });

    it('a website made before the cart: Update website adds the new order columns, older orders kept', async () => {
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        const db = [...cloud.cf.databases.values()][0].db;
        // As the first websites were: no commune / delivery / items
        db.run('DROP TABLE orders');
        db.run(`CREATE TABLE orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '',
                quantity INTEGER NOT NULL DEFAULT 1, customer_name TEXT NOT NULL, phone TEXT NOT NULL, wilaya TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', ip_hash TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new')`);
        db.run("INSERT INTO orders (id, created_at, product_id, customer_name, phone) VALUES ('old', '2026-01-01T00:00:00.000Z', 'jean', 'Ancien', '0661000000')");
        service.publishSite();
        await service.publishPending();
        expect(service.view().status).toBe('live');
        const columns = db.exec('PRAGMA table_info(orders)')[0].values.map(c => c[1]);
        for (const c of ['commune', 'delivery', 'items']) expect(columns).toContain(c);
        const o = await service.orders();
        expect(o.orders.find(x => x.id === 'old')).toMatchObject({ customerName: 'Ancien', delivery: '', status: 'new', items: [{ productId: 'jean', quantity: 1 }] });
    });

    it('Update website: same repository, Worker and database; the new price published; unchanged pictures not sent again', async () => {
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        const first = service.view().site;
        api.run("UPDATE products SET price = 3200 WHERE id = 'jean'");
        const blobsBefore = cloud.requests.filter(r => r.path.endsWith('/git/blobs')).length;
        service.publishSite();
        await service.publishPending();
        const v = service.view();
        expect(v.deploy.status).toBe('done');
        expect(cloud.gh.repos.size).toBe(1);
        expect(cloud.cf.databases.size).toBe(1);
        expect(cloud.cf.scripts.size).toBe(1);
        expect(cloud.cf.scripts.get('boutique-yasmine-api').uploads).toBe(2);
        expect(v.site.url).toBe(first.url);
        const page = await fetch(`${v.site.url}product-jean.html`).then(r => r.text());
        expect(page.replace(/<bdi dir="ltr">|<\/bdi>/g, '')).toContain('3\u00a0200');
        // Only the pages that changed (and catalog.json) were sent, not the picture
        const sent = cloud.requests.filter(r => r.path.endsWith('/git/blobs')).length - blobsBefore;
        expect(sent).toBeGreaterThan(0);
        expect(sent).toBeLessThan(10);
    });

    it('a step fails (Cloudflare refuses D1): told which and why; Try again goes on without making anything twice', async () => {
        const { service } = makeService();
        cloud.cf.refuse['/d1/database'] = 403;
        service.publishSite();
        await service.publishPending();
        let v = service.view();
        expect(v.deploy).toMatchObject({ status: 'failed', failedStep: 'database', reason: 'cloudflare_permission' });
        expect(v.deploy.steps.find(s => s.id === 'repository').status).toBe('done');
        expect(v.deploy.steps.find(s => s.id === 'database')).toMatchObject({ status: 'failed', reason: 'cloudflare_permission' });
        expect(v.status).toBe('error');
        expect(v.canPublish).toBe(true);

        delete cloud.cf.refuse['/d1/database'];
        service.publishSite();
        await service.publishPending();
        v = service.view();
        expect(v.deploy.status).toBe('done');
        expect(cloud.gh.repos.size).toBe(1);
        expect(v.lastError).toBeNull();
    });

    it('names already used on the accounts: the next free one; no workers.dev name yet: one is made', async () => {
        // Someone's own repository and Worker of the same name
        const other = cloud.githubToken();
        await fetch(`${cloud.base}/api/user/repos`, { method: 'POST', headers: { Authorization: `Bearer ${other}` }, body: JSON.stringify({ name: 'boutique-yasmine' }) });
        cloud.cf.scripts.set('boutique-yasmine-api', { metadata: { bindings: [] }, source: '', enabled: true, uploads: 1 });
        cloud.cf.subdomain = null;
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        expect(service.view().deploy.status).toBe('done');
        expect([...cloud.gh.repos.keys()]).toEqual(['boutique-yasmine', 'boutique-yasmine-2']);
        expect(cloud.cf.scripts.get('boutique-yasmine-api').uploads).toBe(1);
        expect(cloud.cf.scripts.has('boutique-yasmine-api-2')).toBe(true);
        expect(cloud.cf.subdomain).toBe('boutique-yasmine');
        expect(service.view().site.url).toBe(`${cloud.base}/pages/yasmine-shop/boutique-yasmine-2/`);
    });

    it('private data in what the website would show: stopped at "articles read", nothing sent to GitHub', async () => {
        api.run("INSERT INTO customers (id, name, phone) VALUES ('k1', 'Client', '0661223344')");
        api.run("UPDATE products SET description = 'Réservé pour 0661223344' WHERE id = 'belt'");
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        const v = service.view();
        expect(v.deploy).toMatchObject({ status: 'failed', failedStep: 'data', reason: 'private_data' });
        // The repository exists (made earlier in the run) but holds only GitHub's first file
        expect([...cloud.filesOf('boutique-yasmine').keys()]).toEqual(['README.md']);
        expect(JSON.stringify(logs)).not.toContain('0661223344');
        // Fixed in the article: Try again publishes
        api.run("UPDATE products SET description = '' WHERE id = 'belt'");
        service.publishSite();
        await service.publishPending();
        expect(service.view().deploy.status).toBe('done');
    });

    it('GitHub linked before this version (no right to switch Pages on): asked to link again, nothing started', async () => {
        const { service } = makeService({ scopes: ['public_repo'] });
        const v = service.view();
        expect(v.requirements).toMatchObject({ github: false, githubPermission: true });
        expect(v.canPublish).toBe(false);
        expect(service.publishSite().result).toEqual({ started: false, reason: 'github_permission' });
        expect(cloud.gh.repos.size).toBe(0);
    });

    it('GitHub Pages slow to build: "waiting", then Check now finds it online', async () => {
        cloud.gh.pagesBuildPolls = 1000;
        const { service } = makeService();
        service.publishSite();
        await service.publishPending();
        let v = service.view();
        expect(v.deploy.status).toBe('waiting');
        expect(v.deploy.steps.find(s => s.id === 'live').status).toBe('waiting');
        expect(v.site.pending).toBe(true);
        expect(v.publishedAt).toBeNull();
        expect((await service.recheckSite()).result).toEqual({ checked: true, live: false });
        cloud.gh.pagesBuildPolls = 0;
        const r = await service.recheckSite();
        expect(r.result).toEqual({ checked: true, live: true });
        v = service.view();
        expect(v).toMatchObject({ status: 'live', site: { pending: false } });
        expect(v.deploy.status).toBe('done');
    });

    it('demo shop / training: refused; a run cut by closing the program shows "Try again"; owner-only channels', async () => {
        const { service } = makeService();
        mode = 'demo';
        expect(await codeOf(() => service.publishSite())).toBe('WEBSITE_ACCOUNTS_BLOCKED');
        expect(await codeOf(() => service.orders())).toBe('WEBSITE_ACCOUNTS_BLOCKED');
        mode = null;
        settings.website.deploy = { status: 'running', steps: [{ id: 'repository', status: 'done' }, { id: 'pages', status: 'running' }] };
        const v = service.view();
        expect(v.deploy).toMatchObject({ status: 'failed', reason: 'interrupted' });
        expect(v.deploy.steps[1]).toMatchObject({ status: 'failed', reason: 'interrupted' });
        expect((await service.orders())).toMatchObject({ ok: false, reason: 'not_published', orders: [] });
        for (const ch of ['website:publish', 'website:recheck', 'website:orders', 'website:openSite']) {
            expect(ipcGuard.allows(ipcGuard.RULES[ch], { id: 'a', role: 'admin' }), ch).toBe(true);
            expect(ipcGuard.allows(ipcGuard.RULES[ch], { id: 'm', role: 'manager' }), ch).toBe(false);
        }
    });

    it('keys go only where they belong: GitHub\'s to GitHub\'s API, Cloudflare\'s to Cloudflare\'s API, the shop key to its own API', async () => {
        const { service, store } = makeService();
        service.publishSite();
        await service.publishPending();
        await service.orders();
        const gh = JSON.parse(store.get('github')).token;
        const cfKeys = JSON.parse(store.get('cloudflare'));
        for (const r of cloud.requests.filter(x => x.auth)) {
            const key = r.auth.replace(/^Bearer /, '');
            if (key === gh) expect(r.path, r.path).toMatch(/^\/api\//);
            else if (key === cfKeys.accessToken) expect(r.path, r.path).toMatch(/^\/client\/v4\//);
            else if (key === store.get('website-key')) expect(r.path).toBe('/w/boutique-yasmine-api/api/orders');
        }
        expect(cloud.requests.filter(x => x.path.startsWith('/pages/')).every(x => !x.auth)).toBe(true);
        // The log of the run names steps only
        expect(JSON.stringify(logs)).not.toMatch(/gho_|cf_at_|cf_rt_/);
        expect(JSON.stringify(logs)).not.toContain(store.get('website-key'));
    });
});
