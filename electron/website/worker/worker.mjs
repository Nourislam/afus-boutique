/**
 * The shop's website API, a Cloudflare Worker on the shop's own account
 * (made and updated by Afus Boutique; the shop never sees it).
 *
 *   GET  /api/health             is the website's API up? (public)
 *   POST /api/orders             a customer's order (the checkout page's
 *                                form, or JSON); public, from the website
 *   GET  /api/orders?limit=      the orders waiting, oldest first   } Afus
 *   POST /api/orders/ack         {"ids": [...]}: kept by Afus, removed  } Boutique
 *                                from here                               } only
 *
 * D1 is a waiting room, not the shop's database: an order stays here only
 * until Afus Boutique has saved it in the shop's SQLite and acknowledged it
 * (ack), then it is deleted. If Afus is closed, orders simply wait.
 *
 * Security
 *   HTTPS only (workers.dev); Strict-Transport-Security.
 *   Afus Boutique's endpoints: Authorization: Bearer <shop key> AND
 *   X-Afus-Store: <store id> (this shop's own Worker, never another's);
 *   the key is compared in constant time; repeated wrong keys are refused
 *   for a while. The website (public) holds no key at all.
 *   Orders: checked field by field; from the shop's own website only (Origin);
 *   5 per 10 minutes from one place; a hidden field stops robots.
 *   Idempotency: the checkout sends an order key (random, per order); the
 *   same key again (double press, retry, back button) gives the same order,
 *   never a second one, also after the order left for Afus (keys kept 30 days).
 *
 * Bindings (set by Afus Boutique when it uploads this file):
 *   DB         this shop's D1 database (schema.sql)
 *   SHOP_KEY   secret, known only to Afus Boutique on the shop's computer
 *   STORE_ID   this shop's id (Afus sends it back on every call)
 *   SITE_URL   the website's address (where customers come back to)
 *   SITE_URLS  every address of the same website (JSON list: the free address
 *              and the shop's own domain once connected); optional
 *   SHOP_NAME  the shop's name
 *
 * No article, price or stock is kept here: the articles are the shop's, in
 * Afus Boutique, which checks every request against them.
 */
const LIMITS = {
    product_id: 80, product_name: 160, size: 40, color: 40, customer_name: 80, first_name: 40, last_name: 40, phone: 20, wilaya: 60, commune: 60, address: 200, note: 500,
    courier_company: 60, office_wilaya: 60, office_commune: 60, courier_office: 120,
};
const ITEM_LIMITS = { product_id: 80, product_name: 160, size: 40, color: 40 };
const MAX_ITEMS = 30;
const MAX_QTY = 20;
// home: to the customer's address; office: picked up at a courier company's office
// (pickup: at the shop, sent by websites made before the courier offices)
const DELIVERY = ['home', 'office', 'pickup'];
const WILAYA = /^(0?[1-9]|[1-5]\d) - \S/;
const MAX_BODY = 64 * 1024; // a full cart, form-encoded (Arabic names take 9 bytes a letter)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

const AUTH_FAIL_MAX = 10;
const ACK_MAX = 200;
const KEY_DAYS = 30;
const ORDER_KEY = /^[A-Za-z0-9-]{16,64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SECURITY = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
};

function siteOrigin(env) {
    try { return new URL(env.SITE_URL).origin; } catch { return ''; }
}

/** Every address of the shop's website (https only): its free address, its own domain. */
function siteUrls(env) {
    let list = [];
    try { list = JSON.parse(env.SITE_URLS || '[]'); } catch { list = []; }
    return [env.SITE_URL, ...(Array.isArray(list) ? list : [])].filter(u => {
        // https only (plain http for a local test server only, never a real address)
        try { const x = new URL(u); return typeof u === 'string' && (x.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(x.hostname)); } catch { return false; }
    });
}
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };

/**
 * The address the customer is on (from the browser's Origin, else its
 * Referer), when it is one of the shop's: the answer and the way back use
 * it. Anything else: the website's main address.
 */
function siteFor(env, request) {
    const from = request.headers.get('Origin') || originOf(request.headers.get('Referer') || '');
    return siteUrls(env).find(u => from && originOf(u) === from) || env.SITE_URL;
}

function json(env, status, body, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': siteOrigin(env) || 'null', Vary: 'Origin', ...SECURITY, ...extra },
    });
}

/** Back to the website (its own address only: never an address taken from the request). */
function backTo(env, page) {
    let url;
    try { url = new URL(page, env.SITE_URL).toString(); } catch { return json(env, 400, { ok: false }); }
    return new Response(null, { status: 303, headers: { Location: url, ...SECURITY } });
}

/** Same length and content, without stopping at the first difference. */
function sameText(a, b) {
    const x = String(a || '');
    const y = String(b || '');
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    return diff === 0 && x.length > 0;
}

