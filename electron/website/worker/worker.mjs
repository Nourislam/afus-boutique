/**
 * The shop's website API, a Cloudflare Worker on the shop's own account
 * (made and updated by Afus Boutique; the shop never sees it).
 *
 *   GET  /api/health             is the website's API up? (public)
 *   POST /api/orders             a customer's order request: the cart of the
 *                                checkout page (items) or the order form of
 *                                an article page (form or JSON)
 *   GET  /api/orders?since=&limit=   the order requests, for Afus Boutique
 *                                only (Authorization: Bearer <shop key>)
 *
 * Bindings (set by Afus Boutique when it uploads this file):
 *   DB         the shop's D1 database (schema.sql): orders and site_meta
 *   SHOP_KEY   secret, known only to Afus Boutique on the shop's computer
 *   SITE_URL   the website's address (where customers come back to)
 *   SHOP_NAME  the shop's name
 *
 * No article, price or stock is kept here: the articles are the shop's, in
 * Afus Boutique, which checks every request against them.
 */
const LIMITS = { product_id: 80, product_name: 160, size: 40, color: 40, customer_name: 80, phone: 20, wilaya: 60, commune: 60, address: 200, note: 500 };
const ITEM_LIMITS = { product_id: 80, product_name: 160, size: 40, color: 40 };
const MAX_ITEMS = 30;
const MAX_QTY = 20;
const DELIVERY = ['home', 'pickup'];
const MAX_BODY = 64 * 1024; // a full cart, form-encoded (Arabic names take 9 bytes a letter)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

const SECURITY = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
};

function siteOrigin(env) {
    try { return new URL(env.SITE_URL).origin; } catch { return ''; }
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
    const digits = order.phone.replace(/\D/g, '');
    if (!order.product_id) return { error: 'product' };
    if (order.customer_name.length < 2) return { error: 'name' };
    if (digits.length < 8 || digits.length > 15) return { error: 'phone' };
    order.phone = digits;
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

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ipHash = (await sha256(`${ip}|${env.SHOP_KEY}`)).slice(0, 32);
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE ip_hash = ? AND created_at > ?').bind(ipHash, since).first();
    if ((recent?.n || 0) >= RATE_MAX) return isForm ? backTo(env, 'order-error.html') : json(env, 429, { ok: false, error: 'too_many' });

    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO orders (id, created_at, product_id, product_name, size, color, quantity, customer_name, phone, wilaya, commune, address, delivery, items, note, ip_hash)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, new Date().toISOString(), order.product_id, order.product_name, order.size, order.color, order.quantity,
            order.customer_name, order.phone, order.wilaya, order.commune, order.address, order.delivery, JSON.stringify(order.items), order.note, ipHash)
        .run();
    // From the cart: the thanks page empties it
    return isForm ? backTo(env, order.items.length ? 'thanks.html?cart=1' : 'thanks.html') : json(env, 201, { ok: true, id });
}

async function listOrders(request, env, url) {
    const auth = request.headers.get('Authorization') || '';
    if (!env.SHOP_KEY || !sameText(auth.replace(/^Bearer\s+/i, ''), env.SHOP_KEY)) return json(env, 401, { ok: false });
    const since = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(url.searchParams.get('since') || '') ? url.searchParams.get('since') : '1970-01-01T00:00:00.000Z';
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 100));
    const { results } = await env.DB.prepare(`SELECT id, created_at, product_id, product_name, size, color, quantity, customer_name, phone, wilaya, commune, address, delivery, items, note, status
                                              FROM orders WHERE created_at > ? ORDER BY created_at LIMIT ?`).bind(since, limit).all();
    return json(env, 200, { ok: true, orders: results || [] }, { 'Access-Control-Allow-Origin': 'null' });
}

async function health(env) {
    const row = await env.DB.prepare("SELECT value FROM site_meta WHERE key = 'published_at'").first().catch(() => null);
    return json(env, 200, { ok: true, shop: env.SHOP_NAME || '', publishedAt: row?.value || null });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        try {
            if (request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': siteOrigin(env) || 'null', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', ...SECURITY } });
            }
            if (url.pathname === '/api/health' && request.method === 'GET') return await health(env);
            if (url.pathname === '/api/orders' && request.method === 'POST') return await createOrder(request, env);
            if (url.pathname === '/api/orders' && request.method === 'GET') return await listOrders(request, env, url);
            if (url.pathname === '/' && request.method === 'GET' && env.SITE_URL) return backTo(env, './');
            return json(env, 404, { ok: false });
        } catch {
            return json(env, 500, { ok: false });
        }
    },
};
