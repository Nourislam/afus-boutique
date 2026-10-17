/**
 * The website's files, made from the shop's own data (catalogSnapshot of the
 * SQLite database, read only) and the chosen theme: every page, the pictures
 * the pages show, the public catalogue (catalog.json) and GitHub Pages'
 * small files. Nothing is made up and nothing private goes out: no purchase
 * price, no stock count, no customer.
 *
 *   buildSite({ snapshot, theme, orderUrl, readImage, lang })
 *     readImage(name) -> Buffer | null  (one of the shop's pictures)
 *   -> { files: [{ path, content }], summary, hash, contentHash }
 *      contentHash: the same files without the time they were made (the
 *      build time in catalog.json): equal when nothing the customer sees changed
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { renderPage, pagesOf, linkFor, scriptTexts, STYLE, SCRIPT, TRACK } = require('../storefront/render');
const { css } = require('../storefront/css');
const { fontFiles } = require('../storefront/fonts');
const { textsFor } = require('../storefront/texts');
const { money, placeholder } = require('../storefront/html');
const { readPhoto } = require('../storefront/photos');

const STORE_SCRIPT = path.join(__dirname, '..', 'storefront', 'assets', 'store.js');
const TRACK_SCRIPT = path.join(__dirname, '..', 'storefront', 'assets', 'track.js');

const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpe?g|png|webp|gif)$/i;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_FILES = 3000;

/** How the pages write money, for the script: "1 234,50 د.ج" -> group, decimal, prefix, suffix. */
function moneyFormat(lang, currency) {
    const zero = money(0, lang, currency);
    const at = zero.indexOf('0');
    const thousand = money(1000, lang, currency);
    const half = money(1.5, lang, currency);
    return { prefix: zero.slice(0, at), suffix: zero.slice(at + 1), group: thousand.charAt(thousand.indexOf('1') + 1), decimal: half.charAt(half.indexOf('1') + 1) };
}

/**
 * What the cart and checkout pages need (search.json): the articles the
 * pages already show, with the price the customer pays for each colour and
 * size. Public fields only, from the public data.
 */
function searchCatalog(snap, theme, lang, asset) {
    const t = textsFor(lang);
    const onSale = (p) => p.salePrice !== null && p.salePrice !== undefined && p.salePrice < p.price;
    return {
        version: 1,
        money: moneyFormat(lang, snap.shop.currency),
        texts: scriptTexts(t),
        products: snap.products.map(p => {
            const ratio = onSale(p) && p.price > 0 ? p.salePrice / p.price : 1;
            const pay = (price) => (price === null || price === undefined ? null : Math.round(price * ratio * 100) / 100);
            return {
                id: p.id,
                name: p.name,
                url: linkFor('product', p.id),
                image: p.images[0] ? asset(p.images[0]) : placeholder(p.name, theme.tokens.colors),
                price: onSale(p) ? p.salePrice : p.price,
                cat: p.categoryId || '',
                available: p.available,
                variants: p.variants.map(v => [v.color, v.size, v.available, pay(v.price)]),
            };
        }),
    };
}

function buildSite({ snapshot, theme, orderUrl = null, readImage = () => null, lang, cname = null }) {
    // The pictures that exist and can be published; the others are left out of the pages
    const images = new Map();
    const keep = (name) => {
        if (!name || !IMAGE.test(name)) return false;
        if (images.has(name)) return images.get(name) !== null;
        let data = null;
        try { data = readImage(name); } catch { data = null; }
        images.set(name, data && data.length && data.length <= MAX_IMAGE ? data : null);
        return images.get(name) !== null;
    };
    const snap = {
        ...snapshot,
        shop: {
            ...snapshot.shop, logo: keep(snapshot.shop.logo) ? snapshot.shop.logo : '',
            ...(snapshot.shop.hero ? { hero: { ...snapshot.shop.hero, image: keep(snapshot.shop.hero.image) ? snapshot.shop.hero.image : '' } } : {}),
        },
        products: snapshot.products.map(p => ({ ...p, images: p.images.filter(keep) })),
    };
    const language = lang || snap.shop.language || 'ar';
    const asset = (name) => `images/${name}`;
    // The built-in photos the pages show (where the shop has no picture yet): only those are published
    const photos = new Set();
    const photoUrl = (file) => { if (readPhoto(file)) { photos.add(file); return `photos/${file}`; } return ''; };

    const files = [];
    for (const page of pagesOf(snap)) {
        files.push({ path: page.path, content: renderPage({ snapshot: snap, theme, page: page.page, id: page.id, lang: language, assetUrl: asset, photoUrl, orderUrl }) });
    }
    // The website's own style sheet and script (no inline script: Content-Security-Policy)
    files.push({ path: STYLE, content: css(theme) });
    files.push({ path: SCRIPT, content: fs.readFileSync(STORE_SCRIPT, 'utf8') });
    for (const f of fontFiles()) files.push({ path: f.path, content: f.data });
    // The ads / visit tools, only when the shop turned one on
    if (Object.values(snap.shop.tracking || {}).some(Boolean)) files.push({ path: TRACK, content: fs.readFileSync(TRACK_SCRIPT, 'utf8') });
    files.push({ path: 'search.json', content: JSON.stringify(searchCatalog(snap, theme, language, asset)) });
    files.push({ path: '404.html', content: renderPage({ snapshot: snap, theme, page: 'home', lang: language, assetUrl: asset, photoUrl, orderUrl }) });
    for (const [name, data] of images) if (data) files.push({ path: asset(name), content: data });
    for (const file of photos) files.push({ path: `photos/${file}`, content: readPhoto(file) });
    // The public catalogue: what the pages show, for other uses of the website
    files.push({ path: 'catalog.json', content: JSON.stringify({ builtAt: snap.builtAt, theme: theme.id, shop: snap.shop, categories: snap.categories, products: snap.products }, null, 1) });
    files.push({ path: '.nojekyll', content: '' });
    // The shop's own domain, once connected (GitHub Pages reads it from this file: without it
    // an update would take the domain off the website)
    if (cname) files.push({ path: 'CNAME', content: String(cname) });
    files.push({ path: 'robots.txt', content: 'User-agent: *\nAllow: /\n' });
    files.push({ path: 'README.md', content: `# ${snap.shop.name || 'Website'}\n\nThis website is made and updated by Afus Boutique from the shop's own catalogue.\nPlease do not edit these files by hand: the next update replaces them.\n` });
    if (files.length > MAX_FILES) throw Object.assign(new Error('too many files'), { reason: 'too_large' });

    const hash = crypto.createHash('sha256');
    const content = crypto.createHash('sha256');
    const timeless = JSON.stringify({ theme: theme.id, shop: snap.shop, categories: snap.categories, products: snap.products });
    for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
        const body = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
        hash.update(f.path).update(body);
        content.update(f.path).update(f.path === 'catalog.json' ? Buffer.from(timeless) : body);
    }
    return {
        files,
        hash: hash.digest('hex'),
        contentHash: content.digest('hex'),
        summary: {
            pages: files.filter(f => f.path.endsWith('.html')).length,
            images: [...images.values()].filter(Boolean).length,
            products: snap.products.length,
            categories: snap.categories.length,
        },
    };
}

module.exports = { buildSite, searchCatalog, moneyFormat };
