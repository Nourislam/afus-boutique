/**
 * GitHub, with the shop's own account (never the publisher's). Sign-in uses
 * GitHub's device flow, the one GitHub recommends for programs installed on
 * a computer: the program holds no secret (only the public id of the AFUS
 * OAuth app, from the installer profile), GitHub's own page is opened in the
 * browser, the shop signs in there and agrees, and the program receives a key
 * for that account alone.
 *
 * Scope asked: repo. The website's repository is public, but GitHub
 * Pages (publishing it) can only be switched on with the "repo" scope for an
 * OAuth app (docs.github.com/rest/pages: "OAuth app tokens ... need the repo
 * scope"); there is no narrower one. The program only ever touches the one
 * repository it made for the website.
 *
 * Every call has a time limit and never follows a redirect (the key is only
 * ever sent to the GitHub address it was made for). Errors carry a reason
 * word only, never the key or GitHub's answer.
 *
 * deps: { clientId, fetch (tests), webBase / apiBase (development tests) }
 */
const WEB = 'https://github.com';
const API = 'https://api.github.com';
const SCOPES = ['repo'];
const TIMEOUT_MS = 15000;
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
// Where the shop can see or withdraw the access it gave (GitHub's own page)
const MANAGE_PATH = '/settings/applications';
// GitHub's own page to make a key with the one permission needed (repo), already filled in
const TOKEN_PAGE_PATH = '/settings/tokens/new?scopes=repo&description=Afus%20Boutique%20website';
// A key the shop made on GitHub (classic personal access token, or an app key)
const TOKEN_FORMAT = /^(gh[pousr]_[A-Za-z0-9]{30,251}|github_pat_[A-Za-z0-9_]{40,251})$/;

class GithubError extends Error {
    constructor(reason, status = null) {
        super(`github: ${reason}`);
        this.reason = reason;
        this.status = status;
    }
}

