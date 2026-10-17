/**
 * Website Manager: what the window's Website screen calls (through the
 * website:* channels of main.js). The state is one JSON value in the
 * settings table (key "website"); the catalogue is only read.
 *
 * The website is created and prepared on this computer. The shop's GitHub
 * account can be linked (githubConnector.js: GitHub's own sign-in page, the
 * key kept encrypted by the main process, never in the settings or the
 * window); with it the program can make the shop's repository by itself
 * (ensureRepository, for the publishing phase). The shop's Cloudflare
 * account is linked the same way (cloudflareConnector.js: Cloudflare's own
 * sign-in page, OAuth with PKCE); with it the next phases make the Worker and
 * the D1 database (cloudflareAccess, main process only). "Update" builds what
 * the website would show and keeps its figures.
 *
 * deps: { api, getSetting(key), saveSetting(key, value), codedError(code, params),
 *         github: { client, store, openPage, onConnected } (optional),
 *         cloudflare: { client, store, openPage, onConnected, ports, callbackPage } (optional),
 *         blockedMode() -> 'demo' | null,
 *         currentEmployee() -> the employee logged in (who changes an order's status) }
 */
const state = require('./websiteState');
const { isPromotionLive, parseIds } = require('../shared/promotions.mjs');
const providers = require('./providers');
const { summarize } = require('./catalogSnapshot');
const { buildPublicData, checkSiteFiles, publicInfo } = require('./publicData');
const { photoDataUrl } = require('./storefront/photos');
const { FEATURES } = require('./publicData/public');
const { createYalidineClient, parcelOf } = require('./couriers/yalidine');
const { phoneKey } = require('./orders/phone');
const crypto = require('crypto');
const { registry } = require('./themes/registry');
const { renderPage } = require('./storefront/render');
const { STORE_PAGES } = require('./storefront/pages');
const { createGithubConnector } = require('./githubConnector');
const { createGithubClient } = require('./github');
const { createCloudflareConnector } = require('./cloudflareConnector');
const { createCloudflareClient } = require('./cloudflare');
const { createDeployer, dataHash } = require('./publish/deployer');
const { createDomainManager } = require('./domain/domainManager');
const { createLookup } = require('./domain/lookup');
const { createHostingerClient } = require('./domain/hostinger');
const domainProviders = require('./domain/providers');
const { canPublishPages } = require('./github');
const publishPing = require('./publish/ping');
const orderBook = require('./orders/orderBook');
const { COURIERS } = require('./storefront/couriers');
const { WILAYAS, wilayaLabel } = require('./storefront/wilayas');
const fs = require('fs');
const path = require('path');

// The shop's website API and the tables of its database, uploaded to its own Cloudflare account
// The Worker with the communes of each wilaya written in (it checks the order's commune)
const WORKER_SOURCE = () => fs.readFileSync(path.join(__dirname, 'worker', 'worker.mjs'), 'utf8')
    .replace('/*@COMMUNES@*/{}', () => fs.readFileSync(path.join(__dirname, '..', 'shared', 'communes.json'), 'utf8'));
const SCHEMA_SQL = () => fs.readFileSync(path.join(__dirname, 'worker', 'schema.sql'), 'utf8');

// Without a GitHub setup (tests of the website alone): nothing can be linked
const NO_STORE = { available: () => false, get: () => null, has: () => false, set: () => { throw Object.assign(new Error('secure storage unavailable'), { reason: 'secure_storage' }); }, remove: () => {} };
const REPO_TRIES = 5;

const KEY = 'website';

// The shop's own Hostinger API key (secure store item)
const HOSTINGER_ITEM = 'hostinger';

