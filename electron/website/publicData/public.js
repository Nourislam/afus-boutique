/**
 * PUBLIC side: what the website may show, built field by field from the
 * internal rows (internal.js). Nothing is copied as a whole: every public
 * field is named here, cleaned (text length, no control characters) and
 * checked (pictures are file names of the images folder, colours are
 * #rrggbb, links are https to the expected sites).
 *
 * PUBLIC_SHAPE is the whole list of public fields; guard.js refuses
 * anything outside it.
 *
 *   toPublic(internal, { now, info }) -> public data (version 1)
 *     info: what the owner wrote for the website itself (hours, social
 *     links, map), kept in the website's settings
 */
const { labelSalePrice, parseIds, isPromotionLive } = require('../../shared/promotions.mjs');
const { COURIER_IDS, courierNames } = require('../storefront/couriers');

const VERSION = 1;
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpe?g|png|webp|gif)$/i;
// SVG pictures (the demo shop's drawings) only in the program's preview: an SVG
// file can hold script, so it is never published on the shop's website
const PREVIEW_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpe?g|png|webp|gif|svg)$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const LANGS = ['ar', 'fr', 'en'];
const SOCIAL_HOSTS = {
    facebook: ['facebook.com', 'fb.com', 'm.facebook.com', 'www.facebook.com'],
    instagram: ['instagram.com', 'www.instagram.com'],
    tiktok: ['tiktok.com', 'www.tiktok.com'],
};
const MAP_HOSTS = ['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl', 'openstreetmap.org', 'www.openstreetmap.org'];

/** One line of shop text: no control characters, trimmed, at most n characters. */
// eslint-disable-next-line no-control-regex
const text = (value, n) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n);
const multiline = (value, n) => text(value, n).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
// No price (NULL, empty) stays "no price": never 0
const money = (value) => (value === null || value === undefined || value === '' ? null
    : Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value) * 100) / 100 : null);
const image = (name, pattern = IMAGE) => (typeof name === 'string' && pattern.test(name) ? name : null);
const flag = (v) => v === 1 || v === true || v === '1';

function readJson(value, fallback) {
    if (Array.isArray(value)) return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

/** An https link to one of these hosts (or a subdomain), else ''. */
function link(value, hosts) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    return hosts.some(h => host === h || host.endsWith(`.${h}`)) ? url.toString().slice(0, 300) : '';
}

/**
 * What the website offers, chosen by the owner (Website screen › Features).
 *   orderForm       the order form on each article's page (name, phone, wilaya...)
 *   whatsappOrder   "Order on WhatsApp" under it (needs the shop's phone)
 *   cart            add to cart, the cart and the checkout (several pieces at once)
 *   homeDelivery / officeDelivery   the ways of delivery offered
 *   noteField    a note field for the customer
 *   trustBar        the strip "pay on delivery, delivery, a call first"
 * There is always a way to order (the form or the cart) and a way to deliver.
 */
const FEATURES = { orderForm: true, whatsappOrder: true, cart: true, homeDelivery: true, officeDelivery: true, noteField: true, trustBar: true, coupons: false, fewLeft: true };
function features(value) {
    const given = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const out = Object.fromEntries(Object.entries(FEATURES).map(([k, def]) => [k, typeof given[k] === 'boolean' ? given[k] : def]));
    if (!out.orderForm && !out.cart) out.orderForm = true;
    if (!out.homeDelivery && !out.officeDelivery) out.homeDelivery = true;
    return out;
}

/** A price of delivery in dinars (0 = free), or null (not set). */
function fee(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n) : null;
}

/**
 * Delivery prices (Website screen › Delivery): one price for home and one
 * for the courier office, the same everywhere, and the wilayas that differ
 * (their own prices, or not delivered); free above an amount (optional).
 */
function deliveryPrices(d) {
    const x = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    const seen = new Set();
    const wilayas = (Array.isArray(x.wilayas) ? x.wilayas : []).map(w => {
        const code = parseInt(w?.code, 10);
        if (!(code >= 1 && code <= 58) || seen.has(code)) return null;
        seen.add(code);
        const row = { code, home: fee(w.home), office: fee(w.office), off: w.off === true };
        return row.home !== null || row.office !== null || row.off ? row : null;
    }).filter(Boolean).sort((a, b) => a.code - b.code);
    return { home: fee(x.home), office: fee(x.office), freeOver: fee(x.freeOver), wilayas };
}

