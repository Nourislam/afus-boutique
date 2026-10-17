/**
 * The store's own pages: lists of articles with search, filters and sort
 * (all, a category, new, best sellers, offers, search), all categories,
 * cart, checkout, contact, about, store location. Everything shown comes
 * from the shop's public data (publicData/); the cart and checkout are
 * filled by the website's script (assets/store.js) from search.json.
 * Without the script every list still shows all its articles, and every
 * article page still has its direct order form.
 */
const { esc, html, phoneDigits, phoneHtml } = require('./html');
const C = require('./components');
const { LEGAL_PAGES, legalPage } = require('./legal');

const byNewest = (list) => [...list].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

function pageHead(ctx, title, sub) {
    return `<div class="page-head"><div class="container"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>`;
}

/**
 * Search box, filters (sizes and colours actually in the list, price, in
 * stock, on sale) and sort; the cards carry what the script compares.
 */
function filterBar(ctx, products, { search = false, sort = 'new' } = {}) {
    const sizes = [...new Set(products.flatMap(p => p.variants.filter(v => v.available && v.size).map(v => v.size)))];
    const colors = [...new Set(products.flatMap(p => p.variants.filter(v => v.available && v.color).map(v => v.color)))];
    const prices = products.map(p => (C.onSale(p) ? p.salePrice : p.price)).filter(Number.isFinite);
    const max = prices.length ? Math.ceil(Math.max(...prices) / 100) * 100 : 0;
    const chips = (name, list) => list.slice(0, 24).map(v => `<label class="fchip"><input type="checkbox" name="${name}" value="${esc(v)}"><span>${esc(v)}</span></label>`).join('');
    const sorts = [['new', 'sortNew'], ['price-up', 'sortPriceUp'], ['price-down', 'sortPriceDown'], ['name', 'sortName'], ...((ctx.snap.bestSellers || []).length ? [['best', 'sortBest']] : [])];
    return html(
        `<form class="filters" data-filters role="search">`,
        search && `<label class="fsearch">${C.ICONS.search}<input type="search" name="q" data-search-input placeholder="${esc(ctx.t('searchPlaceholder'))}" aria-label="${esc(ctx.t('search'))}" autocomplete="off"></label>`,
        `<details class="fpanel"${search ? '' : ' open'}><summary>${esc(ctx.t('filters'))}</summary><div class="fbody">`,
        sizes.length > 1 && `<div class="fgroup"><span class="flabel">${esc(ctx.t('sizes'))}</span><div class="fchips">${chips('size', sizes)}</div></div>`,
        colors.length > 1 && `<div class="fgroup"><span class="flabel">${esc(ctx.t('colors'))}</span><div class="fchips">${chips('color', colors)}</div></div>`,
        max > 0 && `<div class="fgroup"><label class="flabel" for="fmax">${esc(ctx.t('priceMax'))}: <output data-price-out>${max}</output></label><input id="fmax" type="range" name="max" min="0" max="${max}" step="100" value="${max}"></div>`,
        `<div class="fgroup frow"><label class="fcheck"><input type="checkbox" name="available"> ${esc(ctx.t('onlyAvailable'))}</label>`,
        products.some(C.onSale) && `<label class="fcheck"><input type="checkbox" name="sale"> ${esc(ctx.t('onlySale'))}</label>`,
        `</div><button type="reset" class="btn btn-ghost btn-sm" data-filters-reset>${esc(ctx.t('clearFilters'))}</button></div></details>`,
        `<label class="fsort"><span>${esc(ctx.t('sort'))}</span><select name="sort">${sorts.map(([v, k]) => `<option value="${v}"${v === sort ? ' selected' : ''}>${esc(ctx.t(k))}</option>`).join('')}</select></label>`,
        `<p class="fcount" data-count aria-live="polite">${products.length} ${esc(ctx.t('articlesCount'))}</p>`,
        `</form>`,
    );
}

/** A list of articles with its tools (search / filters / sort). */
function listingPage(ctx, { title, sub, products, search = false, sort = 'new', empty }) {
    return html(
        pageHead(ctx, title, sub),
        `<main class="container section listing" data-listing>`,
        products.length ? filterBar(ctx, products, { search, sort }) : '',
        products.length ? C.productGrid(ctx, products) : `<p class="empty">${esc(empty || ctx.t('empty'))}</p>`,
        `<p class="empty" data-no-results hidden>${esc(ctx.t('noResults'))}</p>`,
        `</main>`,
    );
}

