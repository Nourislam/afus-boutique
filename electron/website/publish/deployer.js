/**
 * Create Website / Update website: everything the shop would otherwise do
 * by hand, on the shop's own GitHub and Cloudflare accounts, in order:
 *
 *   repository  the website's repository on GitHub (named from the address name)
 *   pages       GitHub Pages switched on (the website's address)
 *   database    the shop's D1 database on Cloudflare (order requests, publish
 *               info; no article: the articles stay in Afus Boutique)
 *   worker      the shop's Worker on Cloudflare (its website API), with the
 *               database, a secret key kept on this computer, the address
 *   api         the API answers
 *   data        the catalogue read from the shop's SQLite database (read only)
 *   build       the pages made with the chosen theme
 *   publish     the files put on GitHub as one change
 *   live        GitHub Pages built it and the address answers
 *
 * Every step is safe to run again (what exists is found and used, never made
 * twice): a failed step is fixed by running again, and "Update website" is
 * the same run. The shop sees the steps and the address only; names, ids
 * and keys stay in the main process (the key in the secure store).
 *
 * Update website (once online): the latest SQLite data is read and the pages
 * made again; only what changed is sent (pictures already there are not),
 * as ONE change of the repository: the branch moves to it only when every
 * file is there, so an update that fails leaves the published version
 * online as it was. Nothing new to show: nothing is sent. The Worker is sent
 * again only when its code or settings changed (orders keep coming in
 * during an update). A step stopped by the network is tried again by itself
 * a few times; "Try again" goes on safely from where it stopped.
 *
 * deps: { github: { client, keys() -> { token, login, scopes } | null },
 *         cloudflare: { client, access() -> { token, accountId } },
 *         store, read(), write(next), snapshot(), theme(id), readImage(name),
 *         workerSource, schemaSql, ping, now, sleep, log, waits }
 */
const crypto = require('crypto');
const { canPublishPages } = require('../github');
const { buildSite } = require('./siteBuilder');

/** Columns added to the website's tables after the first websites were made (schema.sql has them). */
const SCHEMA_UPGRADES = [
    "ALTER TABLE orders ADD COLUMN commune TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE orders ADD COLUMN delivery TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE orders ADD COLUMN items TEXT NOT NULL DEFAULT '[]'",
    ...['first_name', 'last_name', 'courier_company', 'office_wilaya', 'office_commune', 'courier_office', 'order_key'].map(c => `ALTER TABLE orders ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`),
];

const STEPS = ['repository', 'pages', 'database', 'worker', 'api', 'data', 'build', 'publish', 'live'];
const KEY_ITEM = 'website-key';
const STORE_ITEM = 'website-store';
const TRIES = 5;
const WAITS = { health: 60000, pages: 240000, site: 120000, every: 4000, retry: 3000 };
// Steps tried again by themselves when the network (or the provider, for a
// moment) failed: each only reads, or writes what it would write again
const RETRY_STEPS = ['pages', 'api', 'data', 'build', 'publish', 'live'];
const RETRIES = 2;
const transient = (e) => e?.reason === 'network' || e?.status === 429 || (Number(e?.status) >= 500);

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
/** What the customer would see, without the time it was read: two equal hashes = nothing to publish. */
function dataHash(snapshot, themeId) {
    const { builtAt: _at, ...rest } = snapshot || {};
    return sha256(JSON.stringify({ theme: themeId, data: rest }));
}

class StepError extends Error {
    constructor(reason) { super(reason); this.reason = reason; }
}

/** A provider's reason word -> the reason shown to the shop. */
function reasonOf(error, provider) {
    const r = error?.reason;
    if (error instanceof StepError) return r;
    if (r === 'network') return 'network';
    if (r === 'secure_storage') return 'secure_storage';
    if (r === 'too_large') return 'too_large';
    // The public-data check found something private: nothing is published
    if (r === 'private_data') return 'private_data';
    if (r === 'revoked' || r === 'not_connected') return `${provider}_revoked`;
    if (r === 'scope') return `${provider}_permission`;
    if (r) return `${provider}_failed`;
    return 'unknown';
}

