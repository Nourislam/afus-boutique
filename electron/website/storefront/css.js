/**
 * The website's style sheet, made from a theme: its values become CSS
 * variables, its choices become classes on <body> (hdr-*, card-*, ...). One
 * sheet serves every theme; a theme only changes values and choices.
 * Logical properties (inline-start / end) so Arabic pages read right to left.
 */
const SHADOW = { none: 'none', soft: '0 6px 24px rgba(0,0,0,.07)', strong: '0 14px 40px rgba(0,0,0,.16)' };

function variables(theme) {
    const t = theme.tokens;
    const c = t.colors;
    return `:root{
--bg:${c.background};--surface:${c.surface};--text:${c.text};--muted:${c.muted};--primary:${c.primary};--on-primary:${c.onPrimary};
--accent:${c.accent};--sale:${c.sale};--border:${c.border};
--font-head:${t.fonts.heading};--font-body:${t.fonts.body};
--base:${t.type.baseSize}px;--scale:${t.type.scale};--head-weight:${t.type.headingWeight};--head-case:${t.type.headingCase === 'upper' ? 'uppercase' : 'none'};
--head-track:${t.type.headingTracking}em;--body-track:${t.type.bodyTracking}em;
--radius:${t.shape.radius}px;--btn-radius:${t.shape.buttonRadius}px;--card-radius:${t.shape.cardRadius}px;
--container:${t.layout.container}px;--section-gap:${t.layout.sectionGap}px;--grid-gap:${t.layout.gridGap}px;
--shadow:${SHADOW[t.style.shadow]};--bw:${t.style.border}px;--ratio:${theme.productCard.imageRatio};
--h1:calc(var(--base)*var(--scale)*var(--scale)*var(--scale)*var(--scale));--h2:calc(var(--base)*var(--scale)*var(--scale));
}`;
}

const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:var(--base);line-height:1.6;letter-spacing:var(--body-track)}
img{display:block;max-width:100%}
a{color:inherit;text-decoration:none}
h1,h2,h3,.logo-text,.hero-title,.section-title,.pdp-name,.promo-title{font-family:var(--font-head);font-weight:var(--head-weight);text-transform:var(--head-case);letter-spacing:var(--head-track);line-height:1.15;margin:0}
.container{max-width:var(--container);margin-inline:auto;padding-inline:20px}
.container-narrow{max-width:720px;margin-inline:auto;padding-inline:20px}
.section{margin-block:var(--section-gap)}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:20px}
.section-title{font-size:var(--h2)}
.see-all{color:var(--muted);font-size:.9em;border-bottom:1px solid currentColor;white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:.85em 1.6em;border-radius:var(--btn-radius);font-weight:600;border:var(--bw) solid transparent;transition:opacity .2s,transform .2s;cursor:pointer}
.btn:hover{opacity:.88}
.btn-primary{background:var(--primary);color:var(--on-primary)}
.btn-ghost{border-color:var(--text);border-width:max(1px,var(--bw))}
.btn-light{background:var(--bg);color:var(--text)}
.empty{padding:48px 16px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:var(--radius)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:.35em .85em;border:1px solid var(--border);border-radius:999px;font-size:.85em}
.chip i{width:12px;height:12px;border-radius:50%;border:1px solid var(--border)}
.is-out{opacity:.4;text-decoration:line-through}

