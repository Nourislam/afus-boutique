/**
 * Domain providers: the companies where a shop can buy its own domain
 * (optional: every website works on its free address first).
 *
 * The domain is bought by the shop, on the shop's own account at the
 * provider, paid by the shop, and it is the shop's: Afus Boutique never buys
 * it, never owns it, never holds an account for it. When the shop buys
 * through the provider's affiliate link, the provider may pay Afus a
 * commission (the provider tracks it with the link's affiliate id); the
 * shop's price is the provider's own.
 *
 *   DomainProvider {
 *     id            short name (a-z, 0-9, -)
 *     name          shown to the shop
 *     tlds          the endings it sells (["com", "net", "shop", ...]); "*": any
 *     affiliateUrl  https link with {domain} (and optionally {name}, {tld},
 *                   {subid}) — the provider's own affiliate link format
 *     pricing       optional: { currency, from: { com: 1450, ... }, note } — a
 *                   "from" price shown as a guide (the provider's page shows the real one)
 *     api           optional: the id of an adapter in ADAPTERS (search, price)
 *                   — none is assumed: without it the affiliate link alone works
 *     enabled       false: kept but not offered
 *   }
 *
 * The list comes from the installer profile (profile.json › domainProviders):
 * Afus fills its own affiliate links there; nothing about a company is
 * guessed in the code. A wrong entry is left out (and said why in the log).
 * Hostinger, for example, once Afus has its affiliate link from the
 * Hostinger affiliate dashboard (the link exactly as the dashboard gives it,
 * with {domain} where the searched name goes):
 *   { "id": "hostinger", "name": "Hostinger", "tlds": ["com", "net", "shop", "store", "online"],
 *     "affiliateUrl": "<the affiliate link from the Hostinger dashboard, with {domain}>" }
 * Connecting a domain bought there does not need this: the shop's own
 * Hostinger key (domain/hostinger.js) writes its records automatically.
 */

const ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const TLD = /^(?:[a-z0-9-]{2,24})(?:\.[a-z0-9-]{2,24})?$/;
const PLACEHOLDERS = ['domain', 'name', 'tld', 'subid'];

/**
 * Adapters for providers that offer an API (availability, price). None is
 * shipped: one is added here only after checking the provider really offers
 * that API, with the shop's own key if it needs one. Shape:
 *   { check(domain, { fetch }) -> { status: 'available'|'taken'|'unknown', price?, currency? } }
 */
const ADAPTERS = {};

/** One provider as written in the profile -> a clean provider, or { error }. */
function cleanProvider(raw) {
    if (!raw || typeof raw !== 'object') return { error: 'not_an_object' };
    const id = String(raw.id || '').trim().toLowerCase();
    if (!ID.test(id)) return { error: 'id' };
    const name = String(raw.name || '').trim().slice(0, 60);
    if (!name) return { error: 'name' };
    const affiliateUrl = String(raw.affiliateUrl || '').trim();
    let host = '';
    try {
        const u = new URL(affiliateUrl.replace(/\{(\w+)\}/g, 'x'));
        if (u.protocol !== 'https:' || u.username || u.password) return { error: 'affiliateUrl' };
        host = u.hostname;
    } catch {
        return { error: 'affiliateUrl' };
    }
    if (!affiliateUrl.includes('{domain}') && !affiliateUrl.includes('{name}')) return { error: 'affiliateUrl' };
    const unknown = [...affiliateUrl.matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => !PLACEHOLDERS.includes(k));
    if (unknown.length) return { error: 'affiliateUrl' };
    // The domain may only fill the query or the path, never the host
    if (/\{\w+\}/.test(affiliateUrl.split('/').slice(0, 3).join('/'))) return { error: 'affiliateUrl' };
    const tlds = (Array.isArray(raw.tlds) ? raw.tlds : []).map(t => String(t).trim().toLowerCase().replace(/^\./, '')).filter(t => t === '*' || TLD.test(t));
    if (!tlds.length) return { error: 'tlds' };
    let pricing = null;
    if (raw.pricing && typeof raw.pricing === 'object') {
        const from = {};
        for (const [tld, price] of Object.entries(raw.pricing.from || {})) {
            const t = String(tld).toLowerCase().replace(/^\./, '');
            if (TLD.test(t) && Number.isFinite(Number(price)) && Number(price) > 0) from[t] = Math.round(Number(price) * 100) / 100;
        }
        const currency = /^[A-Z]{3}$/.test(String(raw.pricing.currency || '')) ? raw.pricing.currency : '';
        if (Object.keys(from).length && currency) pricing = { currency, from, note: String(raw.pricing.note || '').slice(0, 120) };
    }
    const api = typeof raw.api === 'string' && ADAPTERS[raw.api] ? raw.api : null;
    return { provider: { id, name, tlds: [...new Set(tlds)], affiliateUrl, host, pricing, api, enabled: raw.enabled !== false } };
}

/** The providers of the profile (wrong ones left out, ids unique). */
function loadProviders(list, { log = () => {} } = {}) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const r = cleanProvider(raw);
        if (r.error) { log({ event: 'domain_provider_refused', id: String(raw?.id || '').slice(0, 30), reason: r.error }); continue; }
        if (out.some(p => p.id === r.provider.id)) continue;
        out.push(r.provider);
    }
    return out;
}

/** "boutique.com.dz" -> "com.dz" when a provider sells "com.dz", else the last label. */
function tldOf(domain, known = []) {
    const parts = String(domain).split('.');
    const two = parts.slice(-2).join('.');
    return parts.length > 2 && known.includes(two) ? two : parts[parts.length - 1];
}

const sells = (p, tld) => p.enabled && (p.tlds.includes('*') || p.tlds.includes(tld));

/** The providers that sell this domain's ending. */
function providersFor(providers, domain) {
    const known = providers.flatMap(p => p.tlds);
    const tld = tldOf(domain, known);
    return providers.filter(p => sells(p, tld));
}

/**
 * The provider's affiliate link for this domain. The domain is the shop's
 * search (already checked as a domain name); it fills only the link's
 * path or query, encoded. The link must stay on the provider's address.
 */
function affiliateLink(provider, domain, { subid = '' } = {}) {
    const d = String(domain || '').toLowerCase();
    const known = provider.tlds;
    const tld = tldOf(d, known);
    const name = d.slice(0, -(tld.length + 1));
    const url = provider.affiliateUrl
        .replace(/\{domain\}/g, encodeURIComponent(d))
        .replace(/\{name\}/g, encodeURIComponent(name))
        .replace(/\{tld\}/g, encodeURIComponent(tld))
        .replace(/\{subid\}/g, encodeURIComponent(String(subid || '').slice(0, 40)));
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== provider.host) throw new Error('link_host');
    return u.toString();
}

/** What the window may know of a provider (no affiliate id, no template). */
const describe = (p) => ({ id: p.id, name: p.name, tlds: p.tlds, pricing: p.pricing, hasApi: !!p.api });

/** "from" price of this domain's ending at the provider, or null. */
function priceFor(provider, domain) {
    if (!provider.pricing) return null;
    const tld = tldOf(domain, provider.tlds);
    const from = provider.pricing.from[tld];
    return from ? { from, currency: provider.pricing.currency } : null;
}

module.exports = { ADAPTERS, cleanProvider, loadProviders, providersFor, affiliateLink, describe, priceFor, tldOf };
