/**
 * Linking the shop's Cloudflare account, in the main process.
 *
 *   start()       opens Cloudflare's sign-in page in the browser; the browser
 *                 comes back to the program on this computer (oauthLoopback)
 *                 with a one-time code, exchanged here with the PKCE verifier
 *                 of this sign-in (neither ever reaches the window)
 *   chooseAccount(id)  when the shop allowed several Cloudflare accounts:
 *                 the one for the website (picked by its name on screen)
 *   cancel()      stops waiting
 *   disconnect()  withdraws the keys at Cloudflare (best effort) and forgets them
 *   check()       are the keys still accepted, can they still reach Workers and D1?
 *   access()      { token, accountId } for the publishing steps of the main
 *                 process only (the short key is renewed with the refresh key
 *                 when it is about to end; one renewal at a time)
 *
 * Kept by secureStore (encrypted by the system): the keys, their end and the
 * chosen account. Saved in the website's settings value (never a key):
 * status not_connected / connected / choose_account / failed, the account's
 * name, what it can reach and a reason word.
 *
 * deps: { client (cloudflare.js), store, saveAccount(meta), readAccount(),
 *         allowed(), openPage(url), onConnected(), ports, callbackPage(kind),
 *         now, timeoutMs }
 */
const { listen, pkce, randomState } = require('./oauthLoopback');
const { TOKEN_FORMAT } = require('./cloudflare');

const ITEM = 'cloudflare';
const RENEW_BEFORE_MS = 2 * 60 * 1000;
const FLOW_TIMEOUT_MS = 10 * 60 * 1000;

