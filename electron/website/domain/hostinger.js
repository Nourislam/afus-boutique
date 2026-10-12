/**
 * Hostinger (developers.hostinger.com, its public REST API, checked against
 * its OpenAPI description): the shop's OWN Hostinger account, with an API
 * key the shop makes in hPanel › API and gives to Afus Boutique. Kept
 * encrypted on this computer (secure store), never shown to the window,
 * never sent anywhere but Hostinger's API.
 *
 * Afus uses only what it needs to connect the shop's domain to its website:
 *   GET    /api/domains/v1/portfolio                 the domains of the account (is it the shop's?)
 *   GET    /api/dns/v1/zones/{domain}                its DNS records
 *   POST   /api/dns/v1/zones/{domain}/validate       the new records checked by Hostinger first
 *   PUT    /api/dns/v1/zones/{domain}                the records written (overwrite: only those
 *                                                    of the same name and type are replaced)
 *   DELETE /api/dns/v1/zones/{domain}                the records Afus wrote, taken away
 * Nothing is ever bought, renewed or paid with the key (the purchase API
 * charges the account's payment method: it is never called).
 */

const BASE = 'https://developers.hostinger.com';
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

class HostingerError extends Error {
    constructor(reason, status = null) { super(reason); this.reason = reason; this.status = status; }
}

function createHostingerClient({ fetch: fetchImpl, base = BASE, timeoutMs = 15000 } = {}) {
    const doFetch = fetchImpl || ((u, init) => require('electron').net.fetch(u, init));

    async function call(token, method, path, body) {
        if (!token || typeof token !== 'string') throw new HostingerError('not_connected');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await doFetch(`${base}${path}`, {
                method,
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'AfusBoutique' },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal,
                redirect: 'error',
            });
        } catch {
            throw new HostingerError('network');
        } finally {
            clearTimeout(timer);
        }
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        if (res.status === 401 || res.status === 403) throw new HostingerError('revoked', res.status);
        if (res.status === 404) throw new HostingerError('not_found', res.status);
        if (res.status === 422) throw new HostingerError('refused', res.status);
        if (res.status === 429) throw new HostingerError('busy', res.status);
        if (!res.ok) throw new HostingerError(res.status >= 500 ? 'network' : 'unknown', res.status);
        return data;
    }

    const zonePath = (domain) => {
        const d = String(domain || '').toLowerCase();
        if (!DOMAIN.test(d)) throw new HostingerError('domain');
        return `/api/dns/v1/zones/${encodeURIComponent(d)}`;
    };

    /** The account's domains: [{ domain, status }] (the key works when this answers). */
    async function domains(token) {
        const data = await call(token, 'GET', '/api/domains/v1/portfolio');
        return (Array.isArray(data) ? data : []).filter(d => d && typeof d.domain === 'string')
            .map(d => ({ domain: d.domain.toLowerCase(), status: String(d.status || '') }));
    }

    /** The domain's records: [{ name, type, ttl, records: [content] }]. */
    async function zone(token, domain) {
        const data = await call(token, 'GET', zonePath(domain));
        return (Array.isArray(data) ? data : []).map(r => ({
            name: String(r.name || ''), type: String(r.type || ''), ttl: Number(r.ttl) || null,
            records: (Array.isArray(r.records) ? r.records : []).map(x => String(x?.content || '')),
        }));
    }

    const body = (records) => ({
        overwrite: true,
        zone: records.map(r => ({ name: r.name, type: r.type, ttl: r.ttl, records: r.records.map(content => ({ content })) })),
    });

    /** Checked by Hostinger, nothing written. */
    const validate = (token, domain, records) => call(token, 'POST', `${zonePath(domain)}/validate`, body(records));
    /** Written: the records of the same name and type are replaced, the others (e-mail...) stay. */
    const update = (token, domain, records) => call(token, 'PUT', zonePath(domain), body(records));
    /** These names / types taken away. */
    const remove = (token, domain, filters) => call(token, 'DELETE', zonePath(domain), { filters });

    return { domains, zone, validate, update, remove, BASE: base };
}

module.exports = { createHostingerClient, HostingerError, BASE };
