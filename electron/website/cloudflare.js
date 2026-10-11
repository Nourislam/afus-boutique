/**
 * Cloudflare, with the shop's own account (never the publisher's). Sign-in
 * uses Cloudflare's OAuth for third-party applications as documented for
 * desktop programs: a public client (no secret in the program, only the
 * public id of the AFUS OAuth client from the installer profile), the
 * Authorization Code flow with PKCE (S256), the browser coming back to the
 * program on this computer (oauthLoopback.js).
 *
 * Endpoints (developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare):
 *   https://dash.cloudflare.com/oauth2/auth | token | revoke
 *   API: https://api.cloudflare.com/client/v4
 *
 * Scopes: the ones the AFUS client is registered with (profile.json ›
 * cloudflareScopes), meant to be: read the account, write Workers scripts,
 * write D1, plus offline_access (to stay linked: a refresh key). The program
 * does not trust the names: after sign-in it checks what the key can really
 * reach (accounts, Workers, D1) with read-only calls.
 *
 * Every call has a time limit and never follows a redirect (keys are only
 * sent to the Cloudflare address they are made for). Errors carry a reason
 * word only, never a key or Cloudflare's answer.
 *
 * deps: { clientId, scopes, fetch (tests), dashBase / apiBase (development tests) }
 */
const DASH = 'https://dash.cloudflare.com';
const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 15000;
// Where the shop sees (and can withdraw) the access it gave (Cloudflare's own page)
const MANAGE_PATH = '/profile/access-management';
const DEFAULT_SCOPES = ['account-settings.read', 'workers-scripts.write', 'd1.write', 'offline_access'];

class CloudflareError extends Error {
    constructor(reason, status = null) {
        super(`cloudflare: ${reason}`);
        this.reason = reason;
        this.status = status;
    }
}

const parseScopes = (text) => String(text || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

function createCloudflareClient({ clientId, scopes, fetch: fetchImpl, dashBase = DASH, apiBase = API, timeoutMs = TIMEOUT_MS } = {}) {
    // Electron's own network (system proxy and certificates)
    const doFetch = fetchImpl || ((url, init) => require('electron').net.fetch(url, init));
    const id = String(clientId || '').trim();
    const wanted = Array.isArray(scopes) && scopes.length ? scopes.map(String) : DEFAULT_SCOPES;

    async function call(url, { method = 'GET', form, token } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const headers = { Accept: 'application/json', 'User-Agent': 'AfusBoutique' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        let res;
        try {
            res = await doFetch(url, { method, headers, body: form ? new URLSearchParams(form).toString() : undefined, signal: controller.signal, redirect: 'error' });
        } catch {
            throw new CloudflareError('network');
        } finally {
            clearTimeout(timer);
        }
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        return { status: res.status, ok: res.ok, data: data && typeof data === 'object' ? data : {} };
    }

    /** Cloudflare's sign-in page for this sign-in (opened in the browser). */
    function authorizeUrl({ redirectUri, state, challenge }) {
        if (!id) throw new CloudflareError('not_configured');
        const q = new URLSearchParams({
            response_type: 'code',
            client_id: id,
            redirect_uri: redirectUri,
            scope: wanted.join(' '),
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
        });
        return `${dashBase}/oauth2/auth?${q.toString()}`;
    }

    /** { accessToken, refreshToken, expiresIn, scopes } from Cloudflare's answer. */
    function tokensOf(r) {
        const d = r.data;
        if (r.ok && d.access_token) {
            return {
                accessToken: String(d.access_token),
                refreshToken: d.refresh_token ? String(d.refresh_token) : null,
                expiresIn: Math.max(60, Number(d.expires_in) || 3600),
                scopes: parseScopes(d.scope),
            };
        }
        if (d.error === 'invalid_grant') throw new CloudflareError('revoked', r.status);
        if (d.error === 'invalid_client' || d.error === 'unauthorized_client') throw new CloudflareError('not_configured', r.status);
        if (d.error === 'invalid_scope') throw new CloudflareError('scope', r.status);
        throw new CloudflareError(r.status >= 500 ? 'network' : 'unknown', r.status);
    }

    /** The code the browser brought back -> keys (with the PKCE verifier of this sign-in). */
    async function exchangeCode({ code, redirectUri, verifier }) {
        const r = await call(`${dashBase}/oauth2/token`, {
            method: 'POST',
            form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: id, code_verifier: verifier },
        });
        return tokensOf(r);
    }

    /** A new short key from the refresh key (Cloudflare may give a new refresh key too). */
    async function refresh(refreshToken) {
        const r = await call(`${dashBase}/oauth2/token`, {
            method: 'POST',
            form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: id },
        });
        return tokensOf(r);
    }

    /** Withdraw a key at Cloudflare (best effort: the key is forgotten here anyway). */
    async function revoke(token, hint = 'refresh_token') {
        try {
            const r = await call(`${dashBase}/oauth2/revoke`, { method: 'POST', form: { token, token_type_hint: hint, client_id: id } });
            return r.ok;
        } catch {
            return false;
        }
    }

    async function api(token, path) {
        const r = await call(`${apiBase}${path}`, { token });
        if (r.status === 401) throw new CloudflareError('revoked', 401);
        return r;
    }

    /** The accounts the shop allowed on Cloudflare's page: [{ id, name }]. */
    async function listAccounts(token) {
        const r = await api(token, '/accounts?per_page=50');
        if (r.status === 403) throw new CloudflareError('scope', 403);
        if (!r.ok || r.data.success === false || !Array.isArray(r.data.result)) throw new CloudflareError(r.status >= 500 ? 'network' : 'unknown', r.status);
        return r.data.result
            .filter(a => a && typeof a.id === 'string' && /^[a-f0-9]{32}$/.test(a.id))
            .map(a => ({ id: a.id, name: String(a.name || '').slice(0, 120) }));
    }

    /**
     * What the key can reach in this account, by read-only lists:
     * { workers: bool, d1: bool }. Nothing is created.
     */
    async function checkAccess(token, accountId) {
        const one = async (path) => {
            const r = await api(token, `/accounts/${encodeURIComponent(accountId)}${path}`);
            if (r.ok && r.data.success !== false) return true;
            if (r.status === 403 || r.status === 404) return false;
            throw new CloudflareError(r.status >= 500 ? 'network' : 'unknown', r.status);
        };
        const [workers, d1] = await Promise.all([one('/workers/scripts'), one('/d1/database?per_page=1')]);
        return { workers, d1 };
    }

    return {
        configured: !!id,
        dashBase,
        scopes: wanted,
        manageUrl: `${dashBase}${MANAGE_PATH}`,
        authorizeUrl, exchangeCode, refresh, revoke, listAccounts, checkAccess,
    };
}

module.exports = { createCloudflareClient, CloudflareError, DEFAULT_SCOPES, DASH, API, parseScopes };
