/**
 * The website's files, made from the shop's own data (catalogSnapshot of the
 * SQLite database, read only) and the chosen theme: every page, the pictures
 * the pages show, the public catalogue (catalog.json) and GitHub Pages'
 * small files. Nothing is made up and nothing private goes out: no purchase
 * price, no stock count, no customer.
 *
 *   buildSite({ snapshot, theme, orderUrl, readImage, lang })
 *     readImage(name) -> Buffer | null  (one of the shop's pictures)
 *   -> { files: [{ path, content }], summary, hash }
 */
const crypto = require('crypto');
const { renderPage, pagesOf } = require('../storefront/render');

const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpe?g|png|webp|gif)$/i;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_FILES = 3000;

function buildSite({ snapshot, theme, orderUrl = null, readImage = () => null, lang }) {
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
        shop: { ...snapshot.shop, logo: keep(snapshot.shop.logo) ? snapshot.shop.logo : '' },
        products: snapshot.products.map(p => ({ ...p, images: p.images.filter(keep) })),
    };
    const language = lang || snap.shop.language || 'ar';
    const asset = (name) => `images/${name}`;

    const files = [];
    for (const page of pagesOf(snap)) {
        files.push({ path: page.path, content: renderPage({ snapshot: snap, theme, page: page.page, id: page.id, lang: language, assetUrl: asset, orderUrl }) });
    }
    files.push({ path: '404.html', content: renderPage({ snapshot: snap, theme, page: 'home', lang: language, assetUrl: asset, orderUrl }) });
    for (const [name, data] of images) if (data) files.push({ path: asset(name), content: data });
    // The public catalogue: what the pages show, for other uses of the website
    files.push({ path: 'catalog.json', content: JSON.stringify({ builtAt: snap.builtAt, theme: theme.id, shop: snap.shop, categories: snap.categories, products: snap.products }, null, 1) });
    files.push({ path: '.nojekyll', content: '' });
    files.push({ path: 'robots.txt', content: 'User-agent: *\nAllow: /\n' });
    files.push({ path: 'README.md', content: `# ${snap.shop.name || 'Website'}\n\nThis website is made and updated by Afus Boutique from the shop's own catalogue.\nPlease do not edit these files by hand: the next update replaces them.\n` });
    if (files.length > MAX_FILES) throw Object.assign(new Error('too many files'), { reason: 'too_large' });

    const hash = crypto.createHash('sha256');
    for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) hash.update(f.path).update(Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content));
    return {
        files,
        hash: hash.digest('hex'),
        summary: {
            pages: files.filter(f => f.path.endsWith('.html')).length,
            images: [...images.values()].filter(Boolean).length,
            products: snap.products.length,
            categories: snap.categories.length,
        },
    };
}

module.exports = { buildSite };
