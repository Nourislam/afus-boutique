/**
 * Linking the shop's GitHub account, in the main process.
 *
 *   start()   asks GitHub for a short code, opens GitHub's page in the
 *             browser; the program then asks GitHub every few seconds whether
 *             the shop agreed (the long device code never leaves this file)
 *   cancel()  stops waiting
 *   disconnect() forgets the key on this computer
 *   check()   is the key still accepted by GitHub?
 *   token()   the key, for the publishing steps of the main process only
 *
 * The key is kept by secureStore (encrypted by the system); what the window
 * sees is the account's state: not_connected / connected / failed, the login
 * name and a reason word. Saved through saveAccount(meta) in the website's
 * settings value (never the key).
 *
 * deps: { client (github.js), store (secureStore.js), saveAccount(meta),
 *         readAccount(), allowed() (false: demo shop, nothing kept),
 *         openPage(url, userCode), onConnected(login), now, sleep }
 */
const { canCreateRepos, canPublishPages, TOKEN_FORMAT } = require('./github');

const ITEM = 'github';
const MAX_NETWORK_RETRIES = 5;

function createGithubConnector({ client, store, saveAccount, readAccount, allowed = () => true, openPage = async () => {}, onConnected = () => {}, now = Date.now, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
    let flow = null; // { deviceCode, userCode, verificationUri, expiresAt, interval, cancelled, done }

    const failed = (reason) => saveAccount({ status: 'failed', login: readAccount().login || '', connectedAt: null, scopes: [], error: reason, errorAt: new Date(now()).toISOString() });

    /** What the window may show of a sign-in in progress (no device code). */
    function publicFlow() {
        if (!flow || flow.cancelled || flow.done) return null;
        return { userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: new Date(flow.expiresAt).toISOString() };
    }

    async function start() {
        if (!client.configured) return { started: false, reason: 'not_configured' };
        if (!store.available()) { failed('secure_storage'); return { started: false, reason: 'secure_storage' }; }
        cancel();
        let code;
        try {
            code = await client.requestDeviceCode();
        } catch (error) {
            const reason = error.reason || 'unknown';
            if (reason !== 'not_configured') failed(reason);
            return { started: false, reason };
        }
        const current = {
            deviceCode: code.deviceCode, userCode: code.userCode, verificationUri: code.verificationUri,
            expiresAt: now() + code.expiresIn * 1000, interval: code.interval, cancelled: false, done: false,
        };
        flow = current;
        current.finished = wait(current);
        await openPage(current.verificationUri, current.userCode);
        return { started: true, flow: publicFlow() };
    }

    /** Asks GitHub until the shop agrees, refuses, or the code runs out. */
    async function wait(current) {
        let networkErrors = 0;
        try {
            while (!current.cancelled) {
                await sleep(current.interval * 1000);
                if (current.cancelled) return;
                if (now() >= current.expiresAt) { failed('expired'); return; }
                let answer;
                try {
                    answer = await client.pollToken(current.deviceCode);
                } catch (error) {
                    if (error.reason === 'network' && ++networkErrors <= MAX_NETWORK_RETRIES) continue;
                    if (!current.cancelled) failed(error.reason || 'unknown');
                    return;
                }
                networkErrors = 0;
                if (answer.pending) continue;
                if (answer.slowDown) { current.interval = Math.max(current.interval + 5, answer.interval || 0); continue; }
                if (current.cancelled) return;
                await keep(answer);
                return;
            }
        } finally {
            current.done = true;
            current.deviceCode = null;
            if (flow === current) flow = null;
        }
    }

    /** The key GitHub gave: checked, kept encrypted, then the account is shown as linked. */
    async function keep({ token, scopes }) {
        let user;
        try {
            user = await client.getUser(token);
        } catch (error) {
            failed(error.reason || 'unknown');
            return;
        }
        // The demo shop opened meanwhile: the key is not kept
        if (!allowed()) return;
        const granted = user.scopes || scopes || [];
        if (!canCreateRepos(granted)) { failed('scope'); return; }
        try {
            store.set(ITEM, JSON.stringify({ token, scopes: granted, login: user.login, userId: user.id, savedAt: new Date(now()).toISOString() }));
        } catch {
            failed('secure_storage');
            return;
        }
        saveAccount({ status: 'connected', login: user.login, connectedAt: new Date(now()).toISOString(), scopes: granted, error: null, errorAt: null });
        onConnected(user.login);
    }

    /**
     * Link with a key the shop made itself on GitHub's page (no AFUS app
     * needed). The key must be allowed "repo" (make the website's
     * repository and switch GitHub Pages on): checked with GitHub before it
     * is kept. -> { linked } | { linked: false, reason }
     */
    async function connectWithToken(raw) {
        const token = String(raw || '').trim();
        if (!TOKEN_FORMAT.test(token)) return { linked: false, reason: 'token_format' };
        if (!store.available()) { failed('secure_storage'); return { linked: false, reason: 'secure_storage' }; }
        cancel();
        let user;
        try {
            user = await client.getUser(token);
        } catch (error) {
            const reason = error.reason === 'revoked' ? 'token_refused' : error.reason || 'unknown';
            return { linked: false, reason };
        }
        if (!allowed()) return { linked: false, reason: 'blocked' };
        // A fine-grained key does not say what it may do: a classic key with "repo" is asked
        if (!user.scopes) return { linked: false, reason: 'token_classic' };
        if (!canPublishPages(user.scopes)) return { linked: false, reason: 'scope' };
        try {
            store.set(ITEM, JSON.stringify({ token, scopes: user.scopes, login: user.login, userId: user.id, method: 'token', savedAt: new Date(now()).toISOString() }));
        } catch {
            failed('secure_storage');
            return { linked: false, reason: 'secure_storage' };
        }
        saveAccount({ status: 'connected', login: user.login, connectedAt: new Date(now()).toISOString(), scopes: user.scopes, error: null, errorAt: null });
        onConnected(user.login);
        return { linked: true };
    }

    /** GitHub no longer accepts the key (withdrawn by the shop on GitHub). */
    function revoked() {
        store.remove(ITEM);
        failed('revoked');
    }

    function cancel() {
        if (flow) { flow.cancelled = true; flow.deviceCode = null; flow = null; }
    }

    function disconnect() {
        cancel();
        store.remove(ITEM);
        saveAccount({ status: 'not_connected', login: '', connectedAt: null, scopes: [], error: null, errorAt: null });
    }

    /** The key kept on this computer, or null. Main process only. */
    function token() {
        const text = store.get(ITEM);
        if (!text) return null;
        try { return JSON.parse(text); } catch { return null; }
    }

    /** Linked = the state says so AND the key is still readable here. */
    function linked() {
        return readAccount().status === 'connected' && !!token()?.token;
    }

    /**
     * Asks GitHub whether the key still works. A key withdrawn on GitHub is
     * forgotten here; no network leaves the account as it is.
     */
    async function check() {
        if (readAccount().status !== 'connected') return { checked: false };
        const kept = token();
        if (!kept?.token) { store.remove(ITEM); failed('token_missing'); return { checked: true, ok: false, reason: 'token_missing' }; }
        try {
            const user = await client.getUser(kept.token);
            if (user.scopes && !canCreateRepos(user.scopes)) { failed('scope'); return { checked: true, ok: false, reason: 'scope' }; }
            if (user.login !== readAccount().login) saveAccount({ ...readAccount(), login: user.login });
            return { checked: true, ok: true };
        } catch (error) {
            if (error.reason === 'revoked') { store.remove(ITEM); failed('revoked'); return { checked: true, ok: false, reason: 'revoked' }; }
            return { checked: false, reason: error.reason || 'unknown' };
        }
    }

    /** For tests: the background wait of the current sign-in. */
    const pending = () => flow?.finished || Promise.resolve();

    return { start, connectWithToken, cancel, disconnect, revoked, check, token, linked, publicFlow, pending, manageUrl: client.manageUrl, tokenPageUrl: client.tokenPageUrl };
}

module.exports = { createGithubConnector, ITEM };