/* Announcement and header */
.announce{background:var(--text);color:var(--bg);text-align:center;font-size:.85em;padding:8px 16px}
.site-header{background:var(--bg);border-bottom:1px solid var(--border);z-index:10}
.site-header.is-sticky{position:sticky;top:0}
.hdr-row{display:flex;align-items:center;gap:24px;min-height:68px}
.logo{display:flex;align-items:center;flex:none}
.logo-img{height:44px;width:auto;max-width:220px;object-fit:contain}
.logo-text{font-size:calc(var(--base)*1.5)}
.nav-inline{display:flex;gap:22px;flex-wrap:wrap;flex:1}
.nav-inline a,.nav-tabs a{color:var(--muted);font-size:.95em;padding-block:4px;border-bottom:2px solid transparent}
.nav-inline a:hover,.nav-tabs a:hover,.nav-inline a.is-current,.nav-tabs a.is-current{color:var(--text);border-color:var(--accent)}
.nav-sale{color:var(--sale)!important}
.hdr-tools{display:flex;align-items:center;gap:16px;margin-inline-start:auto;color:var(--muted);font-size:.9em}
.hdr-search{font-size:1.4em;line-height:1}
.nav-tabs{display:flex;gap:24px;overflow-x:auto;padding-block:10px;border-top:1px solid var(--border);white-space:nowrap}
.nav-toggle{position:absolute;opacity:0;pointer-events:none}
.nav-burger{display:none;flex-direction:column;gap:5px;cursor:pointer;padding:6px}
.nav-burger span{display:block;width:22px;height:2px;background:var(--text)}
.drawer{display:none}
.nav-toggle:checked~.drawer{display:flex;flex-direction:column;position:absolute;inset-inline:0;top:100%;background:var(--bg);border-bottom:1px solid var(--border);padding:12px 20px;gap:12px;box-shadow:var(--shadow)}
.site-header{position:relative}
.site-header.is-sticky{position:sticky}
.hdr-centered .hdr-row{flex-wrap:wrap;justify-content:center;padding-block:14px}
.hdr-centered .logo{order:-1;width:100%;justify-content:center}
.hdr-centered .logo-text{font-size:calc(var(--base)*2)}
.hdr-centered .nav-inline{justify-content:center;flex:none}
.hdr-centered .hdr-tools{position:absolute;inset-inline-end:20px;top:22px}
.hdr-bold{background:var(--primary);color:var(--on-primary);border:0}
.hdr-bold .nav-inline a{color:var(--on-primary);opacity:.8}
.hdr-bold .nav-inline a:hover,.hdr-bold .nav-inline a.is-current{opacity:1;border-color:var(--accent)}
.hdr-bold .hdr-tools{color:var(--on-primary)}
.hdr-bold .nav-burger span{background:var(--on-primary)}
.hdr-bold .nav-tabs{border-color:rgba(0,0,0,.12)}
.hdr-bold .nav-tabs a{color:var(--on-primary);opacity:.75}
.hdr-bold .nav-tabs a:hover,.hdr-bold .nav-tabs a.is-current{opacity:1;border-color:var(--on-primary)}
.hdr-bold .nav-sale{color:var(--on-primary)!important;opacity:1;font-weight:700}
.hdr-bold .drawer a{color:var(--text)}
.hdr-minimal .hdr-row{min-height:60px}
.hdr-minimal .nav-burger,.nav-drawer .nav-burger{display:flex}

/* Hero */
.hero{position:relative;overflow:hidden}
.hero-media img{width:100%;height:100%;object-fit:cover}
.hero-title{font-size:var(--h1)}
.hero-sub{color:var(--muted);font-size:1.1em;margin:14px 0 26px}
.hero-split{display:grid;grid-template-columns:1fr 1fr;min-height:520px;background:var(--surface)}
.hero-split .hero-text{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:48px}
.hero-split.no-image{grid-template-columns:1fr}
.hero-full{min-height:620px;display:flex;align-items:flex-end;color:#fff}
.hero-full .hero-media{position:absolute;inset:0}
.hero-full .hero-media::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,.05))}
.hero-full .hero-text{position:relative;padding-block:64px;max-width:var(--container)}
.hero-full .hero-sub{color:rgba(255,255,255,.85)}
.hero-full.no-image{background:var(--primary);color:var(--on-primary);min-height:420px}
.hero-centered{text-align:center;padding:110px 0;background:var(--surface)}
.hero-centered .hero-text{display:flex;flex-direction:column;align-items:center}
.hero-editorial{display:grid;grid-template-columns:5fr 7fr;gap:0;min-height:600px;border-bottom:1px solid var(--border)}
.hero-editorial .hero-media{order:2}
.hero-editorial .hero-text{display:flex;flex-direction:column;justify-content:flex-end;padding:56px}
.hero-editorial .hero-title{font-size:calc(var(--h1)*1.25)}
.hero-editorial.no-image{grid-template-columns:1fr}
.hero-playful{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:32px;padding:48px max(20px,calc((100% - var(--container))/2 + 20px));background:var(--surface)}
.hero-playful .hero-media{border-radius:40% 60% 55% 45%/50% 45% 55% 50%;overflow:hidden;aspect-ratio:1;border:6px solid var(--accent)}
.hero-playful .hero-text{order:-1;padding:0}
.hero-playful.no-image{grid-template-columns:1fr;text-align:center}

