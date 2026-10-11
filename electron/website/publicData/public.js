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

/** What the owner wrote for the website (Website screen), cleaned. */
function publicInfo(info = {}) {
    const hours = (Array.isArray(info.hours) ? info.hours : String(info.hours || '').split('\n'))
        .map(l => text(l, 80)).filter(Boolean).slice(0, 10);
    return {
        hours,
        social: Object.fromEntries(Object.entries(SOCIAL_HOSTS).map(([k, hosts]) => [k, link(info.social?.[k], hosts)]).filter(([, v]) => v)),
        mapUrl: link(info.mapUrl, MAP_HOSTS),
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
        // Best sellers: the order only (from the shop's own sales), public articles only
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
    },
    categories: { '*': { id: 'string', name: 'string', count: 'number' } },
    brands: { '*': 'string' },
    bestSellers: { '*': 'string' },
    products: {
        '*': {
            id: 'string', name: 'string', description: 'string', categoryId: 'string|null', brand: 'string', gender: 'string', season: 'string', collection: 'string',
            price: 'number', salePrice: 'number|null', images: { '*': 'string' },
            variants: { '*': { color: 'string', colorCode: 'string', size: 'string', price: 'number|null', available: 'boolean' } },
            available: 'boolean', createdAt: 'string|null',
        },
    },
    promotions: { '*': { id: 'string', name: 'string', type: 'string', value: 'number', appliesTo: 'string', ids: { '*': 'string' }, endsAt: 'string|null' } },
};

module.exports = { toPublic, publicInfo, PUBLIC_SHAPE, VERSION, IMAGE, SOCIAL_HOSTS, MAP_HOSTS };