/** The price of delivery to a wilaya (1-58) for 'home' or 'office': a number, null (by phone), or false (not delivered). */
function deliveryFee(prices, wilayaCode, kind, amount = 0) {
    const d = deliveryPrices(prices);
    const w = d.wilayas.find(x => x.code === Number(wilayaCode));
    if (w?.off) return false;
    const price = w?.[kind] ?? d[kind];
    if (price === null || price === undefined) return null;
    if (d.freeOver !== null && amount >= d.freeOver) return 0;
    return price;
}

/** Ads and visit measures the shop uses (its own accounts): ids only, each in its known form. */
const TRACKERS = {
    facebook: /^\d{10,20}$/,
    tiktok: /^[A-Z0-9]{15,30}$/,
    snapchat: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    google: /^G-[A-Z0-9]{6,14}$/,
};
function trackers(t) {
    const x = t && typeof t === 'object' ? t : {};
    return Object.fromEntries(Object.entries(TRACKERS).map(([k, re]) => {
        const v = String(x[k] ?? '').trim();
        const norm = k === 'snapchat' ? v.toLowerCase() : k === 'google' || k === 'tiktok' ? v.toUpperCase() : v;
        return [k, re.test(norm) ? norm : ''];
    }));
}

/** A size guide per category (a few lines each: "M: chest 96–100, length 72"). */
function sizeGuides(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map(g => {
        const id = text(g?.categoryId, 80);
        const body = multiline(g?.text, 800);
        if (!id || !body || seen.has(id)) return null;
        seen.add(id);
        return { categoryId: id, text: body };
    }).filter(Boolean).slice(0, 100);
}

/** What the owner wrote for the website (Website screen), cleaned. */
function publicInfo(info = {}) {
    const hours = (Array.isArray(info.hours) ? info.hours : String(info.hours || '').split('\n'))
        .map(l => text(l, 80)).filter(Boolean).slice(0, 10);
    return {
        hours,
        social: Object.fromEntries(Object.entries(SOCIAL_HOSTS).map(([k, hosts]) => [k, link(info.social?.[k], hosts)]).filter(([, v]) => v)),
        mapUrl: link(info.mapUrl, MAP_HOSTS),
        // The delivery companies the shop works with (ids of storefront/couriers.js)
        couriers: [...new Set((Array.isArray(info.couriers) ? info.couriers : []).filter(id => COURIER_IDS.includes(id)))],
        features: features(info.features),
        delivery: deliveryPrices(info.delivery),
        tracking: trackers(info.tracking),
        sizeGuides: sizeGuides(info.sizeGuides),
        // "Few left" from this many pieces down (the counts themselves never leave SQLite)
        fewLeftAt: Number.isInteger(info.fewLeftAt) && info.fewLeftAt >= 1 && info.fewLeftAt <= 20 ? info.fewLeftAt : 3,
    };
}

function shopOf(store, info, pic) {
    const extra = publicInfo(info);
    return {
        name: text(store.businessName, 120),
        logo: pic(store.shopLogo) || '',
        description: multiline(store.shopDescription, 600),
        phone: text(store.businessPhone, 30),
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(store.businessEmail, 120)) ? text(store.businessEmail, 120) : '',
        address: text(store.businessAddress, 200),
        city: text(store.businessCity, 80),
        wilaya: text(store.businessWilaya, 80),
        currency: /^[A-Z]{3}$/.test(store.currency || '') ? store.currency : 'DZD',
        language: LANGS.includes(store.defaultLanguage) ? store.defaultLanguage : 'ar',
        hours: extra.hours,
        social: extra.social,
        mapUrl: extra.mapUrl,
        couriers: courierNames(extra.couriers),
        features: extra.features,
        delivery: extra.delivery,
        tracking: extra.tracking,
        sizeGuides: extra.sizeGuides,
    };
}

