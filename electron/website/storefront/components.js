/**
 * The storefront's building blocks. Each one reads the shop's data (ctx.snap)
 * and the theme's choices (ctx.theme) and returns markup; none changes data.
 *
 * ctx: { snap, theme, lang, t, link(kind, id), img(path), preview }
 */
const { esc, html, money, moneyHtml, phoneHtml, safeColor, phoneDigits, placeholder } = require('./html');
const { WILAYAS, wilayaLabel } = require('./wilayas');
const { features: resolveFeatures } = require('../publicData/public');

/** What the owner turned on for the website (Website screen › Features). */
const featuresOf = (ctx) => resolveFeatures(ctx.snap.shop.features);

/**
 * The pieces of an order form, the same for the checkout and the form on an
 * article's page: the 58 wilayas (the shop's own first), a field with its
 * message (filled by assets/store.js), a text input.
 */
function formParts(ctx, off) {
    const shopWilaya = ctx.snap.shop.wilaya || '';
    const wilayas = (name) => `<select name="${name}" required${off}><option value="">${esc(ctx.t('chooseWilaya'))}</option>${WILAYAS.map(w => {
        const text = wilayaLabel(w, ctx.lang);
        const chosen = name === 'wilaya' && shopWilaya && (w[1] === shopWilaya || w[2].toLowerCase() === shopWilaya.toLowerCase());
        return `<option value="${esc(text)}"${chosen ? ' selected' : ''}>${esc(text)}</option>`;
    }).join('')}</select>`;
    const err = (name) => `<small class="ferr" data-err-for="${name}" hidden></small>`;
    const field = (name, label, input, wide = false) => `<label class="field${wide ? ' field-wide' : ''}" data-field="${name}"><span>${esc(label)}</span>${input}${err(name)}</label>`;
    const text = (name, { min = 2, max = 60, auto = '', extra = '' } = {}) => `<input name="${name}" required minlength="${min}" maxlength="${max}"${auto ? ` autocomplete="${auto}"` : ''}${extra}${off}>`;
    const phone = () => `<input name="phone" type="tel" inputmode="tel" required maxlength="20" autocomplete="tel" dir="ltr" placeholder="${esc(ctx.t('phoneHint'))}"${off}>`;
    const choice = (value, title, sub, checked) => `<label class="dchoice"><input type="radio" name="delivery" value="${value}"${checked ? ' checked' : ''}${off}><span><strong>${esc(title)}</strong><small>${esc(sub)}</small></span></label>`;
    // The ways of delivery the owner offers (a courier office needs a courier company)
    const f = featuresOf(ctx);
    const home = f.homeDelivery;
    const office = f.officeDelivery && (ctx.snap.shop.couriers || []).length > 0;
    const deliveries = home && office
        ? `<div class="dchoices">${choice('home', ctx.t('deliveryHome'), ctx.t('deliveryHomeSub'), true)}${choice('office', ctx.t('deliveryOffice'), ctx.t('deliveryOfficeSub'), false)}</div>`
        : `<input type="hidden" name="delivery" value="${home ? 'home' : 'office'}"${off}><p class="donly"><strong>${esc(ctx.t(home ? 'deliveryHome' : 'deliveryOffice'))}</strong> · ${esc(ctx.t(home ? 'deliveryHomeSub' : 'deliveryOfficeSub'))}</p>`;
    return { wilayas, err, field, text, phone, deliveries, home, office, features: f };
}

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

