/**
 * The storefront's building blocks. Each one reads the shop's data (ctx.snap)
 * and the theme's choices (ctx.theme) and returns markup; none changes data.
 *
 * ctx: { snap, theme, lang, t, link(kind, id), img(path), preview }
 */
const { esc, html, money, moneyHtml, phoneHtml, safeColor, phoneDigits, placeholder } = require('./html');

const priceOf = (ctx, p) => money(p, ctx.lang, ctx.snap.shop.currency);
const priceHtml = (ctx, p) => moneyHtml(p, ctx.lang, ctx.snap.shop.currency);
const onSale = (p) => p.salePrice !== null && p.salePrice !== undefined && p.salePrice < p.price;
const percentOff = (p) => Math.round((1 - p.salePrice / p.price) * 100);
const categoryName = (ctx, id) => ctx.snap.categories.find(c => c.id === id)?.name || '';

/** The colours of an article (one per name) and its sizes, with what is available. */
function optionsOf(p) {
    const colors = new Map();
    const sizes = new Map();
    for (const v of p.variants) {
        if (v.color && !colors.has(v.color)) colors.set(v.color, { name: v.color, code: safeColor(v.colorCode), available: false });
        if (v.color && v.available) colors.get(v.color).available = true;
        if (v.size) sizes.set(v.size, (sizes.get(v.size) || false) || v.available);
    }
    return { colors: [...colors.values()], sizes: [...sizes.entries()].map(([name, available]) => ({ name, available })) };
}

function image(ctx, p, index = 0, cls = '') {
    const path = p.images[index];
    const src = path ? ctx.img(path) : placeholder(p.name, ctx.theme.tokens.colors);
    return `<img class="${cls}" src="${esc(src)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`;
}

function priceTag(ctx, p) {
    return onSale(p)
        ? `<span class="price"><span class="price-now">${priceHtml(ctx, p.salePrice)}</span> <s class="price-was">${priceHtml(ctx, p.price)}</s></span>`
        : `<span class="price"><span class="price-now">${priceHtml(ctx, p.price)}</span></span>`;
}

function badges(ctx, p) {
    const kind = ctx.theme.productCard.badge;
    return html(
        onSale(p) && `<span class="badge badge-${kind} badge-sale">-${percentOff(p)}%</span>`,
        !p.available && `<span class="badge badge-${kind} badge-out">${esc(ctx.t('soldOut'))}</span>`,
    );
}

/** One article in a list, as the theme draws its cards. */
function productCard(ctx, p) {
    const c = ctx.theme.productCard;
    const { colors, sizes } = optionsOf(p);
    const coded = colors.filter(col => col.code);
    const swatches = c.showColors && coded.length
        ? `<span class="swatches">${coded.slice(0, 6).map(col => `<span class="swatch${col.available ? '' : ' is-out'}" title="${esc(col.name)}"${col.code ? ` style="background:${col.code}"` : ''}></span>`).join('')}${colors.length > 6 ? `<span class="swatch-more">+${colors.length - Math.min(6, coded.length)}</span>` : ''}</span>`
        : '';
    const sizeList = c.showSizes && sizes.length
        ? `<span class="card-sizes">${sizes.slice(0, 6).map(s => `<span class="${s.available ? '' : 'is-out'}">${esc(s.name)}</span>`).join('')}</span>`
        : '';
    return html(
        `<a class="card card-${c.style}${p.available ? '' : ' is-soldout'}" href="${esc(ctx.link('product', p.id))}" data-product="${esc(p.id)}">`,
        `<span class="card-media">${image(ctx, p, 0, 'card-img')}${p.images[1] ? image(ctx, p, 1, 'card-img card-img-alt') : ''}<span class="badges">${badges(ctx, p)}</span></span>`,
        `<span class="card-body">`,
        c.showBrand && p.brand && `<span class="card-brand">${esc(p.brand)}</span>`,
        `<span class="card-name">${esc(p.name)}</span>`,
        priceTag(ctx, p),
        swatches, sizeList,
        `</span></a>`,
    );
}

function productGrid(ctx, products, { columns = ctx.theme.categoryPage.desktopColumns, layout = 'grid' } = {}) {
    if (!products.length) return `<p class="empty">${esc(ctx.t('empty'))}</p>`;
    return `<div class="grid grid-${layout}" style="--cols:${columns};--cols-m:${ctx.theme.categoryPage.mobileColumns}">${products.map(p => productCard(ctx, p)).join('')}</div>`;
}

