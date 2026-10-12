// The shop's own domain (optional): providers and affiliate links, the
// domain search, the records to add, connecting it to the website step by
// step while the free address keeps working, https, removal, failures.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const providers = require('../electron/website/domain/providers');
const { createLookup } = require('../electron/website/domain/lookup');
const connection = require('../electron/website/domain/connection');
const { startFakeCloud } = require('./helpers/fakeCloud.cjs');
const { createWebsiteService } = require('../electron/website/websiteService');
const { createGithubClient } = require('../electron/website/github');
const { createCloudflareClient } = require('../electron/website/cloudflare');
const { createSecureStore } = require('../electron/website/secureStore');
const ws = require('../electron/website/websiteState');
const ipcGuard = require('../electron/services/ipcGuard');
const catalog = require('../electron/services/catalogService');
const initSqlJs = require('sql.js');

const REGX = { id: 'regx', name: 'RegX', tlds: ['com', 'shop', 'com.dz'], affiliateUrl: 'https://regx.example/aff?ref=AFUS1&domain={domain}&sid={subid}', pricing: { currency: 'USD', from: { com: 11.5, shop: 3 } } };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('domain providers: affiliate links only, no company assumed', () => {
    it('a provider from the profile is checked; wrong ones are left out', () => {
        const logs = [];
        const list = providers.loadProviders([
            REGX,
            { ...REGX, id: 'http', affiliateUrl: 'http://regx.example/?d={domain}' },
            { ...REGX, id: 'host', affiliateUrl: 'https://{domain}.evil.example/' },
            { ...REGX, id: 'other', affiliateUrl: 'https://regx.example/?d={domain}&k={key}' },
            { ...REGX, id: 'nodomain', affiliateUrl: 'https://regx.example/' },
            { ...REGX, id: 'notld', tlds: [] },
            { ...REGX, id: 'Bad Id' },
            { ...REGX, id: 'off', enabled: false },
            REGX,
        ], { log: (e) => logs.push(e) });
        expect(list.map(p => p.id)).toEqual(['regx', 'off']);
        expect(logs.map(l => [l.id, l.reason])).toEqual([['http', 'affiliateUrl'], ['host', 'affiliateUrl'], ['other', 'affiliateUrl'], ['nodomain', 'affiliateUrl'], ['notld', 'tlds'], ['Bad Id', 'id']]);
        // No API adapter is shipped: a provider with an unknown "api" works with its link alone
        expect(providers.cleanProvider({ ...REGX, api: 'magic' }).provider.api).toBeNull();
        expect(providers.ADAPTERS).toEqual({});
    });

    it('the link: the domain encoded in the query, the installation reference, the provider\'s own address only', () => {
        const [p] = providers.loadProviders([REGX]);
        expect(providers.affiliateLink(p, 'boutique-yasmine.com', { subid: 'a1b2c3d4e5f6' })).toBe('https://regx.example/aff?ref=AFUS1&domain=boutique-yasmine.com&sid=a1b2c3d4e5f6');
        expect(providers.affiliateLink(p, 'x.com&ref=EVIL', {})).toContain('domain=x.com%26ref%3Devil');
        expect(providers.providersFor([p], 'boutique.com.dz').map(x => x.id)).toEqual(['regx']);
        expect(providers.providersFor([p], 'boutique.net')).toEqual([]);
        expect(providers.priceFor(p, 'a.com')).toEqual({ from: 11.5, currency: 'USD' });
        expect(providers.priceFor(p, 'a.com.dz')).toBeNull();
        // What the window may know: no link template, no affiliate id
        expect(JSON.stringify(providers.describe(p))).not.toMatch(/AFUS1|affiliate|regx\.example/);
    });
});

