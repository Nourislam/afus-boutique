/**
 * The website's pages, made from the shop's data (catalogSnapshot) and a
 * theme. Pure: the same shop and theme give the same pages; nothing is
 * read or written elsewhere. The pages have no script; their own policy
 * (Content-Security-Policy) allows none.
 *
 *   renderPage({ snapshot, theme, page, id, lang, preview, assetUrl, orderUrl })
 *     page: 'home' | 'category' (id: category id, 'all' or 'sale') | 'product' (id)
 *           | 'thanks' | 'order-error' (after an order request)
 *     orderUrl: the shop's website API where the order form is sent
 *     preview: inside the program (links go nowhere, no outside call)
 *     assetUrl(path): the address of one of the shop's pictures
 *   pagesOf(snapshot): every page of the website, for publishing
 */
const { esc } = require('./html');
const { textsFor } = require('./texts');
const C = require('./components');
const { SECTION_TYPES } = require('./sections');
const { css, bodyClasses } = require('./css');

const LANGS = ['ar', 'fr', 'en'];
const fileId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

/** Where each page lives on the published website (all in one folder). */
function linkFor(kind, id) {
    if (kind === 'home') return 'index.html';
    if (kind === 'category') return `category-${fileId(id)}.html`;
    if (kind === 'product') return `product-${fileId(id)}.html`;
    return 'index.html';
}

function renderPage({ snapshot, theme, page = 'home', id = null, lang = 'ar', preview = false, assetUrl = (p) => p, orderUrl = null }) {
    const language = LANGS.includes(lang) ? lang : 'ar';
    const ctx = {
        snap: snapshot, theme, lang: language, t: textsFor(language), preview,
        link: preview ? () => '#' : linkFor,
        img: (path) => assetUrl(path),
        current: page === 'home' ? 'home' : `${page}:${id}`,
        orderUrl: !preview && orderUrl && /^https?:\/\//.test(orderUrl) ? orderUrl : null,
    };
    let main;
    let title = snapshot.shop.name || '';
    if (page === 'product') {
        const product = snapshot.products.find(p => p.id === id) || snapshot.products[0];
        main = product ? C.productPage(ctx, product) : `<main class="container section">${C.productGrid(ctx, [])}</main>`;
        if (product) title = `${product.name} · ${title}`;
    } else if (page === 'thanks' || page === 'order-error') {
        main = C.messagePage(ctx, page);
    } else if (page === 'category') {
        main = C.categoryPage(ctx, id || 'all');
    } else {
        main = theme.home.map(section => SECTION_TYPES[section.type].render(ctx, section)).join('\n');
        // No article yet: said once, in every theme (nothing is invented)
        if (!snapshot.products.length) main += `<section class="container section">${C.productGrid(ctx, [])}</section>`;
    }
    // No script, no frame, no form; pictures from the website itself (or the program's preview)
    // The only form goes to the shop's own website API
    const formTo = ctx.orderUrl ? new URL(ctx.orderUrl).origin : "'none'";
    const policy = `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:${preview ? ' app:' : ''}; font-src 'self'; base-uri 'none'; form-action ${formTo}`;
    return `<!doctype html>
<html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="generator" content="Afus Boutique">
<title>${esc(title)}</title>
${snapshot.shop.description ? `<meta name="description" content="${esc(snapshot.shop.description)}">` : ''}
<style>${css(theme)}</style>
</head>
<body class="theme-${esc(theme.id)} ${bodyClasses(theme)}">
${C.header(ctx)}
${main}
${C.footer(ctx)}
</body>
</html>`;
}

/** Every page of the website: [{ path, page, id }]. */
function pagesOf(snapshot) {
    const pages = [
        { path: linkFor('home'), page: 'home', id: null }, { path: linkFor('category', 'all'), page: 'category', id: 'all' },
        { path: 'thanks.html', page: 'thanks', id: null }, { path: 'order-error.html', page: 'order-error', id: null },
    ];
    if (snapshot.products.some(C.onSale)) pages.push({ path: linkFor('category', 'sale'), page: 'category', id: 'sale' });
    for (const c of snapshot.categories) pages.push({ path: linkFor('category', c.id), page: 'category', id: c.id });
    for (const p of snapshot.products) pages.push({ path: linkFor('product', p.id), page: 'product', id: p.id });
    return pages;
}

module.exports = { renderPage, pagesOf, linkFor };