/** The biggest live promotion, for the announcement bar and the promo section. */
function bestPromotion(ctx) {
    const pct = ctx.snap.promotions.filter(p => p.type === 'percentage' && Number(p.value) > 0);
    return pct.sort((a, b) => b.value - a.value)[0] || null;
}

function navItems(ctx) {
    const items = [{ href: ctx.link('home'), label: ctx.t('home'), page: 'home' }];
    for (const c of ctx.snap.categories.slice(0, 8)) items.push({ href: ctx.link('category', c.id), label: c.name, page: `category:${c.id}` });
    if (ctx.snap.products.some(onSale)) items.push({ href: ctx.link('category', 'sale'), label: ctx.t('sale'), page: 'category:sale', sale: true });
    return items;
}

function header(ctx) {
    const h = ctx.theme.header;
    const shop = ctx.snap.shop;
    const promo = bestPromotion(ctx);
    const logo = shop.logo
        ? `<img class="logo-img" src="${esc(ctx.img(shop.logo))}" alt="${esc(shop.name)}">`
        : `<span class="logo-text">${esc(shop.name || ctx.t('home'))}</span>`;
    const items = navItems(ctx);
    const links = items.map(i => `<a href="${esc(i.href)}" class="${i.sale ? 'nav-sale' : ''}${ctx.current === i.page ? ' is-current' : ''}">${esc(i.label)}</a>`).join('');
    const phone = phoneDigits(shop.phone);
    // The menu of small screens (and of the "drawer" themes) opens without script
    const drawer = `<input type="checkbox" id="nav-toggle" class="nav-toggle" aria-hidden="true"><label for="nav-toggle" class="nav-burger" aria-label="${esc(ctx.t('menu'))}"><span></span><span></span><span></span></label><nav class="drawer" aria-label="${esc(ctx.t('menu'))}">${links}</nav>`;
    return html(
        h.announcement && promo && `<div class="announce">${esc(promo.name)} · ${esc(ctx.t('upTo'))} -${esc(promo.value)}%</div>`,
        `<header class="site-header hdr-${h.style}${h.sticky ? ' is-sticky' : ''}">`,
        `<div class="container hdr-row">`,
        drawer,
        `<a class="logo" href="${esc(ctx.link('home'))}">${logo}</a>`,
        h.nav === 'inline' && `<nav class="nav-inline" aria-label="${esc(ctx.t('categories'))}">${links}</nav>`,
        `<div class="hdr-tools">`,
        h.search && `<span class="hdr-search" aria-hidden="true">⌕</span>`,
        phone && `<a class="hdr-phone" href="${esc(ctx.preview ? '#' : `tel:+${phone}`)}">${phoneHtml(shop.phone)}</a>`,
        `</div></div>`,
        h.nav === 'tabs' && `<nav class="nav-tabs container" aria-label="${esc(ctx.t('categories'))}">${links}</nav>`,
        `</header>`,
    );
}

function footer(ctx) {
    const shop = ctx.snap.shop;
    const where = [shop.address, shop.city, shop.wilaya].filter(Boolean).join(', ');
    const year = new Date(ctx.snap.builtAt).getFullYear();
    const cats = ctx.snap.categories.slice(0, 6).map(c => `<a href="${esc(ctx.link('category', c.id))}">${esc(c.name)}</a>`).join('');
    return html(
        `<footer class="site-footer ftr-${ctx.theme.footer.style}"><div class="container ftr-grid">`,
        `<div><strong class="ftr-name">${esc(shop.name)}</strong>${shop.description ? `<p>${esc(shop.description)}</p>` : ''}</div>`,
        cats && `<div><strong>${esc(ctx.t('categories'))}</strong><div class="ftr-links">${cats}</div></div>`,
        (shop.phone || where || shop.email) && `<div><strong>${esc(ctx.t('contact'))}</strong>${shop.phone ? `<p>${phoneHtml(shop.phone)}</p>` : ''}${shop.email ? `<p>${esc(shop.email)}</p>` : ''}${where ? `<p>${esc(where)}</p>` : ''}</div>`,
        `</div><div class="container ftr-bottom">© ${year} ${esc(shop.name)} · ${esc(ctx.t('rights'))}</div></footer>`,
    );
}