/* Categories */
.cats{display:grid;gap:var(--grid-gap)}
.cats-tiles{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.cat-tiles{position:relative;display:block;border-radius:var(--card-radius);overflow:hidden;background:var(--surface);aspect-ratio:4/5}
.cat-tiles .cat-media,.cat-tiles .cat-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cat-tiles .cat-name{position:absolute;inset-inline:12px;bottom:12px;background:var(--bg);color:var(--text);padding:8px 12px;border-radius:var(--radius);font-weight:600;text-align:center}
.cats-circles{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));text-align:center}
.cat-circles .cat-media{display:block;aspect-ratio:1;border-radius:50%;overflow:hidden;background:var(--surface);margin-bottom:10px;border:3px solid var(--accent)}
.cat-circles img{width:100%;height:100%;object-fit:cover}
.cat-circles .cat-name{font-weight:600}
.cats-pills{display:flex;flex-wrap:wrap;gap:10px}
.cat-pills{padding:.6em 1.3em;border:var(--bw) solid var(--text);border-radius:999px;font-weight:500}
.cat-pills:hover{background:var(--text);color:var(--bg)}
.cats-list{grid-template-columns:1fr;gap:0;border-top:1px solid var(--border)}
.cat-list{display:flex;justify-content:space-between;padding:18px 4px;border-bottom:1px solid var(--border);font-family:var(--font-head);font-size:calc(var(--base)*1.4)}
.cat-list::after{content:"→";color:var(--muted)}
[dir=rtl] .cat-list::after{content:"←"}