const allProducts = (ctx) => listingPage(ctx, { title: ctx.t('products'), products: byNewest(ctx.snap.products), search: true });
const searchPage = (ctx) => listingPage(ctx, { title: ctx.t('searchTitle'), products: byNewest(ctx.snap.products), search: true });
/** Added to AFUS in the last 7 days (publicData.newProducts), newest first. */
function newPage(ctx) {
    const products = (ctx.snap.newProducts || []).map(id => ctx.snap.products.find(p => p.id === id)).filter(Boolean);
    return listingPage(ctx, { title: ctx.t('newIn'), sub: ctx.t('newRule'), products, empty: ctx.t('noNew') });
}

function bestPage(ctx) {
    const order = ctx.snap.bestSellers || [];
    const products = order.map(id => ctx.snap.products.find(p => p.id === id)).filter(Boolean);
    return listingPage(ctx, { title: ctx.t('best'), sub: ctx.t('bestRule'), products, sort: 'best', empty: ctx.t('noBest') });
}

function offersPage(ctx) {
    const products = ctx.snap.products.filter(C.onSale);
    const promos = ctx.snap.promotions.filter(p => p.type === 'percentage' || p.type === 'fixed');
    const banners = promos.length
        ? `<div class="container offer-cards">${promos.map(p => `<div class="offer-card"><span class="promo-pct">${p.type === 'percentage' ? `-${esc(p.value)}%` : `-${esc(p.value)}`}</span><strong>${esc(p.name)}</strong>${p.endsAt ? `<span>${esc(ctx.t('until'))} ${esc(String(p.endsAt).slice(0, 10))}</span>` : ''}</div>`).join('')}</div>`
        : '';
    return html(banners, listingPage(ctx, { title: ctx.t('offersTitle'), products, empty: ctx.t('noOffers') }));
}

function categoriesPage(ctx) {
    const cats = ctx.snap.categories;
    const tile = (c) => {
        const p = ctx.snap.products.find(x => x.categoryId === c.id && x.images.length);
        return `<a class="cat cat-tiles" href="${esc(ctx.link('category', c.id))}">${p ? `<span class="cat-media"><img src="${esc(ctx.img(p.images[0]))}" alt="" loading="lazy"></span>` : ''}<span class="cat-name">${esc(c.name)} <small>${c.count}</small></span></a>`;
    };
    return html(pageHead(ctx, ctx.t('categoriesTitle')), `<main class="container section"><div class="cats cats-tiles">${cats.map(tile).join('')}</div>${cats.length ? '' : `<p class="empty">${esc(ctx.t('empty'))}</p>`}</main>`);
}

function cartPage(ctx) {
    return html(
        pageHead(ctx, ctx.t('cart')),
        `<main class="container section cart-page" data-cart-page>`,
        `<div class="cart-lines" data-cart-lines></div>`,
        `<div class="cart-empty" data-cart-empty><p class="empty">${esc(ctx.t('cartEmpty'))}</p><a class="btn btn-primary" href="${esc(ctx.link('page', 'products'))}">${esc(ctx.t('continueShopping'))}</a></div>`,
        `<aside class="cart-total" data-cart-total hidden><p><span>${esc(ctx.t('subtotal'))}</span><strong data-cart-sum></strong></p><p class="hint">${esc(ctx.t('deliveryNote'))}</p>`,
        `<a class="btn btn-primary btn-block" href="${esc(ctx.link('page', 'checkout'))}" data-go-checkout>${esc(ctx.t('goCheckout'))}</a>`,
        `<a class="btn btn-ghost btn-block" href="${esc(ctx.link('page', 'products'))}">${esc(ctx.t('continueShopping'))}</a></aside>`,
        `<noscript><p class="hint">${esc(ctx.t('needScript'))}</p></noscript>`,
        `</main>`,
    );
}

/**
 * Checkout (cash on delivery): the customer's first and last name, phone,
 * wilaya and commune; home delivery (address) or a courier company's office
 * (company, wilaya, commune, office); the order summary, the total, Confirm.
 * Sent to the shop's own API; nothing is paid and no stock moves here.
 * Every field says what is wrong next to it (assets/store.js); the API
 * checks the same rules again.
 */