/** WhatsApp / phone buttons: the order goes to the shop itself. */
function orderButtons(ctx, p) {
    const phone = phoneDigits(ctx.snap.shop.phone);
    if (!phone) return '';
    const text = `${ctx.t('orderText')} ${p.name} (${priceOf(ctx, onSale(p) ? p.salePrice : p.price)})`;
    const wa = ctx.preview ? '#' : `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    return html(
        `<div class="order">`,
        `<a class="btn btn-primary" href="${esc(wa)}"${ctx.preview ? '' : ' rel="noopener" target="_blank"'}>${esc(ctx.t('order'))}</a>`,
        `<a class="btn btn-ghost" href="${esc(ctx.preview ? '#' : `tel:+${phone}`)}">${esc(ctx.t('call'))}</a>`,
        `</div>`,
    );
}

/**
 * The order form of an article page: a plain form (no script) sent to the
 * shop's own website API, which keeps the request for the shop to call back.
 * In the program's preview it is shown, disabled.
 */
function orderForm(ctx, p) {
    if (!ctx.orderUrl && !ctx.preview) return '';
    const { colors, sizes } = optionsOf(p);
    const off = ctx.preview ? ' disabled' : '';
    const select = (name, label, items) => items.length
        ? `<label class="field"><span>${esc(label)}</span><select name="${name}" required${off}>${items.filter(i => i.available).map(i => `<option value="${esc(i.name)}">${esc(i.name)}</option>`).join('')}</select></label>`
        : '';
    return html(
        `<form class="order-form" method="post"${ctx.preview ? '' : ` action="${esc(ctx.orderUrl)}"`} accept-charset="utf-8">`,
        `<h2 class="opt-title">${esc(ctx.t('orderTitle'))}</h2><p class="hint">${esc(ctx.t('orderHint'))}</p>`,
        `<input type="hidden" name="product_id" value="${esc(p.id)}"><input type="hidden" name="product_name" value="${esc(p.name)}">`,
        // A field people never see: robots fill it, the API then refuses the request
        `<label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>`,
        `<div class="fields">`,
        select('size', ctx.t('chooseSize'), sizes),
        select('color', ctx.t('chooseColor'), colors),
        `<label class="field"><span>${esc(ctx.t('quantity'))}</span><input name="quantity" type="number" min="1" max="20" value="1"${off}></label>`,
        `<label class="field"><span>${esc(ctx.t('yourName'))}</span><input name="customer_name" required minlength="2" maxlength="80" autocomplete="name"${off}></label>`,
        `<label class="field"><span>${esc(ctx.t('yourPhone'))}</span><input name="phone" type="tel" required minlength="8" maxlength="20" autocomplete="tel" dir="ltr"${off}></label>`,
        `<label class="field"><span>${esc(ctx.t('wilaya'))}</span><input name="wilaya" maxlength="60"${off}></label>`,
        `<label class="field field-wide"><span>${esc(ctx.t('addressField'))}</span><input name="address" maxlength="200" autocomplete="street-address"${off}></label>`,
        `<label class="field field-wide"><span>${esc(ctx.t('note'))}</span><textarea name="note" rows="2" maxlength="500"${off}></textarea></label>`,
        `</div><button class="btn btn-primary" type="submit"${off}>${esc(ctx.t('send'))}</button></form>`,
    );
}

/** After an order request: thanks, or why it was not sent. */
function messagePage(ctx, kind) {
    const ok = kind === 'thanks';
    return `<main class="container-narrow section message-page"><h1>${esc(ctx.t(ok ? 'thanksTitle' : 'errorTitle'))}</h1><p>${esc(ctx.t(ok ? 'thanksText' : 'errorText'))}</p><a class="btn btn-primary" href="${esc(ctx.link('home'))}">${esc(ctx.t('backHome'))}</a></main>`;
}

/** An article's own page, as the theme lays it out. */
function productPage(ctx, p) {
    const pp = ctx.theme.productPage;
    const { colors, sizes } = optionsOf(p);
    const pics = p.images.length ? p.images.map((_, i) => image(ctx, p, i, 'pdp-img')) : [image(ctx, p, 0, 'pdp-img')];
    const gallery = pp.gallery === 'thumbs'
        ? `<div class="pdp-gallery g-thumbs"><div class="g-main">${pics[0]}</div>${pics.length > 1 ? `<div class="g-strip">${pics.join('')}</div>` : ''}</div>`
        : `<div class="pdp-gallery g-${pp.gallery}">${pics.join('')}</div>`;
    const colorBlock = colors.length && html(
        `<div class="opt"><span class="opt-title">${esc(ctx.t('colors'))}</span><div class="opt-colors opt-${pp.colors}">`,
        colors.map(c => pp.colors === 'swatches' && c.code
            ? `<span class="swatch-lg${c.available ? '' : ' is-out'}" title="${esc(c.name)}"${c.code ? ` style="background:${c.code}"` : ''}></span>`
            : `<span class="chip${c.available ? '' : ' is-out'}">${c.code ? `<i style="background:${c.code}"></i>` : ''}${esc(c.name)}</span>`),
        `</div></div>`,
    );
    const sizeBlock = sizes.length && html(
        `<div class="opt"><span class="opt-title">${esc(ctx.t('sizes'))}</span><div class="opt-sizes opt-${pp.sizes}">`,
        sizes.map(s => `<span class="size${s.available ? '' : ' is-out'}">${esc(s.name)}</span>`),
        `</div></div>`,
    );
    const related = pp.related
        ? ctx.snap.products.filter(x => x.id !== p.id && x.categoryId && x.categoryId === p.categoryId).slice(0, pp.related)
        : [];
    return html(
        `<main class="container pdp pdp-${pp.layout}">`,
        gallery,
        `<div class="pdp-info${pp.sticky ? ' is-sticky' : ''}">`,
        p.categoryId && `<a class="crumb" href="${esc(ctx.link('category', p.categoryId))}">${esc(categoryName(ctx, p.categoryId))}</a>`,
        p.brand && `<span class="pdp-brand">${esc(p.brand)}</span>`,
        `<h1 class="pdp-name">${esc(p.name)}</h1>`,
        `<div class="pdp-price">${priceTag(ctx, p)}${onSale(p) ? ` <span class="badge badge-pill badge-sale">-${percentOff(p)}%</span>` : ''}</div>`,
        `<p class="stock ${p.available ? 'is-in' : 'is-out'}">${esc(p.available ? ctx.t('inStock') : ctx.t('soldOut'))}</p>`,
        colorBlock, sizeBlock,
        p.available && orderButtons(ctx, p),
        p.available && orderForm(ctx, p),
        p.description && `<div class="pdp-desc">${esc(p.description).replace(/\n/g, '<br>')}</div>`,
        `</div></main>`,
        related.length && `<section class="container section"><h2 class="section-title">${esc(ctx.t('related'))}</h2>${productGrid(ctx, related, { columns: Math.min(4, ctx.theme.categoryPage.desktopColumns) })}</section>`,
    );
}

/** A category, all articles, or the articles on sale. */
function categoryPage(ctx, id) {
    const cp = ctx.theme.categoryPage;
    const products = id === 'all' ? ctx.snap.products
        : id === 'sale' ? ctx.snap.products.filter(onSale)
            : ctx.snap.products.filter(p => p.categoryId === id);
    const title = id === 'all' ? ctx.t('all') : id === 'sale' ? ctx.t('sale') : categoryName(ctx, id);
    const sizes = [...new Set(products.flatMap(p => p.variants.filter(v => v.available && v.size).map(v => v.size)))];
    return html(
        cp.banner ? `<div class="cat-banner"><div class="container"><h1>${esc(title)}</h1><p>${products.length} ${esc(ctx.t('articles'))}</p></div></div>`
            : `<div class="container"><h1 class="cat-title">${esc(title)}</h1></div>`,
        `<main class="container section">`,
        cp.filters && sizes.length && `<div class="cat-sizes"><span>${esc(ctx.t('sizesInStock'))}</span>${sizes.slice(0, 16).map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>`,
        productGrid(ctx, products),
        `</main>`,
    );
}

module.exports = { messagePage, orderForm, productCard, productGrid, header, footer, productPage, categoryPage, bestPromotion, onSale, optionsOf, navItems, priceOf };
