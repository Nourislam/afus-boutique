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
 *         blockedMode() -> 'demo' | 'training' | null }
 */
const state = require('./websiteState');
const providers = require('./providers');
const { buildSnapshot, summarize } = require('./catalogSnapshot');
const { createGithubConnector } = require('./githubConnector');
const { createGithubClient } = require('./github');
const { createCloudflareConnector } = require('./cloudflareConnector');
const { createCloudflareClient } = require('./cloudflare');

// Without a GitHub setup (tests of the website alone): nothing can be linked
const NO_STORE = { available: () => false, get: () => null, has: () => false, set: () => { throw Object.assign(new Error('secure storage unavailable'), { reason: 'secure_storage' }); }, remove: () => {} };
const REPO_TRIES = 5;

const KEY = 'website';

function createWebsiteService({ api, getSetting, saveSetting, codedError, github = {}, cloudflare = {}, blockedMode = () => null }) {
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

    /** Everything the screen shows (no key, no token, no device code). */
    function view() {
        const saved = read();
        const s = { ...saved, accounts: { github: githubView(saved.accounts.github), cloudflare: cloudflareView(saved.accounts.cloudflare) } };
        const blocked = blockedMode();
        return {
            ...s,
            status: state.statusOf(s),
            steps: state.stepsOf(s),
            freeUrl: state.freeUrl(s.name),
            freeHost: state.FREE_HOST,
            suggestedName: s.created ? s.name : state.suggestName(shopName()),
            providers: providers.describeProviders({ github: client.configured && !blocked, cloudflare: cfClient.configured && !blocked }),
            githubFlow: connector.publicFlow(),
            cloudflareFlow: cf.publicFlow(),
            githubBlocked: blocked || null,
            accountsBlocked: blocked || null,
            secureStorage: store.available() && cfStore.available(),
            themes: state.WEBSITE_THEMES,
        };
    }

    function create({ name, theme } = {}) {
        const s = read();
        if (s.created) throw codedError('WEBSITE_EXISTS');
        const clean = String(name || '').trim().toLowerCase();
        if (!state.isValidName(clean)) throw codedError('WEBSITE_NAME_INVALID', { min: state.NAME_MIN, max: state.NAME_MAX });
        write({ ...s, created: true, name: clean, theme: theme && state.WEBSITE_THEMES.some(t => t.id === theme) ? theme : s.theme, createdAt: new Date().toISOString(), lastError: null });
        return view();
    }

    function setTheme(theme) {
        const s = mustExist(read());
        if (!state.WEBSITE_THEMES.some(t => t.id === theme)) throw codedError('WEBSITE_THEME_UNKNOWN');
        write({ ...s, theme });
        return view();
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

    /** Own domain (optional). Linked automatically once Cloudflare is linked. */
    function setDomain(domain) {
        const s = mustExist(read());
        const clean = state.cleanDomain(domain);
        if (!clean) throw codedError('WEBSITE_DOMAIN_INVALID');
        write({ ...s, domain: { name: clean, status: 'pending', addedAt: new Date().toISOString() } });
        return view();
    }

    function removeDomain() {
        const s = mustExist(read());
        write({ ...s, domain: { name: '', status: 'none', addedAt: null } });
        return view();
    }

    /**
     * Prepare the website from the catalogue as it is now. Published when both
     * accounts are linked (next phases); until then the figures are kept so
     * the shop sees what its website will show.
     */
    async function update({ now = Date.now() } = {}) {
        const s = mustExist(read());
        const figures = summarize(buildSnapshot(api, { now }));
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
                const made = await client.createRepository(kept.token, { name, description: `${shopName() || s.name} — website (Afus Boutique)`, homepage: state.freeUrl(s.name) });
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

    /** Link an account (the window's "Connect" buttons). */
    async function connect(providerId) {
        mustExist(read());
        if (!providers.getProvider(providerId)) throw codedError('WEBSITE_PROVIDER_UNKNOWN');
        return providerId === 'github' ? githubStart() : cloudflareStart();
    }

    /** What the website would show now (read-only), for the preview figures. */
    function preview({ now = Date.now() } = {}) {
        return summarize(buildSnapshot(api, { now }));
    }

    return {
        view, create, setTheme, setName, setDomain, removeDomain, update, connect, preview,
        githubStart, githubCancel, githubDisconnect, githubCheck, githubFlowPage, ensureRepository,
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
