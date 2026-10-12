import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { createWebsiteService } = require('../electron/website/websiteService');
const { createCloudflareClient } = require('../electron/website/cloudflare');
const { createSecureStore } = require('../electron/website/secureStore');
const { pkce, sameText } = require('../electron/website/oauthLoopback');
const callbackPage = require('../electron/website/callbackPage');
const ws = require('../electron/website/websiteState');
const ipcGuard = require('../electron/services/ipcGuard');
const logService = require('../electron/services/logService');
const catalog = require('../electron/services/catalogService');

const ACC1 = 'a'.repeat(32);
const ACC2 = 'b'.repeat(32);
const codeOf = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fakeSafeStorage = () => ({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (text) => Buffer.from(`enc:${[...text].reverse().join('')}`),
    decryptString: (buf) => { const s = buf.toString(); if (!s.startsWith('enc:')) throw new Error('bad'); return [...s.slice(4)].reverse().join(''); },
});

/**
 * Cloudflare stand-in on 127.0.0.1: /oauth2/token (checks PKCE), /oauth2/revoke,
 * /client/v4/accounts, /workers/scripts, /d1/database.
 */
function fakeCloudflare() {
    const cf = {
        accounts: [{ id: ACC1, name: 'Boutique Yasmine' }],
        access: { workers: true, d1: true },
        refresh: true, scope: 'account-settings.read workers-scripts.write d1.write offline_access',
        expiresIn: 3600, revoked: [], requests: [], codes: new Map(), live: new Set(), refreshes: 0,
    };
    let n = 0;
    cf.server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            const url = new URL(req.url, 'http://x');
            const form = Object.fromEntries(new URLSearchParams(body));
            cf.requests.push({ path: url.pathname, method: req.method, auth: req.headers.authorization || null, form });
            const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
            const issue = () => {
                const at = `cf_at_${++n}_${crypto.randomBytes(6).toString('hex')}`;
                const rt = `cf_rt_${n}_${crypto.randomBytes(6).toString('hex')}`;
                cf.live.add(at);
                cf.live.add(rt);
                return { access_token: at, refresh_token: cf.refresh ? rt : undefined, expires_in: cf.expiresIn, scope: cf.scope, token_type: 'bearer' };
            };
            if (url.pathname === '/oauth2/token') {
                if (form.grant_type === 'authorization_code') {
                    const c = cf.codes.get(form.code);
                    cf.codes.delete(form.code);
                    const ok = c && c.redirectUri === form.redirect_uri && b64url(crypto.createHash('sha256').update(form.code_verifier || '').digest()) === c.challenge;
                    return ok ? send(200, issue()) : send(400, { error: 'invalid_grant' });
                }
                if (form.grant_type === 'refresh_token') {
                    if (!cf.live.has(form.refresh_token)) return send(400, { error: 'invalid_grant' });
                    cf.live.delete(form.refresh_token); // rotated
                    cf.refreshes++;
                    return send(200, issue());
                }
                return send(400, { error: 'unsupported_grant_type' });
            }
            if (url.pathname === '/oauth2/revoke') { cf.revoked.push(form.token); cf.live.delete(form.token); return send(200, {}); }
            const token = (req.headers.authorization || '').replace(/^Bearer /, '');
            if (url.pathname.startsWith('/client/v4/') && !cf.live.has(token)) return send(401, { success: false });
            if (url.pathname === '/client/v4/accounts') return send(200, { success: true, result: cf.accounts });
            if (/\/workers\/scripts$/.test(url.pathname)) return cf.access.workers ? send(200, { success: true, result: [] }) : send(403, { success: false });
            if (/\/d1\/database$/.test(url.pathname)) return cf.access.d1 ? send(200, { success: true, result: [] }) : send(403, { success: false });
            return send(404, {});
        });
    });
    return cf;
}

