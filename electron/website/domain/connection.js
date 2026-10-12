/**
 * Connecting the shop's own domain to its website (GitHub Pages).
 *
 * What the shop adds at its domain provider (the "DNS records"), as GitHub
 * documents them for a custom domain:
 *   a main domain (boutique.com):  four A records -> GitHub's addresses,
 *                                  and www -> <owner>.github.io (CNAME)
 *   a sub-domain (shop.boutique.com): one CNAME -> <owner>.github.io
 *
 * The free address keeps working until the domain is ready: Afus gives the
 * domain to GitHub Pages only once its records point to GitHub (GitHub then
 * sends the free address to the domain), so a visitor never lands on a
 * domain that does not answer yet. A domain that stops pointing to GitHub
 * is taken off the website again: back on the free address.
 */

// GitHub Pages' addresses for a main domain (docs.github.com, custom domains)
const GITHUB_A = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const GITHUB_AAAA = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];
// Endings sold under a second level (boutique.com.dz is a main domain)
const SECOND_LEVEL = ['com.dz', 'net.dz', 'org.dz', 'edu.dz', 'gov.dz', 'asso.dz', 'pol.dz', 'art.dz', 'tm.dz', 'soc.dz', 'co.uk', 'org.uk', 'com.tn', 'co.ma', 'com.fr'];
// GitHub's certificate states (REST API, Pages): ready, or failed
const CERT_READY = ['issued', 'uploaded', 'approved'];
const CERT_FAILED = ['errored', 'bad_authz', 'authorization_revoked'];

/** boutique.com -> true; shop.boutique.com -> false; boutique.com.dz -> true. */
function isApex(domain) {
    const parts = String(domain).split('.');
    if (parts.length === 2) return true;
    return parts.length === 3 && SECOND_LEVEL.includes(parts.slice(1).join('.'));
}

/** The records to add at the provider: [{ type, host, value }] (host "@" = the domain itself). */
function recordsFor(domain, owner) {
    const target = `${String(owner || '').toLowerCase()}.github.io`;
    if (isApex(domain)) {
        return [
            ...GITHUB_A.map(value => ({ type: 'A', host: '@', value })),
            { type: 'CNAME', host: 'www', value: target },
        ];
    }
    const host = String(domain).split('.')[0];
    return [{ type: 'CNAME', host, value: target }];
}

/**
 * Does the domain point to the shop's GitHub Pages now?
 * -> { ok, state: 'ok' | 'none' | 'wrong' | 'unknown', found: { a, cname } }
 *   none: nothing yet (just bought, or records not added / not spread yet)
 *   wrong: it points somewhere else (shown so the shop can fix it)
 */
async function checkPointing(lookup, domain, owner) {
    const target = `${String(owner || '').toLowerCase()}.github.io`;
    if (isApex(domain)) {
        const a = await lookup.records(domain, 'A');
        if (a === null) return { ok: false, state: 'unknown', found: {} };
        const ours = a.filter(ip => GITHUB_A.includes(ip));
        const other = a.filter(ip => !GITHUB_A.includes(ip));
        if (!a.length) return { ok: false, state: 'none', found: { a } };
        // Every address must be GitHub's (an old address left would send some visitors elsewhere)
        if (other.length || !ours.length) return { ok: false, state: 'wrong', found: { a } };
        return { ok: true, state: 'ok', found: { a } };
    }
    const cname = await lookup.records(domain, 'CNAME');
    if (cname === null) return { ok: false, state: 'unknown', found: {} };
    if (!cname.length) {
        // Some providers answer with addresses only ("flattened"): GitHub's addresses are fine too
        const a = await lookup.records(domain, 'A');
        if (a && a.length && a.every(ip => GITHUB_A.includes(ip))) return { ok: true, state: 'ok', found: { a } };
        return { ok: false, state: a && a.length ? 'wrong' : 'none', found: { a: a || [] } };
    }
    return cname.includes(target) ? { ok: true, state: 'ok', found: { cname } } : { ok: false, state: 'wrong', found: { cname } };
}

module.exports = { GITHUB_A, GITHUB_AAAA, CERT_READY, CERT_FAILED, isApex, recordsFor, checkPointing };
