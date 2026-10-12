// GitHub (device sign-in, repositories, git data, Pages, the published pages)
// and Cloudflare (OAuth with PKCE, workers.dev, Worker upload, D1) played by
// one local server, for the tests of Create Website. The uploaded Worker is
// really run (its own code), with a D1 database made of sql.js: the test
// goes from Afus Boutique to the published page, the customer's order and
// back.
//
//   const cloud = await startFakeCloud({ scopes, d1Factory });
//   cloud.base           http://127.0.0.1:<port>
//   GitHub:  webBase = base, apiBase = `${base}/api`, Pages at `${base}/pages/<owner>/<repo>/`
//   Cloudflare: dashBase = base, apiBase = `${base}/client/v4`, Workers at `${base}/w/<name>/`
const http = require('http');
const crypto = require('crypto');

const gitSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TYPES = { html: 'text/html; charset=utf-8', json: 'application/json', txt: 'text/plain', md: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

/** A D1 binding over sql.js (prepare / bind / first / all / run, as Workers have it). */
function d1Binding(db) {
    const exec = (sql, args) => {
        const stmt = db.prepare(sql);
        stmt.bind(args.map(a => (a === undefined ? null : a)));
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
    };
    const binding = {
        prepare(sql) {
            let args = [];
            const api = {
                bind(...a) { args = a; return api; },
                async first() { return exec(sql, args)[0] || null; },
                async all() { return { results: exec(sql, args), success: true }; },
                async run() { exec(sql, args); return { success: true, meta: { changes: db.getRowsModified() } }; },
                // For batch(): the statement and its values
                _sql: () => [sql, args],
            };
            return api;
        },
        // As D1: the statements in one transaction, all or nothing
        async batch(statements) {
            db.run('BEGIN');
            try {
                const out = statements.map(st => { const [sql, args] = st._sql(); return { results: exec(sql, args), success: true, meta: { changes: db.getRowsModified() } }; });
                db.run('COMMIT');
                return out;
            } catch (e) {
                db.run('ROLLBACK');
                throw e;
            }
        },
    };
    return binding;
}

/** Statements of a SQL text, run one by one (D1's /query takes several). */
function runSql(db, sql, params) {
    if (params && params.length) {
        const stmt = db.prepare(sql.replace(/\?(\d+)/g, '?'));
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return [{ results: rows, success: true }];
    }
    db.exec(sql);
    return [{ results: [], success: true }];
}

function parseMultipart(body, type) {
    const boundary = /boundary=([^;]+)/.exec(type)?.[1];
    if (!boundary) return null;
    const parts = {};
    const text = body.toString('latin1');
    for (const chunk of text.split(`--${boundary}`)) {
        const [head, ...rest] = chunk.split('\r\n\r\n');
        const name = /name="([^"]+)"/.exec(head || '')?.[1];
        if (!name) continue;
        const value = rest.join('\r\n\r\n').replace(/\r\n$/, '');
        parts[name] = { type: /Content-Type: ([^\r\n]+)/i.exec(head)?.[1] || '', value: Buffer.from(value, 'latin1').toString('utf8') };
    }
    return parts;
}

