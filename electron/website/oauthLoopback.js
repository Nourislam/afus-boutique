/**
 * OAuth for a program installed on a computer (RFC 8252): the browser
 * comes back to a small server of the program on this computer only
 * (http://127.0.0.1:<port>/oauth/callback), with PKCE (RFC 7636, S256) and a
 * random "state" so that only the sign-in this program started is accepted.
 *
 *   pkce()             { verifier, challenge, method: 'S256' }
 *   randomState()      32 random bytes, base64url
 *   listen({ ports, path, expectedState, timeoutMs, page })
 *       -> { redirectUri, result: Promise<{ code } | { error }>, closed: Promise, close() }
 *       The first port free on 127.0.0.1 is used (the ports are the ones
 *       registered with the OAuth app). One answer is accepted, then the
 *       server closes; anything else (another path, another method, a wrong
 *       state) is refused without ending the wait, except a wrong state on the
 *       right path, which ends it (someone else's link).
 */
const crypto = require('crypto');
const http = require('http');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce() {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge, method: 'S256' };
}

const randomState = () => b64url(crypto.randomBytes(32));

/** Same length and content, in constant time. */
function sameText(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function tryListen(server, port) {
    return new Promise((resolve) => {
        const onError = () => { server.removeListener('listening', onOk); resolve(false); };
        const onOk = () => { server.removeListener('error', onError); resolve(true); };
        server.once('error', onError);
        server.once('listening', onOk);
        server.listen(port, '127.0.0.1');
    });
}

/**
 * page(kind) -> html shown in the browser once it came back:
 * kind 'ok' | 'denied' | 'error'.
 */
async function listen({ ports, path = '/oauth/callback', expectedState, timeoutMs = 10 * 60 * 1000, page = () => '' }) {
    let settle;
    const result = new Promise((resolve) => { settle = resolve; });
    let done = false;
    let timer = null;
    let markClosed;
    const closed = new Promise((resolve) => { markClosed = resolve; });
    // Stop listening at once (the port is free again), drop idle connections
    const shut = () => {
        server.close(() => markClosed());
        server.closeIdleConnections?.();
    };
    const finish = (value, res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        settle(value);
        // The browser gets its page first
        if (res && !res.writableFinished) res.once('finish', shut);
        else shut();
    };

    const server = http.createServer((req, res) => {
        const send = (status, kind) => {
            res.writeHead(status, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
                'X-Content-Type-Options': 'nosniff',
                Connection: 'close',
            });
            res.end(page(kind));
        };
        let url;
        try { url = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); res.end(); return; }
        if (req.method !== 'GET' || url.pathname !== path || done) { res.writeHead(404); res.end(); return; }
        const q = url.searchParams;
        if (!sameText(q.get('state'), expectedState)) {
            send(400, 'error');
            finish({ error: 'state' }, res);
            return;
        }
        if (q.get('error')) {
            const denied = q.get('error') === 'access_denied';
            send(200, denied ? 'denied' : 'error');
            finish({ error: denied ? 'denied' : 'unknown' }, res);
            return;
        }
        const code = q.get('code');
        if (!code) { send(400, 'error'); finish({ error: 'unknown' }, res); return; }
        send(200, 'ok');
        finish({ code }, res);
    });
    server.keepAliveTimeout = 1000;

    let port = null;
    for (const p of ports) {
        if (await tryListen(server, p)) { port = p; break; }
    }
    if (port === null) {
        const error = new Error('no free port');
        error.reason = 'port_busy';
        throw error;
    }
    timer = setTimeout(() => finish({ error: 'expired' }), timeoutMs);
    timer.unref?.();

    return {
        redirectUri: `http://127.0.0.1:${port}${path}`,
        port,
        result,
        closed,
        close: () => finish({ error: 'cancelled' }),
    };
}

module.exports = { pkce, randomState, listen, sameText };
