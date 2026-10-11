/**
 * The website's pages, made from the shop's public data (publicData/) and a
 * theme. Pure: the same shop and theme give the same pages; nothing is read
 * or written elsewhere.
 *
 *   renderPage({ snapshot, theme, page, id, lang, preview, assetUrl, orderUrl })
 *     page: 'home' | 'category' (id) | 'product' (id) | 'page' (id: one of
 *           STORE_PAGES: products, search, categories, new, best, offers,
 *           cart, checkout, contact, about, location) | 'thanks' | 'order-error'
 *     orderUrl: the shop's website API where orders are sent
 *     preview: inside the program: links go nowhere, the style is in the
 *              page, no script (the frame runs none)
 *     assetUrl(path): the address of one of the shop's pictures
 *   pagesOf(snapshot): every page of the website, for publishing
 *
 * The published pages load one style sheet and one script of the website
 * itself (assets/store.css, assets/store.js): no inline script, no outside
 * resource (Content-Security-Policy).
 */
const { esc } = require('./html');
const { textsFor } = require('./texts');
const C = require('./components');
const { SECTION_TYPES } = require('./sections');
const { STORE_PAGES, listingPage } = require('./pages');
const { css, bodyClasses } = require('./css');

const LANGS = ['ar', 'fr', 'en'];
const fileId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_');
const STYLE = 'assets/store.css';
const SCRIPT = 'assets/store.js';

/** The few words the website's script writes (cart messages). */
const SCRIPT_TEXTS = ['added', 'chooseFirst', 'notThisOne', 'viewCart', 'remove', 'cartEmpty', 'maxQty',
    'errName', 'errPhone', 'errWilaya', 'errCommune', 'errAddress', 'errCourier', 'errOffice', 'errForm'];
const scriptTexts = (t) => Object.fromEntries(SCRIPT_TEXTS.map(k => [k, t(k)]));

/** Where each page lives on the published website (all in one folder). */
function linkFor(kind, id) {
    if (kind === 'home') return 'index.html';
    if (kind === 'category') {
        // All articles / articles on sale have their own store pages
        if (id === 'all') return 'products.html';
        if (id === 'sale') return 'offers.html';
        return `category-${fileId(id)}.html`;
    }
    if (kind === 'product') return `product-${fileId(id)}.html`;
    if (kind === 'page' && STORE_PAGES[id]) return `${id}.html`;
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
    } else if (page === 'page' && STORE_PAGES[id]) {
        main = STORE_PAGES[id](ctx);
        title = `${ctx.t({ new: 'newIn', search: 'searchTitle', about: 'aboutTitle', contact: 'contactTitle', offers: 'offersTitle', categories: 'categoriesTitle' }[id] || id)} · ${title}`;
    } else if (page === 'category') {
        const cat = snapshot.categories.find(c => c.id === id);
        if (id === 'sale') main = STORE_PAGES.offers(ctx);
        else if (id === 'all' || !cat) main = STORE_PAGES.products(ctx);
        else {
            main = listingPage(ctx, { title: cat.name, sub: `${cat.count} ${ctx.t('articlesCount')}`, products: snapshot.products.filter(p => p.categoryId === id) });
            title = `${cat.name} · ${title}`;
        }
    } else {
        main = theme.home.map(section => SECTION_TYPES[section.type].render(ctx, section)).join('\n');
        // No article yet: said once, in every theme (nothing is invented)
        if (!snapshot.products.length) main += `<section class="container section">${C.productGrid(ctx, [])}</section>`;
        main = `<main class="home">${main}</main>`;
    }
    // Scripts and styles of the website itself only; the only form goes to the shop's own API
    const formTo = ctx.orderUrl ? new URL(ctx.orderUrl).origin : "'none'";
    const policy = preview
        ? "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: app:; base-uri 'none'; form-action 'none'"
        : `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action ${formTo}`;
    const style = preview ? `<style>${css(theme)}</style>` : `<link rel="stylesheet" href="${STYLE}">`;
    return `<!doctype html>
<html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="generator" content="Afus Boutique">
<meta name="theme-color" content="${esc(theme.tokens.colors.primary)}">
<title>${esc(title)}</title>
${snapshot.shop.description ? `<meta name="description" content="${esc(snapshot.shop.description.slice(0, 160))}">` : ''}
${style}
${preview ? '' : `<link rel="icon" href="${esc(snapshot.shop.logo ? ctx.img(snapshot.shop.logo) : 'data:,')}">`}
${preview ? '' : `<script src="${SCRIPT}" defer></script>`}
</head>
<body class="theme-${esc(theme.id)} ${bodyClasses(theme)} page-${esc(page === 'page' ? id : page)}" data-lang="${language}" data-currency="${esc(snapshot.shop.currency)}"${preview ? '' : ` data-texts="${esc(JSON.stringify(scriptTexts(ctx.t)))}"`}>
${C.header(ctx)}
${main}
${C.footer(ctx)}
${C.bottomBar(ctx)}
</body>
</html>`;
}

/** Every page of the website: [{ path, page, id }]. */
function pagesOf(snapshot) {
    const pages = [
        { path: linkFor('home'), page: 'home', id: null },
        ...Object.keys(STORE_PAGES).map(id => ({ path: linkFor('page', id), page: 'page', id })),
        { path: 'thanks.html', page: 'thanks', id: null }, { path: 'order-error.html', page: 'order-error', id: null },
    ];
    for (const c of snapshot.categories) pages.push({ path: linkFor('category', c.id), page: 'category', id: c.id });
    for (const p of snapshot.products) pages.push({ path: linkFor('product', p.id), page: 'product', id: p.id });
    return pages;
}

module.exports = { renderPage, pagesOf, linkFor, scriptTexts, STYLE, SCRIPT };