function createWebsiteService({ api, getSetting, saveSetting, codedError, github = {}, cloudflare = {}, blockedMode = () => null, publish = {}, domain = {}, currentEmployee = () => null, couriers = {} }) {
    const read = () => state.normalizeState(getSetting(KEY));
    const write = (next) => { saveSetting(KEY, next); return next; };
    const shopName = () => (getSetting('store_config') || {}).businessName || '';
    const mustExist = (s) => { if (!s.created) throw codedError('WEBSITE_NOT_CREATED'); return s; };

    // Opening hours, social pages and map moved to Settings › Shop: the values typed
    // on the Website screen by an older version are copied there once (nothing lost)
    function moveContactToShop() {
        try {
            if (blockedMode()) return;
            const saved = getSetting(KEY);
            const info = saved?.publicInfo;
            if (!info) return;
            const store = getSetting('store_config') || {};
            if (['shopHours', 'shopFacebook', 'shopInstagram', 'shopTiktok', 'shopMapUrl'].some(k => k in store)) return;
            const hours = (Array.isArray(info.hours) ? info.hours : []).join('\n');
            const moved = {
                shopHours: hours, shopFacebook: info.social?.facebook || '', shopInstagram: info.social?.instagram || '',
                shopTiktok: info.social?.tiktok || '', shopMapUrl: info.mapUrl || '',
            };
            if (Object.values(moved).some(Boolean)) saveSetting('store_config', { ...store, ...moved });
        } catch { /* kept on the Website screen's values, read the same way */ }
    }

    // The shop's GitHub account. Its state is saved in the website value;
    // nothing is written while the demo shop is open (its
    // database is not the shop's)
    const client = github.client || createGithubClient({ clientId: '' });
    const store = github.store || NO_STORE;
    const connector = createGithubConnector({
        client, store,
        readAccount: () => read().accounts.github,
        saveAccount: (meta) => {
            if (blockedMode()) return false;
            const s = read();
            write({ ...s, accounts: { ...s.accounts, github: state.githubAccount(meta) } });
            return true;
        },
        allowed: () => !blockedMode(),
        openPage: github.openPage,
        onConnected: github.onConnected,
        now: github.now,
        sleep: github.sleep,
    });

    // The shop's Cloudflare account (same rules)
    const cfClient = cloudflare.client || createCloudflareClient({ clientId: '' });
    const cfStore = cloudflare.store || store;
    const cf = createCloudflareConnector({
        client: cfClient, store: cfStore,
        readAccount: () => read().accounts.cloudflare,
        saveAccount: (meta) => {
            if (blockedMode()) return false;
            const s = read();
            write({ ...s, accounts: { ...s.accounts, cloudflare: state.cloudflareAccount(meta) } });
            return true;
        },
        allowed: () => !blockedMode(),
        openPage: cloudflare.openPage,
        onConnected: cloudflare.onConnected,
        ports: cloudflare.ports,
        callbackPage: cloudflare.callbackPage,
        now: cloudflare.now,
        timeoutMs: cloudflare.timeoutMs,
    });

    /** The program's own keys: never in the website (publicData/guard.js checks it). */
    function secrets() {
        const out = [];
        const add = (v) => { if (typeof v === 'string' && v.length >= 8) out.push(v); };
        for (const item of ['github', 'cloudflare']) {
            try { const k = JSON.parse(store.get(item) || 'null'); add(k?.token); add(k?.accessToken); add(k?.refreshToken); } catch { /* none */ }
        }
        add(store.get('website-key'));
        // The shop's own Hostinger key (automatic domain records): never on the website either
        try { add(JSON.parse(store.get(HOSTINGER_ITEM) || 'null')?.token); } catch { /* none */ }
        return out;
    }
    /** The website's public data, from SQLite (publicData/: internal -> public, checked). */
    const publicData = ({ now, preview = false } = {}) => buildPublicData(api, { now, preview, info: read().publicInfo, secrets: secrets() });

    // Create Website / Update website (publish/deployer.js)
    const ping = (url) => publishPing.ping(url, { fetch: publish.fetch });
    const deployer = createDeployer({
        github: {
            client,
            keys: () => {
                if (!connector.linked()) return null;
                const k = connector.token();
                return k?.token ? { token: k.token, login: read().accounts.github.login || k.login, scopes: k.scopes || [] } : null;
            },
        },
        cloudflare: { client: cfClient, access: () => cf.access(), linked: () => cf.linked() },
        store,
        read,
        write: (next) => { if (!blockedMode()) write(next); },
        snapshot: () => publicData(),
        checkFiles: (files, data) => checkSiteFiles(api, files, { data, secrets: secrets() }),
        theme: (id) => registry.get(id),
        readImage: publish.readImage,
        shopName,
        workerSource: (publish.workerSource || WORKER_SOURCE)(),
        schemaSql: (publish.schemaSql || SCHEMA_SQL)(),
        ping,
        now: publish.now,
        sleep: publish.sleep,
        waits: publish.waits,
        log: publish.log,
    });

    // The shop's own domain (optional): bought by the shop at a provider, connected to the website
    /** Update website now; a run already going (built before this change): one more right after it. */
    const startUpdate = () => {
        if (!read().publishedAt || blockedMode()) return { started: false, reason: 'not_published' };
        const r = deployer.start();
        if (!r.started && r.reason === 'running') {
            deployer.pending().then(() => deployer.start()).catch(() => {});
            return { started: true, queued: true };
        }
        return r;
    };
    const domains = createDomainManager({
        read,
        // The website value of the open shop (the demo shop's own in the demo): every step that goes online is blocked there
        write,
        github: {
            client,
            keys: () => {
                if (!connector.linked()) return null;
                const k = connector.token();
                return k?.token ? { token: k.token } : null;
            },
        },
        lookup: domain.lookup || createLookup({ fetch: domain.fetch || publish.fetch }),
        providers: domainProviders.loadProviders(domain.providers, { log: publish.log }),
        startUpdate,
        ping: (url) => publishPing.ping(url, { fetch: domain.fetch || publish.fetch }),
        openExternal: domain.openExternal || (async () => {}),
        now: domain.now,
        log: publish.log,
        blocked: () => !!blockedMode(),
        codedError,
        // The shop's own Hostinger account (optional): its key in the secure store, main process only
        hostinger: {
            client: domain.hostinger || createHostingerClient({ fetch: domain.fetch || publish.fetch }),
            vault: { get: () => store.get(HOSTINGER_ITEM), set: (v) => store.set(HOSTINGER_ITEM, v), remove: () => store.remove(HOSTINGER_ITEM) },
        },
    });

    /** The Cloudflare account as shown: "connected" only while its keys are really kept here; no account id. */
    function cloudflareView(account) {
        const { accountId: _hidden, ...shown } = account;
        if (account.status === 'connected' && !cf.linked()) {
            return { ...shown, status: 'failed', connectedAt: null, error: 'token_missing', connected: false };
        }
        return { ...shown, connected: account.status === 'connected' };
    }

    /** The GitHub account as shown: "connected" only while its key is really kept here. */
    function githubView(account) {
        if (account.status === 'connected' && !connector.linked()) {
            return { ...account, status: 'failed', connectedAt: null, error: 'token_missing', connected: false };
        }
        return { ...account, connected: account.status === 'connected' };
    }

    /** What Create Website needs, as the screen shows it. */
    function requirements(s) {
        const keys = connector.linked() ? connector.token() : null;
        return {
            github: !!keys?.token && canPublishPages(keys.scopes || []),
            // Linked before this version (without the right to switch GitHub Pages on): link again
            githubPermission: !!keys?.token && !canPublishPages(keys.scopes || []),
            cloudflare: cf.linked(),
            theme: !!registry.get(s.theme),
        };
    }

    /** Everything the screen shows (no key, no token, no device code, no name or id of what was made). */
    function view() {
        const saved = read();
        // A run stopped by closing the program is not running any more
        const deploy = saved.deploy.status === 'running' && !deployer.running()
            ? { ...saved.deploy, status: 'failed', reason: 'interrupted', steps: saved.deploy.steps.map(x => (x.status === 'running' ? { ...x, status: 'failed', reason: 'interrupted' } : x)) }
            : saved.deploy;
        const { resources: _made, repository: _repo, affiliateRef: _ref, ...shown } = saved;
        const s = { ...shown, deploy, accounts: { github: githubView(saved.accounts.github), cloudflare: cloudflareView(saved.accounts.cloudflare) } };
        const blocked = blockedMode();
        const owner = saved.resources.repo?.owner || (saved.accounts.github.status === 'connected' ? saved.accounts.github.login : '');
        return {
            ...s,
            domain: domains.view(),
            site: {
                freeUrl: saved.site.freeUrl || null,
                url: saved.site.url || null, publishedAt: saved.site.publishedAt || null, pending: !!saved.site.pending, summary: saved.site.summary || null,
                // The last update found nothing new (the website kept as it was), and when it looked
                unchanged: !!saved.site.unchanged, checkedAt: saved.site.checkedAt || null,
            },
            // Delivery companies the shop can offer for pick up at their office
            couriersList: COURIERS.map(([id, name]) => ({ id, name })),
            // For the settings tabs: the categories (size guides), the default WhatsApp message
            categoriesList: (() => { try { return api.all('SELECT id, name FROM categories ORDER BY name'); } catch { return []; } })(),
            defaultConfirmMessage: state.CONFIRM_MESSAGE,
            status: state.statusOf(s),
            steps: state.stepsOf(s),
            freeUrl: saved.site.url || state.freeUrl(s.name, owner),
            freeHost: state.FREE_HOST,
            freeOwner: owner || null,
            requirements: requirements(saved),
            canPublish: !blocked && !deployer.running() && !deployer.blocker(),
            hasOrders: !!saved.resources.worker?.url,
            suggestedName: s.created ? s.name : state.suggestName(shopName()),
            providers: providers.describeProviders({ github: !blocked, cloudflare: !blocked, githubSignIn: client.configured, cloudflareSignIn: cfClient.configured }),
            githubFlow: connector.publicFlow(),
            cloudflareFlow: cf.publicFlow(),
            githubBlocked: blocked || null,
            accountsBlocked: blocked || null,
            secureStorage: store.available() && cfStore.available(),
            themes: registry.describe(),
        };
    }

    function create({ name, theme } = {}) {
        const s = read();
        if (s.created) throw codedError('WEBSITE_EXISTS');
        const clean = String(name || '').trim().toLowerCase();
        if (!state.isValidName(clean)) throw codedError('WEBSITE_NAME_INVALID', { min: state.NAME_MIN, max: state.NAME_MAX });
        write({ ...s, created: true, name: clean, theme: registry.has(theme) ? registry.resolveId(theme) : s.theme, createdAt: new Date().toISOString(), lastError: null });
        return view();
    }

    /**
     * Change Theme: only the website's look. The theme's name is kept with
     * the website; the shop's data (articles, stock, orders, sales, its
     * SQLite tables) is only read, never changed. Online already and
     * { publish: true }: the website's pages are made again with it and
     * published (Update website: same data, new look).
     */
    function setTheme(theme, { publish = false } = {}) {
        const s = mustExist(read());
        if (!registry.has(theme)) throw codedError('WEBSITE_THEME_UNKNOWN');
        const id = registry.resolveId(theme);
        write({ ...s, theme: id });
        let result = { published: false };
        if (publish && s.publishedAt && !blockedMode() && id !== s.theme) {
            const r = startUpdate();
            result = { published: !!r.started, reason: r.started ? null : r.reason };
        }
        return { ...view(), result };
    }

    /** The check found private data: said plainly (how many places), never what. */
    function withPrivateCheck(fn) {
        try { return fn(); } catch (error) {
            if (error.code === 'WEBSITE_PRIVATE_DATA') throw codedError('WEBSITE_PRIVATE_DATA', { n: error.problems.length });
            throw error;
        }
    }

    // Every page the website publishes can be seen before it is published
    const PAGES = ['home', 'category', 'product', ...Object.keys(STORE_PAGES)];
    /**
     * A page of the website as it would look with a theme (the chosen one when
     * none is given), made from the shop's own data as it is now. Read only:
     * nothing is saved, the theme is not changed. For the preview of the
     * Website screen (shown in a frame without script).
     */
    function previewTheme(args = {}) {
        return withPrivateCheck(() => previewPage(args));
    }
    function previewPage({ theme, page = 'home', id = null } = {}) {
        const chosen = theme === undefined || theme === null ? read().theme : theme;
        const t = registry.get(chosen);
        if (!t) throw codedError('WEBSITE_THEME_UNKNOWN');
        const snapshot = publicData({ preview: true });
        const asked = PAGES.includes(page) ? page : 'home';
        // The store's own pages (new in, best sellers, offers, cart...) are "page" + their name
        const kind = STORE_PAGES[asked] ? 'page' : asked;
        const productId = kind === 'product' ? (snapshot.products.some(p => p.id === id) ? id : (snapshot.products.find(p => p.images.length) || snapshot.products[0])?.id) : id;
        const category = snapshot.categories.some(c => c.id === id) ? id : 'all';
        const html = renderPage({
            snapshot, theme: t, page: kind, id: kind === 'category' ? category : kind === 'page' ? asked : productId,
            lang: snapshot.shop.language, preview: true,
            assetUrl: (path) => `app://${encodeURIComponent(path)}`,
            photoUrl: photoDataUrl,
        });
        return {
            theme: t.id, page: asked, html, products: snapshot.products.length,
            // What the page list of the preview offers (the shop's own categories and articles)
            categories: snapshot.categories.map(c => ({ id: c.id, name: c.name })),
            newProducts: snapshot.newProducts?.length || 0, bestSellers: snapshot.bestSellers?.length || 0,
        };
    }

    /** The name of the free address can change until the website is published. */
    function setName(name) {
        const s = mustExist(read());
        if (s.publishedAt) throw codedError('WEBSITE_NAME_LOCKED');
        const clean = String(name || '').trim().toLowerCase();
        if (!state.isValidName(clean)) throw codedError('WEBSITE_NAME_INVALID', { min: state.NAME_MIN, max: state.NAME_MAX });
        write({ ...s, name: clean });
        return view();
    }

    /**
     * Own domain (optional): the shop's, bought by the shop. Saved, then
     * connected step by step (domain/domainManager.js); the free address
     * keeps working until it is ready.
     */
    function setDomain(arg) {
        mustExist(read());
        const { domain: name, source, provider } = typeof arg === 'string' ? { domain: arg } : (arg || {});
        domains.set({ domain: name, source, provider });
        // A first look right away (records may already be there)
        domains.check().catch(() => {});
        return view();
    }

    async function removeDomain() {
        mustExist(read());
        const r = await domains.remove();
        return { ...view(), result: { removed: r.removed, cleanup: r.cleanup } };
    }

    async function domainCheck() {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        await domains.check();
        return view();
    }

    async function domainRetry() {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        await domains.retry();
        return view();
    }

    /** The shop links its own Hostinger account (its API key, checked with Hostinger, kept encrypted here). */
    async function domainHostingerLink({ token } = {}) {
        mustExist(read());
        await domains.hostingerLink({ token });
        return view();
    }
    function domainHostingerForget() {
        mustExist(read());
        domains.hostingerForget();
        return view();
    }
    /** The domain's records written at Hostinger by the program (no table to copy). */
    async function domainHostingerSetup() {
        mustExist(read());
        await domains.hostingerSetup();
        return view();
    }

    /** Domain search for "Buy a new domain" (who sells it, registered or not: a guide). */
    async function domainSearch({ query } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        return domains.search(query);
    }

    /** The provider's page for this domain, with Afus' affiliate link (the shop buys it there, for itself). */
    async function domainOpenBuy(args = {}) {
        mustExist(read());
        return domains.openBuy(args);
    }

    /**
     * Prepare the website from the catalogue as it is now. Published when both
     * accounts are linked (next phases); until then the figures are kept so
     * the shop sees what its website will show.
     */
    async function update({ now = Date.now() } = {}) {
        const s = mustExist(read());
        const figures = summarize(publicData({ now }));
        const ready = connector.linked() && cf.linked();
        write({ ...s, lastUpdate: { at: new Date(now).toISOString(), ...figures, published: false }, lastError: null });
        return { ...view(), result: { published: false, reason: ready ? 'publisher_not_available' : 'accounts', figures } };
    }

    /**
     * Link GitHub: GitHub's sign-in page opens in the browser with a short
     * code; the program waits in the background (the window asks for the
     * state while githubFlow is set). result: { started, reason?, flow? }
     */
    async function githubStart() {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_GITHUB_BLOCKED');
        const result = await connector.start();
        return { ...view(), result };
    }

    /**
     * Link GitHub with a key the shop made on GitHub's page (classic
     * personal access token with "repo"). The key is checked with GitHub and
     * kept encrypted; it never comes back to the window.
     * result: { linked } | { linked: false, reason }
     */
    async function githubConnectToken({ token } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_GITHUB_BLOCKED');
        const result = await connector.connectWithToken(token);
        return { ...view(), result };
    }

    function githubCancel() {
        connector.cancel();
        return view();
    }

    /** Forget the key on this computer (GitHub's page lets the shop withdraw it there too). */
    function githubDisconnect() {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_GITHUB_BLOCKED');
        connector.disconnect();
        return view();
    }

    /** Is the key still accepted by GitHub? (on opening the screen) */
    async function githubCheck() {
        if (blockedMode() || !read().created) return { ...view(), result: { checked: false } };
        const result = await connector.check();
        return { ...view(), result };
    }

    /** GitHub's page of the sign-in in progress, opened again (the address comes from GitHub). */
    function githubFlowPage() {
        return connector.publicFlow()?.verificationUri || null;
    }

    /**
     * The website's repository on the shop's GitHub account, made by the
     * program from the address name (<name>-website, then -2, -3... when
     * the name is taken by another repository of the account). Kept in the
     * website value; made again if it was deleted on GitHub. Main process
     * only (the publishing phase calls it): not a window channel.
     */
    async function ensureRepository() {
        const s = mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_GITHUB_BLOCKED');
        const kept = connector.linked() ? connector.token() : null;
        if (!kept?.token) throw codedError('WEBSITE_GITHUB_NOT_CONNECTED');
        const owner = s.accounts.github.login;
        try {
            if (s.repository) {
                const [repoOwner, repoName] = s.repository.fullName.split('/');
                const found = await client.getRepository(kept.token, repoOwner, repoName);
                if (found) return found;
            }
            const base = state.repositoryName(s.name);
            for (let i = 1; i <= REPO_TRIES; i++) {
                const name = i === 1 ? base : `${base}-${i}`;
                const made = await client.createRepository(kept.token, { name, description: `${shopName() || s.name} — website (Afus Boutique)` });
                if (made.exists) continue;
                const now = read();
                write({ ...now, repository: { fullName: made.fullName || `${owner}/${name}`, htmlUrl: made.htmlUrl, defaultBranch: made.defaultBranch, createdAt: new Date().toISOString() } });
                return made;
            }
            throw codedError('WEBSITE_GITHUB_REPO_FAILED');
        } catch (error) {
            if (error.reason === 'revoked') connector.revoked();
            if (error.reason) throw codedError('WEBSITE_GITHUB_REPO_FAILED');
            throw error;
        }
    }

    /**
     * Link Cloudflare: Cloudflare's sign-in page opens in the browser; the
     * browser comes back to the program by itself. result: { started, reason? }
     */
    async function cloudflareStart() {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        const result = await cf.start();
        return { ...view(), result };
    }

    /**
     * Link Cloudflare with an API token the shop made on Cloudflare's page
     * (Workers Scripts edit, D1 edit, Account Settings read). Checked with
     * Cloudflare and kept encrypted; it never comes back to the window.
     * result: { linked } | { linked: false, reason } (choose_account: several accounts)
     */
    async function cloudflareConnectToken({ token } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        const result = await cf.connectWithToken(token);
        return { ...view(), result };
    }

    /** The provider's own page where the shop makes its key (already filled in). */
    function tokenPage(provider) {
        if (provider === 'github') return connector.tokenPageUrl;
        if (provider === 'cloudflare') return cf.tokenPageUrl();
        return null;
    }
    /** The provider's own page to open a free account. */
    function signupPage(provider) {
        if (provider === 'github') return client.signupUrl || null;
        if (provider === 'cloudflare') return cfClient.signupUrl || null;
        return null;
    }

    function cloudflareCancel() {
        cf.cancel();
        return view();
    }

    /** Several accounts allowed on Cloudflare's page: the one for the website. */
    async function cloudflareChoose(accountId) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        const result = await cf.chooseAccount(String(accountId || ''));
        return { ...view(), result };
    }

    /** Withdraw the access at Cloudflare and forget it here. */
    function cloudflareDisconnect() {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        cf.disconnect();
        return view();
    }

    /** Still accepted, still able to reach Workers and D1? (on opening the screen) */
    async function cloudflareCheck() {
        if (blockedMode() || !read().created) return { ...view(), result: { checked: false } };
        const result = await cf.check();
        return { ...view(), result };
    }

    /**
     * The key and the account for making the Worker and the D1 database
     * (next phases). Main process only: not a window channel.
     */
    async function cloudflareAccess() {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        try {
            return await cf.access();
        } catch (error) {
            if (error.reason === 'not_connected' || error.reason === 'revoked') throw codedError('WEBSITE_CLOUDFLARE_NOT_CONNECTED');
            throw codedError('WEBSITE_CLOUDFLARE_FAILED');
        }
    }

    /**
     * Create Website (and Update website, the same run): on the shop's own
     * accounts, in the background; the screen follows deploy.steps.
     */
    function publishSite() {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        const result = deployer.start();
        return { ...view(), result };
    }

    /**
     * What the owner writes for the website only: opening hours (one line
     * each), Facebook / Instagram / TikTok pages, a map link. Cleaned: a link
     * to another site is dropped. The shop's other data is not touched.
     */
    function setPublicInfo(info = {}) {
        const s = mustExist(read());
        // The features have their own card: kept as they are
        const clean = publicInfo({ features: s.publicInfo?.features, ...info });
        write({ ...s, publicInfo: clean });
        const refused = ['facebook', 'instagram', 'tiktok'].filter(k => String(info.social?.[k] || '').trim() && !clean.social[k]);
        if (String(info.mapUrl || '').trim() && !clean.mapUrl) refused.push('mapUrl');
        return { ...view(), result: { refused } };
    }

    /**
     * What the website offers (Website screen › Features): the order form on
     * the article's page, WhatsApp, the cart, home / courier office delivery,
     * the note, the trust strip. On the website at the next update.
     */
    function setFeatures(features = {}) {
        const s = mustExist(read());
        // Only true / false of known switches; anything else leaves the saved value as it is
        const asked = Object.fromEntries(Object.entries(features || {}).filter(([k, v]) => k in FEATURES && typeof v === 'boolean'));
        const clean = publicInfo({ ...s.publicInfo, features: { ...s.publicInfo?.features, ...asked } });
        write({ ...s, publicInfo: clean });
        return view();
    }

    /**
     * The website's other settings (Website screen › Settings tabs). Public
     * ones (delivery prices, ads / visit measures, size guides, "few left"
     * level) go on the website at the next update; private ones (WhatsApp
     * message, tracking pages, new-order alert) stay in AFUS.
     */
    function setSettings(part = {}) {
        const s = mustExist(read());
        const pub = {};
        for (const k of ['delivery', 'tracking', 'sizeGuides', 'fewLeftAt', 'hero']) if (k in part) pub[k] = part[k];
        const tools = { ...s.tools };
        if ('confirmMessage' in part) tools.confirmMessage = String(part.confirmMessage || '');
        if ('trackingLinks' in part) tools.trackingLinks = part.trackingLinks;
        if ('notify' in part) tools.notify = part.notify === true;
        write({ ...s, publicInfo: publicInfo({ ...s.publicInfo, ...pub }), tools });
        return view();
    }

    /** No more orders from this number (the website's API refuses them after the next sync). */
    function blockPhone({ phone, note = '' } = {}) {
        const s = mustExist(read());
        const key = phoneKey(phone);
        if (!key) throw codedError('WEBSITE_PHONE_INVALID', {});
        const blocked = [...s.tools.blocked.filter(b => b.phone !== key), { phone: key, note: String(note || '').slice(0, 120), at: new Date().toISOString() }];
        write({ ...s, tools: { ...s.tools, blocked } });
        return view();
    }
    function unblockPhone({ phone } = {}) {
        const s = mustExist(read());
        const key = phoneKey(phone);
        write({ ...s, tools: { ...s.tools, blocked: s.tools.blocked.filter(b => b.phone !== key) } });
        return view();
    }
    /** Customers who often send parcels back and never paid one: to think about blocking. */
    function blockSuggestions() {
        const s = read();
        const known = new Set(s.tools.blocked.map(b => b.phone));
        return orderBook.customerStats(api, { limit: 500 })
            .filter(c => c.returned + c.cancelled >= 2 && c.successful === 0 && !known.has(c.phone))
            .map(customerView).slice(0, 50);
    }

    /** The order's WhatsApp message to the customer, from the shop's own words ({name}, {number}...). */
    function confirmMessage({ id } = {}) {
        const s = read();
        const o = orderBook.listOrders(api, { id })[0];
        if (!o) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        const v = orderView(o);
        const lang = (getSetting('store_config') || {}).defaultLanguage === 'fr' ? 'fr' : 'ar';
        const money = (n) => `${Math.round(n).toLocaleString('fr-DZ').replace(/\u202f/g, ' ')} DA`;
        const items = v.items.map(i => `- ${[i.productName, i.color, i.size].filter(Boolean).join(' ')} × ${i.quantity}`).join('\n');
        const place = v.delivery === 'office'
            ? `${lang === 'fr' ? 'Bureau' : 'مكتب'} ${[v.courier?.company, v.commune, v.wilaya].filter(Boolean).join(' - ')}`
            : [v.address, v.commune, v.wilaya].filter(Boolean).join('، ');
        const fill = { name: v.customerName, number: v.number, shop: shopName(), items, total: money(v.toCollect), delivery: place, phone: v.phone };
        const text = (s.tools.confirmMessage || state.CONFIRM_MESSAGE).replace(/\{(name|number|shop|items|total|delivery|phone)\}/g, (_, k) => fill[k] ?? '');
        const digits = phoneKey(v.phone).replace(/^0/, '213');
        return { text, url: `https://wa.me/${digits}?text=${encodeURIComponent(text)}` };
    }

    /** The parcel's tracking number at the courier (typed, or given by Yalidine). */
    function setTracking({ id, number = '', courierState = null } = {}) {
        const n = String(number || '').trim().slice(0, 40);
        if (n && !/^[A-Za-z0-9-]{4,40}$/.test(n)) throw codedError('WEBSITE_TRACKING_INVALID', {});
        if (!orderBook.listOrders(api, { id })[0]) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        api.run('UPDATE website_orders SET tracking_number = ? WHERE id = ?', [n, id]);
        if (courierState !== null) api.run("UPDATE website_orders SET courier_state = ?, courier_state_at = datetime('now') WHERE id = ?", [String(courierState).slice(0, 80), id]);
        return orderView(orderBook.listOrders(api, { id })[0]);
    }

    // Yalidine: the shop's own API id and token, kept encrypted (never shown again)
    const yalidine = couriers.yalidine || createYalidineClient({ fetch: publish.fetch });
    const YALIDINE_ITEM = 'yalidine';
    const yalidineKey = () => { try { return JSON.parse(store.get(YALIDINE_ITEM) || 'null'); } catch { return null; } };
    async function yalidineLink({ id, token, fromWilaya = '' } = {}) {
        const s = mustExist(read());
        const apiId = String(id || '').trim();
        const apiToken = String(token || '').trim();
        if (!/^[A-Za-z0-9_-]{6,128}$/.test(apiId) || !/^[A-Za-z0-9_-]{6,256}$/.test(apiToken)) throw codedError('WEBSITE_COURIER_KEY', {});
        try { await yalidine.check(apiId, apiToken); } catch (e) { throw codedError(e.reason === 'key' ? 'WEBSITE_COURIER_KEY' : 'WEBSITE_COURIER_DOWN', {}); }
        store.set(YALIDINE_ITEM, JSON.stringify({ id: apiId, token: apiToken, fromWilaya: String(fromWilaya || '').slice(0, 60) }));
        write({ ...s, tools: { ...s.tools, yalidine: { linked: true, linkedAt: new Date().toISOString() } } });
        return view();
    }
    function yalidineForget() {
        const s = mustExist(read());
        store.remove(YALIDINE_ITEM);
        write({ ...s, tools: { ...s.tools, yalidine: { linked: false, linkedAt: null } } });
        return view();
    }
    /** Send a confirmed home-delivery order to Yalidine: its tracking number comes back. */
    async function yalidineSend({ id } = {}) {
        const k = yalidineKey();
        if (!k) throw codedError('WEBSITE_COURIER_NOT_LINKED', {});
        const o = orderBook.listOrders(api, { id })[0];
        if (!o) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        const v = orderView(o);
        if (v.delivery !== 'home') throw codedError('WEBSITE_COURIER_HOME_ONLY', {});
        if (v.trackingNumber) throw codedError('WEBSITE_COURIER_SENT', {});
        if (!['confirmed', 'preparing'].includes(v.status)) throw codedError('WEBSITE_COURIER_CONFIRM_FIRST', {});
        let r;
        try { r = await yalidine.createParcel(k.id, k.token, parcelOf(v, { fromWilaya: k.fromWilaya, shopName: shopName() })); } catch (e) { throw codedError(e.reason === 'key' ? 'WEBSITE_COURIER_KEY' : 'WEBSITE_COURIER_DOWN', {}); }
        api.run("UPDATE website_orders SET tracking_number = ?, courier_company = CASE WHEN courier_company = '' THEN 'Yalidine' ELSE courier_company END WHERE id = ?", [r.tracking, id]);
        return orderView(orderBook.listOrders(api, { id })[0]);
    }
    async function yalidineRefresh({ id } = {}) {
        const k = yalidineKey();
        if (!k) throw codedError('WEBSITE_COURIER_NOT_LINKED', {});
        const o = orderBook.listOrders(api, { id })[0];
        if (!o || !o.tracking_number) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        let r;
        try { r = await yalidine.parcelStatus(k.id, k.token, o.tracking_number); } catch (e) { throw codedError(e.reason === 'key' ? 'WEBSITE_COURIER_KEY' : 'WEBSITE_COURIER_DOWN', {}); }
        api.run("UPDATE website_orders SET courier_state = ?, courier_state_at = datetime('now') WHERE id = ?", [r.status, id]);
        return orderView(orderBook.listOrders(api, { id })[0]);
    }

    /**
     * The rules the website's API applies itself (sent at each sync when they
     * changed): numbers refused, coupons (only their hash with the shop's
     * key leaves AFUS), delivery prices.
     */
    function apiConfig(key) {
        const s = read();
        const now = Date.now();
        const coupons = s.publicInfo.features.coupons ? api.all("SELECT * FROM promotions WHERE coupon_code IS NOT NULL AND TRIM(coupon_code) <> ''")
            .filter(p => isPromotionLive(p, now) && ['percentage', 'fixed'].includes(p.type))
            .map(p => ({
                hash: crypto.createHash('sha256').update(`${p.coupon_code.trim().toUpperCase()}|${key}`).digest('hex'),
                type: p.type, value: Number(p.value) || 0, appliesTo: p.applies_to || 'all', ids: parseIds(p.applies_to_ids).map(String),
                minPurchase: Number(p.min_purchase) || 0, endsAt: p.end_date ? String(p.end_date).slice(0, 10) : null, name: String(p.name || '').slice(0, 80),
            })) : [];
        return { blocked: s.tools.blocked.map(b => b.phone), coupons, delivery: s.publicInfo.delivery };
    }

    /** Views per day (the website's counts) and the orders of the same days, by article. */
    function stats({ days = 7 } = {}) {
        const n = Math.min(30, Math.max(1, parseInt(days, 10) || 7));
        const since = new Date(Date.now() + 3600000 - (n - 1) * 86400000).toISOString().slice(0, 10);
        const views = api.all('SELECT day, page, views FROM website_views WHERE day >= ? ORDER BY day', [since]);
        const perDay = {};
        for (const v of views) perDay[v.day] = (perDay[v.day] || 0) + v.views;
        const orders = api.all("SELECT date(received_at, '+1 hour') AS day, COUNT(*) AS n FROM website_orders WHERE date(received_at, '+1 hour') >= ? GROUP BY day", [since]);
        const products = new Map();
        for (const v of views.filter(x => x.page.startsWith('product-'))) {
            const id = v.page.slice(8);
            products.set(id, { id, views: (products.get(id)?.views || 0) + v.views, orders: 0 });
        }
        for (const r of api.all(`SELECT i.product_id AS id, COUNT(DISTINCT i.order_id) AS n FROM website_order_items i JOIN website_orders o ON o.id = i.order_id
                                 WHERE date(o.received_at, '+1 hour') >= ? GROUP BY i.product_id`, [since])) {
            const key = String(r.id).replace(/[^A-Za-z0-9_-]/g, '_');
            const x = products.get(key) || { id: key, views: 0, orders: 0 };
            x.orders = r.n;
            products.set(key, x);
        }
        const names = new Map(api.all('SELECT id, name FROM products').map(p => [String(p.id).replace(/[^A-Za-z0-9_-]/g, '_'), p.name]));
        const list = [...products.values()].map(p => ({ ...p, name: names.get(p.id) || p.id, rate: p.views ? Math.round((p.orders / p.views) * 1000) / 10 : null }))
            .sort((a, b) => b.views - a.views).slice(0, 30);
        const totalViews = Object.values(perDay).reduce((a, b) => a + b, 0);
        const totalOrders = orders.reduce((a, b) => a + b.n, 0);
        return {
            days: n, since, viewsAt: read().tools.viewsAt,
            perDay: Array.from({ length: n }, (_, i) => {
                const day = new Date(Date.parse(`${since}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
                return { day, views: perDay[day] || 0, orders: orders.find(o => o.day === day)?.n || 0 };
            }),
            totalViews, totalOrders, rate: totalViews ? Math.round((totalOrders / totalViews) * 1000) / 10 : null,
            products: list,
        };
    }

    /**
     * Are there changes in Afus Boutique the website does not show yet
     * (articles, prices, pictures, stock, offers, categories, shop details,
     * new in / best sellers)? { outdated: true | false | null (not known) }.
     * Read only: the public data of now against what was last published.
     */
    function changes() {
        const s = read();
        if (!s.created || !s.publishedAt || !s.site.dataHash || blockedMode()) return { outdated: null };
        try {
            return { outdated: dataHash(publicData(), s.theme) !== s.site.dataHash };
        } catch {
            return { outdated: null };
        }
    }

    /** The address was not answering yet after publishing: look again. */
    async function recheckSite() {
        if (blockedMode()) return { ...view(), result: { checked: false } };
        const result = await deployer.recheck().catch(() => ({ checked: false }));
        return { ...view(), result };
    }

    /** An order of the order book as the Website screen shows it. */
    function orderView(o) {
        const items = o.items.map(i => ({
            line: i.line, productId: i.product_id, productName: i.product_name, size: i.size, color: i.color,
            quantity: i.quantity, unitPrice: i.unit_price === null || i.unit_price === undefined ? null : Number(i.unit_price),
            reserved: Number(i.reserved_qty) || 0,
            returnedSellable: Number(i.returned_sellable) || 0, returnedDamaged: Number(i.returned_damaged) || 0,
        }));
        const first = items[0] || {};
        // The price of a line the website sent without one: the article's own, now
        const priced = orderBook.pricedLines(api, o.items);
        const total = priced.reduce((sum, i) => sum + i.price * i.quantity, 0);
        return {
            id: o.id, number: o.number || '', createdAt: o.received_at, status: o.status, statusAt: o.status_at || null, phoneKey: o.phone_key || '',
            total: Math.round(total * 100) / 100, reserved: !!o.reserved, labelPrintedAt: o.label_printed_at || null,
            editable: orderBook.EDITABLE.includes(o.status) && !o.sale_id,
            // The steps it can take now; a returned parcel is checked before anything else
            next: orderBook.nextStatuses(o), returnPending: o.status === 'returned' && !!o.reserved, returnCheckedAt: o.return_checked_at || null,
            moneyReceivedAt: o.money_received_at || null, receipt: o.receipt_number || null,
            productId: first.productId || '', productName: first.productName || '', size: first.size || '', color: first.color || '',
            quantity: items.reduce((n, i) => n + i.quantity, 0),
            customerName: o.customer_name || [o.first_name, o.last_name].filter(Boolean).join(' '), firstName: o.first_name || '', lastName: o.last_name || '',
            phone: o.phone, wilaya: o.wilaya, commune: o.commune, address: o.address, note: o.note, delivery: o.delivery,
            courier: o.delivery === 'office' ? { company: o.courier_company, wilaya: o.office_wilaya, commune: o.office_commune, office: o.courier_office } : null,
            // Delivery price asked of the customer, the coupon, what the courier collects
            deliveryFee: o.delivery_fee === null || o.delivery_fee === undefined ? null : Number(o.delivery_fee),
            coupon: o.coupon_code ? { code: o.coupon_code, discount: Number(o.coupon_discount) || 0 } : null,
            toCollect: Math.round((total - (Number(o.coupon_discount) || 0) + (Number(o.delivery_fee) || 0)) * 100) / 100,
            trackingNumber: o.tracking_number || '', trackingUrl: trackingUrl(o), courierState: o.courier_state || '', courierStateAt: o.courier_state_at || null,
            items,
        };
    }

    /** The courier's own page of the parcel, from the address the owner gave for that company ({number}). */
    function trackingUrl(o) {
        if (!o.tracking_number) return '';
        const company = (o.courier_company || '').toLowerCase();
        const links = read().tools.trackingLinks || {};
        const tpl = Object.entries(links).find(([name]) => name.toLowerCase() === company)?.[1] || links['*'] || '';
        return tpl ? tpl.replace('{number}', encodeURIComponent(o.tracking_number)) : '';
    }

    /**
     * Bring the website's orders into the shop's SQLite.
     *
     *   website -> the shop's Worker -> its D1 (a waiting room) -> here -> SQLite
     *
     * Each page of waiting orders is saved in one SQLite transaction; only
     * then are they acknowledged, and the Worker deletes them from D1. If
     * anything fails (no internet, the API refuses, SQLite cannot save, the
     * ack is lost) nothing is lost: the orders stay in D1 and the next sync
     * takes them again; an order already kept is never added twice (its id).
     * One sync at a time; after a failure the next try waits longer
     * (1, 2, 4 ... 30 minutes), otherwise every 5 minutes.
     */
    const SYNC_EVERY = 5 * 60e3;
    const RETRY_FIRST = 60e3;
    const RETRY_MAX = 30 * 60e3;
    const PAGE = 100;
    let syncing = null;

    function syncOrders({ now = Date.now } = {}) {
        if (!syncing) syncing = runSync(now).finally(() => { syncing = null; });
        return syncing;
    }

    async function runSync(now) {
        const s = read();
        if (!s.created || blockedMode()) return { ok: false, reason: 'blocked' };
        const apiUrl = s.resources.worker?.url;
        const key = deployer.key();
        if (!apiUrl || !key) return { ok: false, reason: 'not_published' };
        const opts = { storeId: deployer.storeId(), fetch: publish.fetch, allowHttp: !!publish.allowHttp };
        let received = 0;
        let waiting = 0;
        let reason = null;
        let legacy = false;
        for (let page = 0; page < 20; page++) {
            // A website published before the waiting room keeps every order: read after the last one kept
            const last = legacy ? api.get('SELECT MAX(received_at) AS at FROM website_orders')?.at : null;
            const since = last ? `${String(last).replace(' ', 'T').slice(0, 19)}.000Z` : undefined;
            const r = await publishPing.fetchOrders(apiUrl, key, { ...opts, limit: PAGE, since });
            if (!r.ok) { reason = r.reason === 'insecure' || r.reason === 'store' || r.reason === 'key' || r.reason === 'busy' ? r.reason : 'network'; break; }
            if (r.legacy && !legacy) { legacy = true; page--; continue; }
            waiting = r.waiting;
            if (!r.orders.length) break;
            // The demo shop opened meanwhile: never into it (nor acknowledged)
            if (blockedMode()) { reason = 'save'; break; }
            let kept;
            try {
                received += orderBook.importOrders(api, r.orders);
                kept = orderBook.knownIds(api, r.orders.map(o => o.id));
            } catch {
                reason = 'save';
                break;
            }
            if (!kept.length) { reason = 'save'; break; }
            if (legacy) { if (r.orders.length < PAGE) break; continue; }
            if (blockedMode()) { reason = 'ack'; break; }
            // Saved: the waiting room may let them go
            const a = await publishPing.ackOrders(apiUrl, key, kept, opts);
            if (!a.ok) { reason = 'ack'; break; }
            waiting = a.waiting;
            if (r.orders.length < PAGE || !waiting) break;
        }
        // The API's own rules (when they changed) and the views of the last days
        if (!reason && !blockedMode()) {
            try {
                const config = apiConfig(key);
                const hash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
                if (hash !== read().tools.configHash) {
                    const c = await publishPing.pushConfig(apiUrl, key, config, opts);
                    if (c.ok) write({ ...read(), tools: { ...read().tools, configHash: hash } });
                }
                const v = await publishPing.fetchViews(apiUrl, key, opts);
                if (v.ok) {
                    api.transaction(() => {
                        for (const row of v.views) {
                            if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !/^[A-Za-z0-9_-]{1,100}$/.test(row.page) || !Number.isInteger(row.views) || row.views < 0) continue;
                            api.run(`INSERT INTO website_views (day, page, views) VALUES (?, ?, ?)
                                     ON CONFLICT(day, page) DO UPDATE SET views = MAX(views, excluded.views)`, [row.day, row.page, row.views]);
                        }
                    });
                    write({ ...read(), tools: { ...read().tools, viewsAt: new Date(now()).toISOString() } });
                }
            } catch { /* the orders are in; the rest comes at the next sync */ }
        }
        const at = new Date(now()).toISOString();
        const prev = read().sync;
        const failures = reason ? prev.failures + 1 : 0;
        const wait = reason ? Math.min(RETRY_MAX, RETRY_FIRST * 2 ** (failures - 1)) : SYNC_EVERY;
        const sync = {
            lastAt: at, lastOkAt: reason ? prev.lastOkAt : at, ok: !reason, reason, failures,
            nextAt: new Date(now() + wait).toISOString(), received, waiting, legacy,
        };
        write({ ...read(), sync });
        return { ok: !reason, reason, received, waiting };
    }

    /** The background sync (main process timer): only when it is time. */
    function syncIfDue({ now = Date.now } = {}) {
        const s = read();
        if (!s.created || blockedMode() || !s.resources.worker?.url) return Promise.resolve({ ok: false, reason: 'idle' });
        if (s.sync.nextAt && now() < Date.parse(s.sync.nextAt)) return Promise.resolve({ ok: false, reason: 'later' });
        return syncOrders({ now });
    }

    const customerView = (c) => ({
        phone: c.phone, name: c.name || '', orders: c.orders, delivered: c.delivered, returned: c.returned,
        cancelled: c.cancelled, successful: c.successful, total: c.total, lastAt: c.lastAt,
    });

    /**
     * The website's orders kept in AFUS (after bringing the new ones), each
     * with its customer's figures (by phone). Shown without internet too.
     */
    async function orders({ status = null } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        const r = await syncOrders();
        const list = orderBook.listOrders(api, { status }).map(orderView);
        const stats = Object.fromEntries(orderBook.customerStats(api, { phones: list.map(o => o.phoneKey) }).map(c => [c.phone, customerView(c)]));
        for (const o of list) o.customer = stats[o.phoneKey] || null;
        const sync = read().sync;
        const counts = orderBook.statusCounts(api);
        if (r.reason === 'not_published' && !list.length && !status) return { ok: false, reason: 'not_published', orders: [], sync, counts };
        return { ok: true, synced: r.ok, reason: r.ok ? null : r.reason, orders: list, sync, counts };
    }

    const one = (id) => {
        const o = orderBook.listOrders(api, { id: String(id || '') })[0];
        if (!o) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        return o;
    };

    /**
     * The call to the customer: what they confirmed (size, colour, quantity,
     * price of each line; wilaya, commune, address or courier office), then
     * Confirmed: the pieces are put aside, no sale yet.
     */
    function confirmOrder({ id, details } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        one(id);
        const r = orderBook.confirmOrder(api, { id, details, employeeId: currentEmployee()?.id || null, codedError });
        return { order: orderView(r.order) };
    }

    /** Change what the customer confirmed (before the order is on its way). */
    function updateOrder({ id, details } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        one(id);
        return { order: orderView(orderBook.updateDetails(api, { id, details, employeeId: currentEmployee()?.id || null, codedError })) };
    }

    /** The colours / sizes an order line can be changed to (the article's active variants, with what can be sold). */
    function orderChoices({ id } = {}) {
        mustExist(read());
        const o = one(id);
        const lines = {};
        for (const i of o.items) {
            const product = api.get('SELECT has_variants, stock_quantity FROM products WHERE id = ?', [i.product_id]);
            lines[i.line] = {
                variants: product?.has_variants ? api.all(`SELECT color, size, stock_quantity AS stock, price FROM product_variants
                                   WHERE product_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY color, size`, [i.product_id]) : [],
                // What can be sold now, with what this order already put aside
                stock: product && !product.has_variants ? (Number(product.stock_quantity) || 0) + (Number(i.reserved_qty) || 0) : null,
                reserved: Number(i.reserved_qty) || 0,
            };
        }
        const lang = getSetting('store_config')?.defaultLanguage || 'ar';
        return {
            lines,
            wilayas: WILAYAS.map(w => wilayaLabel(w, lang)),
            couriers: [...new Set([...COURIERS.map(c => c[1]), ...o.items.length ? [o.courier_company].filter(Boolean) : []])],
        };
    }

    /** What the shipping label shows (the order with its prices and total). */
    function labelData({ id } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        return orderView(one(id));
    }

    function labelPrinted({ id } = {}) {
        mustExist(read());
        one(id);
        orderBook.markLabelPrinted(api, { id, employeeId: currentEmployee()?.id || null });
        return orderView(one(id));
    }

    /** The returned parcel is in the shop: its pieces checked (sellable back in stock, damaged kept out). */
    function checkReturn({ id, lines } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        one(id);
        return { order: orderView(orderBook.checkReturn(api, { id, lines, employeeId: currentEmployee()?.id || null, codedError })) };
    }

    /** The website's customers (one per phone), most recent first; search by name or phone. AFUS only. */
    function customers({ search = '' } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        return orderBook.customerStats(api, { search: String(search).slice(0, 60) }).map(customerView);
    }

    /** One customer's history: figures and every order with its statuses. */
    function customerHistory({ phone } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        const h = orderBook.customerHistory(api, phone);
        if (!h) throw codedError('WEBSITE_CUSTOMER_NOT_FOUND', {});
        return { ...customerView(h), list: h.list.map(o => ({ ...orderView(o), events: o.events })) };
    }

    /**
     * Where an order is: new, confirmed, preparing, shipped, delivered,
     * money received (then it is one sale in AFUS), cancelled.
     */
    function setOrderStatus({ id, status } = {}) {
        mustExist(read());
        if (blockedMode()) throw codedError('WEBSITE_ACCOUNTS_BLOCKED');
        const r = orderBook.setStatus(api, { id, status, employeeId: currentEmployee()?.id || null, codedError });
        return { order: orderView(r.order), sale: r.sale ? { receipt: r.sale.receipt, total: r.sale.total } : null };
    }

    /** Link an account (the window's "Connect" buttons). */
    async function connect(providerId) {
        mustExist(read());
        if (!providers.getProvider(providerId)) throw codedError('WEBSITE_PROVIDER_UNKNOWN');
        return providerId === 'github' ? githubStart() : cloudflareStart();
    }

    /** What the website would show now (read-only), for the preview figures. */
    function preview({ now = Date.now() } = {}) {
        return withPrivateCheck(() => previewFigures({ now }));
    }
    function previewFigures({ now }) {
        return summarize(publicData({ now }));
    }

    return {
        view, moveContactToShop, create, setTheme, setName, setDomain, removeDomain, update, connect, preview, previewTheme,
        githubStart, githubConnectToken, cloudflareConnectToken, tokenPage, signupPage, githubCancel, githubDisconnect, githubCheck, githubFlowPage, ensureRepository,
        publishSite, recheckSite, orders, customers, customerHistory, confirmOrder, updateOrder, orderChoices, labelData, labelPrinted, syncOrders, syncIfDue, setOrderStatus, checkReturn, setPublicInfo, setFeatures, setSettings, blockPhone, unblockPhone, blockSuggestions, confirmMessage, setTracking,
        yalidineLink, yalidineForget, yalidineSend, yalidineRefresh, stats, apiConfig, changes,
        domainCheck, domainRetry, domainSearch, domainOpenBuy, domainHostingerLink, domainHostingerForget, domainHostingerSetup, domainCheckIfDue: () => domains.checkIfDue(),
        publishPending: () => deployer.pending(),
        cloudflareStart, cloudflareCancel, cloudflareChoose, cloudflareDisconnect, cloudflareCheck, cloudflareAccess,
        cloudflareFlowPage: () => cf.flowUrl(),
        cloudflareManageUrl: () => cfClient.manageUrl,
        cloudflareDashBase: () => cfClient.dashBase,
        githubManageUrl: () => client.manageUrl,
        githubClientBase: () => client.webBase,
        // For tests: the background wait of a GitHub sign-in in progress
        githubPending: () => connector.pending(),
        cloudflarePending: () => cf.pending(),
    };
}

module.exports = { createWebsiteService, KEY };
