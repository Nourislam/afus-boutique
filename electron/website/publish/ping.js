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

/** Only https:// (the shop key never travels in clear); http only for a local test server. */
const secure = (url, allowHttp) => /^https:\/\//.test(url) || (allowHttp && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url));

async function call(url, init, { fetch: fetchImpl, timeoutMs = 15000 } = {}) {
    const doFetch = fetchImpl || ((u, i) => require('electron').net.fetch(u, i));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await doFetch(url, { ...init, signal: controller.signal, redirect: 'error' });
        if (res.status === 401 || res.status === 403) return { ok: false, reason: 'key' };
        if (res.status === 429) return { ok: false, reason: 'busy' };
        if (!res.ok) return { ok: false, reason: 'network' };
        return { ok: true, data: await res.json() };
    } catch {
        return { ok: false, reason: 'network' };
    } finally {
        clearTimeout(timer);
    }
}

const headersOf = (key, storeId) => ({
    Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'AfusBoutique',
    ...(storeId ? { 'X-Afus-Store': storeId } : {}),
});

/**
 * The orders waiting on the shop's website API (oldest first). The shop key
 * and store id go there only, over https. A Worker answering for another
 * store is refused.
 */
async function fetchOrders(apiUrl, key, { since, storeId, limit = 100, fetch, timeoutMs, allowHttp = false } = {}) {
    if (!secure(apiUrl, allowHttp)) return { ok: false, reason: 'insecure' };
    const url = `${apiUrl.replace(/\/$/, '')}/api/orders?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ''}`;
    const r = await call(url, { method: 'GET', headers: headersOf(key, storeId) }, { fetch, timeoutMs });
    if (!r.ok) return r;
    if (storeId && r.data.store && r.data.store !== storeId) return { ok: false, reason: 'store' };
    // A Worker of a website published before the waiting room (no ack yet): it says no store
    const legacy = !('store' in r.data);
    return { ok: true, legacy, orders: Array.isArray(r.data.orders) ? r.data.orders : [], waiting: Number(r.data.waiting) || 0 };
}

/** These orders are saved in the shop's SQLite: the website API may delete them. */
async function ackOrders(apiUrl, key, ids, { storeId, fetch, timeoutMs, allowHttp = false } = {}) {
    if (!secure(apiUrl, allowHttp)) return { ok: false, reason: 'insecure' };
    const r = await call(`${apiUrl.replace(/\/$/, '')}/api/orders/ack`, {
        method: 'POST', headers: { ...headersOf(key, storeId), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    }, { fetch, timeoutMs });
    if (!r.ok) return r;
    if (storeId && r.data.store && r.data.store !== storeId) return { ok: false, reason: 'store' };
    return { ok: true, removed: Number(r.data.removed) || 0, waiting: Number(r.data.waiting) || 0 };
}

/** The shop's rules for the API: numbers refused, coupons (by hash), delivery prices. */
async function pushConfig(apiUrl, key, config, { storeId, fetch, timeoutMs, allowHttp = false } = {}) {
    if (!secure(apiUrl, allowHttp)) return { ok: false, reason: 'insecure' };
    const r = await call(`${apiUrl.replace(/\/$/, '')}/api/config`, {
        method: 'POST', headers: { ...headersOf(key, storeId), 'Content-Type': 'application/json' }, body: JSON.stringify(config),
    }, { fetch, timeoutMs });
    if (!r.ok) return r;
    if (storeId && r.data.store && r.data.store !== storeId) return { ok: false, reason: 'store' };
    return { ok: true };
}

/** How many times each page was seen these last days: [{ day, page, views }]. */
async function fetchViews(apiUrl, key, { storeId, fetch, timeoutMs, allowHttp = false } = {}) {
    if (!secure(apiUrl, allowHttp)) return { ok: false, reason: 'insecure' };
    const r = await call(`${apiUrl.replace(/\/$/, '')}/api/views`, { method: 'GET', headers: headersOf(key, storeId) }, { fetch, timeoutMs });
    if (!r.ok) return r;
    if (storeId && r.data.store && r.data.store !== storeId) return { ok: false, reason: 'store' };
    return { ok: true, views: Array.isArray(r.data.views) ? r.data.views : [] };
}

module.exports = { ping, fetchOrders, ackOrders, pushConfig, fetchViews, secure };