describe('looking at a domain: RDAP (registered?) and DNS over https', () => {
    const bootstrap = { services: [[['com', 'net'], ['https://rdap.example-registry.test/com/v1/']], [['shop'], ['http://insecure.test/']]] };
    let calls;
    const fetchFake = (answers) => async (url) => {
        calls.push(url);
        if (url === 'https://data.iana.org/rdap/dns.json') return json(200, bootstrap);
        for (const [match, res] of answers) if (url.includes(match)) return typeof res === 'function' ? res() : res;
        return json(500, {});
    };
    beforeEach(() => { calls = []; });

    it('registered: 200 -> taken, 404 -> probably free, other answers or no registry -> check at the company', async () => {
        const look = createLookup({ fetch: fetchFake([['taken-shop.com', json(200, { ldhName: 'TAKEN-SHOP.COM' })], ['free-shop.com', json(404, {})], ['broken.com', json(503, {})]]) });
        expect(await look.availability('taken-shop.com')).toEqual({ status: 'taken' });
        expect(await look.availability('free-shop.com')).toEqual({ status: 'available' });
        expect(await look.availability('broken.com')).toMatchObject({ status: 'unknown' });
        expect(await look.availability('boutique.dz')).toEqual({ status: 'unknown', reason: 'no_registry' });
        // A registry given over http is not used
        expect(await look.availability('boutique.shop')).toEqual({ status: 'unknown', reason: 'no_registry' });
        // The registry list is read once (kept a day)
        expect(calls.filter(u => u.includes('iana.org')).length).toBe(1);
        expect(calls.every(u => u.startsWith('https://'))).toBe(true);
    });

    it('DNS answers read as plain values; nothing found = []; no answer = null', async () => {
        const look = createLookup({ fetch: fetchFake([
            ['name=www.a.com&type=CNAME', json(200, { Status: 0, Answer: [{ name: 'www.a.com.', type: 5, data: 'Yasmine-Shop.github.io.' }] })],
            ['name=a.com&type=A', json(200, { Status: 0, Answer: [{ type: 1, data: '185.199.108.153' }, { type: 5, data: 'x.' }] })],
            ['name=none.com', json(200, { Status: 3 })],
            ['name=down.com', json(502, {})],
        ]) });
        expect(await look.records('www.a.com', 'CNAME')).toEqual(['yasmine-shop.github.io']);
        expect(await look.records('a.com', 'A')).toEqual(['185.199.108.153']);
        expect(await look.records('none.com', 'A')).toEqual([]);
        expect(await look.records('down.com', 'A')).toBeNull();
    });
});

describe('the records to add, and whether they are in place', () => {
    it('main domain: GitHub\'s four addresses + www; a sub-domain: one CNAME; com.dz is a main domain', () => {
        expect(connection.recordsFor('boutique.com', 'Yasmine-Shop')).toEqual([
            ...['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'].map(value => ({ type: 'A', host: '@', value })),
            { type: 'CNAME', host: 'www', value: 'yasmine-shop.github.io' },
        ]);
        expect(connection.recordsFor('shop.boutique.com', 'yasmine-shop')).toEqual([{ type: 'CNAME', host: 'shop', value: 'yasmine-shop.github.io' }]);
        expect(connection.isApex('boutique.com.dz')).toBe(true);
        expect(connection.isApex('www.boutique.com')).toBe(false);
    });

    it('pointing: nothing yet, somewhere else (an old address left too), GitHub; no answer: unknown', async () => {
        const dns = {};
        const lookup = { records: async (n, t) => (dns[`${n}/${t}`] === undefined ? [] : dns[`${n}/${t}`]) };
        const look = (d) => connection.checkPointing(lookup, d, 'yasmine-shop');
        expect(await look('a.com')).toMatchObject({ ok: false, state: 'none' });
        dns['a.com/A'] = ['185.199.108.153', '1.2.3.4'];
        expect(await look('a.com')).toMatchObject({ ok: false, state: 'wrong' });
        dns['a.com/A'] = connection.GITHUB_A;
        expect(await look('a.com')).toMatchObject({ ok: true });
        dns['shop.a.com/CNAME'] = ['other.netlify.app'];
        expect(await look('shop.a.com')).toMatchObject({ ok: false, state: 'wrong' });
        dns['shop.a.com/CNAME'] = ['yasmine-shop.github.io'];
        expect(await look('shop.a.com')).toMatchObject({ ok: true });
        dns['b.com/A'] = null;
        expect(await look('b.com')).toMatchObject({ ok: false, state: 'unknown' });
    });

    it('the saved domain: old "pending" reads as waiting for records; unknown fields and steps dropped', () => {
        expect(ws.normalizeState({ domain: { name: 'Shop.COM', status: 'pending' } }).domain).toMatchObject({ name: 'shop.com', status: 'dns_needed', source: 'own' });
        expect(ws.normalizeState({ domain: { name: 'shop.com', status: 'hacked', provider: 'x'.repeat(50), secret: 1 } }).domain).toEqual({ name: 'shop.com', status: 'dns_needed', source: 'own', provider: null, reason: null, addedAt: null, misses: 0 });
        expect(ws.normalizeState({ domain: { name: 'yasmine.github.io' } }).domain.status).toBe('none');
        expect(ws.normalizeState({ affiliateRef: '<script>' }).affiliateRef).toBeNull();
    });
});

