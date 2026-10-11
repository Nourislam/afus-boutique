/**
 * INTERNAL side: the only place where the website reads the shop's SQLite
 * database. Read only, and only the columns the website may ever need,
 * named one by one (never SELECT *): purchase costs, wholesale prices,
 * suppliers, SKUs / barcodes, stock counts, employees, customers, sales,
 * cash and settings other than the shop's own description are never read.
 *
 * Stock counts are turned into "available" (1 / 0) inside SQL: the numbers
 * themselves never reach the program's website code.
 *
 * `api` is the { all, get } adapter of the database.
 */
const AVAILABLE_PRODUCT = `CASE WHEN COALESCE(p.has_variants, 0) = 1
    THEN (SELECT COALESCE(SUM(CASE WHEN v.stock_quantity > 0 THEN 1 ELSE 0 END), 0) > 0 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1)
    ELSE COALESCE(p.stock_quantity, 0) > 0 END`;

// The keys of the shop's settings (store_config) a website may show; the
// others (tax numbers RC / NIF / NIS / AI, owner, printers, receipts...) are
// never taken out of the settings.
const STORE_KEYS = ['businessName', 'shopLogo', 'shopDescription', 'businessPhone', 'businessEmail', 'businessAddress', 'businessCity', 'businessWilaya', 'currency', 'defaultLanguage'];

function readJson(text, fallback) {
    if (text === null || text === undefined) return fallback;
    try { return JSON.parse(text); } catch { return fallback; }
}

function readStore(api) {
    const config = readJson(api.get("SELECT value FROM settings WHERE key = 'store_config'")?.value, {}) || {};
    return Object.fromEntries(STORE_KEYS.map(k => [k, config[k]]));
}

function readProducts(api) {
    return api.all(`
        SELECT p.id, p.name, p.description, p.category_id, p.brand, p.gender, p.season, p.collection,
               p.price, p.image_path, p.gallery, p.created_at, COALESCE(p.has_variants, 0) AS has_variants,
               ${AVAILABLE_PRODUCT} AS available
        FROM products p WHERE p.is_active = 1 ORDER BY p.name, p.id`);
}

function readVariants(api) {
    return api.all(`
        SELECT v.product_id, v.color, v.color_code, v.size, v.price, (COALESCE(v.stock_quantity, 0) > 0) AS available
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND COALESCE(p.has_variants, 0) = 1
        ORDER BY v.sort_order, v.rowid`);
}

const readCategories = (api) => api.all('SELECT id, name FROM categories ORDER BY name, id');

/** Automatic promotions only (a coupon promotion is the till's, its code is never read). */
const readPromotions = (api) => api.all(`
    SELECT id, name, type, value, applies_to, applies_to_ids, start_date, end_date, min_purchase, auto_apply, is_active, max_uses, current_uses
    FROM promotions WHERE is_active = 1 AND auto_apply = 1 AND (coupon_code IS NULL OR TRIM(coupon_code) = '')`);

const { countedSale } = require('../../services/saleStatus');

/**
 * The shop's best sellers of the last 90 days: article ids in order, nothing
 * else (no quantity, no amount leaves SQL). Pieces returned are taken off;
 * voided / cancelled sales do not count.
 */
function readBestSellers(api, { now = Date.now(), days = 90, limit = 24 } = {}) {
    const since = new Date(now - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    try {
        return api.all(`
            SELECT si.product_id AS id
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            LEFT JOIN (SELECT sale_item_id, SUM(quantity) AS returned FROM return_items WHERE sale_item_id IS NOT NULL GROUP BY sale_item_id) r ON r.sale_item_id = si.id
            WHERE s.created_at >= ? AND ${countedSale('s')} AND si.product_id IS NOT NULL
            GROUP BY si.product_id
            HAVING SUM(MAX(si.quantity - COALESCE(r.returned, 0), 0)) > 0
            ORDER BY SUM(MAX(si.quantity - COALESCE(r.returned, 0), 0)) DESC, si.product_id
            LIMIT ?`, [since, limit]).map(r => String(r.id));
    } catch {
        return [];
    }
}

function readInternal(api, { now = Date.now() } = {}) {
    return {
        store: readStore(api),
        products: readProducts(api),
        variants: readVariants(api),
        categories: readCategories(api),
        promotions: readPromotions(api),
        bestSellers: readBestSellers(api, { now }),
    };
}

/**
 * Words that must never be on the website, read from the private tables
 * (for the final check, publicData/guard.js): customers' and suppliers'
 * phones and e-mails, the shop's tax numbers, employees' PIN hashes. Only
 * long enough values (a short one could be a size or a colour).
 */
function readPrivateMarkers(api) {
    const out = new Set();
    const add = (v) => { const s = String(v ?? '').trim(); if (s.length >= 6) out.add(s); };
    const tryAll = (sql) => { try { return api.all(sql); } catch { return []; } };
    for (const r of tryAll('SELECT phone, email FROM customers')) { add(r.phone); add(r.email); }
    for (const r of tryAll('SELECT phone, email FROM suppliers')) { add(r.phone); add(r.email); }
    for (const r of tryAll('SELECT pin FROM employees')) add(r.pin);
    const config = readJson(api.get("SELECT value FROM settings WHERE key = 'store_config'")?.value, {}) || {};
    for (const k of ['businessRc', 'businessTaxId', 'businessNis', 'businessAi']) add(config[k]);
    return out;
}

module.exports = { readInternal, readBestSellers, readPrivateMarkers, STORE_KEYS };
