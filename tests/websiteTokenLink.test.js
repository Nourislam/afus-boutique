// Linking the shop's GitHub and Cloudflare accounts with keys the shop made
// itself on their own pages (no AFUS app registered with them), then the
// whole way: Create Website, a customer orders on the website, the order
// reaches the Worker and its D1, then Afus Boutique (SQLite).
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
const { createCloudflareClient, TOKEN_PERMISSIONS } = require('../electron/website/cloudflare');
const { createSecureStore } = require('../electron/website/secureStore');
const catalog = require('../electron/services/catalogService');
const initSqlJs = require('sql.js');

const ACCOUNT = 'c'.repeat(32);
const OTHER = 'd'.repeat(32);
const fakeSafeStorage = () => ({
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (t) => Buffer.from(`enc:${Buffer.from(t).toString('base64')}`),
    decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
});
const codeOf = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };
let SQL;

describe('linking with the shop\'s own keys, then the whole way to an order in Afus', () => {
    let api, settings, dir, cloud, store, service, mode;

    // No AFUS app ids: the one-click sign-in is not available, the keys are
    function makeService() {
        store = createSecureStore({ dir, safeStorage: fakeSafeStorage(), platform: 'linux' });
        return createWebsiteService({
            api, getSetting: (k) => settings[k] ?? null, saveSetting: (k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); },
            codedError: catalog.codedError, blockedMode: () => mode,
            github: { client: createGithubClient({ clientId: '', fetch: globalThis.fetch, webBase: cloud.base, apiBase: `${cloud.base}/api`, writeGapMs: 0 }), store },
            cloudflare: { client: createCloudflareClient({ clientId: '', fetch: globalThis.fetch, dashBase: cloud.base, apiBase: `${cloud.base}/client/v4`, workerUrl: (n) => `${cloud.base}/w/${n}` }), store },
            publish: { fetch: globalThis.fetch, readImage: () => null, waits: { health: 2000, pages: 3000, site: 2000, every: 20, retry: 10 }, log: () => {}, allowHttp: true },
        });
    }

    beforeEach(async () => {
        ({ api } = await createShop());
        settings = { store_config: { businessName: 'Boutique Yasmine' }, website: { created: true, name: 'boutique-yasmine', theme: 'classic' } };
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-token-'));
        SQL = SQL || await initSqlJs();
        cloud = await startFakeCloud({ login: 'yasmine-shop', accounts: [{ id: ACCOUNT, name: 'Boutique' }], subdomain: null, d1Factory: async () => new SQL.Database() });
        mode = null;
        service = makeService();
    });
    afterEach(async () => { await cloud.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('without AFUS app ids: linking is still offered (by key), the one-click sign-in is not', () => {
        expect(service.view().providers).toEqual({ github: { available: true, signIn: false }, cloudflare: { available: true, signIn: false } });
        // The pages where the shop makes its keys: the providers' own, already filled in
        expect(service.tokenPage('github')).toBe(`${cloud.base}/settings/tokens/new?scopes=repo&description=Afus%20Boutique%20website`);
        const cf = new URL(service.tokenPage('cloudflare'));
        expect(cf.pathname).toBe('/profile/api-tokens');
        expect(JSON.parse(cf.searchParams.get('permissionGroupKeys'))).toEqual(TOKEN_PERMISSIONS);
        expect(TOKEN_PERMISSIONS).toEqual([{ key: 'workers_scripts', type: 'edit' }, { key: 'd1', type: 'edit' }, { key: 'account_settings', type: 'read' }]);
        expect(service.tokenPage('other')).toBeNull();
    });

    it('GitHub key: wrong text refused at once; refused / fine-grained / without "repo" told plainly; a right key linked and kept encrypted only', async () => {
        const requests = () => cloud.requests.length;
        let n = requests();
        expect((await service.githubConnectToken({ token: 'hello' })).result).toEqual({ linked: false, reason: 'token_format' });
        expect(requests()).toBe(n);
        expect((await service.githubConnectToken({ token: `ghp_${'x'.repeat(36)}` })).result).toEqual({ linked: false, reason: 'token_refused' });
        expect((await service.githubConnectToken({ token: cloud.githubFineGrained() })).result).toEqual({ linked: false, reason: 'token_classic' });
        cloud.gh.scopes = 'public_repo, read:user';
        expect((await service.githubConnectToken({ token: cloud.githubPat() })).result).toEqual({ linked: false, reason: 'scope' });
        expect(store.has('github')).toBe(false);
        cloud.gh.scopes = 'repo';
        const key = cloud.githubPat();
        const r = await service.githubConnectToken({ token: `  ${key}\n` });
        expect(r.result).toEqual({ linked: true });
        expect(r.accounts.github).toMatchObject({ status: 'connected', login: 'yasmine-shop' });
        // The key: in the encrypted store only, never in the settings or what the window gets
        expect(JSON.parse(store.get('github'))).toMatchObject({ token: key, method: 'token', scopes: ['repo'] });
        expect(JSON.stringify(settings)).not.toContain(key);
        expect(JSON.stringify(service.view())).not.toContain(key);
        // Still accepted when the screen opens again
        expect((await service.githubCheck()).result).toEqual({ checked: true, ok: true });
        // Withdrawn by the shop on GitHub: told at the next check, forgotten here
        cloud.gh.tokens.delete(key);
        expect((await service.githubCheck()).result).toMatchObject({ ok: false, reason: 'revoked' });
        expect(store.has('github')).toBe(false);
    });

    it('Cloudflare API token: wrong text / refused / no account / missing D1 told plainly; several accounts: chosen; linked without any renewal', async () => {
        expect((await service.cloudflareConnectToken({ token: 'short' })).result).toEqual({ linked: false, reason: 'token_format' });
        expect((await service.cloudflareConnectToken({ token: 'z'.repeat(40) })).result).toEqual({ linked: false, reason: 'token_refused' });
        cloud.cf.accounts = [];
        expect((await service.cloudflareConnectToken({ token: cloud.cloudflareApiToken() })).result).toEqual({ linked: false, reason: 'no_account' });
        cloud.cf.accounts = [{ id: ACCOUNT, name: 'Boutique' }];
        // Made without D1: refused, nothing kept
        cloud.cf.refuse = { '/d1/database': 403 };
        expect((await service.cloudflareConnectToken({ token: cloud.cloudflareApiToken() })).result).toEqual({ linked: false, reason: 'scope' });
        expect(store.has('cloudflare')).toBe(false);
        cloud.cf.refuse = {};
        // Two accounts: the shop picks one by name
        cloud.cf.accounts = [{ id: ACCOUNT, name: 'Boutique' }, { id: OTHER, name: 'Personnel' }];
        const key = cloud.cloudflareApiToken();
        const r = await service.cloudflareConnectToken({ token: key });
        expect(r.result).toEqual({ linked: false, reason: 'choose_account' });
        expect(r.accounts.cloudflare.status).toBe('choose_account');
        const chosen = await service.cloudflareChoose(ACCOUNT);
        expect(chosen.result).toEqual({ linked: true });
        expect(chosen.accounts.cloudflare).toMatchObject({ status: 'connected', accountName: 'Boutique' });
        expect(JSON.parse(store.get('cloudflare'))).toMatchObject({ accessToken: key, refreshToken: null, method: 'token', accountId: ACCOUNT });
        expect(JSON.stringify(settings)).not.toContain(key);
        // Used as it is, long after (no renewal, no sign-in page)
        expect(await service.cloudflareAccess()).toEqual({ token: key, accountId: ACCOUNT });
        expect((await service.cloudflareCheck()).result).toEqual({ checked: true, ok: true });
        expect(cloud.cf.requests.some(x => x.path.startsWith('/oauth2/'))).toBe(false);
        // Unlinking does not try to withdraw the token at Cloudflare (the shop deletes it on its page)
        service.cloudflareDisconnect();
        expect(cloud.cf.revoked).toEqual([]);
        expect(store.has('cloudflare')).toBe(false);
    });

    it('demo shop / training: refused, nothing sent', async () => {
        mode = 'demo';
        const n = cloud.requests.length;
        expect(await codeOf(() => service.githubConnectToken({ token: cloud.githubPat() }))).toBe('WEBSITE_GITHUB_BLOCKED');
        expect(await codeOf(() => service.cloudflareConnectToken({ token: cloud.cloudflareApiToken() }))).toBe('WEBSITE_ACCOUNTS_BLOCKED');
        expect(cloud.requests.length).toBe(n);
        expect(service.view().providers.github.available).toBe(false);
    });

    it('the whole way with the keys: Create Website (D1 bound by its id), a customer orders on the website, the order reaches Afus', async () => {
        expect((await service.githubConnectToken({ token: cloud.githubPat() })).result.linked).toBe(true);
        expect((await service.cloudflareConnectToken({ token: cloud.cloudflareApiToken() })).result.linked).toBe(true);
        expect(service.view().canPublish).toBe(true);
        service.publishSite();
        await service.publishPending();
        const v = service.view();
        expect(v.deploy).toMatchObject({ status: 'done' });
        expect(v.status).toBe('live');
        // The Worker's D1 binding as Cloudflare documents it: { type: 'd1', name, id }
        const script = cloud.cf.scripts.get('boutique-yasmine-api');
        expect(script.metadata.bindings.find(b => b.type === 'd1')).toEqual({ type: 'd1', name: 'DB', id: [...cloud.cf.databases.keys()][0] });
        // The account had no workers.dev name yet: one was given
        expect(cloud.cf.subdomain).toBeTruthy();
        // A customer orders on the published checkout page
        const checkout = await fetch(`${v.site.url}checkout.html`).then(r => r.text());
        const action = /<form class="checkout-form"[^>]*action="([^"]+)"/.exec(checkout)[1];
        const items = JSON.stringify([{ product_id: 'jean', product_name: 'Jean', size: '40', color: 'Noir', quantity: 1, unit_price: 3000 }]);
        const sent = await fetch(action, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
            items, first_name: 'Sara', last_name: 'Kaci', phone: '0770 11 22 33', wilaya: '16 - Alger', commune: 'Kouba', delivery: 'home', address: 'Rue 5', website: '', order_key: 'k-token-way-000000001',
        }).toString() });
        expect(sent.status).toBe(303);
        expect(sent.headers.get('location')).toBe(`${v.site.url}thanks.html?cart=1`);
        // In D1 (the waiting room), then in Afus Boutique, then gone from D1
        const d1 = [...cloud.cf.databases.values()][0].db;
        expect(d1.exec('SELECT COUNT(*) FROM orders')[0].values[0][0]).toBe(1);
        expect(await service.syncOrders()).toMatchObject({ ok: true, received: 1, waiting: 0 });
        const o = (await service.orders()).orders;
        expect(o).toHaveLength(1);
        expect(o[0]).toMatchObject({ customerName: 'Sara Kaci', phone: '0770112233', status: 'new', items: [expect.objectContaining({ productId: 'jean', size: '40', quantity: 1 })] });
        expect(d1.exec('SELECT COUNT(*) FROM orders')[0].values[0][0]).toBe(0);
        // The Cloudflare sign-in ends (or is removed): orders keep coming in (they use the shop's own key)
        service.cloudflareDisconnect();
        const again = await fetch(action, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
            items, first_name: 'Nadia', last_name: 'Amrani', phone: '0661 22 33 44', wilaya: '16 - Alger', commune: 'Kouba', delivery: 'home', address: 'Rue 7', website: '', order_key: 'k-token-way-000000002',
        }).toString() });
        expect(again.status).toBe(303);
        expect(await service.syncOrders()).toMatchObject({ ok: true, received: 1 });
        expect((await service.orders()).orders.map(x => x.customerName).sort()).toEqual(['Nadia Amrani', 'Sara Kaci']);
    });
});

