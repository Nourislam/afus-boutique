import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { createWebsiteService } = require('../electron/website/websiteService');
const { createGithubClient, canCreateRepos } = require('../electron/website/github');
const { createSecureStore } = require('../electron/website/secureStore');
const ws = require('../electron/website/websiteState');
const ipcGuard = require('../electron/services/ipcGuard');
const logService = require('../electron/services/logService');
const catalog = require('../electron/services/catalogService');

const TOKEN = 'gho_TESTtoken1234567890abcdef';
const DEVICE = 'device-code-long-secret-1234';
const codeOf = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };

/** System key store stand-in: "encrypts" by reversing, so the plain key is never in the file. */
const fakeSafeStorage = ({ available = true, backend = 'gnome_libsecret' } = {}) => ({
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (text) => Buffer.from(`enc:${[...text].reverse().join('')}`),
    decryptString: (buf) => { const s = buf.toString(); if (!s.startsWith('enc:')) throw new Error('bad'); return [...s.slice(4)].reverse().join(''); },
});

/**
 * GitHub stand-in. answers: the token answers in order (pending, slow_down,
 * denied, expired, token); user: the /user answer; repos: names already taken.
 */
function fakeGithub({ answers = ['pending', 'token'], scope = 'public_repo', user = { status: 200 }, taken = [], verification = 'https://github.com/login/device' } = {}) {
    const calls = [];
    const made = new Map();
    let i = 0;
    const json = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
    const fetch = async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url, method: init.method || 'GET', body, headers: init.headers, redirect: init.redirect });
        if (url === 'https://github.com/login/device/code') {
            return json(200, { device_code: DEVICE, user_code: 'WDJB-MJHT', verification_uri: verification, expires_in: 900, interval: 5 });
        }
        if (url === 'https://github.com/login/oauth/access_token') {
            const a = answers[Math.min(i++, answers.length - 1)];
            if (a === 'network') throw new Error('offline');
            if (a === 'token') return json(200, { access_token: TOKEN, token_type: 'bearer', scope });
            if (a === 'slow_down') return json(200, { error: 'slow_down', interval: 10 });
            return json(200, { error: { pending: 'authorization_pending', denied: 'access_denied', expired: 'expired_token' }[a] });
        }
        if (url === 'https://api.github.com/user') {
            if (user.status !== 200) return json(user.status, { message: 'Bad credentials' });
            return json(200, { login: 'yasmine-shop', id: 42, name: 'Yasmine' }, { 'x-oauth-scopes': scope });
        }
        if (url === 'https://api.github.com/user/repos' && init.method === 'POST') {
            if (taken.includes(body.name) || made.has(body.name)) return json(422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] });
            made.set(body.name, true);
            return json(201, { id: 7, name: body.name, full_name: `yasmine-shop/${body.name}`, html_url: `https://github.com/yasmine-shop/${body.name}`, default_branch: 'main', private: false, owner: { login: 'yasmine-shop' } });
        }
        const repo = /^https:\/\/api\.github\.com\/repos\/yasmine-shop\/([^/]+)$/.exec(url);
        if (repo) {
            if (!made.has(repo[1])) return json(404, { message: 'Not Found' });
            return json(200, { id: 7, name: repo[1], full_name: `yasmine-shop/${repo[1]}`, html_url: '', default_branch: 'main', owner: { login: 'yasmine-shop' } });
        }
        return json(404, {});
    };
    return { fetch, calls, made };
}

