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
 *         blockedMode() -> 'demo' | 'training' | null,
 *         currentEmployee() -> the employee logged in (who changes an order's status) }
 */
const state = require('./websiteState');
const providers = require('./providers');
const { summarize } = require('./catalogSnapshot');
const { buildPublicData, checkSiteFiles, publicInfo } = require('./publicData');
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
const domainProviders = require('./domain/providers');
const { canPublishPages } = require('./github');
const publishPing = require('./publish/ping');
const orderBook = require('./orders/orderBook');
const { COURIERS } = require('./storefront/couriers');
const { WILAYAS, wilayaLabel } = require('./storefront/wilayas');
const fs = require('fs');
const path = require('path');

// The shop's website API and the tables of its database, uploaded to its own Cloudflare account
const WORKER_SOURCE = () => fs.readFileSync(path.join(__dirname, 'worker', 'worker.mjs'), 'utf8');
const SCHEMA_SQL = () => fs.readFileSync(path.join(__dirname, 'worker', 'schema.sql'), 'utf8');

// Without a GitHub setup (tests of the website alone): nothing can be linked
const NO_STORE = { available: () => false, get: () => null, has: () => false, set: () => { throw Object.assign(new Error('secure storage unavailable'), { reason: 'secure_storage' }); }, remove: () => {} };
const REPO_TRIES = 5;

const KEY = 'website';

function createWebsiteService({ api, getSetting, saveSetting, codedError, github = {}, cloudflare = {}, blockedMode = () => null, publish = {}, domain = {}, currentEmployee = () => null }) {
    const read = () => state.normalizeState(getSetting(KEY));
    const write = (next) => { saveSetting(KEY, next); return next; };
    const shopName = () => (getSetting('store_config') || {}).businessName || '';
    const mustExist = (s) => { if (!s.created) throw codedError('WEBSITE_NOT_CREATED'); return s; };

    // The shop's GitHub account. Its state is saved in the website value;
    // nothing is written while the demo shop or training is open (their
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
    const startUpdate = () => {
        if (!read().publishedAt || blockedMode()) return;
        const r = deployer.start();
        // A run already going (built before the domain changed): one more right after it
        if (!r.started && r.reason === 'running') deployer.pending().then(() => deployer.start()).catch(() => {});
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
            status: state.statusOf(s),
            steps: state.stepsOf(s),
            freeUrl: saved.site.url || state.freeUrl(s.name, owner),
            freeHost: state.FREE_HOST,
            freeOwner: owner || null,
            requirements: requirements(saved),
            canPublish: !blocked && !deployer.running() && !deployer.blocker(),
            hasOrders: !!saved.resources.worker?.url,
            suggestedName: s.created ? s.name : state.suggestName(shopName()),
            providers: providers.describeProviders({ github: client.configured && !blocked, cloudflare: cfClient.configured && !blocked }),
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
            const r = deployer.start();
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
        const clean = publicInfo(info);
        write({ ...s, publicInfo: clean });
        const refused = ['facebook', 'instagram', 'tiktok'].filter(k => String(info.social?.[k] || '').trim() && !clean.social[k]);
        if (String(info.mapUrl || '').trim() && !clean.mapUrl) refused.push('mapUrl');
        return { ...view(), result: { refused } };
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
            items,
        };
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
            // Training or the demo shop opened meanwhile: never into that copy (nor acknowledged)
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
        view, create, setTheme, setName, setDomain, removeDomain, update, connect, preview, previewTheme,
        githubStart, githubCancel, githubDisconnect, githubCheck, githubFlowPage, ensureRepository,
        publishSite, recheckSite, orders, customers, customerHistory, confirmOrder, updateOrder, orderChoices, labelData, labelPrinted, syncOrders, syncIfDue, setOrderStatus, checkReturn, setPublicInfo, changes,
        domainCheck, domainRetry, domainSearch, domainOpenBuy, domainCheckIfDue: () => domains.checkIfDue(),
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