function createDeployer(deps) {
    const { github, cloudflare, store, read, write, snapshot, theme, readImage = () => null, workerSource, schemaSql, ping, checkFiles = () => {} } = deps;
    const now = deps.now || Date.now;
    const sleep = deps.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
    const log = deps.log || (() => {});
    const waits = { ...WAITS, ...(deps.waits || {}) };
    let job = null;

    const iso = () => new Date(now()).toISOString();
    const patch = (fn) => { const s = read(); write(fn(s)); };
    const setDeploy = (fields) => patch(s => ({ ...s, deploy: { ...s.deploy, ...fields } }));
    const setStep = (id, status, reason = null) => patch(s => ({
        ...s, deploy: { ...s.deploy, steps: s.deploy.steps.map(x => (x.id === id ? { id, status, reason, at: iso() } : x)) },
    }));
    const setResources = (fields) => patch(s => ({ ...s, resources: { ...s.resources, ...fields } }));

    /** Can a run start now? null, or the reason it cannot. */
    function blocker() {
        const s = read();
        if (!s.created) return 'not_created';
        const g = github.keys();
        if (!g?.token) return 'github_missing';
        if (!canPublishPages(g.scopes || [])) return 'github_permission';
        if (!cloudflare.linked()) return 'cloudflare_missing';
        if (!theme(s.theme)) return 'theme_missing';
        return null;
    }

    function shopKey() {
        let key = store.get(KEY_ITEM);
        if (!key) {
            key = crypto.randomBytes(32).toString('hex');
            store.set(KEY_ITEM, key);
        }
        return key;
    }

    /** This shop's own id, sent with the shop key on every call (one shop, one Worker). */
    function storeId() {
        let id = store.get(STORE_ITEM);
        if (!id) {
            id = crypto.randomUUID();
            store.set(STORE_ITEM, id);
        }
        return id;
    }

    const names = (base, suffix) => Array.from({ length: TRIES }, (_, i) => `${base}${suffix}${i ? `-${i + 1}` : ''}`);
    /** <login>.github.io/<repo>/ (what GitHub Pages will give; its own answer is used once known). */
    const pagesGuess = (owner, repo) => (repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${repo.toLowerCase()}/` : `https://${owner.toLowerCase()}.github.io/${repo}/`);

    const run = {
        async repository(ctx) {
            const { token, login } = ctx.github;
            const known = read().resources.repo;
            if (known) {
                const found = await github.client.getRepository(token, known.owner, known.name);
                if (found) { ctx.repo = { owner: found.owner || known.owner, name: found.name || known.name }; return; }
            }
            for (const name of names(read().name, '')) {
                const made = await github.client.createRepository(token, { name, description: `${ctx.shopName} — website (Afus Boutique)` });
                // Taken by another repository of the account: the next name
                if (made.exists) continue;
                ctx.repo = { owner: made.owner || login, name: made.name || name };
                setResources({ repo: ctx.repo });
                patch(s => ({ ...s, repository: { fullName: `${ctx.repo.owner}/${ctx.repo.name}`, htmlUrl: made.htmlUrl || '', defaultBranch: made.defaultBranch || 'main', createdAt: iso() } }));
                return;
            }
            throw new StepError('name_taken');
        },

        async pages(ctx) {
            const { token } = ctx.github;
            const pages = (await github.client.getPages(token, ctx.repo.owner, ctx.repo.name)) || (await github.client.enablePages(token, ctx.repo.owner, ctx.repo.name, { branch: 'main' }));
            ctx.siteUrl = pages?.url || pagesGuess(ctx.repo.owner, ctx.repo.name);
            if (!ctx.siteUrl.endsWith('/')) ctx.siteUrl += '/';
            patch(s => ({ ...s, site: { ...s.site, url: ctx.siteUrl } }));
        },

        async database(ctx) {
            const { token, accountId } = ctx.cf;
            const known = read().resources.database;
            let db = known ? await cloudflare.client.findDatabase(token, accountId, known.name) : null;
            if (!db || (known.id && db.id !== known.id)) db = null;
            if (!db) {
                for (const name of names(read().name, '-db')) {
                    const made = await cloudflare.client.createDatabase(token, accountId, name);
                    if (made.exists) continue;
                    db = made;
                    break;
                }
            }
            if (!db?.id) throw new StepError('name_taken');
            setResources({ database: { id: db.id, name: db.name } });
            // Tables of the website (made once; kept as they are afterwards)
            await cloudflare.client.queryDatabase(token, accountId, db.id, schemaSql);
            // Websites made before the cart: the new columns of orders (already there -> refused, fine)
            for (const sql of SCHEMA_UPGRADES) await cloudflare.client.queryDatabase(token, accountId, db.id, sql).catch(() => null);
            ctx.database = db;
        },

        async worker(ctx) {
            const { token, accountId } = ctx.cf;
            let subdomain = await cloudflare.client.getWorkersSubdomain(token, accountId);
            if (!subdomain) {
                for (const candidate of [read().name, `${read().name}-${crypto.randomBytes(2).toString('hex')}`, `afus-${crypto.randomBytes(3).toString('hex')}`]) {
                    subdomain = await cloudflare.client.createWorkersSubdomain(token, accountId, candidate.slice(0, 50));
                    if (subdomain) break;
                }
            }
            if (!subdomain) throw new StepError('cloudflare_failed');
            let name = read().resources.worker?.name;
            if (!name) {
                for (const candidate of names(read().name, '-api')) {
                    if (!(await cloudflare.client.workerExists(token, accountId, candidate))) { name = candidate; break; }
                }
            }
            if (!name) throw new StepError('name_taken');
            const bindings = [
                { type: 'd1', name: 'DB', database_id: ctx.database.id },
                { type: 'secret_text', name: 'SHOP_KEY', text: shopKey() },
                // This shop's own id: Afus sends it on every call (never another shop's Worker)
                { type: 'plain_text', name: 'STORE_ID', text: storeId() },
                { type: 'plain_text', name: 'SITE_URL', text: ctx.siteUrl },
                { type: 'plain_text', name: 'SHOP_NAME', text: ctx.shopName },
            ];
            // The same code and settings already running: not sent again
            const codeHash = sha256(JSON.stringify({ workerSource, bindings }));
            const known = read().resources.worker;
            ctx.apiUrl = cloudflare.client.workerUrl(name, subdomain);
            if (known?.codeHash === codeHash && known.url === ctx.apiUrl && await cloudflare.client.workerExists(token, accountId, name)) return;
            await cloudflare.client.uploadWorker(token, accountId, name, { module: workerSource, bindings });
            await cloudflare.client.enableWorkersDev(token, accountId, name);
            setResources({ worker: { name, subdomain, url: ctx.apiUrl, codeHash } });
        },

        /** A fresh workers.dev address can take a little while to answer. */
        async api(ctx) {
            const until = now() + waits.health;
            do {
                const r = await ping(`${ctx.apiUrl}/api/health`);
                if (r.ok && r.json?.ok) return 'done';
                await sleep(waits.every);
            } while (now() < until);
            return 'waiting';
        },

        async data(ctx) { ctx.snapshot = snapshot(); },

        async build(ctx) {
            const make = (snap) => buildSite({ snapshot: snap, theme: theme(read().theme), orderUrl: `${ctx.apiUrl}/api/orders`, readImage });
            ctx.site = make(ctx.snapshot);
            // Nothing the customer sees changed: the very files already published (their time kept)
            const last = read().site;
            if (last.contentHash === ctx.site.contentHash && last.builtAt && last.publishedAt) {
                ctx.snapshot = { ...ctx.snapshot, builtAt: last.builtAt };
                ctx.site = make(ctx.snapshot);
            }
            // The pages, catalogue and README hold nothing private (keys, customers, tax numbers...)
            checkFiles(ctx.site.files, ctx.snapshot);
        },

        async publish(ctx) {
            const { token } = ctx.github;
            const r = await github.client.commitFiles(token, ctx.repo.owner, ctx.repo.name, {
                files: ctx.site.files, message: `Website update ${iso().slice(0, 16).replace('T', ' ')} (Afus Boutique)`,
            });
            ctx.commit = r.commit;
            ctx.unchanged = r.changed === false;
            patch(s => ({
                ...s,
                site: {
                    ...s.site, commit: r.commit, hash: ctx.site.hash, contentHash: ctx.site.contentHash, dataHash: dataHash(ctx.snapshot, read().theme),
                    builtAt: ctx.snapshot.builtAt || iso(), summary: ctx.site.summary, unchanged: ctx.unchanged,
                },
            }));
        },

        /** GitHub Pages built the change and the address answers. */
        async live(ctx) {
            const { token } = ctx.github;
            let until = now() + waits.pages;
            let built = false;
            do {
                const p = await github.client.getPages(token, ctx.repo.owner, ctx.repo.name);
                if (p?.url) ctx.siteUrl = p.url.endsWith('/') ? p.url : `${p.url}/`;
                if (p?.status === 'built') { built = true; break; }
                if (p?.status === 'errored') throw new StepError('pages_failed');
                await sleep(waits.every);
            } while (now() < until);
            let answering = false;
            if (built) {
                until = now() + waits.site;
                do {
                    if ((await ping(ctx.siteUrl)).ok) { answering = true; break; }
                    await sleep(waits.every);
                } while (now() < until);
            }
            if (!answering) {
                patch(s => ({ ...s, site: { ...s.site, url: ctx.siteUrl, pending: true } }));
                return 'waiting';
            }
            await markPublished(ctx);
            return 'done';
        },
    };

    async function markPublished(ctx) {
        const at = iso();
        // Already up to date: the website kept as it was (its last update stays the date shown)
        if (ctx.unchanged && read().publishedAt) {
            patch(s => ({ ...s, lastError: null, site: { ...s.site, url: ctx.siteUrl, pending: false, checkedAt: at } }));
            return;
        }
        // What was published, kept with the website too (for the API's health answer)
        try {
            const db = read().resources.database;
            await cloudflare.client.queryDatabase(ctx.cf.token, ctx.cf.accountId, db.id,
                "INSERT INTO site_meta (key, value) VALUES ('published_at', ?1), ('catalog_hash', ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [at, read().site.hash || '']);
        } catch (error) {
            log({ event: 'site_meta_failed', reason: error.reason || 'unknown' });
        }
        patch(s => ({ ...s, publishedAt: at, lastError: null, site: { ...s.site, url: ctx.siteUrl, pending: false, publishedAt: at } }));
    }

    async function execute() {
        const ctx = { shopName: deps.shopName ? deps.shopName() : '' };
        let current = null;
        let provider = 'github';
        try {
            ctx.github = github.keys();
            for (const id of STEPS) {
                current = id;
                setStep(id, 'running');
                // The Cloudflare key is renewed by its connector when it is about to end
                if (['database', 'worker', 'live'].includes(id)) {
                    provider = 'cloudflare';
                    ctx.cf = await cloudflare.access();
                }
                provider = ['repository', 'pages', 'publish', 'live'].includes(id) ? 'github' : 'cloudflare';
                log({ event: 'step', step: id });
                let result;
                for (let attempt = 0; ; attempt++) {
                    try {
                        result = await run[id](ctx);
                        break;
                    } catch (error) {
                        if (!RETRY_STEPS.includes(id) || attempt >= RETRIES || !transient(error)) throw error;
                        log({ event: 'step_retry', step: id, attempt: attempt + 1, status: error.status || null });
                        await sleep(waits.retry * (attempt + 1));
                    }
                }
                setStep(id, result === 'waiting' ? 'waiting' : 'done');
            }
            const waiting = read().deploy.steps.some(x => x.status === 'waiting');
            setDeploy({ status: waiting ? 'waiting' : 'done', finishedAt: iso(), failedStep: null, reason: null });
        } catch (error) {
            const reason = reasonOf(error, provider);
            log({ event: 'step_failed', step: current, reason, status: error.status || null, message: error instanceof StepError || error.reason ? undefined : String(error.message || error).slice(0, 200) });
            setStep(current, 'failed', reason);
            setDeploy({ status: 'failed', finishedAt: iso(), failedStep: current, reason });
            patch(s => ({ ...s, lastError: reason }));
        } finally {
            job = null;
        }
    }

    /** Start a run (in the background). { started } or { started: false, reason }. */
    function start() {
        if (job) return { started: false, reason: 'running' };
        const why = blocker();
        if (why) return { started: false, reason: why };
        patch(s => ({
            ...s,
            lastError: null,
            deploy: { status: 'running', mode: s.publishedAt ? 'update' : 'create', startedAt: iso(), finishedAt: null, failedStep: null, reason: null, steps: STEPS.map(id => ({ id, status: 'pending', reason: null, at: null })) },
        }));
        job = execute();
        return { started: true };
    }

    /** The website was published but its address was not answering yet: look again. */
    async function recheck() {
        const s = read();
        if (job || !s.site?.url || !s.resources.repo) return { checked: false };
        const keys = github.keys();
        if (!keys?.token) return { checked: false };
        const ctx = { github: keys, repo: s.resources.repo, siteUrl: s.site.url };
        const p = await github.client.getPages(keys.token, ctx.repo.owner, ctx.repo.name).catch(() => null);
        if (p?.status !== 'built' || !(await ping(s.site.url)).ok) return { checked: true, live: false };
        ctx.cf = await cloudflare.access();
        await markPublished(ctx);
        patch(st => ({ ...st, deploy: { ...st.deploy, status: 'done', steps: (st.deploy.steps || []).map(x => (x.status === 'waiting' ? { ...x, status: 'done' } : x)) } }));
        return { checked: true, live: true };
    }

    const running = () => !!job;
    const pending = () => job || Promise.resolve();
    const key = () => store.get(KEY_ITEM);
    const forgetKey = () => store.remove(KEY_ITEM);
    const store_ = () => store.get(STORE_ITEM);

    return { start, recheck, running, pending, blocker, key, storeId: store_, forgetKey, STEPS };
}

module.exports = { createDeployer, dataHash, STEPS, KEY_ITEM };
