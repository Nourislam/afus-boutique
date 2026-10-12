/**
 * The shop's website, as the shop sees it: its name in the free address, its
 * theme, its own domain (optional) and how far it is (created, accounts
 * linked, published). Pure functions, saved as one JSON value in the
 * settings table (key "website"): no table of its own, nothing about
 * products or sales.
 *
 * Nothing technical is asked from the shop: the repository, the worker, the
 * database and the DNS records are chosen by the program when the accounts
 * are linked (next phases), from the name below.
 */
const { registry, DEFAULT_THEME } = require('./themes/registry');
const { publicInfo } = require('./publicData/public');

// Free address of every shop: GitHub Pages, https://<account>.github.io/<name>/
const FREE_HOST = 'github.io';
const NAME_MIN = 3;
const NAME_MAX = 40;

const DEFAULT_STATE = Object.freeze({
    created: false,
    name: '',
    theme: DEFAULT_THEME,
    createdAt: null,
    // Accounts the website is published with (filled by the providers)
    // GitHub: status not_connected / connected / failed (+ login, reason word);
    // its key is never here (secureStore.js)
    accounts: {
        github: { status: 'not_connected', login: '', connectedAt: null, scopes: [], error: null, errorAt: null },
        // Cloudflare: not_connected / connected / choose_account / failed
        // (+ account name, what it can reach); its keys are never here
        cloudflare: { status: 'not_connected', accountName: '', accountId: '', accounts: [], access: null, connectedAt: null, error: null, errorAt: null },
    },
    // The shop's repository, made by the program (never typed by the shop)
    repository: null, // { fullName, htmlUrl, defaultBranch, createdAt }
    // What Create Website made on the shop's accounts (main process only, never shown)
    resources: {}, // { repo: { owner, name }, database: { id, name }, worker: { name, subdomain, url } }
    // The published website: its address and what was published
    site: {}, // { url, commit, hash, builtAt, publishedAt, pending, summary }
    // What the owner wrote for the website only (opening hours, social links, map)
    publicInfo: { hours: [], social: {}, mapUrl: '', couriers: [] },
    // The last Create Website / Update website run, step by step
    deploy: { status: 'idle', steps: [], startedAt: null, finishedAt: null, failedStep: null, reason: null },
    // Optional own domain: the website always works on the free address first
    domain: { name: '', status: 'none', addedAt: null },
    publishedAt: null,
    // Bringing the website's orders into the shop's SQLite (website/orders + websiteService.syncOrders)
    sync: { lastAt: null, lastOkAt: null, ok: null, reason: null, failures: 0, nextAt: null, received: 0, waiting: 0, legacy: false },
    lastUpdate: null, // { at, products, available, onSale, withImages, categories, published }
    lastError: null,
});

/** A saved value read back with every field present (unknown fields dropped). */
function normalizeState(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const repo = s.repository && typeof s.repository === 'object' && s.repository.fullName ? {
        fullName: String(s.repository.fullName), htmlUrl: String(s.repository.htmlUrl || ''),
        defaultBranch: String(s.repository.defaultBranch || 'main'), createdAt: s.repository.createdAt || null,
    } : null;
    return {
        created: !!s.created,
        name: typeof s.name === 'string' ? s.name : '',
        // An unknown or old theme name reads as a theme that exists (themes/registry.js)
        theme: registry.resolveId(s.theme),
        createdAt: s.createdAt || null,
        accounts: { github: githubAccount(s.accounts?.github), cloudflare: cloudflareAccount(s.accounts?.cloudflare) },
        repository: repo,
        domain: {
            name: typeof s.domain?.name === 'string' ? s.domain.name : '',
            status: s.domain?.name ? (s.domain.status || 'pending') : 'none',
            addedAt: s.domain?.addedAt || null,
        },
        publishedAt: s.publishedAt || null,
        lastUpdate: s.lastUpdate && typeof s.lastUpdate === 'object' ? s.lastUpdate : null,
        lastError: s.lastError || null,
        resources: resourcesOf(s.resources),
        publicInfo: publicInfo(s.publicInfo),
        site: siteOf(s.site),
        deploy: deployOf(s.deploy),
        sync: syncOf(s.sync),
    };
}

const SYNC_REASONS = ['network', 'key', 'busy', 'store', 'insecure', 'save', 'ack'];
function syncOf(x) {
    const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    const at = (v) => (isText(v, 40) ? v : null);
    return {
        lastAt: at(x?.lastAt), lastOkAt: at(x?.lastOkAt), ok: typeof x?.ok === 'boolean' ? x.ok : null,
        reason: SYNC_REASONS.includes(x?.reason) ? x.reason : null, failures: n(x?.failures), nextAt: at(x?.nextAt),
        received: n(x?.received), waiting: n(x?.waiting), legacy: x?.legacy === true,
    };
}