async function startFakeCloud({ scopes = 'repo', login = 'yasmine-shop', d1Factory, accounts, subdomain = null, pagesBuildPolls = 2 } = {}) {
    const gh = {
        tokens: new Set(), login, scopes, polls: 0, deny: false,
        repos: new Map(), blobs: new Map(), trees: new Map(), commits: new Map(), requests: [], pagesBuildPolls,
        // 'PATCH /git/refs/heads/main' -> { status, times } (times: how many calls fail; none = always)
        refuse: {},
        // Domains another GitHub website already uses (GitHub refuses them); looks before a certificate
        takenDomains: new Set(), certPolls: 2, certFails: false,
        // Content made in a row: at most this many per window, then 403 "secondary rate limit"
        secondary: { max: 8, windowMs: 1000 },
    };
    const cf = {
        tokens: new Set(), codes: new Map(), revoked: [], accounts: accounts || [{ id: 'a'.repeat(32), name: 'Boutique' }],
        subdomain, scripts: new Map(), databases: new Map(), requests: [], refuse: {},
    };
    const cloud = { gh, cf, base: '', requests: [] };

    const treeSha = (entries) => crypto.createHash('sha1').update(JSON.stringify(entries)).digest('hex');
    function commitTree(repo, files, message) {
        const entries = [...files.entries()].map(([path, buf]) => { const sha = gitSha(buf); gh.blobs.set(sha, buf); return { path, type: 'blob', mode: '100644', sha }; }).sort((a, b) => a.path.localeCompare(b.path));
        const tsha = treeSha(entries);
        gh.trees.set(tsha, entries);
        const csha = crypto.createHash('sha1').update(`${tsha}${message}${Math.random()}`).digest('hex');
        gh.commits.set(csha, { tree: tsha, parents: repo.head ? [repo.head] : [], message });
        repo.head = csha;
    }
    const filesOf = (repo) => {
        const c = gh.commits.get(repo.head);
        return new Map((gh.trees.get(c.tree) || []).map(e => [e.path, gh.blobs.get(e.sha)]));
    };

    async function github(req, res, url, body, send) {
        const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
        // As GitHub documents the device flow: a form with the app's client_id
        if (url.pathname.startsWith('/login/') && req.method === 'POST' && (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded') || !new URLSearchParams(body || '').get('client_id'))) {
            return send(400, { error: 'incorrect_client_credentials' });
        }
        if (url.pathname === '/login/device/code') { gh.polls = 0; return send(200, { device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: `${cloud.base}/login/device`, expires_in: 900, interval: 1 }); }
        if (url.pathname === '/login/oauth/access_token') {
            if (++gh.polls < 2) return send(200, { error: 'authorization_pending' });
            if (gh.deny) return send(200, { error: 'access_denied' });
            const t = `gho_fake_${crypto.randomBytes(8).toString('hex')}`;
            gh.tokens.add(t);
            return send(200, { access_token: t, scope: gh.scopes });
        }
        if (!gh.tokens.has(auth)) return send(401, { message: 'Bad credentials' });
        const p = url.pathname.replace(/^\/api/, '');
        // As GitHub: a fine-grained key does not list scopes (no X-OAuth-Scopes header)
        if (p === '/user') return send(200, { login: gh.login, id: 1 }, auth.startsWith('github_pat_') ? {} : { 'x-oauth-scopes': gh.scopes });
        if (p === '/user/repos' && req.method === 'POST') {
            const j = JSON.parse(body || '{}');
            if (gh.repos.has(j.name)) return send(422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] });
            const repo = { name: j.name, owner: gh.login, head: null, pages: null, builtHead: null, buildPolls: 0 };
            gh.repos.set(j.name, repo);
            commitTree(repo, new Map([['README.md', Buffer.from(`# ${j.name}\n`)]]), 'Initial commit');
            return send(201, { id: 7, name: j.name, full_name: `${gh.login}/${j.name}`, html_url: `${cloud.base}/${gh.login}/${j.name}`, default_branch: 'main', private: false, owner: { login: gh.login } });
        }
        const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
        if (!m) return send(404, {});
        const repo = m[1] === gh.login ? gh.repos.get(decodeURIComponent(m[2])) : null;
        if (!repo) return send(404, { message: 'Not Found' });
        const rest = m[3] || '';
        const refused = gh.refuse[`${req.method} ${rest}`];
        if (refused && (refused.times === undefined || refused.times-- > 0)) return send(refused.status, { message: 'refused by test' });
        if (!rest) return send(200, { id: 7, name: repo.name, full_name: `${repo.owner}/${repo.name}`, html_url: '', default_branch: 'main', owner: { login: repo.owner } });
        if (rest === '/git/ref/heads/main') return send(200, { object: { sha: repo.head } });
        let g = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest);
        if (g) { const c = gh.commits.get(g[1]); return c ? send(200, { sha: g[1], tree: { sha: c.tree } }) : send(404, {}); }
        g = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest);
        if (g && req.method === 'GET') { const t = gh.trees.get(g[1]); return t ? send(200, { sha: g[1], tree: t }) : send(404, {}); }
        // As GitHub: content made too fast in a row is refused for a moment (secondary rate limit)
        const tooFast = () => {
            const t = Date.now();
            gh.writes = (gh.writes || []).filter(x => t - x < gh.secondary.windowMs);
            gh.writes.push(t);
            if (gh.writes.length <= gh.secondary.max) return false;
            gh.limited = (gh.limited || 0) + 1;
            return true;
        };
        if ((rest === '/git/blobs' || rest === '/git/trees') && req.method === 'POST' && tooFast()) {
            return send(403, { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }, { 'retry-after': '1' });
        }
        if (rest === '/git/blobs' && req.method === 'POST') {
            const buf = Buffer.from(JSON.parse(body).content, 'base64');
            const sha = gitSha(buf);
            gh.blobs.set(sha, buf);
            return send(201, { sha });
        }
        if (rest === '/git/trees' && req.method === 'POST') {
            // As GitHub: an entry gives either the sha of a blob or its text content, not both
            const given = JSON.parse(body).tree;
            if (given.some(e => (e.sha === undefined) === (e.content === undefined))) return send(422, { message: 'Must supply either tree.sha or tree.content' });
            const entries = given.map(e => {
                if (e.content === undefined) return { path: e.path, type: 'blob', mode: e.mode, sha: e.sha };
                const buf = Buffer.from(String(e.content), 'utf8');
                const sha = gitSha(buf);
                gh.blobs.set(sha, buf);
                return { path: e.path, type: 'blob', mode: e.mode, sha };
            });
            if (entries.some(e => !gh.blobs.has(e.sha))) return send(422, { message: 'tree.sha is not a valid blob' });
            entries.sort((a, b) => a.path.localeCompare(b.path));
            const sha = treeSha(entries);
            gh.trees.set(sha, entries);
            return send(201, { sha });
        }
        if (rest === '/git/commits' && req.method === 'POST') {
            const j = JSON.parse(body);
            if (!gh.trees.has(j.tree) || j.parents[0] !== repo.head) return send(422, {});
            const sha = crypto.createHash('sha1').update(`${j.tree}${j.message}${Math.random()}`).digest('hex');
            gh.commits.set(sha, { tree: j.tree, parents: j.parents, message: j.message });
            return send(201, { sha });
        }
        if (rest === '/git/refs/heads/main' && req.method === 'PATCH') {
            const j = JSON.parse(body);
            if (!gh.commits.has(j.sha) || gh.commits.get(j.sha).parents[0] !== repo.head) return send(422, { message: 'not a fast forward' });
            repo.head = j.sha;
            repo.buildPolls = 0;
            return send(200, { object: { sha: j.sha } });
        }
        if (rest === '/pages') {
            // GitHub's documented rule: the repo scope for an OAuth app
            if (!gh.scopes.split(/[\s,]+/).includes('repo')) return send(403, { message: 'Resource not accessible by integration' });
            if (req.method === 'POST') {
                if (repo.pages) return send(409, { message: 'already enabled' });
                repo.pages = { url: `${cloud.base}/pages/${repo.owner}/${repo.name}/` };
                return send(201, { html_url: repo.pages.url, status: null });
            }
            if (!repo.pages) return send(404, {});
            if (req.method === 'PUT') {
                // As GitHub: the own domain is written as a CNAME file on the branch (one commit)
                const j = JSON.parse(body || '{}');
                if ('cname' in j) {
                    const cname = j.cname ? String(j.cname).toLowerCase() : null;
                    if (cname && gh.takenDomains.has(cname)) return send(400, { message: 'The CNAME is already taken' });
                    const files = filesOf(repo);
                    if (cname) files.set('CNAME', Buffer.from(cname)); else files.delete('CNAME');
                    commitTree(repo, files, cname ? `Create CNAME` : 'Delete CNAME');
                    repo.pages.cname = cname;
                    repo.pages.certPolls = 0;
                    repo.pages.https = false;
                }
                if ('https_enforced' in j) {
                    if (j.https_enforced && repo.pages.cert !== 'approved') return send(422, { message: 'The certificate does not exist yet' });
                    repo.pages.https = !!j.https_enforced;
                }
                return send(204, null);
            }
            // A build takes a few looks after each change
            let status = 'built';
            if (repo.builtHead !== repo.head) {
                status = 'building';
                if (++repo.buildPolls >= gh.pagesBuildPolls) { repo.builtHead = repo.head; status = 'built'; }
            }
            let cert = null;
            if (repo.pages.cname) {
                cert = ++repo.pages.certPolls >= gh.certPolls ? (gh.certFails ? 'errored' : 'approved') : 'authorization_pending';
                repo.pages.cert = cert;
            }
            const htmlUrl = repo.pages.cname ? `${repo.pages.https ? 'https' : 'http'}://${repo.pages.cname}/` : repo.pages.url;
            return send(200, { html_url: htmlUrl, status, cname: repo.pages.cname || null, https_enforced: !!repo.pages.https, https_certificate: cert ? { state: cert, domains: [repo.pages.cname] } : undefined });
        }
        return send(404, {});
    }

    async function serveWorker(req, res, url, body) {
        const m = /^\/w\/([^/]+)(\/.*)?$/.exec(url.pathname);
        const script = m && cf.scripts.get(m[1]);
        if (!script || !script.enabled) { res.writeHead(404); return res.end('There is nothing here yet'); }
        if (!script.module) script.module = (await import(`data:text/javascript;base64,${Buffer.from(script.source).toString('base64')}`)).default;
        const env = {};
        for (const b of script.metadata.bindings) {
            if (b.type === 'd1') env[b.name] = d1Binding(cf.databases.get(b.id).db);
            else env[b.name] = b.text;
        }
        const target = `https://${m[1]}.${cf.subdomain}.workers.dev${m[2] || '/'}${url.search}`;
        const headers = new Headers(Object.entries(req.headers).filter(([k]) => !['host', 'connection'].includes(k)));
        headers.set('CF-Connecting-IP', req.socket.remoteAddress || '127.0.0.1');
        const response = await script.module.fetch(new Request(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
        const out = Buffer.from(await response.arrayBuffer());
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(out);
    }

    async function cloudflare(req, res, url, body, send) {
        if (url.pathname === '/oauth2/token') {
            const f = Object.fromEntries(new URLSearchParams(body.toString()));
            const issue = () => { const at = `cf_at_${crypto.randomBytes(6).toString('hex')}`; const rt = `cf_rt_${crypto.randomBytes(6).toString('hex')}`; cf.tokens.add(at); cf.tokens.add(rt); return { access_token: at, refresh_token: rt, expires_in: 3600, scope: 'account-settings.read workers-scripts.write d1.write offline_access' }; };
            if (f.grant_type === 'authorization_code') {
                const c = cf.codes.get(f.code); cf.codes.delete(f.code);
                const ok = c && c.redirectUri === f.redirect_uri && b64url(crypto.createHash('sha256').update(f.code_verifier || '').digest()) === c.challenge;
                return ok ? send(200, issue()) : send(400, { error: 'invalid_grant' });
            }
            if (f.grant_type === 'refresh_token' && cf.tokens.has(f.refresh_token)) { cf.tokens.delete(f.refresh_token); return send(200, issue()); }
            return send(400, { error: 'invalid_grant' });
        }
        if (url.pathname === '/oauth2/revoke') { const f = Object.fromEntries(new URLSearchParams(body.toString())); cf.revoked.push(f.token); cf.tokens.delete(f.token); return send(200, {}); }
        const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
        if (!cf.tokens.has(auth)) return send(401, { success: false });
        const p = url.pathname.replace(/^\/client\/v4/, '');
        if (p === '/accounts') return send(200, { success: true, result: cf.accounts });
        const m = /^\/accounts\/([a-f0-9]{32})(\/.*)$/.exec(p);
        if (!m || !cf.accounts.some(a => a.id === m[1])) return send(403, { success: false });
        const rest = m[2];
        for (const [step, status] of Object.entries(cf.refuse)) if (rest.includes(step)) return send(status, { success: false, errors: [{ message: 'refused by test' }] });
        if (rest === '/workers/subdomain') {
            if (req.method === 'GET') return cf.subdomain ? send(200, { success: true, result: { subdomain: cf.subdomain } }) : send(404, { success: false, errors: [{ code: 10007 }] });
            if (req.method === 'PUT') { cf.subdomain = JSON.parse(body).subdomain; return send(200, { success: true, result: { subdomain: cf.subdomain } }); }
        }
        if (rest === '/workers/scripts' && req.method === 'GET') return send(200, { success: true, result: [...cf.scripts.keys()].map(id => ({ id })) });
        let w = /^\/workers\/scripts\/([a-z0-9-]+)\/settings$/.exec(rest);
        if (w) return cf.scripts.has(w[1]) ? send(200, { success: true, result: {} }) : send(404, { success: false });
        w = /^\/workers\/scripts\/([a-z0-9-]+)\/subdomain$/.exec(rest);
        if (w && req.method === 'POST') { const s = cf.scripts.get(w[1]); if (!s) return send(404, { success: false }); s.enabled = JSON.parse(body).enabled === true; return send(200, { success: true, result: { enabled: s.enabled } }); }
        w = /^\/workers\/scripts\/([a-z0-9-]+)$/.exec(rest);
        if (w && req.method === 'PUT') {
            const parts = parseMultipart(body, req.headers['content-type'] || '');
            const metadata = JSON.parse(parts?.metadata?.value || '{}');
            const mod = parts?.[metadata.main_module];
            if (!mod || !/javascript\+module/.test(mod.type)) return send(400, { success: false, errors: [{ message: 'No such module' }] });
            // As Cloudflare: a D1 binding names its database by "id" (database_id is only the wrangler.toml name)
            for (const b of metadata.bindings || []) if (b.type === 'd1' && (!cf.databases.has(b.id) || 'database_id' in b)) return send(400, { success: false, errors: [{ code: 10021, message: 'binding DB of type d1 must have a valid `id` specified' }] });
            const prev = cf.scripts.get(w[1]);
            cf.scripts.set(w[1], { metadata, source: mod.value, module: null, enabled: prev?.enabled || false, uploads: (prev?.uploads || 0) + 1 });
            return send(200, { success: true, result: { id: w[1] } });
        }
        if (rest.startsWith('/d1/database')) {
            const q = /^\/d1\/database\/([0-9a-f-]+)\/query$/.exec(rest);
            if (q && req.method === 'POST') {
                const d = cf.databases.get(q[1]);
                if (!d) return send(404, { success: false });
                const j = JSON.parse(body);
                try { return send(200, { success: true, result: runSql(d.db, j.sql, j.params) }); } catch (e) { return send(400, { success: false, errors: [{ message: String(e.message) }] }); }
            }
            if (req.method === 'POST') {
                const { name } = JSON.parse(body);
                if ([...cf.databases.values()].some(d => d.name === name)) return send(400, { success: false, errors: [{ message: 'A database with that name already exists' }] });
                const uuid = crypto.randomUUID();
                cf.databases.set(uuid, { name, db: await d1Factory() });
                return send(200, { success: true, result: { uuid, name } });
            }
            const name = url.searchParams.get('name');
            return send(200, { success: true, result: [...cf.databases.entries()].filter(([, d]) => !name || d.name === name).map(([uuid, d]) => ({ uuid, name: d.name })) });
        }
        return send(404, { success: false });
    }

    function servePages(req, res, url) {
        const m = /^\/pages\/([^/]+)\/([^/]+)\/(.*)$/.exec(url.pathname);
        const repo = m && gh.repos.get(m[2]);
        if (!repo?.pages || !repo.builtHead) { res.writeHead(404); return res.end('404'); }
        const c = gh.commits.get(repo.builtHead);
        const files = new Map((gh.trees.get(c.tree) || []).map(e => [e.path, gh.blobs.get(e.sha)]));
        const path = decodeURIComponent(m[3] || '') || 'index.html';
        const data = files.get(path) || files.get('404.html');
        res.writeHead(files.has(path) ? 200 : 404, { 'Content-Type': TYPES[path.split('.').pop()] || 'application/octet-stream' });
        return res.end(data);
    }

    cloud.server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
            const body = Buffer.concat(chunks);
            const url = new URL(req.url, 'http://x');
            const send = (status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
            cloud.requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization || null, redirect: null });
            try {
                if (url.pathname.startsWith('/w/')) return await serveWorker(req, res, url, body);
                if (url.pathname.startsWith('/pages/')) return servePages(req, res, url);
                if (url.pathname.startsWith('/client/v4') || url.pathname.startsWith('/oauth2/')) return await cloudflare(req, res, url, body, send);
                return await github(req, res, url, body.toString(), send);
            } catch (e) {
                res.writeHead(500); res.end(String(e.stack || e));
            }
        });
    });
    await new Promise(r => cloud.server.listen(0, '127.0.0.1', r));
    cloud.base = `http://127.0.0.1:${cloud.server.address().port}`;
    cloud.filesOf = (name) => filesOf(gh.repos.get(name));
    cloud.close = () => new Promise(r => cloud.server.close(r));
    /** The browser on Cloudflare's sign-in page: the shop agrees and is sent back. */
    cloud.cloudflareAgree = async (authUrl) => {
        const q = new URL(authUrl).searchParams;
        const code = crypto.randomBytes(8).toString('hex');
        cf.codes.set(code, { challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') });
        const back = new URL(q.get('redirect_uri'));
        back.searchParams.set('state', q.get('state'));
        back.searchParams.set('code', code);
        return (await fetch(back)).status;
    };
    /** Keys as if the shop had linked both accounts (for tests that skip the sign-in pages). */
    cloud.githubToken = () => { const t = `gho_fake_${crypto.randomBytes(8).toString('hex')}`; gh.tokens.add(t); return t; };
    // A classic personal access token the shop made on GitHub's page (its scopes as the fake account has them)
    cloud.githubPat = () => { const t = `ghp_${crypto.randomBytes(18).toString('hex')}`; gh.tokens.add(t); return t; };
    // An API token the shop made on Cloudflare's page (no refresh: it does not end)
    cloud.githubFineGrained = () => { const t = `github_pat_${crypto.randomBytes(30).toString('hex')}`; gh.tokens.add(t); return t; };
    cloud.cloudflareApiToken = () => { const t = crypto.randomBytes(20).toString('hex'); cf.tokens.add(t); return t; };
    cloud.cloudflareTokens = () => { const at = `cf_at_${crypto.randomBytes(6).toString('hex')}`; const rt = `cf_rt_${crypto.randomBytes(6).toString('hex')}`; cf.tokens.add(at); cf.tokens.add(rt); return { at, rt }; };
    return cloud;
}

module.exports = { startFakeCloud, d1Binding, gitSha };