describe('website: the shop\'s GitHub account', () => {
    let api, settings, dir, clock, opened, focused, mode;

    const makeService = ({ gh = fakeGithub(), clientId = 'Iv1.afus-public-id', safe = fakeSafeStorage(), allowWeak = false } = {}) => {
        const store = createSecureStore({ dir, safeStorage: safe, allowWeak, platform: 'linux' });
        const service = createWebsiteService({
            api,
            getSetting: (key) => settings[key] ?? null,
            saveSetting: (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); },
            codedError: catalog.codedError,
            blockedMode: () => mode,
            github: {
                client: createGithubClient({ clientId, fetch: gh.fetch }),
                store,
                openPage: async (url, code) => { opened.push([url, code]); },
                onConnected: () => { focused++; },
                now: () => clock,
                sleep: async (ms) => { clock += ms; },
            },
        });
        service.create({ name: 'boutique-yasmine' });
        return { service, store, gh };
    };

    beforeEach(async () => {
        ({ api } = await createShop());
        settings = { store_config: { businessName: 'Boutique Yasmine' } };
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-secure-'));
        clock = Date.parse('2026-10-11T10:00:00Z');
        opened = []; focused = 0; mode = null;
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('not connected at first; connect opens GitHub\'s own page with a short code, then the account is connected', async () => {
        const { service, gh } = makeService();
        expect(service.view().accounts.github).toMatchObject({ status: 'not_connected', connected: false });
        expect(service.view().providers.github.available).toBe(true);

        const started = await service.githubStart();
        expect(started.result).toMatchObject({ started: true });
        expect(started.githubFlow).toMatchObject({ userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device' });
        expect(opened).toEqual([['https://github.com/login/device', 'WDJB-MJHT']]);
        // Only the public app id and the minimal scope are sent; no secret exists
        expect(gh.calls[0].body).toEqual({ client_id: 'Iv1.afus-public-id', scope: 'repo' });
        // The long device code never reaches the window
        expect(JSON.stringify(started)).not.toContain(DEVICE);

        await service.githubPending();
        const v = service.view();
        expect(v.accounts.github).toMatchObject({ status: 'connected', connected: true, login: 'yasmine-shop', scopes: ['public_repo'], error: null });
        expect(v.githubFlow).toBeNull();
        expect(v.steps.find(s => s.id === 'github').done).toBe(true);
        expect(focused).toBe(1);
        // The key: never in the window's view, never in the settings, never plain on disk
        expect(JSON.stringify(v)).not.toContain(TOKEN);
        expect(JSON.stringify(settings)).not.toContain(TOKEN);
        const file = path.join(dir, 'github.bin');
        expect(fs.readFileSync(file, 'utf8')).not.toContain(TOKEN);
        if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o077).toBe(0);
        // The key goes to GitHub's API only, as a bearer, never following a redirect
        const userCall = gh.calls.find(c => c.url === 'https://api.github.com/user');
        expect(userCall.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(gh.calls.every(c => c.redirect === 'error')).toBe(true);
        expect(gh.calls.filter(c => c.url.startsWith('https://github.com/')).every(c => !c.headers.Authorization)).toBe(true);
    });

    it('slow down and short network cuts are waited out', async () => {
        const { service } = makeService({ gh: fakeGithub({ answers: ['pending', 'slow_down', 'network', 'pending', 'token'] }) });
        const start = clock;
        await service.githubStart();
        await service.githubPending();
        expect(service.view().accounts.github.status).toBe('connected');
        // 5 s twice, then 10 s after slow_down (5 + 5, and at least GitHub's 10)
        expect(clock - start).toBe(5000 + 5000 + 10000 * 3);
    });

    it('connection failed: refused, code expired, missing access — clear reason, nothing kept', async () => {
        for (const [answers, scope, reason] of [[['pending', 'denied'], 'public_repo', 'denied'], [['expired'], 'public_repo', 'expired'], [['token'], 'read:user', 'scope']]) {
            settings = { store_config: {} };
            const { service, store } = makeService({ gh: fakeGithub({ answers, scope }) });
            await service.githubStart();
            await service.githubPending();
            expect(service.view().accounts.github, reason).toMatchObject({ status: 'failed', connected: false, error: reason });
            expect(store.has('github'), reason).toBe(false);
        }
        // The code runs out on the program's side too (no answer for 15 minutes)
        settings = { store_config: {} };
        const { service } = makeService({ gh: fakeGithub({ answers: ['pending'] }) });
        await service.githubStart();
        await service.githubPending();
        expect(service.view().accounts.github).toMatchObject({ status: 'failed', error: 'expired' });
    });

    it('no AFUS app id in this copy: told plainly, no request sent; no secure key store: nothing saved, no request', async () => {
        const a = makeService({ clientId: '' });
        // Linking with the shop's own key stays possible; only the one-click sign-in is not offered
        expect(a.service.view().providers.github).toEqual({ available: true, signIn: false });
        const r = await a.service.githubStart();
        expect(r.result).toEqual({ started: false, reason: 'not_configured' });
        expect(a.gh.calls).toEqual([]);
        expect(r.accounts.github.status).toBe('not_connected');

        settings = { store_config: {} };
        const b = makeService({ safe: fakeSafeStorage({ backend: 'basic_text' }) });
        expect(b.service.view().secureStorage).toBe(false);
        const r2 = await b.service.githubStart();
        expect(r2.result).toEqual({ started: false, reason: 'secure_storage' });
        expect(r2.accounts.github).toMatchObject({ status: 'failed', error: 'secure_storage' });
        expect(b.gh.calls).toEqual([]);
    });

    it('demo shop / training: refused; switched to while waiting: nothing kept', async () => {
        const { service, store } = makeService();
        mode = 'demo';
        expect(await codeOf(() => service.githubStart())).toBe('WEBSITE_GITHUB_BLOCKED');
        expect(service.view().githubBlocked).toBe('demo');
        expect(service.view().providers.github.available).toBe(false);
        mode = null;
        await service.githubStart();
        mode = 'training';
        await service.githubPending();
        expect(store.has('github')).toBe(false);
        mode = null;
        expect(service.view().accounts.github.status).toBe('not_connected');
    });

    it('cancel stops the wait; disconnect forgets the key', async () => {
        const { service, store } = makeService({ gh: fakeGithub({ answers: ['pending', 'pending', 'pending', 'token'] }) });
        await service.githubStart();
        expect(service.githubCancel().githubFlow).toBeNull();
        await service.githubPending();
        expect(service.view().accounts.github.status).toBe('not_connected');
        expect(store.has('github')).toBe(false);

        await service.githubStart();
        await service.githubPending();
        expect(store.has('github')).toBe(true);
        const after = service.githubDisconnect();
        expect(after.accounts.github).toMatchObject({ status: 'not_connected', login: '' });
        expect(fs.existsSync(path.join(dir, 'github.bin'))).toBe(false);
    });

    it('check: a key withdrawn on GitHub is forgotten; a key no longer readable shows "failed"', async () => {
        const gh = fakeGithub();
        const { service, store } = makeService({ gh });
        await service.githubStart();
        await service.githubPending();
        expect((await service.githubCheck()).result).toEqual({ checked: true, ok: true });

        // Key file lost (another computer, system key changed)
        fs.writeFileSync(path.join(dir, 'github.bin'), 'garbage');
        expect(service.view().accounts.github).toMatchObject({ status: 'failed', error: 'token_missing', connected: false });
        expect(service.view().steps.find(s => s.id === 'github').done).toBe(false);

        // Withdrawn on GitHub
        settings.website.accounts.github = { status: 'connected', login: 'yasmine-shop' };
        store.set('github', JSON.stringify({ token: TOKEN }));
        const revoked = makeServiceWith(gh, { user: { status: 401 } });
        const r = await revoked.githubCheck();
        expect(r.result).toMatchObject({ checked: true, ok: false, reason: 'revoked' });
        expect(r.accounts.github).toMatchObject({ status: 'failed', error: 'revoked' });
        expect(store.has('github')).toBe(false);
    });

    // Same data folder and settings, GitHub answering differently
    function makeServiceWith(_gh, options) {
        const gh = fakeGithub(options);
        return createWebsiteService({
            api, getSetting: (key) => settings[key] ?? null,
            saveSetting: (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); },
            codedError: catalog.codedError, blockedMode: () => mode,
            github: { client: createGithubClient({ clientId: 'x', fetch: gh.fetch }), store: createSecureStore({ dir, safeStorage: fakeSafeStorage(), platform: 'linux' }), now: () => clock, sleep: async () => {} },
        });
    }

    it('the repository is made by the program on the shop\'s account (name from the address, taken name avoided)', async () => {
        const gh = fakeGithub({ taken: ['boutique-yasmine'] });
        const { service } = makeService({ gh });
        expect(await codeOf(() => service.ensureRepository())).toBe('WEBSITE_GITHUB_NOT_CONNECTED');
        await service.githubStart();
        await service.githubPending();
        const repo = await service.ensureRepository();
        expect(repo).toMatchObject({ fullName: 'yasmine-shop/boutique-yasmine-2', private: false });
        const create = gh.calls.filter(c => c.url === 'https://api.github.com/user/repos');
        expect(create.at(-1).body).toMatchObject({ name: 'boutique-yasmine-2', private: false, auto_init: true });
        // Kept for the program; never shown on the screen
        expect(settings.website.repository).toMatchObject({ fullName: 'yasmine-shop/boutique-yasmine-2' });
        expect(service.view()).not.toHaveProperty('repository');
        // Again: the same repository, not a new one
        const again = await service.ensureRepository();
        expect(again.fullName).toBe('yasmine-shop/boutique-yasmine-2');
        expect(gh.calls.filter(c => c.url === 'https://api.github.com/user/repos')).toHaveLength(2);
        mode = 'training';
        expect(await codeOf(() => service.ensureRepository())).toBe('WEBSITE_GITHUB_BLOCKED');
    });

    it('client: GitHub\'s page only, minimal scope; the owner alone; keys never in the log', async () => {
        const gh = fakeGithub({ verification: 'https://evil.example/login' });
        const client = createGithubClient({ clientId: 'x', fetch: gh.fetch });
        expect((await client.requestDeviceCode()).verificationUri).toBe('https://github.com/login/device');
        expect(canCreateRepos(['public_repo'])).toBe(true);
        expect(canCreateRepos(['read:user'])).toBe(false);
        for (const ch of ['website:getState', 'website:preview', 'website:githubStart', 'website:githubCancel', 'website:githubDisconnect', 'website:githubCheck', 'website:githubOpen', 'website:githubManage']) {
            expect(ipcGuard.allows(ipcGuard.RULES[ch], { id: 'a', role: 'admin' }), ch).toBe(true);
            expect(ipcGuard.allows(ipcGuard.RULES[ch], { id: 'm', role: 'manager' }), ch).toBe(false);
            expect(ipcGuard.allows(ipcGuard.RULES[ch], { id: 'c', role: 'cashier' }), ch).toBe(false);
        }
        expect(logService.redact(`failed with ${TOKEN} and github_pat_ABCDEFGHIJ1234567890`)).not.toMatch(/TESTtoken|ABCDEFGHIJ/);
    });

    it('secure store: refuses the fixed-key Linux fallback unless allowed for development tests', () => {
        const weak = createSecureStore({ dir, safeStorage: fakeSafeStorage({ backend: 'basic_text' }), platform: 'linux' });
        expect(weak.available()).toBe(false);
        expect(() => weak.set('github', 'x')).toThrow();
        expect(createSecureStore({ dir, safeStorage: fakeSafeStorage({ backend: 'basic_text' }), platform: 'linux', allowWeak: true }).available()).toBe(true);
        expect(createSecureStore({ dir, safeStorage: fakeSafeStorage({ backend: 'basic_text' }), platform: 'darwin' }).available()).toBe(true);
        expect(createSecureStore({ dir, safeStorage: fakeSafeStorage({ available: false }), platform: 'win32' }).available()).toBe(false);
        expect(() => weak.set('../escape', 'x')).toThrow();
        // An older saved state still reads (connected: true -> connected)
        expect(ws.normalizeState({ accounts: { github: { connected: true } } }).accounts.github.status).toBe('connected');
    });
});