function createCloudflareConnector({
    client, store, saveAccount, readAccount, allowed = () => true,
    openPage = async () => {}, onConnected = () => {}, ports = [], callbackPage = () => '',
    now = Date.now, timeoutMs = FLOW_TIMEOUT_MS,
}) {
    let flow = null; // { server, verifier, redirectUri, url, expiresAt, cancelled, done, finished }
    let renewing = null;

    const iso = () => new Date(now()).toISOString();
    const save = (meta) => saveAccount({ accountName: '', accountId: '', accounts: [], access: null, connectedAt: null, error: null, errorAt: null, ...meta });
    const failed = (reason) => save({ status: 'failed', accountName: readAccount().accountName || '', error: reason, errorAt: iso() });

    function readKeys() {
        const text = store.get(ITEM);
        if (!text) return null;
        try { return JSON.parse(text); } catch { return null; }
    }
    const writeKeys = (keys) => store.set(ITEM, JSON.stringify(keys));
    const keysOf = (t, accountId = null) => ({
        accessToken: t.accessToken, refreshToken: t.refreshToken,
        expiresAt: now() + t.expiresIn * 1000, scopes: t.scopes, accountId, savedAt: iso(),
    });

    /** Withdraw at Cloudflare, without waiting (the keys are forgotten here anyway). */
    function revokeQuietly(keys) {
        // An API token the shop made itself is withdrawn on Cloudflare's page, by the shop
        if (!keys || keys.method === 'token') return;
        if (keys.refreshToken) client.revoke(keys.refreshToken, 'refresh_token').catch(() => {});
        if (keys.accessToken) client.revoke(keys.accessToken, 'access_token').catch(() => {});
    }

    /** What the window may show of a sign-in in progress (no code, no verifier, no state). */
    function publicFlow() {
        if (!flow || flow.cancelled || flow.done) return null;
        return { expiresAt: new Date(flow.expiresAt).toISOString() };
    }

    async function start() {
        if (!client.configured) return { started: false, reason: 'not_configured' };
        if (!store.available()) { failed('secure_storage'); return { started: false, reason: 'secure_storage' }; }
        const previous = flow;
        cancel();
        if (previous) await previous.server.closed;
        const challenge = pkce();
        const state = randomState();
        let server;
        try {
            server = await listen({ ports, expectedState: state, timeoutMs, page: callbackPage });
        } catch (error) {
            failed(error.reason || 'unknown');
            return { started: false, reason: error.reason || 'unknown' };
        }
        const current = {
            server, verifier: challenge.verifier, redirectUri: server.redirectUri,
            url: client.authorizeUrl({ redirectUri: server.redirectUri, state, challenge: challenge.challenge }),
            expiresAt: now() + timeoutMs, cancelled: false, done: false,
        };
        flow = current;
        current.finished = wait(current);
        await openPage(current.url);
        return { started: true, flow: publicFlow() };
    }

    async function wait(current) {
        try {
            const answer = await current.server.result;
            if (current.cancelled || answer.error === 'cancelled') return;
            if (answer.error) { failed(answer.error === 'state' ? 'unknown' : answer.error); return; }
            let tokens;
            try {
                tokens = await client.exchangeCode({ code: answer.code, redirectUri: current.redirectUri, verifier: current.verifier });
            } catch (error) {
                failed(error.reason === 'revoked' ? 'expired' : error.reason || 'unknown');
                return;
            }
            if (current.cancelled) { revokeQuietly(keysOf(tokens)); return; }
            await keep(tokens, current);
        } finally {
            current.done = true;
            current.verifier = null;
            if (flow === current) flow = null;
            await current.server.closed;
        }
    }

    /** Keys received: checked, kept encrypted, then the account is shown as linked. */
    async function keep(tokens, current) {
        const keys = keysOf(tokens);
        // Cancelled, or the demo shop / training opened meanwhile: nothing is kept
        const stop = () => current.cancelled || !allowed();
        if (stop()) { revokeQuietly(keys); return; }
        // Without a refresh key the link would end within the hour
        if (!keys.refreshToken) { revokeQuietly(keys); failed('scope'); return; }
        let accounts;
        try {
            accounts = await client.listAccounts(keys.accessToken);
        } catch (error) {
            revokeQuietly(keys);
            failed(error.reason || 'unknown');
            return;
        }
        if (stop()) { revokeQuietly(keys); return; }
        if (!accounts.length) { revokeQuietly(keys); failed('no_account'); return; }
        try {
            writeKeys(keys);
        } catch {
            revokeQuietly(keys);
            failed('secure_storage');
            return;
        }
        if (accounts.length === 1) {
            await useAccount(accounts[0], keys);
            return;
        }
        save({ status: 'choose_account', accounts });
        onConnected();
    }

    /**
     * Link with an API token the shop made itself on Cloudflare's page (no
     * AFUS app needed). It does not end: no renewal. Checked with Cloudflare
     * (its accounts, Workers, D1) before it is kept.
     * -> { linked } | { linked: false, reason } (several accounts: choose_account)
     */
    async function connectWithToken(raw) {
        const token = String(raw || '').trim();
        if (!TOKEN_FORMAT.test(token)) return { linked: false, reason: 'token_format' };
        if (!store.available()) { failed('secure_storage'); return { linked: false, reason: 'secure_storage' }; }
        cancel();
        let accounts;
        try {
            accounts = await client.listAccounts(token);
        } catch (error) {
            return { linked: false, reason: error.reason === 'revoked' ? 'token_refused' : error.reason || 'unknown' };
        }
        if (!allowed()) return { linked: false, reason: 'blocked' };
        if (!accounts.length) return { linked: false, reason: 'no_account' };
        const keys = { accessToken: token, refreshToken: null, expiresAt: null, scopes: [], accountId: null, method: 'token', savedAt: iso() };
        try {
            writeKeys(keys);
        } catch {
            failed('secure_storage');
            return { linked: false, reason: 'secure_storage' };
        }
        if (accounts.length === 1) return useAccount(accounts[0], keys);
        save({ status: 'choose_account', accounts });
        onConnected();
        return { linked: false, reason: 'choose_account' };
    }

    /** Unusable keys: withdrawn at Cloudflare and forgotten here. */
    function drop(keys) {
        revokeQuietly(keys);
        store.remove(ITEM);
    }

    /**
     * The account for the website: can its key reach Workers and D1?
     * fromChoice: a network cut keeps the choice open instead of failing.
     */
    async function useAccount(account, keys, { fromChoice = false } = {}) {
        let access;
        try {
            access = await client.checkAccess(keys.accessToken, account.id);
        } catch (error) {
            const reason = error.reason || 'unknown';
            if (fromChoice && reason === 'network') return { linked: false, reason };
            drop(keys);
            failed(reason);
            return { linked: false, reason };
        }
        if (!access.workers || !access.d1) {
            drop(keys);
            save({ status: 'failed', accountName: account.name, access, error: 'scope', errorAt: iso() });
            return { linked: false, reason: 'scope' };
        }
        writeKeys({ ...keys, accountId: account.id });
        save({ status: 'connected', accountName: account.name, accountId: account.id, access, connectedAt: iso() });
        onConnected();
        return { linked: true };
    }

    /** The shop picked one of the accounts it allowed (by name on screen). */
    async function chooseAccount(accountId) {
        const saved = readAccount();
        const keys = readKeys();
        const account = (saved.accounts || []).find(a => a.id === accountId);
        if (saved.status !== 'choose_account' || !account) return { linked: false, reason: 'unknown_account' };
        if (!keys?.accessToken) { failed('token_missing'); return { linked: false, reason: 'token_missing' }; }
        let token;
        let offered;
        try {
            token = (await renewIfNeeded(keys)).accessToken;
            // Only an account Cloudflare itself says this key may use
            offered = await client.listAccounts(token);
        } catch (error) {
            return { linked: false, reason: error.reason || 'unknown' };
        }
        const real = offered.find(a => a.id === account.id);
        if (!real) return { linked: false, reason: 'unknown_account' };
        return useAccount(real, { ...readKeys(), accessToken: token }, { fromChoice: true });
    }

    function cancel() {
        if (flow) {
            flow.cancelled = true;
            flow.verifier = null;
            flow.server.close();
            flow = null;
        }
    }

    function disconnect() {
        cancel();
        revokeQuietly(readKeys());
        store.remove(ITEM);
        save({ status: 'not_connected' });
    }

    /** Cloudflare no longer accepts the keys (withdrawn by the shop on Cloudflare). */
    function revoked() {
        store.remove(ITEM);
        failed('revoked');
    }

    /** The keys, with the short one renewed when it is about to end. One renewal at a time. */
    async function renewIfNeeded(keys) {
        if (keys.method === 'token') return keys;
        if (keys.expiresAt - now() > RENEW_BEFORE_MS) return keys;
        if (!keys.refreshToken) { revoked(); throw Object.assign(new Error('session ended'), { reason: 'revoked' }); }
        if (!renewing) {
            renewing = (async () => {
                try {
                    const t = await client.refresh(keys.refreshToken);
                    // Cloudflare may give a new refresh key (the old one then stops working)
                    const next = { ...keys, ...keysOf({ ...t, refreshToken: t.refreshToken || keys.refreshToken }, keys.accountId) };
                    writeKeys(next);
                    return next;
                } catch (error) {
                    if (error.reason === 'revoked') revoked();
                    throw error;
                } finally {
                    renewing = null;
                }
            })();
        }
        return renewing;
    }

    /** Keys that can still be used: an API token, or a sign-in with its refresh key. */
    const usable = (keys) => !!keys?.accessToken && (keys.method === 'token' || !!keys.refreshToken);

    /** Linked = the state says so AND the keys of the chosen account are readable here. */
    function linked() {
        const keys = readKeys();
        return readAccount().status === 'connected' && usable(keys) && !!keys.accountId;
    }

    /** { token, accountId } for the main process (later phases). Throws { reason }. */
    async function access() {
        if (!linked()) throw Object.assign(new Error('not linked'), { reason: 'not_connected' });
        const keys = await renewIfNeeded(readKeys());
        return { token: keys.accessToken, accountId: keys.accountId };
    }

    /**
     * Still accepted, and still able to reach Workers and D1? No network: the
     * account stays as it is.
     */
    async function check() {
        const saved = readAccount();
        if (saved.status !== 'connected') return { checked: false };
        const keys = readKeys();
        if (!usable(keys) || !keys.accountId) { store.remove(ITEM); failed('token_missing'); return { checked: true, ok: false, reason: 'token_missing' }; }
        try {
            const { token, accountId } = await access();
            const reach = await client.checkAccess(token, accountId);
            if (!reach.workers || !reach.d1) {
                drop(readKeys());
                save({ status: 'failed', accountName: saved.accountName, access: reach, error: 'scope', errorAt: iso() });
                return { checked: true, ok: false, reason: 'scope' };
            }
            return { checked: true, ok: true };
        } catch (error) {
            if (error.reason === 'revoked') { if (readAccount().status === 'connected') revoked(); return { checked: true, ok: false, reason: 'revoked' }; }
            return { checked: false, reason: error.reason || 'unknown' };
        }
    }

    /** Cloudflare's page of the sign-in in progress (opened again on request). */
    const flowUrl = () => (publicFlow() ? flow.url : null);
    /** For tests: the background wait of the current sign-in. */
    const pending = () => flow?.finished || Promise.resolve();

    return { start, connectWithToken, tokenPageUrl: () => client.tokenPageUrl, chooseAccount, cancel, disconnect, revoked, check, access, linked, publicFlow, flowUrl, pending };
}

module.exports = { createCloudflareConnector, ITEM };