async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** "16 - Alger" -> 16 (one of the 58 wilayas), else 0. */
function wilayaCode(text) {
    if (!WILAYA.test(text)) return 0;
    const n = parseInt(text, 10);
    return n >= 1 && n <= 58 ? n : 0;
}

/** An Algerian number: mobile 05/06/07 + 8 digits, or fixed 0 + 8 digits; +213 / 00213 accepted. */
function algerianPhone(text) {
    let d = String(text || '').replace(/[\s.-]/g, '');
    if (/[^\d+]/.test(d)) return '';
    d = d.replace(/^(\+|00)213/, '0');
    return /^0[5-7]\d{8}$/.test(d) || /^0[1-49]\d{7}$/.test(d) ? d : '';
}

/** The cart's lines (JSON text or list), checked; null when there is none, false when wrong. */
function readItems(value) {
    if (value === undefined || value === null || value === '' || value === '[]') return null;
    let list;
    try { list = typeof value === 'string' ? JSON.parse(value) : value; } catch { return false; }
    if (!Array.isArray(list) || !list.length || list.length > MAX_ITEMS) return false;
    const items = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object') return false;
        const item = {};
        for (const [key, max] of Object.entries(ITEM_LIMITS)) item[key] = clean(raw[key], max);
        if (!item.product_id) return false;
        item.quantity = Math.min(MAX_QTY, Math.max(1, parseInt(raw.quantity, 10) || 1));
        const price = Number(raw.unit_price);
        item.unit_price = raw.unit_price !== null && raw.unit_price !== '' && Number.isFinite(price) && price >= 0 && price < 1e9 ? Math.round(price * 100) / 100 : null;
        items.push(item);
    }
    return items;
}

/** The order request, checked; { order } or { error }. */
function readOrder(fields) {
    if (clean(fields.website, 100)) return { error: 'spam' }; // a field people never see
    const order = {};
    for (const [key, max] of Object.entries(LIMITS)) order[key] = clean(fields[key], max);
    order.quantity = Math.min(MAX_QTY, Math.max(1, parseInt(fields.quantity, 10) || 1));
    const items = readItems(fields.items);
    if (items === false) return { error: 'items' };
    order.items = items || [];
    if (items) {
        // The first line names the order in lists; the quantity is the whole cart's
        order.product_id = order.product_id || items[0].product_id;
        order.product_name = order.product_name || items[0].product_name;
        order.quantity = items.reduce((n, i) => n + i.quantity, 0);
    }
    order.delivery = DELIVERY.includes(fields.delivery) ? fields.delivery : '';
    if (!order.product_id) return { error: 'product' };
    // The form on an article's page: the full name in one field, an Algerian
    // phone, wilaya and commune, home (with the address) or a courier office
    // (which one is settled when the shop calls to confirm)
    if (fields.source === 'product') {
        if (order.customer_name.length < 3) return { error: 'name' };
        const words = order.customer_name.split(/\s+/);
        order.first_name = words[0].slice(0, LIMITS.first_name);
        order.last_name = words.slice(1).join(' ').slice(0, LIMITS.last_name);
        if (!wilayaCode(order.wilaya) || order.commune.length < 2) return { error: 'place' };
        if (!['home', 'office'].includes(order.delivery)) return { error: 'delivery' };
        if (order.delivery === 'home' && order.address.length < 3) return { error: 'address' };
        if (order.delivery === 'office') { order.office_wilaya = order.wilaya; order.office_commune = order.office_commune || order.commune; order.courier_office = ''; }
        if (order.delivery !== 'home') order.address = '';
        if (order.delivery !== 'office') { order.courier_company = ''; order.office_wilaya = ''; order.office_commune = ''; order.courier_office = ''; }
        const phone = algerianPhone(order.phone);
        if (!phone) return { error: 'phone' };
        order.phone = phone;
        order.source = 'product';
        return { order };
    }
    // The checkout: first and last name, an Algerian phone, wilaya and commune,
    // and what the chosen delivery needs (older forms send one name)
    const checkout = !!(order.first_name || order.last_name);
    if (checkout) {
        if (order.first_name.length < 2 || order.last_name.length < 2) return { error: 'name' };
        order.customer_name = `${order.first_name} ${order.last_name}`.slice(0, LIMITS.customer_name);
        if (!wilayaCode(order.wilaya) || order.commune.length < 2) return { error: 'place' };
        if (order.delivery === 'home' && order.address.length < 3) return { error: 'address' };
        if (order.delivery === 'office' && (order.courier_company.length < 2 || !wilayaCode(order.office_wilaya) || order.office_commune.length < 2 || order.courier_office.length < 2)) return { error: 'office' };
        if (!['home', 'office'].includes(order.delivery)) return { error: 'delivery' };
    } else if (order.customer_name.length < 2) return { error: 'name' };
    if (order.delivery !== 'office') { order.courier_company = ''; order.office_wilaya = ''; order.office_commune = ''; order.courier_office = ''; }
    const phone = algerianPhone(order.phone);
    if (!phone) return { error: 'phone' };
    order.phone = phone;
    return { order };
}

