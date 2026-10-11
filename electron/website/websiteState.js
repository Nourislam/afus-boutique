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
const { WEBSITE_THEMES, DEFAULT_THEME, isTheme } = require('../shared/websiteThemes.mjs');

// Free address of every shop: <name>.<FREE_HOST>. One place to change it.
const FREE_HOST = 'pages.dev';
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
    // Optional own domain: the website always works on the free address first
    domain: { name: '', status: 'none', addedAt: null },
    publishedAt: null,
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
        theme: isTheme(s.theme) ? s.theme : DEFAULT_THEME,
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

const freeUrl = (name) => (name ? `https://${name}.${FREE_HOST}` : '');

// `connected` is set by the service only when the key is really kept here
const githubLinked = (state) => state.accounts.github.connected === true || (state.accounts.github.connected === undefined && state.accounts.github.status === 'connected');
const cloudflareLinked = (state) => state.accounts.cloudflare.connected === true || (state.accounts.cloudflare.connected === undefined && state.accounts.cloudflare.status === 'connected');

/** The website's repository name on the shop's account: from the address name. */
const repositoryName = (name) => `${name}-website`;

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
    if (state.lastError) return 'error';
    if (state.publishedAt) return 'live';
    if (!githubLinked(state) || !cloudflareLinked(state)) return 'accounts';
    return 'ready';
}

module.exports = {
    FREE_HOST, NAME_MIN, NAME_MAX, DEFAULT_STATE, WEBSITE_THEMES,
    GITHUB_STATUSES, GITHUB_REASONS, CLOUDFLARE_STATUSES, CLOUDFLARE_REASONS, cloudflareAccount,
    normalizeState, githubAccount, repositoryName, slugify, suggestName, isValidName, cleanDomain, freeUrl, stepsOf, statusOf,
};
