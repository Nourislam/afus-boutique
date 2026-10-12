/**
 * Two public, read-only looks at a domain, both over https, nothing of the
 * shop sent but the domain name:
 *
 *   availability(domain)  is the name already registered? (RDAP, the public
 *                         registry service: IANA's list says which registry
 *                         answers for each ending). A guide only: the
 *                         provider's page says for sure.
 *   records(name, type)   what the domain points to (DNS over HTTPS, a
 *                         public resolver), to see when the shop's DNS
 *                         records are in place.
 */

const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const DOH = 'https://cloudflare-dns.com/dns-query';
const DAY = 24 * 3600e3;
const MAX_BODY = 2 * 1024 * 1024;
const TYPES = { A: 1, AAAA: 28, CNAME: 5, TXT: 16 };

function createLookup({ fetch: fetchImpl, now = Date.now, timeoutMs = 8000, bootstrapUrl = BOOTSTRAP, dohUrl = DOH } = {}) {
    const doFetch = fetchImpl || ((u, init) => require('electron').net.fetch(u, init));
    let bootstrap = null; // { at, services: [[tlds], [urls]] }

    async function get(url, headers = {}) {
        if (!/^https:\/\//.test(url)) return { status: 0 };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await doFetch(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'AfusBoutique', ...headers }, signal: controller.signal, redirect: 'follow' });
            const text = await res.text();
            if (text.length > MAX_BODY) return { status: 0 };
            let json = null;
            try { json = JSON.parse(text); } catch { json = null; }
            return { status: res.status, json };
        } catch {
            return { status: 0 };
        } finally {
            clearTimeout(timer);
        }
    }

    async function rdapBase(tld) {
        if (!bootstrap || now() - bootstrap.at > DAY) {
            const r = await get(bootstrapUrl);
            if (r.status === 200 && Array.isArray(r.json?.services)) bootstrap = { at: now(), services: r.json.services };
        }
        const entry = (bootstrap?.services || []).find(s => Array.isArray(s?.[0]) && s[0].map(String).map(x => x.toLowerCase()).includes(tld));
        const base = entry?.[1]?.find(u => /^https:\/\//.test(u));
        return base ? (base.endsWith('/') ? base : `${base}/`) : null;
    }

    /** 'taken' | 'available' | 'unknown' (no registry service for this ending, or no answer). */
    async function availability(domain) {
        const d = String(domain || '').toLowerCase();
        const tld = d.split('.').pop();
        const base = await rdapBase(tld);
        if (!base) return { status: 'unknown', reason: 'no_registry' };
        const r = await get(`${base}domain/${encodeURIComponent(d)}`, { Accept: 'application/rdap+json, application/json' });
        if (r.status === 200) return { status: 'taken' };
        if (r.status === 404) return { status: 'available' };
        return { status: 'unknown', reason: r.status ? 'registry' : 'network' };
    }

    /** The DNS answers of this type: ['185.199.108.153', ...] / ['user.github.io'], or null when no answer could be had. */
    async function records(name, type) {
        const r = await get(`${dohUrl}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, { Accept: 'application/dns-json' });
        if (r.status !== 200 || !r.json || typeof r.json.Status !== 'number') return null;
        // NXDOMAIN and others: no records (the name does not point anywhere yet)
        if (r.json.Status !== 0) return [];
        return (Array.isArray(r.json.Answer) ? r.json.Answer : [])
            .filter(a => a.type === TYPES[type])
            .map(a => String(a.data || '').toLowerCase().replace(/^"|"$/g, '').replace(/\.$/, ''));
    }

    return { availability, records };
}

module.exports = { createLookup, BOOTSTRAP, DOH, TYPES };
