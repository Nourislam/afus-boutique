/**
 * Is the shop's own website (or its API) answering? A GET to the address
 * the program published, nothing sent, nothing followed elsewhere.
 * -> { ok, status, json? }
 */
async function ping(url, { fetch: fetchImpl, timeoutMs = 10000 } = {}) {
    const doFetch = fetchImpl || ((u, init) => require('electron').net.fetch(u, init));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await doFetch(url, { method: 'GET', headers: { 'User-Agent': 'AfusBoutique', 'Cache-Control': 'no-cache' }, signal: controller.signal, redirect: 'manual' });
        let json = null;
        if ((res.headers.get('content-type') || '').includes('application/json')) { try { json = await res.json(); } catch { json = null; } }
        return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
    } catch {
        return { ok: false, status: 0 };
    } finally {
        clearTimeout(timer);
    }
}

/** The shop's order requests from its website API (the shop key goes there only). */
async function fetchOrders(apiUrl, key, { since, fetch: fetchImpl, timeoutMs = 15000 } = {}) {
    const doFetch = fetchImpl || ((u, init) => require('electron').net.fetch(u, init));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${apiUrl.replace(/\/$/, '')}/api/orders?limit=200${since ? `&since=${encodeURIComponent(since)}` : ''}`;
    try {
        const res = await doFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'AfusBoutique' }, signal: controller.signal, redirect: 'error' });
        if (res.status === 401) return { ok: false, reason: 'key' };
        if (!res.ok) return { ok: false, reason: 'network' };
        const data = await res.json();
        return { ok: true, orders: Array.isArray(data.orders) ? data.orders : [] };
    } catch {
        return { ok: false, reason: 'network' };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { ping, fetchOrders };
