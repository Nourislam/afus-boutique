/**
 * The kinds of home page section a theme can list, each with its options
 * (checked by themes/schema.js) and how it is drawn from the shop's data.
 * A section with nothing to show (no article on sale, no description...)
 * draws nothing: a theme never invents content.
 *
 * Adding a kind of section: one entry here; every theme can then use it.
 */
const { esc, html, phoneDigits, phoneHtml } = require('./html');
const C = require('./components');

const e = (values, def) => ({ kind: 'enum', values, default: def });
const int = (min, max, def) => ({ kind: 'int', min, max, default: def });
const bool = (def) => ({ kind: 'bool', default: def });

const byNewest = (list) => [...list].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

/** The articles a "products" section shows. */
function pick(ctx, source) {
    const all = ctx.snap.products;
    switch (source) {
        // Added to AFUS in the last 7 days (newest first), in stock
        case 'new': return (ctx.snap.newProducts || []).map(id => all.find(p => p.id === id)).filter(p => p && p.available);
        case 'sale': return all.filter(p => C.onSale(p) && p.available);
        case 'available': return all.filter(p => p.available);
        case 'featured': return [...all.filter(p => p.available && p.images.length), ...all.filter(p => p.available && !p.images.length)];
        // The shop's best sellers of the last 7 days (completed sales, order only), in stock
        case 'best': return (ctx.snap.bestSellers || []).map(id => all.find(p => p.id === id)).filter(p => p && p.available);
        default: return all;
    }
}

const TITLE = { new: 'new', sale: 'sale', featured: 'featured', available: 'available', all: 'all', best: 'best' };
// "See all" of each kind of list goes to its store page
const SEE_ALL = { new: ['page', 'new'], sale: ['page', 'offers'], best: ['page', 'best'], featured: ['page', 'products'], available: ['page', 'products'], all: ['page', 'products'] };
const sectionHead = (ctx, title, href) => `<div class="section-head"><h2 class="section-title">${esc(title)}</h2>${href ? `<a class="see-all" href="${esc(href)}">${esc(ctx.t('seeAll'))}</a>` : ''}</div>`;