async function createOrder(request, env) {
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_BODY) return json(env, 413, { ok: false, error: 'too_large' });
    const type = request.headers.get('Content-Type') || '';
    const isForm = type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');
    let fields;
    try {
        const text = await request.text();
        if (text.length > MAX_BODY) return json(env, 413, { ok: false, error: 'too_large' });
        fields = isForm ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text || '{}');
    } catch {
        return isForm ? backTo(env, 'order-error.html') : json(env, 400, { ok: false, error: 'bad_request' });
    }
    const { order, error } = readOrder(fields || {});
    if (error) return isForm ? backTo(env, 'order-error.html') : json(env, 400, { ok: false, error });
    // Back to the thanks page; "cart=1" empties the cart (only an order of the cart does)
    const done = (id, status) => (isForm ? backTo(env, order.items.length && order.source !== 'product' ? 'thanks.html?cart=1' : 'thanks.html') : json(env, status, { ok: true, id, duplicate: status === 200 }));

    // The same order sent again (double press, retry): the same answer, no second order
    const key = ORDER_KEY.test(String(fields.order_key || '')) ? String(fields.order_key) : null;
    if (key) {
        const seen = await env.DB.prepare('SELECT order_id FROM order_keys WHERE order_key = ?').bind(key).first();
        if (seen) return done(seen.order_id, 200);
    }
    const ipHash = await whoIs(request, env);
    if (await overLimit(env, 'order', ipHash, RATE_MAX, RATE_WINDOW_MS)) return isForm ? backTo(env, 'order-error.html') : json(env, 429, { ok: false, error: 'too_many' });

    const id = crypto.randomUUID();
    const at = new Date().toISOString();
    // An order request only: nothing is sold and no stock moves here (Afus Boutique decides).
    // Key, order and rate count are written together (one D1 batch: all or nothing)
    const writes = [
        env.DB.prepare(`INSERT INTO orders (id, created_at, product_id, product_name, size, color, quantity, customer_name, first_name, last_name, phone, wilaya, commune, address, delivery,
                          courier_company, office_wilaya, office_commune, courier_office, items, note, ip_hash, order_key)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(id, at, order.product_id, order.product_name, order.size, order.color, order.quantity,
                order.customer_name, order.first_name, order.last_name, order.phone, order.wilaya, order.commune, order.address, order.delivery,
                order.courier_company, order.office_wilaya, order.office_commune, order.courier_office, JSON.stringify(order.items), order.note, ipHash, key || ''),
        env.DB.prepare('INSERT INTO hits (kind, who, created_at) VALUES (?, ?, ?)').bind('order', ipHash, at),
    ];
    if (key) writes.unshift(env.DB.prepare('INSERT INTO order_keys (order_key, order_id, created_at) VALUES (?, ?, ?)').bind(key, id, at));
    try {
        await env.DB.batch(writes);
    } catch (e) {
        // Two presses at the same moment: the other one made the order
        const seen = key ? await env.DB.prepare('SELECT order_id FROM order_keys WHERE order_key = ?').bind(key).first() : null;
        if (seen) return done(seen.order_id, 200);
        throw e;
    }
    return done(id, 201);
}

/** One place (an IP address), never kept as such: a hash with the shop's key. */
async function whoIs(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    return (await sha256(`${ip}|${env.SHOP_KEY}`)).slice(0, 32);
}

async function overLimit(env, kind, who, max, windowMs) {
    const since = new Date(Date.now() - windowMs).toISOString();
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE kind = ? AND who = ? AND created_at > ?').bind(kind, who, since).first();
    return (row?.n || 0) >= max;
}

/**
 * Afus Boutique of this shop only: the shop key (constant time) and this
 * Worker's own store id. Wrong keys are counted: too many from one place
 * and even the right key is refused there for a while.
 * -> null when allowed, else the Response to send.
 */
async function afusOnly(request, env) {
    const who = await whoIs(request, env);
    if (await overLimit(env, 'auth_fail', who, AUTH_FAIL_MAX, RATE_WINDOW_MS)) return json(env, 429, { ok: false, error: 'too_many' }, { 'Access-Control-Allow-Origin': 'null' });
    const auth = request.headers.get('Authorization') || '';
    const keyOk = !!env.SHOP_KEY && sameText(auth.replace(/^Bearer\s+/i, ''), env.SHOP_KEY);
    const storeOk = !!env.STORE_ID && sameText(request.headers.get('X-Afus-Store') || '', env.STORE_ID);
    if (keyOk && storeOk) return null;
    await env.DB.prepare('INSERT INTO hits (kind, who, created_at) VALUES (?, ?, ?)').bind('auth_fail', who, new Date().toISOString()).run();
    return json(env, keyOk ? 403 : 401, { ok: false }, { 'Access-Control-Allow-Origin': 'null' });
}

/** The orders waiting for Afus Boutique, oldest first. */
async function listOrders(request, env, url) {
    const refused = await afusOnly(request, env);
    if (refused) return refused;
    const since = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(url.searchParams.get('since') || '') ? url.searchParams.get('since') : '1970-01-01T00:00:00.000Z';
    const limit = Math.min(ACK_MAX, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 100));
    const { results } = await env.DB.prepare(`SELECT id, created_at, product_id, product_name, size, color, quantity, customer_name, first_name, last_name, phone, wilaya, commune, address, delivery,
                                              courier_company, office_wilaya, office_commune, courier_office, items, note, status
                                              FROM orders WHERE created_at > ? ORDER BY created_at, id LIMIT ?`).bind(since, limit).all();
    const waiting = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first();
    return json(env, 200, { ok: true, store: env.STORE_ID, orders: results || [], waiting: waiting?.n || 0 }, { 'Access-Control-Allow-Origin': 'null' });
}

/**
 * Afus Boutique saved these orders in the shop's SQLite: they leave the
 * waiting room. Unknown ids are ignored (already gone: a repeated ack is fine).
 */
async function ackOrders(request, env) {
    const refused = await afusOnly(request, env);
    if (refused) return refused;
    if (!(request.headers.get('Content-Type') || '').includes('application/json')) return json(env, 415, { ok: false, error: 'json_only' }, { 'Access-Control-Allow-Origin': 'null' });
    let body;
    try {
        const text = await request.text();
        if (text.length > 16 * 1024) return json(env, 413, { ok: false, error: 'too_large' }, { 'Access-Control-Allow-Origin': 'null' });
        body = JSON.parse(text);
    } catch {
        return json(env, 400, { ok: false, error: 'bad_request' }, { 'Access-Control-Allow-Origin': 'null' });
    }
    const ids = Array.isArray(body?.ids) ? body.ids : null;
    if (!ids || ids.length > ACK_MAX || !ids.every(id => typeof id === 'string' && ID.test(id))) return json(env, 400, { ok: false, error: 'ids' }, { 'Access-Control-Allow-Origin': 'null' });
    let removed = 0;
    if (ids.length) {
        const r = await env.DB.prepare(`DELETE FROM orders WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
        removed = r?.meta?.changes ?? 0;
    }
    // Old order keys and counts are not needed any more
    const old = new Date(Date.now() - KEY_DAYS * 86400000).toISOString();
    await env.DB.batch([
        env.DB.prepare('DELETE FROM order_keys WHERE created_at < ?').bind(old),
        env.DB.prepare('DELETE FROM hits WHERE created_at < ?').bind(new Date(Date.now() - 86400000).toISOString()),
    ]);
    const waiting = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first();
    return json(env, 200, { ok: true, store: env.STORE_ID, removed, waiting: waiting?.n || 0 }, { 'Access-Control-Allow-Origin': 'null' });
}