function toPublic(internal, { now = Date.now(), info = {}, preview = false } = {}) {
    const pattern = preview ? PREVIEW_IMAGE : IMAGE;
    const pic = (name) => image(name, pattern);
    const promotions = internal.promotions;
    const byProduct = new Map();
    for (const v of internal.variants) {
        if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
        byProduct.get(v.product_id).push({
            color: text(v.color, 40),
            colorCode: HEX.test(v.color_code || '') ? v.color_code.toLowerCase() : '',
            size: text(v.size, 20),
            price: money(v.price),
            available: flag(v.available),
            few: flag(v.few),
        });
    }
    const products = internal.products.map(p => {
        const price = money(p.price) ?? 0;
        const sale = labelSalePrice(promotions, { productId: p.id, categoryId: p.category_id, price }, now);
        const images = [p.image_path, ...(readJson(p.gallery, []) || [])].map(pic).filter(Boolean);
        return {
            id: String(p.id),
            name: text(p.name, 160),
            description: multiline(p.description, 2000),
            categoryId: p.category_id ? String(p.category_id) : null,
            brand: text(p.brand, 80),
            gender: text(p.gender, 30),
            season: text(p.season, 40),
            collection: text(p.collection, 80),
            price,
            salePrice: sale !== null && sale < price ? money(sale) : null,
            images: [...new Set(images)].slice(0, 6),
            variants: flag(p.has_variants) ? (byProduct.get(p.id) || []) : [],
            available: flag(p.available),
            few: flag(p.few),
            createdAt: p.created_at ? String(p.created_at).slice(0, 30) : null,
        };
    }).filter(p => p.name);

    const counts = new Map();
    for (const p of products) if (p.categoryId) counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1);
    const categories = internal.categories
        .filter(c => counts.has(String(c.id)))
        .map(c => ({ id: String(c.id), name: text(c.name, 80), count: counts.get(String(c.id)) }))
        .filter(c => c.name);
    return {
        version: VERSION,
        builtAt: new Date(now).toISOString(),
        shop: shopOf(internal.store, info, pic),
        categories,
        brands: [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        // New products (added in the last 7 days) and best sellers (completed sales of the
        // last 7 days): the order only, public articles only (services/storeRankings.js)
        newProducts: (internal.newProducts || []).map(String).filter(id => products.some(p => p.id === id)).slice(0, 200),
        bestSellers: (internal.bestSellers || []).map(String).filter(id => products.some(p => p.id === id)).slice(0, 24),
        products,
        // Live automatic promotions only, for the announcement and sale banners
        promotions: promotions.filter(pr => isPromotionLive(pr, now) && (pr.max_uses == null || Number(pr.max_uses) <= 0 || Number(pr.current_uses) < Number(pr.max_uses))).map(pr => ({
            id: String(pr.id), name: text(pr.name, 80), type: ['percentage', 'fixed'].includes(pr.type) ? pr.type : 'other',
            value: money(pr.value) ?? 0, appliesTo: ['all', 'category', 'product'].includes(pr.applies_to) ? pr.applies_to : 'all',
            ids: parseIds(pr.applies_to_ids).map(String).slice(0, 500), endsAt: pr.end_date ? String(pr.end_date).slice(0, 30) : null,
        })),
    };
}

/**
 * Every public field (the guard refuses any other). '*' is "items of a
 * list", a string is the type of a value.
 */
const PUBLIC_SHAPE = {
    version: 'number', builtAt: 'string',
    shop: {
        name: 'string', logo: 'string', description: 'string', phone: 'string', email: 'string', address: 'string', city: 'string', wilaya: 'string',
        currency: 'string', language: 'string', hours: { '*': 'string' }, social: { facebook: 'string', instagram: 'string', tiktok: 'string' }, mapUrl: 'string',
        couriers: { '*': 'string' },
        features: Object.fromEntries(Object.keys(FEATURES).map(k => [k, 'boolean'])),
        delivery: { home: 'number|null', office: 'number|null', freeOver: 'number|null', wilayas: { '*': { code: 'number', home: 'number|null', office: 'number|null', off: 'boolean' } } },
        tracking: Object.fromEntries(Object.keys(TRACKERS).map(k => [k, 'string'])),
        sizeGuides: { '*': { categoryId: 'string', text: 'string' } },
    },
    categories: { '*': { id: 'string', name: 'string', count: 'number' } },
    brands: { '*': 'string' },
    newProducts: { '*': 'string' },
    bestSellers: { '*': 'string' },
    products: {
        '*': {
            id: 'string', name: 'string', description: 'string', categoryId: 'string|null', brand: 'string', gender: 'string', season: 'string', collection: 'string',
            price: 'number', salePrice: 'number|null', images: { '*': 'string' },
            variants: { '*': { color: 'string', colorCode: 'string', size: 'string', price: 'number|null', available: 'boolean', few: 'boolean' } },
            available: 'boolean', few: 'boolean', createdAt: 'string|null',
        },
    },
    promotions: { '*': { id: 'string', name: 'string', type: 'string', value: 'number', appliesTo: 'string', ids: { '*': 'string' }, endsAt: 'string|null' } },
};

module.exports = { toPublic, publicInfo, features, FEATURES, deliveryPrices, deliveryFee, trackers, TRACKERS, sizeGuides, PUBLIC_SHAPE, VERSION, IMAGE, SOCIAL_HOSTS, MAP_HOSTS };