function checkoutPage(ctx) {
    const off = ctx.orderUrl ? '' : ' disabled';
    const { wilayas, field, text, phone, deliveries, home, office, features, prices, coupon, summary } = C.formParts(ctx, off);
    const couriers = ctx.snap.shop.couriers || [];
    return html(
        pageHead(ctx, ctx.t('checkout'), ctx.t('codOnly')),
        `<main class="container section checkout" data-checkout>`,
        `<form class="checkout-form" method="post" novalidate${ctx.orderUrl ? ` action="${esc(ctx.orderUrl)}"` : ''} accept-charset="utf-8" data-checkout-form ${prices}>`,
        `<input type="hidden" name="order_key" data-order-key value=""><input type="hidden" name="items" data-items value="[]"><input type="hidden" name="product_id" data-first-id value=""><input type="hidden" name="product_name" data-first-name value="">`,
        `<label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>`,
        `<div class="co-main">`,
        `<fieldset class="co-block"><legend class="co-title"><b>1</b>${esc(ctx.t('yourDetails'))}</legend><div class="fields">`,
        field('first_name', ctx.t('firstName'), text('first_name', { max: 40, auto: 'given-name' })),
        field('last_name', ctx.t('lastName'), text('last_name', { max: 40, auto: 'family-name' })),
        field('phone', ctx.t('yourPhone'), phone(), true),
        field('wilaya', ctx.t('wilaya'), wilayas('wilaya')),
        field('commune', ctx.t('commune'), text('commune', { auto: 'address-level2' })),
        `</div></fieldset>`,
        `<fieldset class="co-block"><legend class="co-title"><b>2</b>${esc(ctx.t('delivery'))}</legend>`,
        deliveries,
        home && `<div class="fields" data-when="home">${field('address', ctx.t('addressField'), text('address', { min: 3, max: 200, auto: 'street-address' }), true)}</div>`,
        office ? html(
            `<div class="fields" data-when="office">`,
            field('courier_company', ctx.t('courierCompany'), `<select name="courier_company" required${off}><option value="">${esc(ctx.t('chooseCourier'))}</option>${couriers.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>`, true),
            field('office_wilaya', ctx.t('officeWilaya'), wilayas('office_wilaya')),
            field('office_commune', ctx.t('officeCommune'), text('office_commune')),
            field('courier_office', ctx.t('courierOffice'), text('courier_office', { max: 120, extra: ` placeholder="${esc(ctx.t('courierOfficeHint'))}"` }), true),
            `</div>`,
        ) : '',
        `</fieldset>`,
        features.noteField && `<fieldset class="co-block"><div class="fields">${field('note', ctx.t('note'), `<textarea name="note" rows="2" maxlength="500"${off}></textarea>`, true)}</div></fieldset>`,
        `</div>`,
        `<aside class="cart-total summary" data-summary><h2 class="co-title"><b>3</b>${esc(ctx.t('orderSummary'))}</h2><div data-summary-lines></div>`,
        coupon,
        summary,
        `<p class="hint">${esc(ctx.t('checkoutHint'))}</p>`,
        `<p class="form-msg is-bad" data-form-msg role="alert" hidden></p>`,
        `<button class="btn btn-primary btn-block" type="submit" data-confirm${off}>${esc(ctx.t('confirmOrder'))}</button>`,
        `<noscript><p class="hint">${esc(ctx.t('needScript'))}</p></noscript>`,
        `</aside>`,
        `</form>`,
        `</main>`,
    );
}