async function health(env) {
    const row = await env.DB.prepare("SELECT value FROM site_meta WHERE key = 'published_at'").first().catch(() => null);
    return json(env, 200, { ok: true, shop: env.SHOP_NAME || '', publishedAt: row?.value || null });
}

export default {
    async fetch(request, envIn) {
        const url = new URL(request.url);
        // The answers and the way back follow the address the customer came from (one of the shop's)
        const env = envIn.SITE_URL ? { ...envIn, SITE_URL: siteFor(envIn, request) } : envIn;
        try {
            // HTTPS only (an http:// call is not answered with data)
            if (url.protocol !== 'https:') return json(env, 403, { ok: false, error: 'https' });
            if (request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': siteOrigin(env) || 'null', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', ...SECURITY } });
            }
            if (url.pathname === '/api/health' && request.method === 'GET') return await health(env);
            if (url.pathname === '/api/orders' && request.method === 'POST') {
                // From the shop's own website only (a browser always says where the form was)
                const origin = request.headers.get('Origin');
                const known = siteUrls(envIn).map(originOf);
                if (origin && known.length && !known.includes(origin)) return json(env, 403, { ok: false, error: 'origin' });
                return await createOrder(request, env);
            }
            if (url.pathname === '/api/orders' && request.method === 'GET') return await listOrders(request, env, url);
            if (url.pathname === '/api/orders/ack' && request.method === 'POST') return await ackOrders(request, env);
            if (url.pathname === '/' && request.method === 'GET' && env.SITE_URL) return backTo(env, './');
            return json(env, 404, { ok: false });
        } catch {
            return json(env, 500, { ok: false });
        }
    },
};
