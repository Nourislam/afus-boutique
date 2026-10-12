// Website management: Change Theme (the look only: the shop's SQLite data,
// articles and orders untouched), Preview Website before anything is sent
// (every page, the data as it is now), Update Website, status, addresses,
// last update.
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
const { STYLE } = require('../electron/website/storefront/render');
const { STORE_PAGES } = require('../electron/website/storefront/pages');
const orderBook = require('../electron/website/orders/orderBook');
const ipcGuard = require('../electron/services/ipcGuard');
const catalog = require('../electron/services/catalogService');
const initSqlJs = require('sql.js');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPEG2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9, 8, 8, 8, 8]);
const IMAGES = { 'jean-1.jpg': JPEG, 'jean-2.jpg': JPEG2 };
const codeOf = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };

describe('Website management (simulated GitHub and Cloudflare, the real Worker)', () => {
    let api, db, settings, dir, cloud, SQL, mode;

    const fakeSafeStorage = () => ({
        isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
        decryptString: (buf) => Buffer.from(buf.toString().slice(4), 'base64').toString(),
    });
    function makeService() {
        const store = createSecureStore({ dir, safeStorage: fakeSafeStorage(), platform: 'linux' });
        if (!store.has('github')) store.set('github', JSON.stringify({ token: cloud.githubToken(), scopes: ['repo'], login: 'yasmine-shop' }));
        if (!store.has('cloudflare')) {
            const { at, rt } = cloud.cloudflareTokens();
            store.set('cloudflare', JSON.stringify({ accessToken: at, refreshToken: rt, expiresAt: Date.now() + 3600e3, scopes: [], accountId: 'c'.repeat(32) }));
        }
        return createWebsiteService({
            api, getSetting: (key) => settings[key] ?? null, saveSetting: (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); },
            codedError: catalog.codedError, blockedMode: () => mode,
            github: { client: createGithubClient({ clientId: 'gh-public', fetch: globalThis.fetch, webBase: cloud.base, apiBase: `${cloud.base}/api` }), store },
            cloudflare: { client: createCloudflareClient({ clientId: 'cf-public', fetch: globalThis.fetch, dashBase: cloud.base, apiBase: `${cloud.base}/client/v4`, workerUrl: (name) => `${cloud.base}/w/${name}` }), store },
            publish: { fetch: globalThis.fetch, readImage: (n) => IMAGES[n] || null, waits: { health: 2000, pages: 3000, site: 2000, every: 20, retry: 10 }, log: () => {}, allowHttp: true },
            domain: { providers: [], lookup: { records: async () => [], availability: async () => ({ status: 'unknown' }) } },
        });
    }
    const files = () => cloud.filesOf('boutique-yasmine');
    const text = (name) => files().get(name)?.toString('utf8') || '';
    const catalogJson = () => JSON.parse(text('catalog.json'));
    const publish = async (service) => { service.publishSite(); await service.publishPending(); return service.view(); };
    /** Every row of every table of the shop's SQLite file (the settings row of the website itself apart). */
    const everything = () => JSON.stringify(api.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(({ name }) => [
        name, name === 'settings' ? api.all("SELECT * FROM settings WHERE key <> 'website' ORDER BY key") : api.all(`SELECT * FROM "${name}" ORDER BY rowid`),
    ]));

    beforeEach(async () => {
        ({ api, db } = await createShop());
        api.run("INSERT INTO categories (id, name) VALUES ('c-jeans', 'Jeans')");
        api.run("UPDATE products SET category_id = 'c-jeans', image_path = 'jean-1.jpg', created_at = datetime('now', '-30 days') WHERE id = 'jean'");
        api.run("UPDATE products SET created_at = datetime('now', '-30 days') WHERE id = 'belt'");
        api.run("INSERT INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify({ businessName: 'Boutique Yasmine', defaultLanguage: 'fr' })]);
        settings = {
            store_config: { businessName: 'Boutique Yasmine' },
            website: {
                created: true, name: 'boutique-yasmine', theme: 'classic',
                accounts: {
                    github: { status: 'connected', login: 'yasmine-shop', connectedAt: '2026-10-11T10:00:00Z', scopes: ['repo'] },
                    cloudflare: { status: 'connected', accountName: 'Boutique', accountId: 'c'.repeat(32), connectedAt: '2026-10-11T10:00:00Z' },
                },
            },
        };
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-manage-'));
        SQL = SQL || await initSqlJs();
        cloud = await startFakeCloud({ login: 'yasmine-shop', accounts: [{ id: 'c'.repeat(32), name: 'Boutique' }], subdomain: 'yasmine', d1Factory: async () => new SQL.Database() });
        mode = null;
    });
    afterEach(async () => { await cloud.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('Change Theme on the online website: only its look is made again — every SQLite table, the articles and the orders stay exactly as they were', async () => {
        const service = makeService();
        let v = await publish(service);
        // An order kept in AFUS (with its pieces put aside) and a sale: they must not move
        orderBook.importOrders(api, [{ id: 'o1', created_at: new Date().toISOString(), customer_name: 'Sara', phone: '0770112233', wilaya: '16', commune: 'Kouba', address: 'Rue 1', delivery: 'home', items: JSON.stringify([{ product_id: 'belt', product_name: 'Ceinture', quantity: 1, unit_price: 800 }]) }]);
        orderBook.setStatus(api, { id: 'o1', status: 'confirmed', codedError: catalog.codedError });
        const before = everything();
        const productsBefore = catalogJson().products;
        const cssBefore = text(STYLE);
        const at = v.publishedAt;
        const uploads = cloud.cf.scripts.get('boutique-yasmine-api').uploads;
        await new Promise(r => setTimeout(r, 1100));

        v = service.setTheme('kids', { publish: true });
        expect(v.theme).toBe('kids');
        expect(v.result).toEqual({ published: true, reason: null });
        await service.publishPending();
        v = service.view();
        expect(v.deploy).toMatchObject({ status: 'done', mode: 'update' });
        // The website's look changed...
        expect(text(STYLE)).not.toBe(cssBefore);
        expect(catalogJson().theme).toBe('kids');
        expect(Date.parse(v.publishedAt)).toBeGreaterThan(Date.parse(at));
        // ...and nothing else: the same articles on the website, the same SQLite, the order service as it was
        expect(catalogJson().products).toEqual(productsBefore);
        expect(everything()).toBe(before);
        expect(api.get("SELECT status, reserved FROM website_orders WHERE id = 'o1'")).toEqual({ status: 'confirmed', reserved: 1 });
        expect(cloud.cf.scripts.get('boutique-yasmine-api').uploads).toBe(uploads);
        expect(service.changes()).toEqual({ outdated: false });
    });

    it('Change Theme without publishing (or before the website exists): kept for the next update; the same theme or an unknown one does nothing', async () => {
        const service = makeService();
        // Before the website is online: kept, nothing published
        let v = service.setTheme('luxury', { publish: true });
        expect(v.result.published).toBe(false);
        expect(cloud.gh.repos.size).toBe(0);
        await publish(service);
        const head = cloud.gh.repos.get('boutique-yasmine').head;
        v = service.setTheme('kids');
        expect(v.result.published).toBe(false);
        expect(cloud.gh.repos.get('boutique-yasmine').head).toBe(head);
        expect(service.changes()).toEqual({ outdated: true });
        // The same theme again: nothing to make
        expect(service.setTheme('kids', { publish: true }).result.published).toBe(false);
        const before = everything();
        expect(await codeOf(() => service.setTheme('neon', { publish: true }))).toBe('WEBSITE_THEME_UNKNOWN');
        expect(service.view().theme).toBe('kids');
        expect(everything()).toBe(before);
        // The demo shop / training: kept there, never published
        mode = 'demo';
        expect(service.setTheme('classic', { publish: true }).result.published).toBe(false);
        mode = null;
        expect(cloud.gh.repos.get('boutique-yasmine').head).toBe(head);
    });

    it('Preview Website: every page the website publishes, in any theme, from the data as it is now — nothing written, nothing sent', async () => {
        const service = makeService();
        await publish(service);
        const before = everything();
        const saved = JSON.stringify(settings.website);
        const requests = cloud.requests.length;
        for (const page of ['home', 'category', 'product', ...Object.keys(STORE_PAGES)]) {
            const p = service.previewTheme({ page });
            expect(p.page, page).toBe(page);
            expect(p.html, page).toMatch(/^<!doctype html>/i);
            expect(p.html, page).toContain('Boutique Yasmine');
        }
        // Another theme only looked at: the saved one stays
        expect(service.previewTheme({ theme: 'kids', page: 'home' }).theme).toBe('kids');
        expect(service.view().theme).toBe('classic');
        // One category, one article
        expect(service.previewTheme({ page: 'category', id: 'c-jeans' }).html).toContain('Jean');
        expect(service.previewTheme({ page: 'category', id: 'c-jeans' }).categories).toEqual([{ id: 'c-jeans', name: 'Jeans' }]);
        expect(service.previewTheme({ page: 'product', id: 'belt' }).html).toContain('Ceinture');
        expect(service.previewTheme({ page: 'nope' }).page).toBe('home');
        // Read only: the shop's data, the website value, GitHub and Cloudflare untouched
        expect(everything()).toBe(before);
        expect(JSON.stringify(settings.website)).toBe(saved);
        expect(cloud.requests.length).toBe(requests);
        for (const ch of ['website:previewTheme', 'website:setTheme', 'website:publish', 'website:changes', 'website:getState']) expect(ipcGuard.RULES[ch], ch).toBe('admin');
    });

    it('products, prices, pictures, best sellers and new in: seen in the preview at once, online after Update only', async () => {
        const service = makeService();
        await publish(service);
        const price = (html) => html.replace(/<bdi dir="ltr">|<\/bdi>/g, '');
        // Before: nothing new, no best seller
        expect(catalogJson().products.map(p => p.id).sort()).toEqual(['belt', 'jean']);
        expect(text('best.html')).not.toContain('product-belt.html');
        expect(text('new.html')).not.toContain('product-cap.html');

        // In Afus Boutique: a new article, a new price, a new picture, a sale today (best seller)
        catalog.saveProduct(api, { id: 'cap', name: 'Casquette', price: 1500, stock_quantity: 5 }, []);
        api.run("UPDATE products SET price = 3400 WHERE id = 'jean'");
        api.run("UPDATE products SET image_path = 'jean-2.jpg' WHERE id = 'jean'");
        api.run("INSERT INTO sales (id, receipt_number, subtotal, total, status, created_at) VALUES ('s1', 'R-1', 800, 800, 'completed', datetime('now'))");
        api.run("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, total) VALUES ('si1', 's1', 'belt', 'Ceinture', 1, 800, 800)");

        // The preview shows them now...
        expect(price(service.previewTheme({ page: 'product', id: 'jean' }).html)).toContain('3 400');
        expect(service.previewTheme({ page: 'product', id: 'jean' }).html).toContain('jean-2.jpg');
        const best = service.previewTheme({ page: 'best' });
        expect(best.bestSellers).toBe(1);
        expect(best.html).toContain('Ceinture');
        const fresh = service.previewTheme({ page: 'new' });
        expect(fresh.newProducts).toBe(1);
        expect(fresh.html).toContain('Casquette');
        // ...the website not yet
        expect(service.changes()).toEqual({ outdated: true });
        expect(catalogJson().products.map(p => p.id)).not.toContain('cap');
        expect(price(text('product-jean.html'))).not.toContain('3 400');

        const v = await publish(service);
        expect(v.deploy.status).toBe('done');
        expect(catalogJson().products.map(p => p.id).sort()).toEqual(['belt', 'cap', 'jean']);
        expect(catalogJson().products.find(p => p.id === 'jean')).toMatchObject({ price: 3400, images: ['jean-2.jpg'] });
        expect(price(text('product-jean.html'))).toContain('3 400');
        expect(files().get('images/jean-2.jpg')).toEqual(JPEG2);
        expect(files().has('images/jean-1.jpg')).toBe(false);
        expect(text('best.html')).toContain('product-belt.html');
        expect(text('new.html')).toContain('product-cap.html');
        expect(text('product-cap.html')).toContain('Casquette');
        expect(service.changes()).toEqual({ outdated: false });
    });

    it('Change Theme while an update is going on: the new look is published right after it', async () => {
        const service = makeService();
        await publish(service);
        api.run("UPDATE products SET price = 3100 WHERE id = 'jean'");
        service.publishSite(); // an update going on, built with the old look
        const v = service.setTheme('kids', { publish: true });
        expect(v.result).toEqual({ published: true, reason: null });
        await service.publishPending();
        await new Promise(r => setTimeout(r, 50));
        await service.publishPending();
        expect(catalogJson().theme).toBe('kids');
        expect(catalogJson().products.find(p => p.id === 'jean').price).toBe(3100);
        expect(service.changes()).toEqual({ outdated: false });
    });

    it('the management view: status, free address, own domain, theme, last updated — and the free address before / after publishing', async () => {
        const service = makeService();
        let v = service.view();
        expect(v).toMatchObject({ status: 'ready', theme: 'classic', publishedAt: null, domain: { name: '', status: 'none' } });
        expect(v.freeUrl).toBe('https://yasmine-shop.github.io/boutique-yasmine/');
        v = await publish(service);
        expect(v.status).toBe('live');
        expect(v.site.freeUrl).toBe(`${cloud.base}/pages/yasmine-shop/boutique-yasmine/`);
        expect(v.publishedAt).toBeTruthy();
        expect(v.canPublish).toBe(true);
        // Nothing secret in what the window gets
        const shown = JSON.stringify(v);
        for (const secret of [cloud.githubToken(), 'website-key', 'affiliateRef', 'resources']) expect(shown).not.toContain(secret);
        // The SQLite file itself is never reopened or rewritten by the website: same tables as before
        expect(db.exec("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'")[0].values[0][0]).toBeGreaterThan(10);
    });
});