function image(ctx, p, index = 0, cls = '', { eager = false } = {}) {
    const path = p.images[index];
    const src = path ? ctx.img(path) : placeholder(p.name, ctx.theme.tokens.colors);
    // The first photo of an article page is what the buyer waits for: loaded first
    const load = eager ? ' fetchpriority="high"' : ' loading="lazy"';
    return `<img class="${cls}" src="${esc(src)}" alt="${esc(p.name)}"${load} decoding="async">`;
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
    const searchText = [p.name, p.brand, categoryName(ctx, p.categoryId), p.collection, p.season, ...colors.map(x => x.name)].filter(Boolean).join(' ').toLowerCase();
    const bestRank = (ctx.snap.bestSellers || []).indexOf(p.id);
    return html(
        `<a class="card card-${c.style}${p.available ? '' : ' is-soldout'}" href="${esc(ctx.link('product', p.id))}" data-product="${esc(p.id)}"`,
        ` data-search="${esc(searchText)}" data-price="${onSale(p) ? p.salePrice : p.price}" data-cat="${esc(p.categoryId || '')}"`,
        ` data-sizes="${esc(sizes.filter(x => x.available).map(x => x.name).join('|'))}" data-colors="${esc(colors.filter(x => x.available).map(x => x.name).join('|'))}"`,
        ` data-available="${p.available ? 1 : 0}" data-sale="${onSale(p) ? 1 : 0}" data-new="${esc(p.createdAt || '')}" data-best="${bestRank < 0 ? 9999 : bestRank}" data-name="${esc(p.name.toLowerCase())}">`,
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

/** The store's main pages (the ones with something to show). */
function navItems(ctx) {
    const snap = ctx.snap;
    const items = [
        { href: ctx.link('home'), label: ctx.t('home'), page: 'home' },
        { href: ctx.link('page', 'products'), label: ctx.t('products'), page: 'page:products' },
        snap.categories.length && { href: ctx.link('page', 'categories'), label: ctx.t('categories'), page: 'page:categories' },
        (snap.newProducts || []).length && { href: ctx.link('page', 'new'), label: ctx.t('newIn'), page: 'page:new' },
        snap.products.some(onSale) && { href: ctx.link('page', 'offers'), label: ctx.t('offers'), page: 'page:offers', sale: true },
        (snap.bestSellers || []).length && { href: ctx.link('page', 'best'), label: ctx.t('best'), page: 'page:best' },
        { href: ctx.link('page', 'about'), label: ctx.t('about'), page: 'page:about' },
        { href: ctx.link('page', 'contact'), label: ctx.t('contact'), page: 'page:contact' },
    ];
    return items.filter(Boolean);
}

const ICONS = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2Z"/></svg>',
    cash: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/></svg>',
    truck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.5-4A8 8 0 1 1 9 19.5Z"/></svg>',
};

/**
 * What a buyer paying on delivery wants to know before ordering. Only what
 * is always true of an Afus website: nothing is paid online, the order goes
 * to the buyer's wilaya, the shop calls before sending it.
 */
function trustList(ctx, cls = '') {
    const item = (icon, title, sub) => `<li>${ICONS[icon]}<span><b>${esc(ctx.t(title))}</b><small>${esc(ctx.t(sub))}</small></span></li>`;
    // The ways of delivery really offered (the same as the order forms)
    const f = featuresOf(ctx);
    const office = f.officeDelivery && (ctx.snap.shop.couriers || []).length > 0;
    const sub = f.homeDelivery && office ? 'trustDeliverySub' : f.homeDelivery ? 'deliveryHomeSub' : 'deliveryOfficeSub';
    return `<ul class="trust ${cls}">${item('cash', 'trustCod', 'trustCodSub')}${item('truck', 'trustDelivery', sub)}${item('check', 'trustCall', 'trustCallSub')}</ul>`;
}

/** The cart link with its count (filled in by the website's script). */
const cartLink = (ctx, cls = 'hdr-icon') => `<a class="${cls}" href="${esc(ctx.link('page', 'cart'))}" aria-label="${esc(ctx.t('cart'))}">${ICONS.cart}<span class="cart-count" data-cart-count hidden>0</span></a>`;

/** Small screens: a bar at the bottom, always at hand (home, categories, search, cart, contact). */
function bottomBar(ctx) {
    const item = (href, icon, label, page, extra = '') => `<a href="${esc(href)}" class="${ctx.current === page ? 'is-current' : ''}">${icon}${extra}<span>${esc(label)}</span></a>`;
    return html(
        `<nav class="bottom-bar" aria-label="${esc(ctx.t('menu'))}">`,
        item(ctx.link('home'), ICONS.home, ctx.t('home'), 'home'),
        item(ctx.link('page', 'categories'), ICONS.grid, ctx.t('categories'), 'page:categories'),
        item(ctx.link('page', 'search'), ICONS.search, ctx.t('search'), 'page:search'),
        featuresOf(ctx).cart && item(ctx.link('page', 'cart'), ICONS.cart, ctx.t('cart'), 'page:cart', '<span class="cart-count" data-cart-count hidden>0</span>'),
        item(ctx.link('page', 'contact'), ICONS.phone, ctx.t('contact'), 'page:contact'),
        `</nav>`,
    );
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
        // The bar on top: the sale when there is one, else how the shop sells (pay on delivery)
        h.announcement && `<div class="announce">${promo ? `${esc(promo.name)} · ${esc(ctx.t('upTo'))} -${esc(promo.value)}%` : `${esc(ctx.t('trustCod'))} · ${esc(ctx.t('trustDelivery'))}`}</div>`,
        `<header class="site-header hdr-${h.style}${h.sticky ? ' is-sticky' : ''}">`,
        `<div class="container hdr-row">`,
        drawer,
        `<a class="logo" href="${esc(ctx.link('home'))}">${logo}</a>`,
        h.nav === 'inline' && `<nav class="nav-inline" aria-label="${esc(ctx.t('categories'))}">${links}</nav>`,
        `<div class="hdr-tools">`,
        h.search && `<form class="hdr-search" action="${esc(ctx.link('page', 'search'))}" method="get" role="search"><input type="search" name="q" placeholder="${esc(ctx.t('searchPlaceholder'))}" aria-label="${esc(ctx.t('search'))}"><button type="submit" aria-label="${esc(ctx.t('search'))}">${ICONS.search}</button></form>`,
        !h.search && `<a class="hdr-icon" href="${esc(ctx.link('page', 'search'))}" aria-label="${esc(ctx.t('search'))}">${ICONS.search}</a>`,
        phone && `<a class="hdr-phone" href="${esc(ctx.preview ? '#' : `tel:+${phone}`)}">${phoneHtml(shop.phone)}</a>`,
        featuresOf(ctx).cart && cartLink(ctx),
        `</div></div>`,
        h.nav === 'tabs' && `<nav class="nav-tabs container" aria-label="${esc(ctx.t('categories'))}">${links}</nav>`,
        `</header>`,
    );
}