describe('connecting the shop\'s own domain to its website (simulated GitHub and Cloudflare, the real Worker)', () => {
    const DOMAIN = 'boutique-yasmine.com';
    let api, settings, dir, cloud, SQL, mode, logs, dns, opened, rdap;

    const fakeSafeStorage = () => ({
        isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
        decryptString: (buf) => Buffer.from(buf.toString().slice(4), 'base64').toString(),
    });
    // The shop's domain is answered by the (fake) GitHub Pages, as real DNS would do once pointed
    const siteFetch = (url, init) => {
        const u = String(url);
        if (u.startsWith(`https://${DOMAIN}/`)) return globalThis.fetch(`${cloud.base}/pages/yasmine-shop/boutique-yasmine/${u.slice(`https://${DOMAIN}/`.length)}`, init);
        return globalThis.fetch(url, init);
    };
    function makeService({ providerList = [REGX] } = {}) {
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
            publish: { fetch: siteFetch, readImage: () => null, waits: { health: 2000, pages: 3000, site: 2000, every: 20, retry: 10 }, log: (e) => logs.push(e), allowHttp: true },
            domain: {
                providers: providerList,
                lookup: {
                    records: async (name, type) => (dns[`${name}/${type}`] === undefined ? [] : dns[`${name}/${type}`]),
                    availability: async (d) => ({ status: rdap[d] || 'unknown' }),
                },
                fetch: siteFetch,
                openExternal: async (url) => { opened.push(url); },
            },
        });
    }
    const repo = () => cloud.gh.repos.get('boutique-yasmine');
    const files = () => cloud.filesOf('boutique-yasmine');
    const bindings = () => Object.fromEntries(cloud.cf.scripts.get('boutique-yasmine-api').metadata.bindings.filter(b => b.text !== undefined).map(b => [b.name, b.text]));
    const pointToGithub = () => { dns[`${DOMAIN}/A`] = connection.GITHUB_A; };
    const published = async (service) => { service.publishSite(); await service.publishPending(); };

    beforeEach(async () => {
        ({ api } = await createShop());
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
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-domain-'));
        SQL = SQL || await initSqlJs();
        cloud = await startFakeCloud({ login: 'yasmine-shop', accounts: [{ id: 'c'.repeat(32), name: 'Boutique' }], subdomain: 'yasmine', d1Factory: async () => new SQL.Database() });
        mode = null; logs = []; dns = {}; opened = []; rdap = {};
    });
    afterEach(async () => { await cloud.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('no domain needed: the website is created and works on its free address; the domain section says so', async () => {
        const service = makeService({ providerList: [] });
        await published(service);
        const v = service.view();
        expect(v.status).toBe('live');
        expect(v.domain).toMatchObject({ name: '', status: 'none', providers: [] });
        expect(v.site.freeUrl).toBe(`${cloud.base}/pages/yasmine-shop/boutique-yasmine/`);
        expect(files().has('CNAME')).toBe(false);
        // Without providers the search still works (name endings looked at), nothing to buy
        const found = await service.domainSearch({ query: 'Boutique Yasmine' });
        expect(found).toMatchObject({ providersAvailable: 0, results: [{ domain: 'boutique-yasmine.com', providers: [] }] });
    });

    it('I already have a domain: the records shown; the free address works until they point to GitHub; then connected, https, active', async () => {
        const service = makeService();
        await published(service);
        const free = service.view().site.freeUrl;
        let v = service.setDomain(DOMAIN);
        await service.domainCheck();
        v = service.view();
        expect(v.domain).toMatchObject({ name: DOMAIN, status: 'dns_needed', source: 'own', reason: null });
        expect(v.domain.records).toEqual(connection.recordsFor(DOMAIN, 'yasmine-shop'));
        // Nothing given to GitHub yet: the free address is untouched (no redirect to a domain that does not answer)
        expect(repo().pages.cname || null).toBeNull();
        expect((await fetch(`${free}index.html`)).status).toBe(200);

        // Records pointing elsewhere: told what was found
        dns[`${DOMAIN}/A`] = ['34.1.2.3'];
        v = await service.domainCheck();
        expect(v.domain).toMatchObject({ status: 'dns_wrong', found: { a: ['34.1.2.3'] } });
        expect(repo().pages.cname || null).toBeNull();

        // Put right: given to the website; the website keeps its CNAME file; the order service takes orders from the domain
        cloud.gh.certPolls = 1000; // GitHub has not made the certificate yet
        pointToGithub();
        v = await service.domainCheck();
        expect(v.domain.status).toBe('connecting');
        expect(repo().pages.cname).toBe(DOMAIN);
        await service.publishPending();
        expect(files().get('CNAME').toString()).toBe(DOMAIN);
        expect(JSON.parse(bindings().SITE_URLS)).toEqual(expect.arrayContaining([free, `https://${DOMAIN}/`]));
        expect(service.view().deploy.status).toBe('done');

        // GitHub makes the certificate (a few looks), then https is required, then it answers
        v = await service.domainCheck();
        expect(v.domain.status).toBe('https_pending');
        expect(repo().pages.https).toBe(false);
        expect(bindings().SITE_URL).toBe(free); // the main address stays the free one until https works
        cloud.gh.certPolls = 0; // the certificate is ready
        v = await service.domainCheck();
        expect(v.domain.status).toBe('active');
        expect(repo().pages.https).toBe(true);
        await service.publishPending();
        v = service.view();
        expect(v.site.url).toBe(`https://${DOMAIN}/`);
        expect(v.site.freeUrl).toBe(free);
        expect(bindings().SITE_URL).toBe(`https://${DOMAIN}/`);
        expect(files().get('CNAME').toString()).toBe(DOMAIN);

        // Orders: from the domain (the customer is sent back there), from the free address, never from elsewhere
        const action = /<form class="checkout-form"[^>]*action="([^"]+)"/.exec(files().get('checkout.html').toString())[1];
        const order = (origin) => fetch(action, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin }, body: new URLSearchParams({
            items: JSON.stringify([{ product_id: 'belt', product_name: 'Ceinture', quantity: 1, unit_price: 800 }]),
            first_name: 'Sara', last_name: 'Kaci', phone: '0770 11 22 33', wilaya: '16 - Alger', commune: 'Kouba', delivery: 'home', address: 'Rue 1', website: '',
        }).toString() });
        const fromDomain = await order(`https://${DOMAIN}`);
        expect(fromDomain.status).toBe(303);
        expect(fromDomain.headers.get('location')).toBe(`https://${DOMAIN}/thanks.html?cart=1`);
        expect((await order(new URL(free).origin)).status).toBe(303);
        expect((await order('https://evil.example')).status).toBe(403);
    });

    it('the domain stops pointing to GitHub: after two looks it is taken off — the free address works again', async () => {
        const service = makeService();
        await published(service);
        service.setDomain(DOMAIN);
        pointToGithub();
        await service.domainCheck(); await service.publishPending();
        await service.domainCheck(); await service.domainCheck(); await service.publishPending();
        expect(service.view().domain.status).toBe('active');
        dns[`${DOMAIN}/A`] = [];
        let v = await service.domainCheck();
        expect(v.domain.status).toBe('active'); // one look may be a passing problem
        v = await service.domainCheck();
        expect(v.domain).toMatchObject({ status: 'dns_wrong', reason: 'dns_lost' });
        expect(repo().pages.cname).toBeNull();
        await service.publishPending();
        expect(files().has('CNAME')).toBe(false);
        expect(service.view().site.url).toBe(service.view().site.freeUrl);
        // Records back: connected again
        pointToGithub();
        v = await service.domainCheck();
        expect(v.domain.status).toBe('connecting');
    });

    it('removed by the shop: off GitHub, off the website, and told which records to take away at the provider', async () => {
        const service = makeService();
        await published(service);
        service.setDomain(DOMAIN);
        pointToGithub();
        await service.domainCheck(); await service.publishPending();
        const v = await service.removeDomain();
        expect(v.domain).toMatchObject({ name: '', status: 'none' });
        expect(v.result.cleanup).toEqual(connection.recordsFor(DOMAIN, 'yasmine-shop'));
        expect(repo().pages.cname).toBeNull();
        await service.publishPending();
        expect(files().has('CNAME')).toBe(false);
        expect(JSON.parse(bindings().SITE_URLS)).not.toContain(`https://${DOMAIN}/`);
    });

    it('GitHub refuses (another website uses it) or cannot make the certificate: not connected, the free address kept, Try again', async () => {
        const service = makeService();
        await published(service);
        cloud.gh.takenDomains.add(DOMAIN);
        service.setDomain(DOMAIN);
        pointToGithub();
        let v = await service.domainCheck();
        expect(v.domain).toMatchObject({ status: 'failed', reason: 'taken' });
        expect(repo().pages.cname || null).toBeNull();
        // Nothing more happens by itself on a refused domain
        expect(await service.domainCheckIfDue()).toBeNull();

        cloud.gh.takenDomains.clear();
        cloud.gh.certFails = true;
        cloud.gh.certPolls = 1;
        v = await service.domainRetry();
        expect(v.domain.status).toBe('connecting');
        await service.publishPending();
        v = await service.domainCheck();
        expect(v.domain).toMatchObject({ status: 'failed', reason: 'https_failed' });
        expect(repo().pages.cname).toBeNull();
        cloud.gh.certFails = false;
        v = await service.domainRetry();
        expect(v.domain.status).toBe('connecting');
    });

    it('a domain saved before the website exists waits; connecting starts once the website is online', async () => {
        const service = makeService();
        pointToGithub();
        service.setDomain(DOMAIN);
        let v = await service.domainCheck();
        expect(v.domain).toMatchObject({ status: 'dns_needed', reason: 'not_published' });
        expect(cloud.gh.repos.size).toBe(0);
        await published(service);
        v = await service.domainCheck();
        expect(v.domain.status).toBe('connecting');
    });

    it('Buy a new domain: search, the provider\'s page with Afus\' affiliate link (the shop buys it, for itself), then connect it', async () => {
        const service = makeService();
        await published(service);
        rdap['boutique-yasmine.com'] = 'available';
        rdap['boutique-yasmine.shop'] = 'taken';
        const found = await service.domainSearch({ query: 'Boutique Yasmine' });
        expect(found.providersAvailable).toBe(1);
        expect(found.results).toEqual(expect.arrayContaining([
            { domain: 'boutique-yasmine.com', status: 'available', providers: [{ id: 'regx', name: 'RegX', price: { from: 11.5, currency: 'USD' } }] },
            { domain: 'boutique-yasmine.shop', status: 'taken', providers: [{ id: 'regx', name: 'RegX', price: { from: 3, currency: 'USD' } }] },
        ]));
        expect((await service.domainSearch({ query: 'shop.example.com' })).results.map(r => r.domain)).toEqual(['shop.example.com']);
        expect(await codeOf(() => service.domainSearch({ query: '!' }))).toBe('WEBSITE_DOMAIN_INVALID');

        const r = await service.domainOpenBuy({ domain: 'boutique-yasmine.com', provider: 'regx' });
        expect(r).toMatchObject({ opened: true, domain: 'boutique-yasmine.com' });
        expect(opened).toHaveLength(1);
        expect(opened[0]).toMatch(/^https:\/\/regx\.example\/aff\?ref=AFUS1&domain=boutique-yasmine\.com&sid=[a-f0-9]{12}$/);
        // The same installation reference each time; kept with the website, never shown to the window
        await service.domainOpenBuy({ domain: 'boutique-yasmine.com', provider: 'regx' });
        expect(opened[1]).toBe(opened[0]);
        const v = service.view();
        expect(JSON.stringify(v)).not.toMatch(/AFUS1|regx\.example|affiliateRef/);
        expect(v.domainClicks).toEqual([expect.objectContaining({ provider: 'regx', tld: 'com' }), expect.objectContaining({ provider: 'regx', tld: 'com' })]);
        // Refused: not a domain, a provider that does not sell it, an unknown provider, the demo shop
        expect(await codeOf(() => service.domainOpenBuy({ domain: 'javascript:alert(1)', provider: 'regx' }))).toBe('WEBSITE_DOMAIN_INVALID');
        expect(await codeOf(() => service.domainOpenBuy({ domain: 'boutique-yasmine.net', provider: 'regx' }))).toBe('WEBSITE_DOMAIN_PROVIDER');
        expect(await codeOf(() => service.domainOpenBuy({ domain: 'boutique-yasmine.com', provider: 'nope' }))).toBe('WEBSITE_DOMAIN_PROVIDER');
        mode = 'demo';
        expect(await codeOf(() => service.domainOpenBuy({ domain: 'boutique-yasmine.com', provider: 'regx' }))).toBe('WEBSITE_ACCOUNTS_BLOCKED');
        mode = null;
        expect(opened).toHaveLength(2);

        // Bought (on the provider's site, by the shop): connected like any domain of its own
        service.setDomain({ domain: 'boutique-yasmine.com', source: 'bought', provider: 'regx' });
        expect(service.view().domain).toMatchObject({ name: 'boutique-yasmine.com', source: 'bought', provider: 'regx', status: 'dns_needed' });
    });

    it('owner-only channels; one domain at a time once connected', async () => {
        for (const ch of ['website:setDomain', 'website:removeDomain', 'website:domainCheck', 'website:domainRetry', 'website:domainSearch', 'website:domainOpenBuy']) expect(ipcGuard.RULES[ch], ch).toBe('admin');
        const service = makeService();
        await published(service);
        service.setDomain(DOMAIN);
        pointToGithub();
        await service.domainCheck(); await service.publishPending();
        expect(await codeOf(() => service.setDomain('other-shop.com'))).toBe('WEBSITE_DOMAIN_EXISTS');
    });
});

async function codeOf(fn) { try { await fn(); } catch (e) { return e.code; } return null; }