describe('GitHub content limits on the first publish', () => {
    it('pages go inside the tree request; pictures one by one; "too fast" answers are waited out, nothing lost', async () => {
        const SQLjs = await initSqlJs();
        const cloud = await startFakeCloud({ d1Factory: async () => new SQLjs.Database() });
        try {
            cloud.gh.secondary = { max: 3, windowMs: 400 };
            const token = cloud.githubPat();
            const client = createGithubClient({ clientId: '', fetch: globalThis.fetch, webBase: cloud.base, apiBase: `${cloud.base}/api`, writeGapMs: 0, sleep: (ms) => new Promise(r => setTimeout(r, Math.min(ms, 450))) });
            const repo = await client.createRepository(token, { name: 'shop' });
            const files = [
                ...Array.from({ length: 40 }, (_, i) => ({ path: `page-${i}.html`, content: `<!doctype html><p>${i} é</p>` })),
                ...Array.from({ length: 8 }, (_, i) => ({ path: `images/p${i}.jpg`, content: Buffer.from([0xff, 0xd8, 0xff, i, 0x80, 0xfe]) })),
            ];
            const r = await client.commitFiles(token, repo.owner, repo.name, { files, message: 'first' });
            expect(r.changed).toBe(true);
            // Only the 8 pictures were sent as blobs; GitHub said "too fast" and it was waited out
            expect(cloud.requests.filter(x => x.path.endsWith('/git/blobs')).length).toBeGreaterThanOrEqual(8);
            expect(cloud.gh.limited).toBeGreaterThan(0);
            const tree = cloud.gh.trees.get(cloud.gh.commits.get(cloud.gh.repos.get('shop').head).tree);
            expect(tree.map(e => e.path).sort()).toEqual(files.map(f => f.path).sort());
            expect(cloud.gh.blobs.get(tree.find(e => e.path === 'page-3.html').sha).toString('utf8')).toBe('<!doctype html><p>3 é</p>');
        } finally {
            await cloud.close();
        }
    }, 30000);
});
