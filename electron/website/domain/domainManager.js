/**
 * The shop's own domain (optional). The website works on its free address
 * first and keeps working there until the domain is ready.
 *
 *   Buy a new domain:  search -> the provider's affiliate link (the shop
 *                      buys it there, on its own account: the domain is the
 *                      shop's) -> "I bought it" -> connect
 *   I already have one: type it -> connect
 *   Connect:           the records to add at the provider (shown, copyable)
 *                      -> Afus looks by itself every few minutes -> once they
 *                      point to GitHub, the domain is given to the website
 *                      (GitHub Pages) -> GitHub makes its certificate (https)
 *                      -> https required -> the website answers on
 *                      https://<domain>/ -> active
 *
 * Afus never buys, owns or keeps an account for the domain; it only opens
 * the provider's page with Afus' affiliate link and, for connecting, uses
 * the shop's own GitHub. Nothing secret goes to a provider.
 *
 * Automatic records (optional): a shop whose domain is at Hostinger gives
 * its own Hostinger API key once; Afus then writes the records itself (no
 * table to copy) and takes them away when the domain is removed. The key
 * is the shop's, kept encrypted on this computer (vault), used for this
 * domain's DNS records only — never to buy anything.
 *
 * deps: { read, write, github: { client, keys }, lookup, providers,
 *         startUpdate(), running(), ping, openExternal, now, log, blocked,
 *         hostinger: { client, vault: { get, set, remove } } }
 */
const crypto = require('crypto');
const state = require('../websiteState');
const providerKit = require('./providers');
const { recordsFor, checkPointing, apexOf, isApex, GITHUB_A, GITHUB_AAAA, CERT_READY, CERT_FAILED } = require('./connection');

const MINUTE = 60e3;
const EVERY = { dns_needed: 2 * MINUTE, dns_wrong: 2 * MINUTE, connecting: 2 * MINUTE, https_pending: 2 * MINUTE, active: 6 * 60 * MINUTE };
const MAX_CANDIDATES = 8;
// Two looks in a row that do not find GitHub: the domain is taken off the website (free address back)
const MISSES_TO_DETACH = 2;
const CONNECTED = ['connecting', 'https_pending', 'active'];