const DEPLOY_STATUSES = ['idle', 'running', 'done', 'failed', 'waiting'];
const STEP_STATUSES = ['pending', 'running', 'done', 'failed', 'waiting'];
const isText = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** What was made on the shop's accounts (names and ids only, no key). */
function resourcesOf(r) {
    const out = {};
    if (isText(r?.repo?.owner, 39) && isText(r?.repo?.name, 100)) out.repo = { owner: r.repo.owner, name: r.repo.name };
    if (isText(r?.database?.id, 64) && isText(r?.database?.name, 64)) out.database = { id: r.database.id, name: r.database.name };
    if (isText(r?.worker?.name, 63) && isText(r?.worker?.subdomain, 63) && isText(r?.worker?.url, 300)) {
        out.worker = { name: r.worker.name, subdomain: r.worker.subdomain, url: r.worker.url };
        // What was uploaded (a hash: the Worker is sent again only when it changes)
        if (isText(r.worker.codeHash, 64)) out.worker.codeHash = r.worker.codeHash;
    }
    return out;
}

function siteOf(x) {
    if (!x || typeof x !== 'object') return {};
    const out = {};
    if (isText(x.url, 300) && /^https?:\/\//.test(x.url)) out.url = x.url;
    for (const key of ['commit', 'hash', 'contentHash', 'dataHash', 'builtAt', 'publishedAt', 'checkedAt']) if (isText(x[key], 100)) out[key] = x[key];
    if (typeof x.pending === 'boolean') out.pending = x.pending;
    // The last update found nothing new to publish (the website kept as it was)
    if (typeof x.unchanged === 'boolean') out.unchanged = x.unchanged;
    if (x.summary && typeof x.summary === 'object') out.summary = Object.fromEntries(Object.entries(x.summary).filter(([, v]) => Number.isFinite(v)));
    return out;
}

function deployOf(d) {
    const steps = Array.isArray(d?.steps) ? d.steps.filter(x => isText(x?.id, 20)).map(x => ({
        id: x.id, status: STEP_STATUSES.includes(x.status) ? x.status : 'pending', reason: isText(x.reason, 40) ? x.reason : null, at: x.at || null,
    })) : [];
    // A run cut by closing the program is not running any more
    const status = DEPLOY_STATUSES.includes(d?.status) ? d.status : 'idle';
    return {
        status, steps,
        // Create website (the first time) or Update website (once it is online)
        mode: d?.mode === 'update' ? 'update' : 'create',
        startedAt: d?.startedAt || null, finishedAt: d?.finishedAt || null,
        failedStep: isText(d?.failedStep, 20) ? d.failedStep : null, reason: isText(d?.reason, 40) ? d.reason : null,
    };
}

const GITHUB_STATUSES = ['not_connected', 'connected', 'failed'];
const GITHUB_REASONS = ['denied', 'expired', 'network', 'scope', 'secure_storage', 'revoked', 'token_missing', 'not_configured', 'unknown'];

/** The GitHub account as saved (an older "connected: true" reads as connected). */
function githubAccount(a) {
    const status = GITHUB_STATUSES.includes(a?.status) ? a.status : (a?.connected ? 'connected' : 'not_connected');
    return {
        status,
        login: typeof a?.login === 'string' ? a.login.slice(0, 39) : '',
        connectedAt: status === 'connected' ? (a?.connectedAt || null) : null,
        scopes: Array.isArray(a?.scopes) ? a.scopes.filter(x => typeof x === 'string').slice(0, 10) : [],
        error: status === 'failed' ? (GITHUB_REASONS.includes(a?.error) ? a.error : 'unknown') : null,
        errorAt: status === 'failed' ? (a?.errorAt || null) : null,
    };
}

const CLOUDFLARE_STATUSES = ['not_connected', 'connected', 'choose_account', 'failed'];
const CLOUDFLARE_REASONS = ['denied', 'expired', 'network', 'scope', 'no_account', 'port_busy', 'secure_storage', 'revoked', 'token_missing', 'not_configured', 'unknown'];
const ACCOUNT_ID = /^[a-f0-9]{32}$/;

/** The Cloudflare account as saved (an older "connected: true" without keys reads as not connected). */
function cloudflareAccount(a) {
    const status = CLOUDFLARE_STATUSES.includes(a?.status) ? a.status : 'not_connected';
    const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    return {
        status,
        accountName: text(a?.accountName, 120),
        accountId: status === 'connected' && ACCOUNT_ID.test(a?.accountId || '') ? a.accountId : '',
        accounts: status === 'choose_account' && Array.isArray(a?.accounts)
            ? a.accounts.filter(x => ACCOUNT_ID.test(x?.id || '')).slice(0, 50).map(x => ({ id: x.id, name: text(x.name, 120) }))
            : [],
        access: a?.access && typeof a.access === 'object' ? { workers: !!a.access.workers, d1: !!a.access.d1 } : null,
        connectedAt: status === 'connected' ? (a?.connectedAt || null) : null,
        error: status === 'failed' ? (CLOUDFLARE_REASONS.includes(a?.error) ? a.error : 'unknown') : null,
        errorAt: status === 'failed' ? (a?.errorAt || null) : null,
    };
}

// Arabic and French letters have no place in an address: Latin letters,
// digits and dashes only
const ACCENTS = { à: 'a', â: 'a', ä: 'a', á: 'a', ç: 'c', é: 'e', è: 'e', ê: 'e', ë: 'e', î: 'i', ï: 'i', í: 'i', ô: 'o', ö: 'o', ó: 'o', ù: 'u', û: 'u', ü: 'u', ú: 'u', ÿ: 'y', ñ: 'n' };

/** "Boutique Yasmine" -> "boutique-yasmine"; '' when nothing Latin is left. */
function slugify(text) {
    return String(text || '').toLowerCase()
        .replace(/[\u0080-￿]/g, (ch) => ACCENTS[ch] || ' ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, NAME_MAX)
        .replace(/-+$/g, '');
}

/** A name for the free address: from the shop's name, or "boutique-xxxx". */
function suggestName(shopName, random = Math.random) {
    const slug = slugify(shopName);
    if (slug.length >= NAME_MIN) return slug;
    return `boutique-${Math.floor(random() * 1e6).toString(36).padStart(4, '0')}`;
}

/** Letters, digits and dashes, 3 to 40, not starting or ending with a dash. */
function isValidName(name) {
    const n = String(name || '');
    return n.length >= NAME_MIN && n.length <= NAME_MAX && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(n) && !n.includes('--');
}

/** "www.Shop.com/" (with or without its protocol) -> "www.shop.com"; '' when it is not a domain. */
function cleanDomain(text) {
    const d = String(text || '').trim().toLowerCase()
        .replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
    const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
    if (!new RegExp(`^(?:${label}\\.)+[a-z]{2,24}$`).test(d) || d.length > 253) return '';
    // The free address is not a domain of one's own
    if (d === FREE_HOST || d.endsWith(`.${FREE_HOST}`)) return '';
    return d;
}

/** The website's free address once published (owner: the GitHub account, when linked). */
const freeUrl = (name, owner) => (name ? `https://${owner ? String(owner).toLowerCase() : '…'}.${FREE_HOST}/${name}/` : '');

// `connected` is set by the service only when the key is really kept here
const githubLinked = (state) => state.accounts.github.connected === true || (state.accounts.github.connected === undefined && state.accounts.github.status === 'connected');
const cloudflareLinked = (state) => state.accounts.cloudflare.connected === true || (state.accounts.cloudflare.connected === undefined && state.accounts.cloudflare.status === 'connected');

/** The website's repository name on the shop's account: from the address name. */
const repositoryName = (name) => name;

/** The four steps shown to the shop, in order. */
function stepsOf(state) {
    return [
        { id: 'created', done: state.created },
        { id: 'github', done: githubLinked(state) },
        { id: 'cloudflare', done: cloudflareLinked(state) },
        { id: 'published', done: !!state.publishedAt },
    ];
}

/**
 * One word for the status card:
 * none (no website yet) - accounts (created, an account to link) -
 * ready (accounts linked, not published yet) - live - error (last update failed)
 */
function statusOf(state) {
    if (!state.created) return 'none';
    // Once online, a run is an update, and a failed one leaves the website as it was
    if (state.deploy?.status === 'running') return state.publishedAt ? 'updating' : 'publishing';
    if (state.lastError) return state.publishedAt ? 'update_failed' : 'error';
    if (state.publishedAt) return 'live';
    if (!githubLinked(state) || !cloudflareLinked(state)) return 'accounts';
    return 'ready';
}

module.exports = {
    FREE_HOST, NAME_MIN, NAME_MAX, DEFAULT_STATE,
    GITHUB_STATUSES, GITHUB_REASONS, CLOUDFLARE_STATUSES, CLOUDFLARE_REASONS, cloudflareAccount,
    normalizeState, githubAccount, repositoryName, slugify, suggestName, isValidName, cleanDomain, freeUrl, stepsOf, statusOf,
};
