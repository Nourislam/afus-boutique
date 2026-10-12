// A domain at Hostinger: the shop's own Hostinger API key (kept encrypted on
// this computer) lets the program write the domain's website records
// itself — checked by Hostinger first, e-mail records untouched — and take
// them away when the domain is removed. Nothing is ever bought with it.
// Hostinger is played here by a fake that follows its OpenAPI description.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { createHostingerClient } = require('../electron/website/domain/hostinger');
const connection = require('../electron/website/domain/connection');
const { startFakeCloud } = require('./helpers/fakeCloud.cjs');
const { createWebsiteService } = require('../electron/website/websiteService');
const { createGithubClient } = require('../electron/website/github');
const { createCloudflareClient } = require('../electron/website/cloudflare');
const { createSecureStore } = require('../electron/website/secureStore');
const ipcGuard = require('../electron/services/ipcGuard');
const catalog = require('../electron/services/catalogService');
const initSqlJs = require('sql.js');

const HOST = 'https://developers.hostinger.com';
const KEY = 'test-hostinger-key-0123456789abcdef';
const codeOf = async (fn) => { try { await fn(); } catch (e) { return e.code || e.reason; } return null; };

/** Hostinger's API as documented: portfolio, DNS zones (get / validate / update with overwrite / delete). */
function fakeHostinger({ domains = ['boutique-yasmine.com'] } = {}) {
    const h = { calls: [], zones: new Map(), domains: [...domains], revoked: false, failValidate: false };
    for (const d of domains) {
        h.zones.set(d, [
            { name: '@', type: 'A', ttl: 14400, records: [{ content: '34.120.1.2' }] }, // Hostinger's parking page
            { name: '@', type: 'ALIAS', ttl: 14400, records: [{ content: 'parking.example.' }] },
            { name: 'www', type: 'CNAME', ttl: 14400, records: [{ content: `${d}.` }] },
            { name: 'shop', type: 'A', ttl: 14400, records: [{ content: '34.120.1.2' }] },
            { name: '@', type: 'MX', ttl: 14400, records: [{ content: '5 mx1.hostinger.com.' }] },
        ]);
    }
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    h.fetch = async (url, init = {}) => {
        const u = new URL(url);
        const body = init.body ? JSON.parse(init.body) : undefined;
        h.calls.push({ method: init.method, path: u.pathname, auth: init.headers?.Authorization, body });
        if (init.headers?.Authorization !== `Bearer ${KEY}` || h.revoked) return json(401, { message: 'Unauthenticated' });
        if (u.pathname === '/api/domains/v1/portfolio' && init.method === 'GET') return json(200, h.domains.map((domain, i) => ({ id: i + 1, domain, type: 'domain', status: 'active' })));
        const m = /^\/api\/dns\/v1\/zones\/([^/]+)(\/validate)?$/.exec(u.pathname);
        if (!m) return json(404, { message: 'Not found' });
        const zone = h.zones.get(decodeURIComponent(m[1]));
        if (!zone) return json(404, { message: 'Not found' });
        if (init.method === 'GET') return json(200, zone);
        const valid = (z) => Array.isArray(z) && z.every(r => r.name && r.type && Array.isArray(r.records) && r.records.every(x => typeof x.content === 'string'));
        if (m[2]) return h.failValidate || !valid(body.zone) ? json(422, { message: 'The zone is invalid.', errors: {} }) : json(200, { message: 'Request accepted' });
        if (init.method === 'PUT') {
            if (!valid(body.zone)) return json(422, { message: 'invalid' });
            for (const r of body.zone) {
                if (body.overwrite !== false) for (let i = zone.length - 1; i >= 0; i--) if (zone[i].name === r.name && zone[i].type === r.type) zone.splice(i, 1);
                zone.push({ name: r.name, type: r.type, ttl: r.ttl, records: r.records });
            }
            return json(200, { message: 'Request accepted' });
        }
        if (init.method === 'DELETE') {
            for (const f of body.filters) for (let i = zone.length - 1; i >= 0; i--) if (zone[i].name === f.name && zone[i].type === f.type) zone.splice(i, 1);
            return json(200, { message: 'Request accepted' });
        }
        return json(405, {});
    };
    /** What a resolver would answer once Hostinger's change spread. */
    h.lookup = {
        availability: async () => ({ status: 'unknown' }),
        records: async (name, type) => {
            for (const [apex, zone] of h.zones) {
                if (name !== apex && !name.endsWith(`.${apex}`)) continue;
                const host = name === apex ? '@' : name.slice(0, -(apex.length + 1));
                return zone.filter(r => r.name === host && r.type === type).flatMap(r => r.records.map(x => x.content.replace(/\.$/, '')));
            }
            return [];
        },
    };
    return h;
}