/* Product grid and cards */
.grid{display:grid;gap:var(--grid-gap);grid-template-columns:repeat(var(--cols),minmax(0,1fr))}
.grid-carousel{grid-auto-flow:column;grid-auto-columns:calc((100% - var(--grid-gap)*(var(--cols) - 1))/var(--cols));grid-template-columns:none;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px}
.grid-carousel>.card{scroll-snap-align:start}
.grid-large-first>.card:first-child{grid-column:span 2;grid-row:span 2}
.card{display:flex;flex-direction:column;gap:10px;position:relative;text-align:var(--card-align,start)}
.card-media{position:relative;display:block;aspect-ratio:var(--ratio);overflow:hidden;background:var(--surface);border-radius:var(--card-radius)}
.card-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .35s,transform .5s}
.card-img-alt{opacity:0}
.card:hover .card-img-alt{opacity:1}
.card:hover .card-img{transform:scale(1.03)}
.card-body{display:flex;flex-direction:column;gap:4px}
.card-brand{font-size:.75em;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.card-name{font-weight:500}
.price-now{font-weight:700}
.price-was{color:var(--muted);font-size:.9em;margin-inline-start:6px}
.card .price-now{color:var(--text)}
.price:has(.price-was) .price-now{color:var(--sale)}
.swatches{display:flex;gap:5px;margin-top:4px;align-items:center}
.swatch{width:14px;height:14px;border-radius:50%;background:var(--surface);border:1px solid var(--border)}
.swatch.is-out{opacity:.35}
.swatch-more{font-size:.75em;color:var(--muted)}
.card-sizes{display:flex;flex-wrap:wrap;gap:4px;font-size:.75em;color:var(--muted)}
.card-sizes span{border:1px solid var(--border);padding:1px 6px;border-radius:4px}
.card.is-soldout .card-img{filter:grayscale(.7);opacity:.7}
.badges{position:absolute;top:10px;inset-inline-start:10px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.badge{font-size:.72em;font-weight:700;padding:3px 9px;line-height:1.4}
.badge-sale{background:var(--sale);color:#fff}
.badge-out{background:var(--text);color:var(--bg)}
.badge-pill{border-radius:999px}
.badge-corner{border-radius:0}
.badge-ribbon{border-radius:0 var(--radius) var(--radius) 0;margin-inline-start:-10px}
[dir=rtl] .badge-ribbon{border-radius:var(--radius) 0 0 var(--radius)}
.badge-text{background:none!important;color:var(--sale);padding:0;text-transform:uppercase;letter-spacing:.06em}
.badge-text.badge-out{color:var(--text)}
.card-bordered{border:max(1px,var(--bw)) solid var(--border);border-radius:var(--card-radius);padding:10px}
.card-bordered .card-media{border-radius:calc(var(--card-radius) - 4px)}
.card-elevated{background:var(--bg);border-radius:var(--card-radius);box-shadow:var(--shadow);padding-bottom:14px;overflow:hidden}
.card-elevated .card-media{border-radius:0}
.card-elevated .card-body{padding-inline:14px}
.card-rounded .card-media{border-radius:calc(var(--card-radius)*1.5);border:3px solid var(--surface)}
.card-rounded .card-body{padding-inline:6px}
.card-overlay .card-body{position:absolute;inset-inline:0;bottom:0;padding:14px;background:linear-gradient(to top,rgba(0,0,0,.72),transparent);color:#fff;border-radius:0 0 var(--card-radius) var(--card-radius)}
.card-overlay .card-brand,.card-overlay .price-was,.card-overlay .card-sizes{color:rgba(255,255,255,.75)}
.card-overlay .price-now{color:#fff}
.card-overlay.card .price:has(.price-was) .price-now{color:#fff}
.name-upper .card-name{text-transform:uppercase;letter-spacing:.06em;font-size:.88em}
.align-center{--card-align:center}
.align-center .swatches,.align-center .card-sizes{justify-content:center}
.img-warm .card-img,.img-warm .pdp-img,.img-warm .hero-media img{filter:sepia(.12) saturate(1.05)}
.img-mono-hover .card-img{filter:grayscale(1)}
.img-mono-hover .card:hover .card-img{filter:none}

/* Promotion, brands, about, contact */
.promo{background:var(--accent);color:#fff;margin-block:var(--section-gap)}
.promo-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-block:44px;flex-wrap:wrap}
.promo-pct{font-family:var(--font-head);font-size:calc(var(--h1)*1.1);font-weight:800;line-height:1}
.promo-title{font-size:var(--h2);margin-top:6px}
.promo-strip .promo-row{padding-block:18px}
.promo-strip .promo-pct{font-size:var(--h2)}
.promo-strip .promo-title{font-size:1.1em}
.promo-split{background:linear-gradient(90deg,var(--accent) 50%,var(--primary) 50%)}
.brands{display:flex;flex-wrap:wrap;gap:12px 32px;justify-content:center;font-family:var(--font-head);font-size:calc(var(--base)*1.3);color:var(--muted)}
.brands-boxed span{border:1px solid var(--border);padding:12px 22px;border-radius:var(--radius);font-size:.85em}
.about{background:var(--surface);padding-block:var(--section-gap)}
.about p{color:var(--muted);font-size:1.1em}
.about-centered{text-align:center}
.about-split .container-narrow{display:grid;grid-template-columns:1fr 2fr;gap:32px;max-width:var(--container)}
.contact{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.contact-card{background:var(--surface);border-radius:var(--card-radius);padding:32px;border:var(--bw) solid var(--border)}
.contact-strip{border-block:1px solid var(--border);padding-block:24px}

/* Category page */
.cat-banner{background:var(--surface);padding:48px 0;border-bottom:1px solid var(--border)}
.cat-banner h1,.cat-title{font-size:var(--h1)}
.cat-title{margin-top:32px}
.cat-banner p{color:var(--muted);margin:6px 0 0}
.cat-sizes{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:24px;color:var(--muted);font-size:.9em}

/* Product page */
.pdp{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:48px;margin-block:40px}
.pdp-wide{grid-template-columns:1fr}
.pdp-wide .pdp-info{max-width:720px}
.pdp-gallery{display:grid;gap:12px}
.pdp-img{width:100%;aspect-ratio:var(--ratio);object-fit:cover;background:var(--surface);border-radius:var(--card-radius)}
.g-grid{grid-template-columns:1fr 1fr}
.g-grid .pdp-img:first-child{grid-column:span 2}
.g-thumbs .g-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.pdp-wide .g-stack{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.pdp-info{display:flex;flex-direction:column;gap:14px;align-self:start}
.pdp-info.is-sticky{position:sticky;top:96px}
.crumb{color:var(--muted);font-size:.85em}
.pdp-brand{text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-size:.8em}
.pdp-name{font-size:var(--h2)}
.pdp-price{font-size:1.3em;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.stock{margin:0;font-weight:600;font-size:.9em}
.stock.is-in{color:#15803d}
.stock.is-out{color:var(--sale)}
.opt{display:flex;flex-direction:column;gap:8px}
.opt-title{font-weight:600;font-size:.9em}
.opt-colors,.opt-sizes{display:flex;flex-wrap:wrap;gap:8px}
.swatch-lg{width:30px;height:30px;border-radius:50%;border:2px solid var(--bg);outline:1px solid var(--border);background:var(--surface)}
.size{min-width:46px;text-align:center;padding:9px 12px;border:max(1px,var(--bw)) solid var(--border);border-radius:var(--radius);font-weight:500}
.opt-pills .size{border-radius:999px}
.opt-list{flex-direction:column}
.opt-list .size{text-align:start;border-width:0 0 1px;border-radius:0}
.order{display:flex;gap:10px;flex-wrap:wrap}
.order .btn{flex:1;min-width:180px}
.order-form{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--border);padding-top:16px}
.order-form .hint{color:var(--muted);font-size:.9em;margin:0}
.fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.field{display:flex;flex-direction:column;gap:4px;font-size:.85em;color:var(--muted)}
.field-wide{grid-column:1/-1}
.field input,.field select,.field textarea{font:inherit;font-size:1rem;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;width:100%}
.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
.hp{position:absolute;inset-inline-start:-9999px;width:1px;height:1px;overflow:hidden}
.message-page{text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding-block:96px}
.message-page p{color:var(--muted)}
.pdp-desc{color:var(--muted);border-top:1px solid var(--border);padding-top:16px}

/* Footer */
.site-footer{margin-top:var(--section-gap);border-top:1px solid var(--border);padding-top:48px;font-size:.92em}
.ftr-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:32px}
.ftr-grid p{color:var(--muted);margin:6px 0 0}
.ftr-name{font-family:var(--font-head);font-size:1.3em}
.ftr-links{display:flex;flex-direction:column;gap:6px;margin-top:8px;color:var(--muted)}
.ftr-bottom{color:var(--muted);font-size:.85em;padding-block:24px;margin-top:32px;border-top:1px solid var(--border)}
.ftr-simple .ftr-grid{grid-template-columns:1fr;text-align:center}
.ftr-simple .ftr-grid>div:not(:first-child){display:none}
.ftr-simple .ftr-bottom{text-align:center;border:0;margin-top:0}
.ftr-dark{background:var(--primary);color:var(--on-primary);border:0}
.ftr-dark p,.ftr-dark .ftr-links,.ftr-dark .ftr-bottom{color:var(--on-primary);opacity:.75}
.ftr-dark .ftr-bottom{border-color:rgba(255,255,255,.15)}

/* Small screens */
@media (max-width:900px){
  .grid{grid-template-columns:repeat(var(--cols-m),minmax(0,1fr))}
  .grid-carousel{grid-template-columns:none;grid-auto-columns:70%}
  .grid-large-first>.card:first-child{grid-column:auto;grid-row:auto}
  .hero-split,.hero-editorial,.hero-playful{grid-template-columns:1fr;min-height:0}
  .hero-split .hero-media,.hero-editorial .hero-media{aspect-ratio:4/5;order:0}
  .hero-split .hero-text,.hero-editorial .hero-text{padding:32px 20px}
  .hero-full{min-height:520px}
  .hero-centered{padding:72px 0}
  .pdp{grid-template-columns:1fr;gap:24px;margin-block:20px}
  .fields{grid-template-columns:1fr}
  .pdp-info.is-sticky{position:static}
  .ftr-grid,.about-split .container-narrow{grid-template-columns:1fr}
  .nav-inline{display:none}
  .nav-burger{display:flex}
  .hdr-centered .hdr-row{justify-content:space-between}
  .hdr-centered .logo{order:0;width:auto}
  .hdr-centered .hdr-tools{position:static}
  .hdr-phone{display:none}
  :root{--h1:calc(var(--base)*var(--scale)*var(--scale)*var(--scale));--section-gap:calc(var(--section-gap)*.6)}
}
`;

/** The classes on <body> that carry a theme's choices. */
function bodyClasses(theme) {
    const c = theme.productCard;
    return [
        c.nameCase === 'upper' ? 'name-upper' : '', c.align === 'center' ? 'align-center' : '',
        theme.tokens.style.imageFilter !== 'none' ? `img-${theme.tokens.style.imageFilter}` : '',
        theme.header.nav === 'drawer' ? 'nav-drawer' : '',
    ].filter(Boolean).join(' ');
}

const css = (theme) => `${variables(theme)}\n${BASE}`;

module.exports = { css, bodyClasses };