function contactBlock(ctx) {
    const shop = ctx.snap.shop;
    const phone = phoneDigits(shop.phone);
    const extras = C.shopExtras(ctx);
    const where = [shop.address, shop.city, shop.wilaya].filter(Boolean).join(', ');
    const link = (url, label, cls = 'btn btn-ghost') => `<a class="${cls}" href="${esc(ctx.preview ? '#' : url)}"${ctx.preview || url.startsWith('tel:') ? '' : ' rel="noopener" target="_blank"'}>${label}</a>`;
    return html(
        `<div class="contact-cards">`,
        phone && `<div class="contact-card"><span class="flabel">${esc(ctx.t('phone'))}</span><strong>${phoneHtml(shop.phone)}</strong><div class="btns">${link(`tel:+${phone}`, esc(ctx.t('call')), 'btn btn-primary')}${link(`https://wa.me/${phone}`, esc(ctx.t('whatsapp')))}</div></div>`,
        shop.email && `<div class="contact-card"><span class="flabel">${esc(ctx.t('email'))}</span><strong>${esc(shop.email)}</strong>${link(`mailto:${shop.email}`, esc(ctx.t('email')))}</div>`,
        where && `<div class="contact-card"><span class="flabel">${esc(ctx.t('address'))}</span><strong>${esc(where)}</strong>${shop.mapUrl ? link(shop.mapUrl, esc(ctx.t('openMap'))) : ''}</div>`,
        extras.hours && `<div class="contact-card">${extras.hours}</div>`,
        extras.social && `<div class="contact-card">${extras.social}</div>`,
        `</div>`,
    );
}

const contactPage = (ctx) => html(pageHead(ctx, ctx.t('contactTitle')), `<main class="container section">${contactBlock(ctx)}</main>`);

function aboutPage(ctx) {
    const shop = ctx.snap.shop;
    const figures = [[ctx.snap.products.length, ctx.t('articlesCount')], [ctx.snap.categories.length, ctx.t('categories')], [ctx.snap.brands.length, ctx.t('brands')]].filter(([n]) => n > 0);
    return html(
        pageHead(ctx, ctx.t('aboutTitle')),
        `<main class="container-narrow section about-page">`,
        shop.logo && `<img class="about-logo" src="${esc(ctx.img(shop.logo))}" alt="${esc(shop.name)}">`,
        `<h2 class="section-title">${esc(shop.name)}</h2>`,
        shop.description && `<p class="lead">${esc(shop.description).replace(/\n/g, '<br>')}</p>`,
        figures.length && `<ul class="figures">${figures.map(([n, l]) => `<li><strong>${n}</strong><span>${esc(l)}</span></li>`).join('')}</ul>`,
        ctx.snap.brands.length > 1 && `<p class="brands brands-text">${ctx.snap.brands.map(b => `<span>${esc(b)}</span>`).join('')}</p>`,
        `<div class="btns"><a class="btn btn-primary" href="${esc(ctx.link('page', 'products'))}">${esc(ctx.t('shopNow'))}</a><a class="btn btn-ghost" href="${esc(ctx.link('page', 'contact'))}">${esc(ctx.t('contact'))}</a></div>`,
        `</main>`,
    );
}

function locationPage(ctx) {
    const shop = ctx.snap.shop;
    const where = [shop.address, shop.city, shop.wilaya].filter(Boolean).join(', ');
    return html(
        pageHead(ctx, ctx.t('location'), ctx.t('visitUs')),
        `<main class="container section location">`,
        `<div class="location-card"><h2 class="section-title">${esc(shop.name)}</h2>`,
        where ? `<p class="lead">${esc(where)}</p>` : '',
        shop.mapUrl ? `<a class="btn btn-primary" href="${esc(ctx.preview ? '#' : shop.mapUrl)}"${ctx.preview ? '' : ' rel="noopener" target="_blank"'}>${esc(ctx.t('openMap'))}</a>` : '',
        `</div>`,
        contactBlock(ctx),
        `</main>`,
    );
}

/** page id -> builder (all at <id>.html). */
/** Returns, terms, privacy, delivery: the same words for every shop, its name and contact in them. */
function legal(id) {
    return (ctx) => {
        const page = legalPage(id, ctx.lang, ctx.snap.shop);
        return html(
            pageHead(ctx, page.title),
            `<main class="container-narrow section legal">`,
            ...page.sections.map(sec => `<section><h2>${esc(sec.h)}</h2>${sec.p.map(t => `<p>${esc(t)}</p>`).join('')}</section>`),
            `</main>`,
        );
    };
}

const STORE_PAGES = {
    products: allProducts, search: searchPage, new: newPage, best: bestPage, offers: offersPage,
    categories: categoriesPage, cart: cartPage, checkout: checkoutPage, contact: contactPage, about: aboutPage, location: locationPage,
    ...Object.fromEntries(LEGAL_PAGES.map(id => [id, legal(id)])),
};

module.exports = { STORE_PAGES, listingPage, filterBar, contactBlock };