function createDomainManager(deps) {
    const { read, write, github, lookup, providers = [], ping, log = () => {} } = deps;
    const now = deps.now || Date.now;
    const blocked = deps.blocked || (() => false);
    const iso = () => new Date(now()).toISOString();
    let lastFound = null; // what the domain pointed to at the last look (shown to fix it)
    let checking = null;

    // forName: written only if the domain is still that one (a look that ends after the
    // shop removed or changed the domain never writes on the new one)
    const save = (fields, forName = null) => {
        const s = read();
        if (forName !== null && s.domain.name !== forName) return false;
        write({ ...s, domain: { ...s.domain, ...fields } });
        return true;
    };
    const owner = (s) => s.resources.repo?.owner || '';
    const fail = deps.codedError || ((code, params = {}) => Object.assign(new Error(code), { code, params }));

    /** A random reference of this installation for the affiliate links (no person, no shop data). */
    function subid() {
        const s = read();
        if (s.affiliateRef) return s.affiliateRef;
        const ref = crypto.randomBytes(6).toString('hex');
        write({ ...s, affiliateRef: ref });
        return ref;
    }

    // Hostinger: the shop's own key (vault), and whether the domain is in that account (last look)
    const hostinger = deps.hostinger || null;
    let hostingerOwns = null;
    const hostingerKey = () => {
        try { return JSON.parse(hostinger?.vault.get() || 'null')?.token || null; } catch { return null; }
    };
    // Whether a key is kept, remembered here (the screen asks often: no decryption each time)
    let hostingerLinked = null;
    const isLinked = () => {
        if (hostingerLinked === null) hostingerLinked = !!hostingerKey();
        return hostingerLinked;
    };
    const forgetKey = () => { hostinger.vault.remove(); hostingerLinked = false; hostingerOwns = null; };
    const hostingerView = () => (hostinger ? { linked: isLinked(), owns: hostingerOwns } : null);

    function view() {
        const s = read();
        const d = s.domain;
        const free = s.site.freeUrl || (CONNECTED.includes(d.status) ? null : s.site.url) || null;
        return {
            ...d,
            freeUrl: free,
            records: d.name && owner(s) ? recordsFor(d.name, owner(s)) : [],
            found: d.name ? lastFound : null,
            providers: providers.filter(p => p.enabled).map(providerKit.describe),
            hostinger: hostingerView(),
        };
    }

    /**
     * Domain search: a name ("Boutique Yasmine", "boutique-yasmine") gives
     * that name with each ending the providers sell; a full domain is looked
     * at alone. For each: registered or not (a guide), who sells it, from what price.
     */
    async function search(query) {
        const text = String(query || '').trim().toLowerCase().slice(0, 80);
        const full = /\.[a-z]{2,}$/.test(text) ? state.cleanDomain(text) : '';
        let candidates;
        if (full) {
            candidates = [full];
        } else {
            const name = state.slugify(text).slice(0, 63).replace(/-+$/, '');
            if (!name || name.length < 2) throw fail('WEBSITE_DOMAIN_INVALID');
            const tlds = [...new Set(providers.filter(p => p.enabled).flatMap(p => p.tlds).filter(t => t !== '*'))];
            candidates = (tlds.length ? tlds : ['com']).slice(0, MAX_CANDIDATES).map(t => `${name}.${t}`).map(state.cleanDomain).filter(Boolean);
        }
        const results = await Promise.all(candidates.map(async (domain) => {
            const sellers = providerKit.providersFor(providers, domain);
            const found = await lookup.availability(domain).catch(() => ({ status: 'unknown' }));
            return {
                domain,
                status: found.status,
                providers: sellers.map(p => ({ id: p.id, name: p.name, price: providerKit.priceFor(p, domain) })),
            };
        }));
        return { query: text, results, providersAvailable: providers.filter(p => p.enabled).length };
    }

    /**
     * Open the provider's page for this domain with Afus' affiliate link
     * (in the shop's browser). Kept here: which provider and ending, when.
     */
    async function openBuy({ domain, provider } = {}) {
        if (blocked()) throw fail('WEBSITE_ACCOUNTS_BLOCKED');
        const clean = state.cleanDomain(domain);
        if (!clean) throw fail('WEBSITE_DOMAIN_INVALID');
        const p = providers.find(x => x.id === provider && x.enabled);
        if (!p || !providerKit.providersFor([p], clean).length) throw fail('WEBSITE_DOMAIN_PROVIDER');
        const url = providerKit.affiliateLink(p, clean, { subid: subid() });
        const s = read();
        write({ ...s, domainClicks: [...s.domainClicks, { provider: p.id, tld: providerKit.tldOf(clean, p.tlds), at: iso() }].slice(-50) });
        await deps.openExternal(url);
        log({ event: 'domain_buy_link', provider: p.id });
        return { opened: true, domain: clean, provider: p.id };
    }

    /** The shop's domain (had already, or just bought): saved, then connected step by step. */
    function set({ domain, source = 'own', provider = null } = {}) {
        // Saving the name only (also in the demo shop: nothing goes online from there)
        const s = read();
        const clean = state.cleanDomain(domain);
        if (!clean) throw fail('WEBSITE_DOMAIN_INVALID');
        if (s.domain.name && s.domain.name !== clean && CONNECTED.includes(s.domain.status)) throw fail('WEBSITE_DOMAIN_EXISTS', { domain: s.domain.name });
        const known = providers.some(p => p.id === provider);
        lastFound = null;
        hostingerOwns = null;
        write({
            ...s,
            domain: {
                name: clean, status: 'dns_needed', source: source === 'bought' ? 'bought' : 'own', provider: known ? provider : null,
                reason: s.publishedAt ? null : 'not_published', addedAt: iso(), misses: 0,
            },
        });
        return view();
    }

    /** Take the domain off GitHub Pages (the free address answers again). */
    async function detach(s) {
        const keys = github.keys();
        if (!keys?.token || !s.resources.repo) return;
        await github.client.updatePages(keys.token, s.resources.repo.owner, s.resources.repo.name, { cname: null });
    }

    /** The shop takes the domain off its website: back on the free address. */
    async function remove() {
        // A look going on finishes first (it could otherwise give the old domain to GitHub after this)
        if (checking) await checking.catch(() => {});
        const s = read();
        const was = s.domain;
        if (was.name && CONNECTED.includes(was.status) && !blocked()) {
            try { await detach(s); } catch (error) { throw fail('WEBSITE_DOMAIN_GITHUB', { reason: error.reason || 'unknown' }); }
        }
        // Records Afus wrote at Hostinger: taken away too (nobody else can then point a website at them)
        let cleaned = false;
        if (was.name && was.autoDns === 'hostinger' && hostingerKey() && !blocked()) {
            try {
                await hostinger.client.remove(hostingerKey(), apexOf(was.name), autoRecords(was.name, owner(s)).map(r => ({ name: r.name, type: r.type })));
                cleaned = true;
            } catch (error) {
                log({ event: 'hostinger_cleanup_failed', reason: error.reason || 'unknown' });
            }
        }
        lastFound = null;
        write({ ...read(), domain: { name: '', status: 'none', source: null, provider: null, reason: null, addedAt: null } });
        // The website without the CNAME file, the order service without the domain
        if (was.name && CONNECTED.includes(was.status) && !blocked()) deps.startUpdate();
        // The records at the provider are the shop's: told to take them away (nobody else can use them then)
        return { ...view(), removed: was.name || null, cleaned, cleanup: was.name && owner(s) && !cleaned ? recordsFor(was.name, owner(s)) : [] };
    }

    /** One look: moves the domain on as far as it can go now. */
    async function step() {
        const s = read();
        const d = s.domain;
        if (!d.name || ['none', 'failed'].includes(d.status) || blocked()) return view();
        const keep = (fields) => save(fields, d.name);
        const stillOurs = () => read().domain.name === d.name;
        const keys = github.keys();
        if (!keys?.token) { keep({ reason: 'github_missing', checkedAt: iso() }); return view(); }
        const repo = s.resources.repo;
        if (!s.publishedAt || !repo) { keep({ reason: 'not_published', checkedAt: iso() }); return view(); }
        const pointing = await checkPointing(lookup, d.name, repo.owner);
        if (pointing.state !== 'unknown') lastFound = pointing.found;

        if (['dns_needed', 'dns_wrong'].includes(d.status)) {
            if (!pointing.ok) {
                keep({ status: pointing.state === 'wrong' ? 'dns_wrong' : (pointing.state === 'none' ? 'dns_needed' : d.status), reason: d.reason === 'dns_lost' ? 'dns_lost' : null, checkedAt: iso() });
                return view();
            }
            // It points to GitHub: the domain is given to the website (GitHub sends the free address to it)
            if (!stillOurs()) return view();
            const p = await github.client.updatePages(keys.token, repo.owner, repo.name, { cname: d.name });
            if (p?.refused) { keep({ status: 'failed', reason: 'taken', checkedAt: iso() }); return view(); }
            keep({ status: 'connecting', reason: null, dnsOkAt: iso(), connectedAt: iso(), checkedAt: iso(), misses: 0 });
            // The website with its CNAME file, the order service taking orders from the domain
            deps.startUpdate();
            return view();
        }

        // Connected: still pointing to GitHub?
        if (!pointing.ok && pointing.state !== 'unknown') {
            const misses = (d.misses || 0) + 1;
            if (misses >= MISSES_TO_DETACH) {
                if (!stillOurs()) return view();
                await detach(s);
                keep({ status: 'dns_wrong', reason: 'dns_lost', misses: 0, checkedAt: iso() });
                deps.startUpdate();
                log({ event: 'domain_detached', reason: 'dns_lost' });
                return view();
            }
            keep({ misses, checkedAt: iso() });
            return view();
        }
        let pages = await github.client.getPages(keys.token, repo.owner, repo.name);
        if (!stillOurs()) return view();
        if (pages && pages.cname !== d.name) {
            // Taken off on GitHub meanwhile: given again
            pages = await github.client.updatePages(keys.token, repo.owner, repo.name, { cname: d.name });
            if (pages?.refused) { keep({ status: 'failed', reason: 'taken', checkedAt: iso() }); return view(); }
        }
        if (CERT_FAILED.includes(pages?.certificate)) {
            // No certificate: off the website (the free address stays on https); Try again starts over
            await detach(s);
            keep({ status: 'failed', reason: 'https_failed', checkedAt: iso(), misses: 0 });
            deps.startUpdate();
            return view();
        }
        if (!CERT_READY.includes(pages?.certificate)) { keep({ status: 'https_pending', checkedAt: iso(), misses: 0 }); return view(); }
        if (!pages.httpsEnforced) await github.client.updatePages(keys.token, repo.owner, repo.name, { httpsEnforced: true });
        const answer = await ping(`https://${d.name}/`);
        const answering = answer.ok || (answer.status >= 300 && answer.status < 400);
        if (!answering) { keep({ status: 'https_pending', checkedAt: iso(), misses: 0 }); return view(); }
        const first = d.status !== 'active';
        keep({ status: 'active', reason: null, checkedAt: iso(), misses: 0, ...(first ? { activeAt: iso() } : {}) });
        // Now the main address: the website's links and the order service follow it
        if (first) deps.startUpdate();
        return view();
    }

    /** Look now (the screen's "Check now", or the timer). One look at a time: a new one waits for the one going on, then looks again. */
    async function check() {
        if (checking) return checking.then(() => check());
        checking = step().catch((error) => {
            log({ event: 'domain_check_failed', reason: error.reason || 'unknown', status: error.status || null });
            save({ checkedAt: iso() }, read().domain.name || null);
            return { ...view(), error: error.reason || 'unknown' };
        }).finally(() => { checking = null; });
        return checking;
    }

    /** The timer: a look when it is time for this step. */
    function checkIfDue() {
        const d = read().domain;
        const every = EVERY[d.status];
        if (!d.name || !every || blocked()) return Promise.resolve(null);
        if (d.checkedAt && now() - Date.parse(d.checkedAt) < every) return Promise.resolve(null);
        return check();
    }

    /** A failed domain (refused by GitHub, no certificate): start over. */
    function retry() {
        const d = read().domain;
        if (!d.name) throw fail('WEBSITE_DOMAIN_INVALID');
        save({ status: 'dns_needed', reason: null, misses: 0 });
        return check();
    }

    /** The records Afus writes at the shop's DNS provider, as names inside the domain's zone. */
    function autoRecords(domain, ownerLogin) {
        const target = `${String(ownerLogin || '').toLowerCase()}.github.io.`;
        if (isApex(domain)) {
            return [
                { name: '@', type: 'A', ttl: 300, records: GITHUB_A },
                { name: '@', type: 'AAAA', ttl: 300, records: GITHUB_AAAA },
                { name: 'www', type: 'CNAME', ttl: 300, records: [target] },
            ];
        }
        return [{ name: domain.slice(0, -(apexOf(domain).length + 1)), type: 'CNAME', ttl: 300, records: [target] }];
    }

    /**
     * The shop links its own Hostinger account (an API key it made in hPanel
     * › API). Checked with Hostinger before it is kept: a key Hostinger
     * refuses is not saved. -> { linked, owns } (owns: the domain is in it).
     */
    async function hostingerLink({ token } = {}) {
        if (!hostinger) throw fail('WEBSITE_DOMAIN_PROVIDER');
        if (blocked()) throw fail('WEBSITE_ACCOUNTS_BLOCKED');
        const key = String(token || '').trim();
        if (!/^[A-Za-z0-9._~+/=-]{20,300}$/.test(key)) throw fail('WEBSITE_HOSTINGER_KEY');
        let list;
        try {
            list = await hostinger.client.domains(key);
        } catch (error) {
            throw fail(error.reason === 'revoked' ? 'WEBSITE_HOSTINGER_KEY' : 'WEBSITE_HOSTINGER_FAILED', { reason: error.reason || 'unknown' });
        }
        hostinger.vault.set(JSON.stringify({ token: key, linkedAt: iso() }));
        hostingerLinked = true;
        const d = read().domain;
        hostingerOwns = d.name ? list.some(x => x.domain === apexOf(d.name)) : null;
        log({ event: 'hostinger_linked', domains: list.length });
        return view();
    }

    function hostingerForget() {
        if (!hostinger) return view();
        forgetKey();
        return view();
    }

    /**
     * Set up the domain's records automatically at Hostinger: only its
     * website records (A / AAAA of the domain, www; or the sub-domain's
     * CNAME) are replaced, the others (e-mail...) stay. Checked by Hostinger
     * first. Then the usual looks connect it to the website.
     */
    async function hostingerSetup() {
        if (!hostinger) throw fail('WEBSITE_DOMAIN_PROVIDER');
        if (blocked()) throw fail('WEBSITE_ACCOUNTS_BLOCKED');
        const s = read();
        const d = s.domain;
        const key = hostingerKey();
        if (!key) throw fail('WEBSITE_HOSTINGER_KEY');
        if (!d.name || !['dns_needed', 'dns_wrong'].includes(d.status)) throw fail('WEBSITE_DOMAIN_INVALID');
        if (!owner(s)) throw fail('WEBSITE_NOT_PUBLISHED');
        const zoneName = apexOf(d.name);
        const records = autoRecords(d.name, owner(s));
        try {
            const list = await hostinger.client.domains(key);
            hostingerOwns = list.some(x => x.domain === zoneName);
            // Only a domain of the shop's own Hostinger account
            if (!hostingerOwns) throw fail('WEBSITE_HOSTINGER_NOT_OWNED', { domain: zoneName });
            const current = await hostinger.client.zone(key, zoneName);
            const names = new Set(records.map(r => r.name));
            // What would get in the way: an ALIAS on the domain, addresses where a CNAME goes
            const clash = current.filter(r => names.has(r.name) && (r.type === 'ALIAS' || (records.some(x => x.name === r.name && x.type === 'CNAME') && ['A', 'AAAA'].includes(r.type))));
            await hostinger.client.validate(key, zoneName, records);
            if (clash.length) await hostinger.client.remove(key, zoneName, clash.map(r => ({ name: r.name, type: r.type })));
            await hostinger.client.update(key, zoneName, records);
        } catch (error) {
            if (error.code) throw error;
            if (error.reason === 'revoked') { forgetKey(); throw fail('WEBSITE_HOSTINGER_KEY'); }
            throw fail('WEBSITE_HOSTINGER_FAILED', { reason: error.reason || 'unknown' });
        }
        save({ autoDns: 'hostinger', autoAt: iso() }, d.name);
        log({ event: 'hostinger_records_written', records: records.length });
        // A first look (Hostinger's change takes from a few minutes to spread)
        return check();
    }

    return { view, search, openBuy, set, remove, check, checkIfDue, retry, hostingerLink, hostingerForget, hostingerSetup, CONNECTED };
}

module.exports = { createDomainManager, EVERY, MISSES_TO_DETACH };