/** "public_repo, read:user" -> ['public_repo', 'read:user'] */
const parseScopes = (text) => String(text || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
/** The key can create a public repository (repo includes public_repo). */
const canCreateRepos = (scopes) => scopes.includes('public_repo') || scopes.includes('repo');
/** The key can switch GitHub Pages on (an older key given public_repo only cannot). */
const canPublishPages = (scopes) => scopes.includes('repo');

const crypto = require('crypto');
/** Git's own name of a file's content (so unchanged files are not sent again). */
const gitBlobSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
// Content made in a row is kept a little apart (GitHub's secondary limits)
const WRITE_GAP_MS = 700;
const TEXT_FILE = /\.(html|css|js|mjs|json|txt|xml|svg|webmanifest|md)$|(^|\/)(CNAME|\.nojekyll)$/i;
/** A text file of the website, sent inside the tree request (valid UTF-8 only). */
const isText = (path, buf) => TEXT_FILE.test(path) && Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
const SAFE_PATH = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;

function createGithubClient({ clientId, fetch: fetchImpl, webBase = WEB, apiBase = API, timeoutMs = TIMEOUT_MS, writeGapMs = WRITE_GAP_MS, sleep } = {}) {
    const wait = sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
    // Electron's own network (system proxy and certificates)
    const doFetch = fetchImpl || ((url, init) => require('electron').net.fetch(url, init));
    const id = String(clientId || '').trim();

    async function call(url, { method = 'GET', body, form, token } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const headers = { Accept: 'application/json', 'User-Agent': 'AfusBoutique' };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
            headers['X-GitHub-Api-Version'] = '2022-11-28';
        }
        if (body) headers['Content-Type'] = 'application/json';
        // The sign-in endpoints take their parameters as a form (docs.github.com, device flow)
        if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        let res;
        try {
            res = await doFetch(url, { method, headers, body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined, signal: controller.signal, redirect: 'error' });
        } catch {
            throw new GithubError('network');
        } finally {
            clearTimeout(timer);
        }
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        return { status: res.status, ok: res.ok, data: data && typeof data === 'object' ? data : {}, headers: res.headers };
    }

    /** Step 1: a short code for the shop to type on GitHub's page. */
    async function requestDeviceCode() {
        if (!id) throw new GithubError('not_configured');
        const r = await call(`${webBase}/login/device/code`, { method: 'POST', form: { client_id: id, scope: SCOPES.join(' ') } });
        const d = r.data;
        if (!r.ok || !d.device_code || !d.user_code) throw new GithubError(d.error === 'device_flow_disabled' ? 'not_configured' : 'unknown', r.status);
        // Only ever GitHub's own page
        const page = typeof d.verification_uri === 'string' && d.verification_uri.startsWith(`${webBase}/`) ? d.verification_uri : `${webBase}/login/device`;
        return {
            deviceCode: String(d.device_code),
            userCode: String(d.user_code),
            verificationUri: page,
            expiresIn: Math.max(60, Number(d.expires_in) || 900),
            interval: Math.max(1, Number(d.interval) || 5),
        };
    }

    /**
     * Step 2, asked every few seconds: has the shop agreed yet?
     * { pending } | { slowDown, interval } | { token, scopes }; throws
     * denied / expired / not_configured / unknown.
     */
    async function pollToken(deviceCode) {
        const r = await call(`${webBase}/login/oauth/access_token`, {
            method: 'POST', form: { client_id: id, device_code: deviceCode, grant_type: DEVICE_GRANT },
        });
        const d = r.data;
        if (d.access_token) return { token: String(d.access_token), scopes: parseScopes(d.scope) };
        switch (d.error) {
            case 'authorization_pending': return { pending: true };
            case 'slow_down': return { slowDown: true, interval: Number(d.interval) || null };
            case 'access_denied': throw new GithubError('denied');
            case 'expired_token': throw new GithubError('expired');
            case 'device_flow_disabled':
            case 'incorrect_client_credentials': throw new GithubError('not_configured');
            default: throw new GithubError(r.status >= 500 ? 'network' : 'unknown', r.status);
        }
    }

    /** The account the key belongs to, and what the key may do. */
    async function getUser(token) {
        const r = await call(`${apiBase}/user`, { token });
        if (r.status === 401) throw new GithubError('revoked', 401);
        if (!r.ok || !r.data.login) throw new GithubError(r.status >= 500 ? 'network' : 'unknown', r.status);
        const header = r.headers && typeof r.headers.get === 'function' ? r.headers.get('x-oauth-scopes') : null;
        return { login: String(r.data.login), id: r.data.id ?? null, name: r.data.name || '', scopes: header === null ? null : parseScopes(header) };
    }

    /** A repository of the account, or null when there is none of that name. */
    async function getRepository(token, owner, name) {
        const r = await call(`${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { token });
        if (r.status === 404) return null;
        if (r.status === 401) throw new GithubError('revoked', 401);
        if (!r.ok) throw new GithubError(r.status >= 500 ? 'network' : 'unknown', r.status);
        return repoOf(r.data);
    }

    /**
     * A new public repository on the shop's account (with a first commit, so
     * it can be published at once). { exists: true } when the name is taken.
     */
    async function createRepository(token, { name, description = '', homepage = '' }) {
        const r = await call(`${apiBase}/user/repos`, {
            method: 'POST', token,
            body: { name, description, homepage: homepage || undefined, private: false, auto_init: true, has_issues: false, has_projects: false, has_wiki: false },
        });
        if (r.status === 201) return repoOf(r.data);
        if (r.status === 422 && JSON.stringify(r.data.errors || r.data.message || '').includes('already exists')) return { exists: true };
        if (r.status === 401) throw new GithubError('revoked', 401);
        if (/verif(y|ied)[^.]*e-?mail|e-?mail[^.]*verif/i.test(String(r.data.message || ''))) throw new GithubError('email_unverified', r.status);
        if (r.status === 403 || r.status === 404) throw new GithubError('scope', r.status);
        throw new GithubError(r.status >= 500 ? 'network' : 'unknown', r.status);
    }

    /**
     * A call that makes content: when GitHub says "too fast" (403/429 with a
     * rate-limit answer, or Retry-After), wait as asked and try again (a few
     * times). Calls in a row are kept a little apart.
     */
    let lastWrite = 0;
    async function paced(make, tries = 4) {
        for (let attempt = 0; ; attempt++) {
            const gap = lastWrite + writeGapMs - Date.now();
            if (gap > 0) await wait(gap);
            lastWrite = Date.now();
            const r = await make();
            const limited = r.status === 429 || (r.status === 403 && (/rate limit/i.test(String(r.data.message || '')) || header(r, 'retry-after') || header(r, 'x-ratelimit-remaining') === '0'));
            if (!limited || attempt >= tries - 1) return r;
            const after = Number(header(r, 'retry-after'));
            const reset = Number(header(r, 'x-ratelimit-reset'));
            const ms = after > 0 ? after * 1000 : reset > 0 ? Math.max(1000, reset * 1000 - Date.now()) : 60000 * (attempt + 1);
            await wait(Math.min(ms, 5 * 60000));
        }
    }
    const header = (r, name) => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(name) : null);

    const repoPath = (owner, name) => `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const fail = (r) => {
        if (r.status === 401) throw new GithubError('revoked', 401);
        // GitHub asks the account's e-mail address to be confirmed first
        if (/verif(y|ied)[^.]*e-?mail|e-?mail[^.]*verif/i.test(String(r.data.message || ''))) throw new GithubError('email_unverified', r.status);
        if (r.status === 403 || r.status === 404) throw new GithubError('scope', r.status);
        throw new GithubError(r.status >= 500 ? 'network' : 'unknown', r.status);
    };

    /**
     * Put the website's files in the repository as one change (commit) on its
     * branch; files not listed any more are removed. Files whose content is
     * already there are not sent again. files: [{ path, content: Buffer|string }]
     * -> { commit, changed }
     */
    async function commitFiles(token, owner, name, { files, message, branch = 'main' }) {
        const base = repoPath(owner, name);
        const list = files.map(f => ({ path: String(f.path), content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8') }));
        for (const f of list) if (!SAFE_PATH.test(f.path)) throw new GithubError('unknown');
        const ref = await call(`${base}/git/ref/heads/${encodeURIComponent(branch)}`, { token });
        if (!ref.ok) fail(ref);
        const parent = ref.data.object?.sha;
        const head = await call(`${base}/git/commits/${parent}`, { token });
        if (!head.ok) fail(head);
        const current = await call(`${base}/git/trees/${head.data.tree?.sha}?recursive=1`, { token });
        const known = new Set((current.ok && Array.isArray(current.data.tree) ? current.data.tree : []).filter(e => e.type === 'blob').map(e => e.sha));

        // Text files (pages, style, script, catalogue) go inside the one tree request; only
        // pictures are sent one by one, slowly, as GitHub asks for content made in a row
        // (docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits)
        const entries = [];
        for (const f of list) {
            const sha = gitBlobSha(f.content);
            if (known.has(sha)) { entries.push({ path: f.path, mode: '100644', type: 'blob', sha }); continue; }
            if (isText(f.path, f.content)) { entries.push({ path: f.path, mode: '100644', type: 'blob', content: f.content.toString('utf8') }); continue; }
            const b = await paced(() => call(`${base}/git/blobs`, { method: 'POST', token, body: { content: f.content.toString('base64'), encoding: 'base64' } }));
            if (!b.ok || !b.data.sha) fail(b);
            entries.push({ path: f.path, mode: '100644', type: 'blob', sha: b.data.sha });
        }
        entries.sort((a, b) => a.path.localeCompare(b.path));
        const tree = await paced(() => call(`${base}/git/trees`, { method: 'POST', token, body: { tree: entries } }));
        if (!tree.ok || !tree.data.sha) fail(tree);
        if (tree.data.sha === head.data.tree?.sha) return { commit: parent, changed: false };
        const commit = await call(`${base}/git/commits`, { method: 'POST', token, body: { message, tree: tree.data.sha, parents: [parent] } });
        if (!commit.ok || !commit.data.sha) fail(commit);
        const moved = await call(`${base}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', token, body: { sha: commit.data.sha, force: false } });
        if (!moved.ok) fail(moved);
        return { commit: commit.data.sha, changed: true };
    }

    /** GitHub Pages of the repository: { url, status } (status: built / building / errored / null), or null. */
    async function getPages(token, owner, name) {
        const r = await call(`${repoPath(owner, name)}/pages`, { token });
        if (r.status === 404) return null;
        if (!r.ok) fail(r);
        return pagesOf(r.data);
    }

    /**
     * The website's own domain on GitHub Pages (cname; null = none, back on
     * the free address) and whether https is required. -> the Pages state, or
     * { refused: true } when GitHub does not accept the domain (used by
     * another GitHub website, or not a valid domain).
     */
    async function updatePages(token, owner, name, { cname, httpsEnforced } = {}) {
        const body = {};
        if (cname !== undefined) body.cname = cname;
        if (httpsEnforced !== undefined) body.https_enforced = !!httpsEnforced;
        const r = await call(`${repoPath(owner, name)}/pages`, { method: 'PUT', token, body });
        if (r.status === 400 || r.status === 422) return { refused: true };
        if (!r.ok) fail(r);
        return getPages(token, owner, name);
    }

    /** Switch GitHub Pages on, from the branch's root (already on: its state). */
    async function enablePages(token, owner, name, { branch = 'main' } = {}) {
        const r = await call(`${repoPath(owner, name)}/pages`, { method: 'POST', token, body: { build_type: 'legacy', source: { branch, path: '/' } } });
        if (r.status === 201) return pagesOf(r.data);
        if (r.status === 409) return getPages(token, owner, name);
        return fail(r);
    }

    return {
        configured: !!id,
        webBase,
        manageUrl: `${webBase}${MANAGE_PATH}`,
        tokenPageUrl: `${webBase}${TOKEN_PAGE_PATH}`,
        // GitHub's own page to open a free account
        signupUrl: `${webBase}/signup`,
        requestDeviceCode, pollToken, getUser, getRepository, createRepository,
        commitFiles, getPages, enablePages, updatePages,
    };
}

/** GitHub Pages as Afus uses it: address, build state, own domain, its certificate, https required. */
const pagesOf = (d) => ({
    url: String(d.html_url || ''), status: d.status || null,
    cname: d.cname ? String(d.cname).toLowerCase() : null,
    certificate: d.https_certificate?.state ? String(d.https_certificate.state) : null,
    httpsEnforced: !!d.https_enforced,
});

const repoOf = (d) => ({
    id: d.id ?? null,
    fullName: String(d.full_name || ''),
    owner: String(d.owner?.login || ''),
    name: String(d.name || ''),
    htmlUrl: String(d.html_url || ''),
    defaultBranch: String(d.default_branch || 'main'),
    private: !!d.private,
});

module.exports = { createGithubClient, GithubError, TOKEN_FORMAT, SCOPES, parseScopes, canCreateRepos, canPublishPages, gitBlobSha, WEB, API };