/** The browser: opens Cloudflare's page; the shop agrees (or refuses) and is sent back. */
async function browser(cf, url, { refuse = false, state: forceState } = {}) {
    const u = new URL(url);
    const q = u.searchParams;
    const redirect = new URL(q.get('redirect_uri'));
    const code = crypto.randomBytes(8).toString('hex');
    cf.codes.set(code, { challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') });
    redirect.searchParams.set('state', forceState ?? q.get('state'));
    if (refuse) redirect.searchParams.set('error', 'access_denied');
    else redirect.searchParams.set('code', code);
    const res = await fetch(redirect);
    return { status: res.status, html: await res.text(), headers: res.headers };
}

describe('website: the shop\'s Cloudflare account', () => {
    let api, settings, dir, cf, base, opened, focused, mode, ports;

    const makeService = ({ clientId = 'afus-public-client', timeoutMs } = {}) => {
        const store = createSecureStore({ dir, safeStorage: fakeSafeStorage(), platform: 'linux' });
        const service = createWebsiteService({
            api,
            getSetting: (key) => settings[key] ?? null,
            saveSetting: (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); },
            codedError: catalog.codedError,
            blockedMode: () => mode,
            cloudflare: {
                client: createCloudflareClient({ clientId, fetch: globalThis.fetch, dashBase: base, apiBase: `${base}/client/v4` }),
                store,
                ports,
                openPage: async (url) => { opened.push(url); },
                onConnected: () => { focused++; },
                callbackPage: (kind) => callbackPage(kind, 'fr'),
                timeoutMs,
            },
        });
        if (!settings.website?.created) service.create({ name: 'boutique-yasmine' });
        return { service, store };
    };

    beforeEach(async () => {
        ({ api } = await createShop());
        settings = { store_config: { businessName: 'Boutique Yasmine' } };
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-cf-'));
        cf = fakeCloudflare();
        await new Promise(r => cf.server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${cf.server.address().port}`;
        opened = []; focused = 0; mode = null;
        // Free ports for the program's callback server
        ports = await Promise.all([0, 1].map(() => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); })));
    });
    afterEach(() => { cf.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('not connected; connect opens Cloudflare\'s own sign-in page (PKCE S256, state, minimal scopes, no secret)', async () => {
        const { service } = makeService();
        expect(service.view().accounts.cloudflare).toMatchObject({ status: 'not_connected', connected: false });
        expect(service.view().providers.cloudflare.available).toBe(true);
        const r = await service.cloudflareStart();
        expect(r.result.started).toBe(true);
        expect(r.cloudflareFlow).toHaveProperty('expiresAt');
        expect(opened).toHaveLength(1);
        const u = new URL(opened[0]);
        expect(`${u.origin}${u.pathname}`).toBe(`${base}/oauth2/auth`);
        const q = Object.fromEntries(u.searchParams);
        expect(q).toMatchObject({ response_type: 'code', client_id: 'afus-public-client', code_challenge_method: 'S256' });
        expect(q.scope.split(' ')).toEqual(expect.arrayContaining(['workers-scripts.write', 'd1.write', 'offline_access']));
        expect(q.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
        expect(q.state.length).toBeGreaterThanOrEqual(43);
        expect(q).not.toHaveProperty('client_secret');
        // Nothing of the sign-in reaches the window
        expect(JSON.stringify(r)).not.toContain(q.state);
        expect(JSON.stringify(r)).not.toContain(q.code_challenge);
        service.cloudflareCancel();
    });

    it('agreed on Cloudflare: back in the program, Connected, Workers and D1 reachable; keys never shown or saved plainly', async () => {
        const { service } = makeService();
        await service.cloudflareStart();
        const back = await browser(cf, opened[0]);
        expect(back.status).toBe(200);
        expect(back.html).toContain('Cloudflare est lié');
        expect(back.headers.get('content-security-policy')).toContain("default-src 'none'");
        await service.cloudflarePending();

        const v = service.view();
        expect(v.accounts.cloudflare).toMatchObject({ status: 'connected', connected: true, accountName: 'Boutique Yasmine', access: { workers: true, d1: true }, error: null });
        expect(v.accounts.cloudflare).not.toHaveProperty('accountId');
        expect(v.cloudflareFlow).toBeNull();
        expect(v.steps.find(s => s.id === 'cloudflare').done).toBe(true);
        expect(focused).toBe(1);

        // The token request: the PKCE verifier, the public id, no secret
        const tokenCall = cf.requests.find(x => x.path === '/oauth2/token');
        expect(tokenCall.form).toMatchObject({ grant_type: 'authorization_code', client_id: 'afus-public-client' });
        expect(tokenCall.form.code_verifier).toBeTruthy();
        expect(tokenCall.form).not.toHaveProperty('client_secret');
        expect(tokenCall.auth).toBeNull();

        // Keys: not in the view, not in the settings, not plain on disk
        const keys = [...cf.live];
        const file = path.join(dir, 'cloudflare.bin');
        for (const k of keys) {
            expect(JSON.stringify(v)).not.toContain(k);
            expect(JSON.stringify(settings)).not.toContain(k);
            expect(fs.readFileSync(file, 'utf8')).not.toContain(k);
        }
        if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o077).toBe(0);
        // Bearer keys only to the API
        expect(cf.requests.filter(x => x.auth).every(x => x.path.startsWith('/client/v4/'))).toBe(true);
        // A second answer is not taken (refused, then the server is closed)
        const second = await fetch(new URL(opened[0]).searchParams.get('redirect_uri')).then(res => res.status, () => 'closed');
        expect([404, 'closed']).toContain(second);
    });

    it('the key for the next phases (main process): renewed with the refresh key when about to end, one renewal at a time', async () => {
        cf.expiresIn = 60; // already within the renewal window
        const { service } = makeService();
        await service.cloudflareStart();
        await browser(cf, opened[0]);
        await service.cloudflarePending();
        const before = cf.refreshes;
        const [a, b] = await Promise.all([service.cloudflareAccess(), service.cloudflareAccess()]);
        expect(a).toEqual(b);
        expect(a.accountId).toBe(ACC1);
        expect(cf.refreshes - before).toBe(1);
        expect(cf.live.has(a.token)).toBe(true);
        expect((await service.cloudflareCheck()).result).toEqual({ checked: true, ok: true });
    });

    it('several accounts allowed: the shop picks one by its name; an id not offered is refused', async () => {
        cf.accounts = [{ id: ACC1, name: 'Perso' }, { id: ACC2, name: 'Boutique' }];
        const { service } = makeService();
        await service.cloudflareStart();
        await browser(cf, opened[0]);
        await service.cloudflarePending();
        let v = service.view();
        expect(v.accounts.cloudflare.status).toBe('choose_account');
        expect(v.accounts.cloudflare.accounts.map(a => a.name)).toEqual(['Perso', 'Boutique']);
        expect((await service.cloudflareChoose('c'.repeat(32))).result).toEqual({ linked: false, reason: 'unknown_account' });
        // An id slipped into the saved list (not offered by Cloudflare) is refused too
        settings.website.accounts.cloudflare.accounts.push({ id: 'c'.repeat(32), name: 'Other' });
        expect((await service.cloudflareChoose('c'.repeat(32))).result).toEqual({ linked: false, reason: 'unknown_account' });
        v = await service.cloudflareChoose(ACC2);
        expect(v.result).toEqual({ linked: true });
        expect(v.accounts.cloudflare).toMatchObject({ status: 'connected', accountName: 'Boutique', accounts: [] });
        expect((await service.cloudflareAccess()).accountId).toBe(ACC2);
    });

    it('connection failed: refused, missing Workers/D1 access, no refresh key, no account — nothing kept, keys withdrawn', async () => {
        // Refused on Cloudflare's page
        const { service, store } = makeService();
        await service.cloudflareStart();
        const back = await browser(cf, opened.at(-1), { refuse: true });
        expect(back.html).toContain('Liaison refusée');
        await service.cloudflarePending();
        expect(service.view().accounts.cloudflare).toMatchObject({ status: 'failed', error: 'denied' });
        expect(store.has('cloudflare')).toBe(false);

        // D1 not allowed
        cf.access = { workers: true, d1: false };
        await service.cloudflareStart();
        await browser(cf, opened.at(-1));
        await service.cloudflarePending();
        expect(service.view().accounts.cloudflare).toMatchObject({ status: 'failed', error: 'scope', access: { workers: true, d1: false } });
        expect(service.view().steps.find(s => s.id === 'cloudflare').done).toBe(false);
        expect(store.has('cloudflare')).toBe(false);

        // No refresh key (offline_access refused): would end within the hour
        cf.access = { workers: true, d1: true };
        cf.refresh = false;
        await service.cloudflareStart();
        await browser(cf, opened.at(-1));
        await service.cloudflarePending();
        expect(service.view().accounts.cloudflare, JSON.stringify(service.view().accounts.cloudflare)).toMatchObject({ status: 'failed', error: 'scope' });
        await new Promise(r => setTimeout(r, 100));
        expect(cf.revoked.length).toBeGreaterThan(0);

        // No account selected
        cf.refresh = true;
        cf.accounts = [];
        await service.cloudflareStart();
        await browser(cf, opened.at(-1));
        await service.cloudflarePending();
        expect(service.view().accounts.cloudflare).toMatchObject({ status: 'failed', error: 'no_account' });
        expect(store.has('cloudflare')).toBe(false);
    });

    it('cancelled while the keys arrive: nothing kept, keys withdrawn', async () => {
        const { service, store } = makeService();
        await service.cloudflareStart();
        const url = opened.at(-1);
        // Cancel as soon as Cloudflare is asked for the accounts
        const slow = cf.server.listeners('request')[0];
        cf.server.removeAllListeners('request');
        cf.server.on('request', (req, res) => {
            if (req.url.startsWith('/client/v4/accounts')) service.cloudflareCancel();
            slow(req, res);
        });
        await browser(cf, url);
        await service.cloudflarePending();
        await new Promise(r => setTimeout(r, 100));
        expect(store.has('cloudflare')).toBe(false);
        expect(service.view().accounts.cloudflare.status).toBe('not_connected');
        expect(cf.revoked.length).toBeGreaterThan(0);
    });

    it('a wrong state (someone else\'s link) is refused; the code expires after the wait; cancel closes the server', async () => {
        const { service } = makeService({ timeoutMs: 300 });
        await service.cloudflareStart();
        const wrong = await browser(cf, opened.at(-1), { state: 'not-this-sign-in' });
        expect(wrong.status).toBe(400);
        await service.cloudflarePending();
        expect(service.view().accounts.cloudflare).toMatchObject({ status: 'failed' });
        expect(cf.requests.some(x => x.path === '/oauth2/token')).toBe(false);

        await service.cloudflareStart();
        await service.cloudflarePending();
        expect(service.view().accounts.cloudflare).toMatchObject({ status: 'failed', error: 'expired' });

        const again = makeService({ timeoutMs: 60000 }).service;
        await again.cloudflareStart();
        const redirect = new URL(opened.at(-1)).searchParams.get('redirect_uri');
        again.cloudflareCancel();
        await again.cloudflarePending();
        await new Promise(r => setTimeout(r, 120));
        await expect(fetch(redirect)).rejects.toThrow();
    });

    it('withdrawn on Cloudflare: seen at the next check, forgotten; disconnect withdraws and forgets', async () => {
        const { service, store } = makeService();
        await service.cloudflareStart();
        await browser(cf, opened[0]);
        await service.cloudflarePending();
        cf.live.clear(); // the shop removed the access on Cloudflare
        const r = await service.cloudflareCheck();
        expect(r.result).toMatchObject({ checked: true, ok: false, reason: 'revoked' });
        expect(r.accounts.cloudflare).toMatchObject({ status: 'failed', error: 'revoked' });
        expect(store.has('cloudflare')).toBe(false);
        expect(await codeOf(() => service.cloudflareAccess())).toBe('WEBSITE_CLOUDFLARE_NOT_CONNECTED');

        await service.cloudflareStart();
        await browser(cf, opened.at(-1));
        await service.cloudflarePending();
        const keys = [...cf.live];
        expect(service.cloudflareDisconnect().accounts.cloudflare).toMatchObject({ status: 'not_connected', accountName: '' });
        await new Promise(r => setTimeout(r, 100));
        expect(cf.revoked).toEqual(expect.arrayContaining(keys));
        expect(fs.existsSync(path.join(dir, 'cloudflare.bin'))).toBe(false);
    });

    it('not set up in this copy, demo shop / training: refused without any request', async () => {
        const a = makeService({ clientId: '' });
        expect(a.service.view().providers.cloudflare).toEqual({ available: true, signIn: false });
        expect((await a.service.cloudflareStart()).result).toEqual({ started: false, reason: 'not_configured' });
        expect(opened).toEqual([]);

        const { service, store } = makeService();
        mode = 'demo';
        expect(await codeOf(() => service.cloudflareStart())).toBe('WEBSITE_ACCOUNTS_BLOCKED');
        expect(service.view().providers.cloudflare.available).toBe(false);
        mode = null;
        await service.cloudflareStart();
        mode = 'training';
        await browser(cf, opened.at(-1));
        await service.cloudflarePending();
        expect(store.has('cloudflare')).toBe(false);
        mode = null;
        await new Promise(r => setTimeout(r, 100));
        expect(service.view().accounts.cloudflare.status).toBe('not_connected');
        expect(cf.requests.some(x => x.path === '/client/v4/accounts')).toBe(false);
        expect(cf.revoked.length).toBeGreaterThan(0);
        expect(cf.requests.length).toBe(cf.requests.filter(x => x.path.startsWith('/oauth2/')).length);
    });

    it('pieces: PKCE, constant-time state, owner-only channels, old state, keys hidden in the log', () => {
        const p = pkce();
        expect(p.method).toBe('S256');
        expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(p.challenge).toBe(b64url(crypto.createHash('sha256').update(p.verifier).digest()));
        expect(sameText('abc', 'abc')).toBe(true);
        expect(sameText('abc', 'abd')).toBe(false);
        expect(sameText('abc', null)).toBe(false);
        for (const ch of ['Start', 'Cancel', 'Choose', 'Disconnect', 'Check', 'Open', 'Manage'].map(c => `website:cloudflare${c}`)) {
            expect(ipcGuard.allows(ipcGuard.RULES[ch], { id: 'a', role: 'admin' }), ch).toBe(true);
            expect(ipcGuard.allows(ipcGuard.RULES[ch], { id: 'm', role: 'manager' }), ch).toBe(false);
        }
        // An older saved state (phase 2) reads as not connected
        expect(ws.normalizeState({ accounts: { cloudflare: { connected: true } } }).accounts.cloudflare.status).toBe('not_connected');
        expect(ws.cloudflareAccount({ status: 'connected', accountId: '../x' }).accountId).toBe('');
        const line = logService.redact('POST token code=abc123&code_verifier=xyz&refresh_token=ory_rt_ABCDEFGHIJKLMN access_token=zz');
        expect(line).not.toMatch(/abc123|xyz|ABCDEFGHIJ|=zz/);
        expect(logService.redact({ refreshToken: 'x', codeVerifier: 'y' })).toEqual({ refreshToken: '***', codeVerifier: '***' });
        expect(callbackPage('ok', 'ar')).toContain('dir="rtl"');
        expect(callbackPage('ok', 'ar')).not.toMatch(/<script/i);
    });
});