const SOCIAL_NAMES = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
/** An outside link of the shop (social page, map): nowhere in the program's preview. */
const outside = (ctx, url, label, cls = '') => `<a class="${cls}" href="${esc(ctx.preview ? '#' : url)}"${ctx.preview ? '' : ' rel="noopener" target="_blank"'}>${esc(label)}</a>`;

/** Opening hours, social pages and map link, when the owner wrote them (Website screen). */
function shopExtras(ctx) {
    const shop = ctx.snap.shop;
    const social = Object.entries(shop.social || {}).filter(([, url]) => url);
    return {
        hours: shop.hours?.length ? `<div class="hours"><strong>${esc(ctx.t('hours'))}</strong>${shop.hours.map(l => `<p>${esc(l)}</p>`).join('')}</div>` : '',
        social: social.length ? `<div class="social"><strong>${esc(ctx.t('follow'))}</strong><div class="social-links">${social.map(([k, url]) => outside(ctx, url, SOCIAL_NAMES[k] || k)).join('')}</div></div>` : '',
        map: shop.mapUrl ? outside(ctx, shop.mapUrl, ctx.t('onMap'), 'map-link') : '',
    };
}

function footer(ctx) {
    const shop = ctx.snap.shop;
    const extras = shopExtras(ctx);
    const where = [shop.address, shop.city, shop.wilaya].filter(Boolean).join(', ');
    const year = new Date(ctx.snap.builtAt).getFullYear();
    const cats = ctx.snap.categories.slice(0, 6).map(c => `<a href="${esc(ctx.link('category', c.id))}">${esc(c.name)}</a>`).join('');
    return html(
        `<footer class="site-footer ftr-${ctx.theme.footer.style}"><div class="container ftr-grid">`,
        `<div><strong class="ftr-name">${esc(shop.name)}</strong>${shop.description ? `<p>${esc(shop.description)}</p>` : ''}</div>`,
        cats && `<div class="ftr-nav"><strong>${esc(ctx.t('categories'))}</strong><div class="ftr-links">${cats}</div></div>`,
        `<div class="ftr-nav"><strong>${esc(ctx.t('products'))}</strong><div class="ftr-links">${[...navItems(ctx).filter(i => i.page !== 'home'), { href: ctx.link('page', 'location'), label: ctx.t('location') }, ...(featuresOf(ctx).cart ? [{ href: ctx.link('page', 'cart'), label: ctx.t('cart') }] : [])].map(i => `<a href="${esc(i.href)}">${esc(i.label)}</a>`).join('')}</div></div>`,
        (shop.phone || where || shop.email || shop.mapUrl) && `<div><strong>${esc(ctx.t('contact'))}</strong>${shop.phone ? `<p>${phoneHtml(shop.phone)}</p>` : ''}${shop.email ? `<p>${esc(shop.email)}</p>` : ''}${where ? `<p>${esc(where)}</p>` : ''}${extras.map ? `<p>${extras.map}</p>` : ''}</div>`,
        (extras.hours || extras.social) && `<div>${extras.hours}${extras.social}</div>`,
        `</div><div class="container ftr-bottom">© ${year} ${esc(shop.name)} · ${esc(ctx.t('rights'))}</div></footer>`,
    );
}

