/**
 * What the website shows, read from the shop's own tables (nothing written):
 * the shop's name and contact, the categories, and each article on sale with
 * its pictures, its price, its price during a live promotion and, for each
 * colour / size, whether it is available. Purchase prices and exact stock
 * never leave the program. `api` is the { all, get } adapter.
 */
const { labelSalePrice, parseIds } = require('../shared/promotions.mjs');

const PRODUCT_STOCK = `CASE WHEN COALESCE(p.has_variants, 0) = 1
    THEN (SELECT COALESCE(SUM(v.stock_quantity), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1)
    ELSE p.stock_quantity END`;

function readJson(text, fallback) {
    if (text === null || text === undefined) return fallback;
    try { return JSON.parse(text); } catch { return fallback; }
}

function buildSnapshot(api, { now = Date.now() } = {}) {
    const config = readJson(api.get("SELECT value FROM settings WHERE key = 'store_config'")?.value, {}) || {};
    const shop = {
        name: config.businessName || '',
        phone: config.businessPhone || '',
        email: config.businessEmail || '',
        address: config.businessAddress || '',
        city: config.businessCity || '',
        wilaya: config.businessWilaya || '',
        description: config.shopDescription || '',
        logo: config.shopLogo || '',
    };
    const promotions = api.all('SELECT * FROM promotions WHERE is_active = 1');
    const categories = api.all('SELECT id, name, color FROM categories ORDER BY name');
    const products = api.all(`
        SELECT p.id, p.name, p.description, p.category_id, p.brand, p.gender, p.season, p.collection,
               p.price, p.image_path, p.gallery, COALESCE(p.has_variants, 0) AS has_variants, ${PRODUCT_STOCK} AS stock
        FROM products p WHERE p.is_active = 1 ORDER BY p.name
    `);
    const variants = api.all(`
        SELECT v.product_id, v.color, v.color_code, v.size, v.price, COALESCE(v.stock_quantity, 0) AS stock
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND COALESCE(p.has_variants, 0) = 1
        ORDER BY v.sort_order, v.rowid
    `);
    const byProduct = new Map();
    for (const v of variants) {
        if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
        byProduct.get(v.product_id).push({ color: v.color || '', colorCode: v.color_code || '', size: v.size || '', price: v.price ?? null, available: v.stock > 0 });
    }
    const items = products.map(p => {
        const images = [p.image_path, ...(readJson(p.gallery, []) || [])].filter(Boolean);
        const sale = labelSalePrice(promotions, { productId: p.id, categoryId: p.category_id, price: p.price }, now);
        return {
            id: p.id, name: p.name, description: p.description || '', categoryId: p.category_id || null,
            brand: p.brand || '', gender: p.gender || '', season: p.season || '', collection: p.collection || '',
            price: Number(p.price) || 0, salePrice: sale ?? null, images,
            variants: p.has_variants ? (byProduct.get(p.id) || []) : [],
            available: (Number(p.stock) || 0) > 0,
        };
    });
    const usedCategories = new Set(items.map(i => i.categoryId).filter(Boolean));
    return {
        builtAt: new Date(now).toISOString(),
        shop,
        categories: categories.filter(c => usedCategories.has(c.id)),
        products: items,
        // Promotions on the whole shop or on categories, for the banners of the website
        promotions: promotions.filter(pr => pr.auto_apply).map(pr => ({ id: pr.id, name: pr.name, type: pr.type, value: pr.value, appliesTo: pr.applies_to, ids: parseIds(pr.applies_to_ids) })),
    };
}

/** The figures shown to the shop about what its website will show. */
function summarize(snapshot) {
    const products = snapshot.products;
    return {
        products: products.length,
        available: products.filter(p => p.available).length,
        onSale: products.filter(p => p.salePrice !== null && p.salePrice < p.price).length,
        withImages: products.filter(p => p.images.length > 0).length,
        categories: snapshot.categories.length,
    };
}

module.exports = { buildSnapshot, summarize };
