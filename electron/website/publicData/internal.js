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

/**
 * "Few left": in stock, and as many pieces as fewAt or fewer. Only the yes /
 * no leaves SQL (the counts stay in the shop).
 */
function readProducts(api, fewAt = 3) {
    const n = Number.isInteger(fewAt) && fewAt > 0 ? fewAt : 3;
    return api.all(`
        SELECT p.id, p.name, p.description, p.category_id, p.brand, p.gender, p.season, p.collection,
               p.price, p.image_path, p.gallery, p.created_at, COALESCE(p.has_variants, 0) AS has_variants,
               ${AVAILABLE_PRODUCT} AS available,
               (CASE WHEN COALESCE(p.has_variants, 0) = 1
                     THEN (SELECT COALESCE(SUM(MAX(COALESCE(v.stock_quantity, 0), 0)), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1)
                     ELSE MAX(COALESCE(p.stock_quantity, 0), 0) END) BETWEEN 1 AND ${n} AS few
        FROM products p WHERE p.is_active = 1 ORDER BY p.name, p.id`);
}

function readVariants(api, fewAt = 3) {
    const n = Number.isInteger(fewAt) && fewAt > 0 ? fewAt : 3;
    return api.all(`
        SELECT v.product_id, v.color, v.color_code, v.size, v.price, (COALESCE(v.stock_quantity, 0) > 0) AS available,
               (COALESCE(v.stock_quantity, 0) BETWEEN 1 AND ${n}) AS few
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND COALESCE(p.has_variants, 0) = 1
        ORDER BY v.sort_order, v.rowid`);
}

const readCategories = (api) => api.all('SELECT id, name FROM categories ORDER BY name, id');

/** Automatic promotions only (a coupon promotion is the till's, its code is never read). */
const readPromotions = (api) => api.all(`
    SELECT id, name, type, value, applies_to, applies_to_ids, start_date, end_date, min_purchase, auto_apply, is_active, max_uses, current_uses
    FROM promotions WHERE is_active = 1 AND auto_apply = 1 AND (coupon_code IS NULL OR TRIM(coupon_code) = '')`);

const rankings = require('../../services/storeRankings');

/**
 * New products and best sellers by AFUS's rules (services/storeRankings.js):
 * article ids in order, nothing else (no quantity, no amount leaves SQL).
 */
function readRankings(api, { now = Date.now() } = {}) {
    const ids = (fn) => { try { return fn().map(r => r.id); } catch { return []; } };
    return {
        newProducts: ids(() => rankings.newProducts(api, { now })),
        bestSellers: ids(() => rankings.bestSellers(api, { now })),
    };
}

function readInternal(api, { now = Date.now(), fewAt = 3 } = {}) {
    return {
        store: readStore(api),
        products: readProducts(api, fewAt),
        variants: readVariants(api, fewAt),
        categories: readCategories(api),
        promotions: readPromotions(api),
        ...readRankings(api, { now }),
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

module.exports = { readInternal, readRankings, readPrivateMarkers, STORE_KEYS };