/** "Order on WhatsApp": the shop's chat, the article written in (the script adds the choice and the details). */
function whatsappOrder(ctx, p) {
    const phone = phoneDigits(ctx.snap.shop.phone);
    if (!phone || !featuresOf(ctx).whatsappOrder) return '';
    const text = `${ctx.t('orderText')} ${p.name} (${priceOf(ctx, onSale(p) ? p.salePrice : p.price)})`;
    const wa = ctx.preview ? '#' : `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    return `<a class="btn btn-whatsapp btn-block" href="${esc(wa)}" data-wa="${esc(phone)}"${ctx.preview ? '' : ' rel="noopener" target="_blank"'}>${ICONS.chat}<span>${esc(ctx.t('orderWhatsapp'))}</span></a>`;
}

/**
 * Order this article from its page (pay on delivery): full name, phone,
 * wilaya, commune, home (then the address) or a courier office; "Order now",
 * then "Order on WhatsApp". Sent to the shop's own API like the checkout
 * (same checks there); the colour, size and quantity come from the choice
 * above (assets/store.js). Nothing is paid and no stock moves here.
 */
function orderForm(ctx, p) {
    const f = featuresOf(ctx);
    if (!f.orderForm) return whatsappOrder(ctx, p);
    const off = ctx.orderUrl ? '' : ' disabled';
    const { wilayas, field, text, phone, deliveries, home } = formParts(ctx, off);
    return html(
        `<form class="quick-order" id="order" method="post" novalidate${ctx.orderUrl ? ` action="${esc(ctx.orderUrl)}"` : ''} accept-charset="utf-8" data-quick-order data-price="${onSale(p) ? p.salePrice : p.price}">`,
        `<input type="hidden" name="source" value="product"><input type="hidden" name="order_key" data-order-key value="">`,
        `<input type="hidden" name="items" data-items value="[]"><input type="hidden" name="product_id" value="${esc(p.id)}"><input type="hidden" name="product_name" value="${esc(p.name)}">`,
        `<label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>`,
        `<div class="qo-head"><h2 class="qo-title">${esc(ctx.t('orderFormTitle'))}</h2><p class="qo-sub">${esc(ctx.t('orderFormSub'))}</p></div>`,
        `<div class="fields">`,
        field('customer_name', ctx.t('fullName'), text('customer_name', { min: 3, max: 80, auto: 'name' }), true),
        field('phone', ctx.t('yourPhone'), phone(), true),
        field('wilaya', ctx.t('wilaya'), wilayas('wilaya')),
        field('commune', ctx.t('commune'), text('commune', { auto: 'address-level2' })),
        `</div>`,
        deliveries,
        home && `<div class="fields" data-when="home">${field('address', ctx.t('addressField'), text('address', { min: 3, max: 200, auto: 'street-address' }), true)}</div>`,
        f.noteField && `<div class="fields">${field('note', ctx.t('noteOptional'), `<textarea name="note" rows="2" maxlength="500"${off}></textarea>`, true)}</div>`,
        `<p class="form-msg is-bad" data-form-msg role="alert" hidden></p>`,
        `<button class="btn btn-primary btn-block btn-order" type="submit" data-confirm${off}><span>${esc(ctx.t('orderNow'))}</span><small>${esc(ctx.t('trustCod'))}</small></button>`,
        whatsappOrder(ctx, p),
        `<noscript><p class="hint">${esc(ctx.t('noScriptOrder'))}</p></noscript>`,
        `</form>`,
    );
}

/** After an order request: thanks, or why it was not sent. */
function messagePage(ctx, kind) {
    const ok = kind === 'thanks';
    return `<main class="container-narrow section message-page"><h1>${esc(ctx.t(ok ? 'thanksTitle' : 'errorTitle'))}</h1><p>${esc(ctx.t(ok ? 'thanksText' : 'errorText'))}</p><a class="btn btn-primary" href="${esc(ctx.link('home'))}">${esc(ctx.t('backHome'))}</a></main>`;
}

/**
 * Choose the colour and the size, then Add to cart (or the order form under it). Plain radio
 * buttons (they work without script); the website's script keeps the cart
 * and greys the sizes not available in the chosen colour (data-variants).
 */
function addToCart(ctx, p, colors, sizes) {
    const pp = ctx.theme.productPage;
    const variants = p.variants.map(v => [v.color, v.size, v.available ? 1 : 0, v.price]);
    const off = ctx.preview ? ' disabled' : '';
    const colorChoice = colors.length && html(
        `<fieldset class="opt"><legend class="opt-title">${esc(ctx.t('colors'))}</legend><div class="opt-colors opt-${pp.colors}">`,
        colors.map(c => `<label class="pick pick-color${c.available ? '' : ' is-out'}" title="${esc(c.name)}"><input type="radio" name="color" value="${esc(c.name)}"${c.available ? '' : ' disabled'}${colors.filter(x => x.available).length === 1 && c.available ? ' checked' : ''}>${c.code && pp.colors === 'swatches' ? `<span class="swatch-lg" style="background:${c.code}"></span>` : `<span class="chip">${c.code ? `<i style="background:${c.code}"></i>` : ''}${esc(c.name)}</span>`}</label>`),
        `</div></fieldset>`,
    );
    const sizeChoice = sizes.length && html(
        `<fieldset class="opt"><legend class="opt-title">${esc(ctx.t('sizes'))}</legend><div class="opt-sizes opt-${pp.sizes}">`,
        sizes.map(s => `<label class="pick pick-size${s.available ? '' : ' is-out'}"><input type="radio" name="size" value="${esc(s.name)}"${s.available ? '' : ' disabled'}${sizes.filter(x => x.available).length === 1 && s.available ? ' checked' : ''}><span class="size">${esc(s.name)}</span></label>`),
        `</div></fieldset>`,
    );
    return html(
        `<form class="add-form" novalidate data-add-form data-id="${esc(p.id)}" data-variants="${esc(JSON.stringify(variants))}" data-has-colors="${colors.length ? 1 : 0}" data-has-sizes="${sizes.length ? 1 : 0}">`,
        colorChoice, sizeChoice,
        `<div class="qty"><span class="opt-title">${esc(ctx.t('quantityShort'))}</span><div class="stepper">`,
        `<button type="button" data-step="-1" aria-label="-"${off}>−</button>`,
        `<input type="number" name="qty" min="1" max="20" value="1" inputmode="numeric" aria-label="${esc(ctx.t('quantityShort'))}"${off}>`,
        `<button type="button" data-step="1" aria-label="+"${off}>+</button></div></div>`,
        // The cart for several pieces; one piece is ordered with the form under it
        featuresOf(ctx).cart && `<div class="add-row"><button class="btn btn-ghost" type="submit" name="action" value="add" data-add${off}>${esc(ctx.t('addToCart'))}</button></div>`,
        `<p class="form-msg" data-form-msg role="status" aria-live="polite"></p>`,
        `<noscript><p class="hint">${esc(ctx.t('needScript'))}</p></noscript>`,
        `</form>`,
    );
}

/** An article's own page, as the theme lays it out. */
function productPage(ctx, p) {
    const pp = ctx.theme.productPage;
    const { colors, sizes } = optionsOf(p);
    const count = Math.max(1, p.images.length);
    const pics = Array.from({ length: count }, (_, i) => image(ctx, p, i, 'pdp-img', { eager: i === 0 }));
    // Phones: the photos side by side, swiped with the thumb, dots under them.
    // Thumbs: one big photo, the others under it to choose (the same track)
    const dots = count > 1 ? `<div class="g-dots" aria-hidden="true">${pics.map((_, i) => `<span${i ? '' : ' class="is-on"'}></span>`).join('')}</div>` : '';
    const strip = pp.gallery === 'thumbs' && count > 1
        ? `<div class="g-strip">${p.images.map((_, i) => `<button type="button" data-go="${i}" aria-label="${i + 1}/${count}">${image(ctx, p, i, 'g-thumb')}</button>`).join('')}</div>` : '';
    const gallery = `<div class="pdp-gallery g-${pp.gallery}" data-gallery><div class="g-track" data-track>${pics.join('')}</div>${dots}${strip}</div>`;
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
        p.available ? addToCart(ctx, p, colors, sizes) : html(colorBlock, sizeBlock),
        p.available && orderForm(ctx, p),
        p.available && featuresOf(ctx).trustBar && trustList(ctx),
        p.description && `<div class="pdp-desc">${esc(p.description).replace(/\n/g, '<br>')}</div>`,
        `</div></main>`,
        // Phones: once the button is out of sight, the price and "Order now" stay at the bottom
        p.available && !ctx.preview && `<div class="buy-bar" data-buy-bar hidden><span class="bb-info"><span class="bb-name">${esc(p.name)}</span>${priceTag(ctx, p)}</span><button type="button" class="btn btn-primary" data-buy-now>${esc(ctx.t(featuresOf(ctx).orderForm ? 'orderNow' : 'addToCart'))}</button></div>`,
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

module.exports = { featuresOf, formParts, trustList, bottomBar, cartLink, ICONS, categoryName, shopExtras, messagePage, productCard, productGrid, header, footer, productPage, categoryPage, bestPromotion, onSale, optionsOf, navItems, priceOf };
