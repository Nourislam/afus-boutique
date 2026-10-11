/**
 * GitHub, with the shop's own account (never the publisher's). Sign-in uses
 * GitHub's device flow, the one GitHub recommends for programs installed on
 * a computer: the program holds no secret (only the public id of the AFUS
 * OAuth app, from the installer profile), GitHub's own page is opened in the
 * browser, the shop signs in there and agrees, and the program receives a key
 * for that account alone.
 *
 * Scope asked: public_repo (create and fill the shop's public website
 * repository), nothing else: no private repositories, no profile changes.
 *
 * Every call has a time limit and never follows a redirect (the key is only
 * ever sent to the GitHub address it was made for). Errors carry a reason
 * word only, never the key or GitHub's answer.
 *
 * deps: { clientId, fetch (tests), webBase / apiBase (development tests) }
 */
const WEB = 'https://github.com';
const API = 'https://api.github.com';
const SCOPES = ['public_repo'];
const TIMEOUT_MS = 15000;
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
// Where the shop can see or withdraw the access it gave (GitHub's own page)
const MANAGE_PATH = '/settings/applications';

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

function createGithubClient({ clientId, fetch: fetchImpl, webBase = WEB, apiBase = API, timeoutMs = TIMEOUT_MS } = {}) {
    // Electron's own network (system proxy and certificates)
    const doFetch = fetchImpl || ((url, init) => require('electron').net.fetch(url, init));
    const id = String(clientId || '').trim();

    async function call(url, { method = 'GET', body, token } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const headers = { Accept: 'application/json', 'User-Agent': 'AfusBoutique' };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
            headers['X-GitHub-Api-Version'] = '2022-11-28';
        }
        if (body) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await doFetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, redirect: 'error' });
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
        const r = await call(`${webBase}/login/device/code`, { method: 'POST', body: { client_id: id, scope: SCOPES.join(' ') } });
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
            method: 'POST', body: { client_id: id, device_code: deviceCode, grant_type: DEVICE_GRANT },
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
        if (r.status === 403 || r.status === 404) throw new GithubError('scope', r.status);
        throw new GithubError(r.status >= 500 ? 'network' : 'unknown', r.status);
    }

    return {
        configured: !!id,
        webBase,
        manageUrl: `${webBase}${MANAGE_PATH}`,
        requestDeviceCode, pollToken, getUser, getRepository, createRepository,
    };
}

const repoOf = (d) => ({
    id: d.id ?? null,
    fullName: String(d.full_name || ''),
    owner: String(d.owner?.login || ''),
    name: String(d.name || ''),
    htmlUrl: String(d.html_url || ''),
    defaultBranch: String(d.default_branch || 'main'),
    private: !!d.private,
});

module.exports = { createGithubClient, GithubError, SCOPES, parseScopes, canCreateRepos, WEB, API };