const SECTION_TYPES = {
    hero: {
        options: { variant: e(['split', 'full', 'centered', 'editorial', 'playful'], 'split'), cta: e(['all', 'sale', 'new'], 'all') },
        render(ctx, o) {
            const shop = ctx.snap.shop;
            const withPic = byNewest(ctx.snap.products.filter(p => p.images.length));
            const pic = withPic[0];
            const sale = ctx.snap.products.some(C.onSale);
            const target = o.cta === 'sale' && sale ? 'sale' : 'all';
            // A small line over the title, only when it is true (new pieces this week, a sale on)
            const eyebrow = (ctx.snap.newProducts || []).length ? ctx.t('new') : sale ? ctx.t('sale') : '';
            // The second way in: the sale (when the first is not already it), else the categories
            const second = sale && target !== 'sale' ? ['category', 'sale', ctx.t('offers')]
                : ctx.snap.categories.length ? ['page', 'categories', ctx.t('categories')] : null;
            return html(
                `<section class="hero hero-${o.variant}${pic ? '' : ' no-image'}">`,
                pic && o.variant !== 'centered' && `<div class="hero-media"><img src="${esc(ctx.img(pic.images[0]))}" alt="${esc(pic.name)}" fetchpriority="high" decoding="async"></div>`,
                `<div class="hero-text container-narrow">`,
                eyebrow && `<span class="hero-eyebrow">${esc(eyebrow)}</span>`,
                `<h1 class="hero-title">${esc(shop.name)}</h1>`,
                shop.description && `<p class="hero-sub">${esc(shop.description)}</p>`,
                `<div class="hero-ctas"><a class="btn btn-primary" href="${esc(ctx.link('category', target))}">${esc(ctx.t('shopNow'))}</a>`,
                second && `<a class="btn btn-outline" href="${esc(ctx.link(second[0], second[1]))}">${esc(second[2])}</a>`,
                `</div></div></section>`,
            );
        },
    },

    // Pay on delivery, delivery to the wilaya, a call before sending: what a buyer checks first
    trust: {
        options: { style: e(['strip', 'cards'], 'strip') },
        render(ctx, o) {
            return `<section class="trust-section trust-${o.style}"><div class="container">${C.trustList(ctx, 'trust-row')}</div></section>`;
        },
    },

    categories: {
        options: { style: e(['tiles', 'circles', 'pills', 'list'], 'tiles'), limit: int(2, 12, 6), title: bool(true) },
        render(ctx, o) {
            const cats = ctx.snap.categories.slice(0, o.limit);
            if (!cats.length) return '';
            const items = cats.map(c => {
                const p = ctx.snap.products.find(x => x.categoryId === c.id && x.images.length);
                const media = (o.style === 'tiles' || o.style === 'circles') && p ? `<img src="${esc(ctx.img(p.images[0]))}" alt="">` : '';
                return `<a class="cat cat-${o.style}" href="${esc(ctx.link('category', c.id))}">${media ? `<span class="cat-media">${media}</span>` : ''}<span class="cat-name">${esc(c.name)}</span></a>`;
            }).join('');
            return `<section class="container section">${o.title ? sectionHead(ctx, ctx.t('categories')) : ''}<div class="cats cats-${o.style}">${items}</div></section>`;
        },
    },

    products: {
        options: {
            source: e(['new', 'sale', 'featured', 'available', 'all', 'best'], 'featured'), limit: int(2, 24, 8),
            layout: e(['grid', 'carousel', 'large-first'], 'grid'), columns: int(2, 5, 4), seeAll: bool(true),
        },
        render(ctx, o) {
            const list = pick(ctx, o.source).slice(0, o.limit);
            if (!list.length) return '';
            const href = o.seeAll ? ctx.link(...SEE_ALL[o.source]) : null;
            return `<section class="container section">${sectionHead(ctx, ctx.t(TITLE[o.source]), href)}${C.productGrid(ctx, list, { columns: o.columns, layout: o.layout })}</section>`;
        },
    },

    promo: {
        options: { style: e(['banner', 'split', 'strip'], 'banner') },
        render(ctx, o) {
            const promo = C.bestPromotion(ctx);
            const count = ctx.snap.products.filter(C.onSale).length;
            if (!promo || !count) return '';
            return html(
                `<section class="promo promo-${o.style}"><div class="container promo-row">`,
                `<div><span class="promo-pct">-${esc(promo.value)}%</span><h2 class="promo-title">${esc(promo.name)}</h2><p>${count} ${esc(ctx.t('articles'))}</p></div>`,
                `<a class="btn btn-light" href="${esc(ctx.link('category', 'sale'))}">${esc(ctx.t('shopNow'))}</a>`,
                `</div></section>`,
            );
        },
    },

    brands: {
        options: { style: e(['text', 'boxed'], 'text') },
        render(ctx, o) {
            const names = [...new Set(ctx.snap.products.map(p => p.brand).filter(Boolean))].slice(0, 12);
            if (names.length < 2) return '';
            return `<section class="container section">${sectionHead(ctx, ctx.t('brands'))}<div class="brands brands-${o.style}">${names.map(n => `<span>${esc(n)}</span>`).join('')}</div></section>`;
        },
    },

    about: {
        options: { style: e(['plain', 'centered', 'split'], 'centered') },
        render(ctx, o) {
            const shop = ctx.snap.shop;
            if (!shop.description) return '';
            return `<section class="about about-${o.style}"><div class="container-narrow"><h2 class="section-title">${esc(ctx.t('about'))}</h2><p>${esc(shop.description)}</p></div></section>`;
        },
    },

    contact: {
        options: { style: e(['card', 'strip'], 'card'), whatsapp: bool(true) },
        render(ctx, o) {
            const shop = ctx.snap.shop;
            const where = [shop.address, shop.city, shop.wilaya].filter(Boolean).join(', ');
            const phone = phoneDigits(shop.phone);
            const extras = C.shopExtras(ctx);
            if (!phone && !where && !extras.hours && !extras.map) return '';
            return html(
                `<section class="container section"><div class="contact contact-${o.style}">`,
                `<div><h2 class="section-title">${esc(ctx.t('contact'))}</h2>`,
                shop.phone && `<p><strong>${esc(ctx.t('phone'))}:</strong> ${phoneHtml(shop.phone)}</p>`,
                where && `<p><strong>${esc(ctx.t('address'))}:</strong> ${esc(where)}</p>`,
                extras.map && `<p>${extras.map}</p>`,
                extras.hours,
                `</div>`,
                o.whatsapp && phone && `<a class="btn btn-primary" href="${esc(ctx.preview ? '#' : `https://wa.me/${phone}`)}">WhatsApp</a>`,
                `</div></section>`,
            );
        },
    },
};

module.exports = { SECTION_TYPES };