describe('the Hostinger client: only the domain list and the DNS zone, Bearer key, errors in plain words', () => {
    it('paths, methods, key and bodies as Hostinger documents them; never a purchase', async () => {
        const h = fakeHostinger();
        const client = createHostingerClient({ fetch: h.fetch });
        expect(await client.domains(KEY)).toEqual([{ domain: 'boutique-yasmine.com', status: 'active' }]);
        const zone = await client.zone(KEY, 'boutique-yasmine.com');
        expect(zone.find(r => r.type === 'MX')).toEqual({ name: '@', type: 'MX', ttl: 14400, records: ['5 mx1.hostinger.com.'] });
        await client.validate(KEY, 'boutique-yasmine.com', [{ name: 'www', type: 'CNAME', ttl: 300, records: ['yasmine-shop.github.io.'] }]);
        expect(h.calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/dns/v1/zones/boutique-yasmine.com/validate', body: { overwrite: true, zone: [{ name: 'www', type: 'CNAME', ttl: 300, records: [{ content: 'yasmine-shop.github.io.' }] }] } });
        expect(h.calls.every(c => c.auth === `Bearer ${KEY}`)).toBe(true);
        expect(await codeOf(() => client.zone(KEY, '../../api/billing'))).toBe('domain');
        expect(await codeOf(() => client.zone('wrong-key-0123456789abcdef', 'boutique-yasmine.com'))).toBe('revoked');
        expect(await codeOf(() => client.zone(KEY, 'not-mine.com'))).toBe('not_found');
        expect(await codeOf(() => client.domains(''))).toBe('not_connected');
        const down = createHostingerClient({ fetch: async () => { throw new Error('offline'); } });
        expect(await codeOf(() => down.domains(KEY))).toBe('network');
        // The module has no purchase, renewal or payment call at all
        const source = fs.readFileSync(require.resolve('../electron/website/domain/hostinger.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(source).not.toMatch(/'POST', '\/api\/domains\/v1\/portfolio'|billing|payment|subscriptions/);
    });
});

describe('a domain at Hostinger, set up by the program with the shop\'s own key (simulated GitHub, Cloudflare and Hostinger)', () => {
    let api, settings, dir, cloud, SQL, mode, h;
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
        const fetchAll = (url, init) => (String(url).startsWith(HOST) ? h.fetch(url, init) : globalThis.fetch(url, init));
        return createWebsiteService({
            api, getSetting: (key) => settings[key] ?? null, saveSetting: (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); },
            codedError: catalog.codedError, blockedMode: () => mode,
            github: { client: createGithubClient({ clientId: 'gh-public', fetch: globalThis.fetch, webBase: cloud.base, apiBase: `${cloud.base}/api`, writeGapMs: 0 }), store },
            cloudflare: { client: createCloudflareClient({ clientId: 'cf-public', fetch: globalThis.fetch, dashBase: cloud.base, apiBase: `${cloud.base}/client/v4`, workerUrl: (name) => `${cloud.base}/w/${name}` }), store },
            publish: { fetch: globalThis.fetch, readImage: () => null, waits: { health: 2000, pages: 3000, site: 2000, every: 20, retry: 10 }, log: () => {}, allowHttp: true },
            domain: { providers: [], lookup: h.lookup, fetch: fetchAll },
        });
    }
    const publish = async (service) => { service.publishSite(); await service.publishPending(); };
    const zone = (d = 'boutique-yasmine.com') => h.zones.get(d);
    const recordsOf = (name, type, d) => zone(d).filter(r => r.name === name && r.type === type).flatMap(r => r.records.map(x => x.content));

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
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-hostinger-'));
        SQL = SQL || await initSqlJs();
        cloud = await startFakeCloud({ login: 'yasmine-shop', accounts: [{ id: 'c'.repeat(32), name: 'Boutique' }], subdomain: 'yasmine', d1Factory: async () => new SQL.Database() });
        mode = null;
        h = fakeHostinger({ domains: ['boutique-yasmine.com', 'other-shop.com'] });
    });
    afterEach(async () => { await cloud.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('link the account (checked by Hostinger, kept encrypted, never shown), set up automatically: GitHub\'s records written, e-mail kept, then connected', async () => {
        const service = makeService();
        await publish(service);
        service.setDomain('boutique-yasmine.com');
        let v = await service.domainCheck();
        expect(v.domain).toMatchObject({ status: 'dns_wrong', hostinger: { linked: false } });
        // A key Hostinger refuses (or not a key at all) is not kept
        expect(await codeOf(() => service.domainHostingerLink({ token: 'wrong-key-0123456789abcdef' }))).toBe('WEBSITE_HOSTINGER_KEY');
        expect(await codeOf(() => service.domainHostingerLink({ token: 'short' }))).toBe('WEBSITE_HOSTINGER_KEY');
        expect(service.view().domain.hostinger.linked).toBe(false);

        v = await service.domainHostingerLink({ token: KEY });
        expect(v.domain.hostinger).toEqual({ linked: true, owns: true });
        // The key: encrypted on this computer, never in what the window gets, never in the settings
        expect(JSON.stringify(v)).not.toContain(KEY);
        expect(JSON.stringify(settings)).not.toContain(KEY);
        for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f)).toString()).not.toContain(KEY);

        v = await service.domainHostingerSetup();
        // Checked by Hostinger before it was written; only the website's records replaced
        const writes = h.calls.filter(c => c.path.startsWith('/api/dns/v1/zones/'));
        expect(writes.map(c => `${c.method} ${c.path.replace('/api/dns/v1/zones/boutique-yasmine.com', '')}`)).toEqual(['GET ', 'POST /validate', 'DELETE ', 'PUT ']);
        expect(recordsOf('@', 'A')).toEqual(connection.GITHUB_A);
        expect(recordsOf('@', 'AAAA')).toEqual(connection.GITHUB_AAAA);
        expect(recordsOf('www', 'CNAME')).toEqual(['yasmine-shop.github.io.']);
        expect(recordsOf('@', 'ALIAS')).toEqual([]);
        expect(recordsOf('@', 'MX')).toEqual(['5 mx1.hostinger.com.']);
        expect(recordsOf('shop', 'A')).toEqual(['34.120.1.2']); // another name of the shop: untouched
        // Spread: the usual steps connect it (the free address untouched until then)
        expect(v.domain).toMatchObject({ autoDns: 'hostinger', status: 'connecting' });
        expect(cloud.gh.repos.get('boutique-yasmine').pages.cname).toBe('boutique-yasmine.com');
        // Every call carried the key to Hostinger only (apart from the wrong key tried above); nothing bought
        expect(h.calls.every(c => c.auth === `Bearer ${KEY}` || c.auth === 'Bearer wrong-key-0123456789abcdef')).toBe(true);
        expect(h.calls.some(c => c.method === 'POST' && c.path === '/api/domains/v1/portfolio')).toBe(false);
        expect(cloud.requests.some(r => JSON.stringify(r).includes(KEY))).toBe(false);
    });

    it('removed: the records the program wrote are taken away at Hostinger (e-mail kept); no table left to clean by hand', async () => {
        const service = makeService();
        await publish(service);
        service.setDomain('boutique-yasmine.com');
        await service.domainHostingerLink({ token: KEY });
        await service.domainHostingerSetup();
        await service.publishPending();
        const v = await service.removeDomain();
        expect(v.result).toMatchObject({ removed: 'boutique-yasmine.com', cleanup: [] });
        expect(recordsOf('@', 'A')).toEqual([]);
        expect(recordsOf('@', 'AAAA')).toEqual([]);
        expect(recordsOf('www', 'CNAME')).toEqual([]);
        expect(recordsOf('@', 'MX')).toEqual(['5 mx1.hostinger.com.']);
        expect(cloud.gh.repos.get('boutique-yasmine').pages.cname).toBeNull();
    });

    it('a sub-domain: one CNAME (its old address taken away first); a domain of another account or a refused change: nothing written', async () => {
        const service = makeService();
        await publish(service);
        await service.domainHostingerLink({ token: KEY });
        service.setDomain('shop.boutique-yasmine.com');
        await service.domainHostingerSetup();
        expect(recordsOf('shop', 'CNAME')).toEqual(['yasmine-shop.github.io.']);
        expect(recordsOf('shop', 'A')).toEqual([]);
        expect(recordsOf('@', 'A')).toEqual(['34.120.1.2']); // the main domain is not the website's: untouched
        await service.removeDomain();

        // Not in the linked account
        service.setDomain('elsewhere.com');
        expect(await codeOf(() => service.domainHostingerSetup())).toBe('WEBSITE_HOSTINGER_NOT_OWNED');
        expect(service.view().domain.hostinger).toEqual({ linked: true, owns: false });
        await service.removeDomain();
        // Hostinger refuses the change: nothing written
        service.setDomain('other-shop.com');
        h.failValidate = true;
        const before = JSON.stringify(zone('other-shop.com'));
        expect(await codeOf(() => service.domainHostingerSetup())).toBe('WEBSITE_HOSTINGER_FAILED');
        expect(JSON.stringify(zone('other-shop.com'))).toBe(before);
        expect(service.view().domain.autoDns).toBeNull();
    });

    it('a key revoked at Hostinger is forgotten; Unlink forgets it; the demo shop never uses it; owner-only channels', async () => {
        const service = makeService();
        await publish(service);
        service.setDomain('boutique-yasmine.com');
        await service.domainHostingerLink({ token: KEY });
        mode = 'demo';
        expect(await codeOf(() => service.domainHostingerSetup())).toBe('WEBSITE_ACCOUNTS_BLOCKED');
        expect(await codeOf(() => service.domainHostingerLink({ token: KEY }))).toBe('WEBSITE_ACCOUNTS_BLOCKED');
        mode = null;
        h.revoked = true;
        expect(await codeOf(() => service.domainHostingerSetup())).toBe('WEBSITE_HOSTINGER_KEY');
        expect(service.view().domain.hostinger.linked).toBe(false);
        h.revoked = false;
        await service.domainHostingerLink({ token: KEY });
        expect(service.domainHostingerForget().domain.hostinger.linked).toBe(false);
        for (const ch of ['website:domainHostingerLink', 'website:domainHostingerForget', 'website:domainHostingerSetup']) expect(ipcGuard.RULES[ch], ch).toBe('admin');
    });
});
