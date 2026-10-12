import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { registry, createRegistry, ALIASES } = require('../electron/website/themes/registry');
const { normalizeTheme } = require('../electron/website/themes/schema');
const BUILTIN = require('../electron/website/themes/builtin');
const { SECTION_TYPES } = require('../electron/website/storefront/sections');
const { renderPage, pagesOf } = require('../electron/website/storefront/render');
const { buildSnapshot } = require('../electron/website/catalogSnapshot');
const { createWebsiteService } = require('../electron/website/websiteService');
const ws = require('../electron/website/websiteState');
const catalog = require('../electron/services/catalogService');
const { formatMoney } = require('../electron/i18n');

const IDS = ['fashion-modern', 'atelier', 'sport', 'luxury', 'minimal', 'streetwear', 'classic', 'kids'];
const STORE = ['products', 'search', 'new', 'best', 'offers', 'categories', 'cart', 'checkout', 'contact', 'about', 'location'];
const PAGES = [['home', null], ['category', 'all'], ['category', 'sale'], ['product', 'jean'], ...STORE.map(id => ['page', id])];
// The only script of a published page: the website's own file (no inline script, no handler)
const ONLY_OWN_SCRIPT = (html) => html.replace('<script src="assets/store.js" defer></script>', '');
const clone = (x) => JSON.parse(JSON.stringify(x));
const deepFreeze = (o) => { Object.values(o).forEach(v => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

/** Everything of the shop except the website's own setting. */
function shopData(api) {
    const tables = ['products', 'product_variants', 'categories', 'promotions', 'sales', 'customers'];
    return JSON.stringify([
        ...tables.map(t => api.all(`SELECT * FROM ${t} ORDER BY rowid`)),
        api.all("SELECT key, value FROM settings WHERE key != 'website' ORDER BY key"),
    ]);
}

describe('website themes: data only, checked, extensible', () => {
    it('eight built-in themes, all valid, named in the three languages, in order', () => {
        expect(registry.list().map(t => t.id)).toEqual(IDS);
        for (const m of BUILTIN) {
            const r = normalizeTheme(m);
            expect(r.errors, m.id).toEqual([]);
            for (const lang of ['ar', 'fr', 'en']) {
                expect(r.theme.name[lang], `${m.id} ${lang}`).toBeTruthy();
                expect(r.theme.description[lang], `${m.id} ${lang}`).toBeTruthy();
            }
            expect(r.theme.home.length).toBeGreaterThan(2);
            for (const s of r.theme.home) expect(SECTION_TYPES).toHaveProperty(s.type);
        }
        // Themes really differ in what they control
        const looks = registry.list().map(t => JSON.stringify([t.header.style, t.productCard.style, t.productCard.imageRatio, t.productPage.gallery, t.home.map(s => s.type + (s.variant || s.style || ''))]));
        expect(new Set(looks).size).toBe(IDS.length);
        expect(new Set(registry.list().map(t => t.tokens.colors.background + t.tokens.fonts.heading)).size).toBe(IDS.length);
    });

    it('a theme with a mistake is refused, not half used (typo, bad colour, CSS in a font, unknown section)', () => {
        const base = clone(BUILTIN[0]);
        const bad = [
            [{ ...base, colour: {} }, /colour: unknown/],
            [{ ...base, tokens: { ...base.tokens, colors: { ...base.tokens.colors, text: 'red' } } }, /colors\.text/],
            [{ ...base, tokens: { ...base.tokens, fonts: { ...base.tokens.fonts, heading: 'x;}</style><script>alert(1)</script>' } } }, /fonts\.heading/],
            [{ ...base, tokens: { ...base.tokens, fonts: { ...base.tokens.fonts, body: 'url(https://evil.example/f)' } } }, /fonts\.body/],
            [{ ...base, home: [{ type: 'carousel3d' }] }, /unknown section/],
            [{ ...base, home: [{ type: 'products', limit: 500 }] }, /limit/],
            [{ ...base, productCard: { ...base.productCard, style: 'neon' } }, /productCard\.style/],
            [{ ...base, id: 'Bad Id' }, /^id/],
            [{ ...base, name: { ar: 'x', fr: 'y' } }, /name\.en/],
        ];
        for (const [m, why] of bad) {
            const r = normalizeTheme(m);
            expect(r.ok).toBe(false);
            expect(r.errors.join('\n')).toMatch(why);
            expect(() => createRegistry([m])).toThrow(/refused/);
        }
    });

    it('a new theme is one more file: registered, listed, drawn — nothing else changes', async () => {
        const reg = createRegistry();
        const added = reg.register({
            ...clone(BUILTIN[2]), id: 'beach-summer',
            name: { ar: 'صيف', fr: 'Été', en: 'Summer' }, description: { ar: 'شاطئ', fr: 'Plage', en: 'Beach' },
            tokens: { ...clone(BUILTIN[2].tokens), colors: { ...BUILTIN[2].tokens.colors, background: '#fdf6e3', accent: '#0ea5e9' } },
            home: [{ type: 'hero', variant: 'full' }, { type: 'products', source: 'sale' }],
        });
        expect(reg.list().map(t => t.id)).toEqual([...IDS, 'beach-summer']);
        expect(reg.describe().at(-1)).toMatchObject({ id: 'beach-summer', sections: ['hero', 'products'] });
        const { api } = await createShop();
        const html = renderPage({ snapshot: buildSnapshot(api), theme: added, page: 'home', lang: 'fr', preview: true });
        expect(html).toContain('--bg:#fdf6e3');
        expect(html).toContain('hero-full');
        expect(() => reg.register(clone(BUILTIN[0]))).toThrow(/already exists/);
        expect(() => reg.register({ ...clone(BUILTIN[0]), id: 'modern' })).toThrow(/already exists/);
        // The program's own registry is not touched
        expect(registry.has('beach-summer')).toBe(false);
    });

    it('older theme names are understood (phase 2 shops keep a look)', () => {
        expect(ALIASES).toEqual({ modern: 'fashion-modern', elegant: 'luxury', classic: 'classic' });
        expect(ws.normalizeState({ theme: 'modern' }).theme).toBe('fashion-modern');
        expect(ws.normalizeState({ theme: 'elegant' }).theme).toBe('luxury');
        expect(ws.normalizeState({ theme: 'neon' }).theme).toBe('fashion-modern');
        expect(ws.normalizeState({ theme: 'kids' }).theme).toBe('kids');
    });
});

describe('website themes: every theme draws the same shop data', () => {
    let api, snapshot;
    beforeEach(async () => {
        ({ api } = await createShop());
        api.run("INSERT INTO categories (id, name) VALUES ('c-jeans', 'Jeans')");
        api.run("UPDATE products SET category_id = 'c-jeans', brand = 'Levi''s', description = 'Coupe droite', image_path = 'jean-1.jpg', gallery = '[\"jean-2.jpg\"]' WHERE id = 'jean'");
        api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, applies_to_ids, auto_apply)
                 VALUES ('p1', 'Soldes', 'percentage', 20, 1, 'product', '["jean"]', 1)`);
        api.run("INSERT INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify({ businessName: 'Boutique Yasmine', businessPhone: '0555 12 34 56', shopDescription: 'Mode à Alger', defaultLanguage: 'ar' })]);
        snapshot = deepFreeze(buildSnapshot(api));
    });

    it('each theme × each page × Arabic / French: a whole page, no script, the shop\'s articles, prices, sizes and colours', () => {
        const jean = snapshot.products.find(p => p.id === 'jean');
        const belt = snapshot.products.find(p => p.id === 'belt');
        for (const theme of registry.list()) {
            for (const lang of ['ar', 'fr']) {
                for (const [page, id] of PAGES) {
                    const where = `${theme.id} ${lang} ${page}:${id}`;
                    // The snapshot is frozen: drawing never changes the data
                    const html = renderPage({ snapshot, theme, page, id, lang });
                    // Prices and phones are wrapped so their figures read left to right
                    const flat = html.replace(/<bdi dir="ltr">|<\/bdi>/g, '');
                    expect(html, where).toMatch(/^<!doctype html>/);
                    expect(html, where).toContain(`dir="${lang === 'ar' ? 'rtl' : 'ltr'}"`);
                    expect(html, where).toContain(`theme-${theme.id}`);
                    expect(ONLY_OWN_SCRIPT(html), where).not.toMatch(/<script|javascript:|\son[a-z]+=/i);
                    expect(html, where).toContain('<link rel="stylesheet" href="assets/store.css">');
                    expect(html, where).toContain("script-src 'self'");
                    expect(html, where).toContain("default-src 'none'");
                    expect(html, where).not.toMatch(/img-src[^;]*app:/);
                    expect(html, where).toContain('Boutique Yasmine');
                    if (page === 'category' && id === 'all') {
                        expect(html, where).toContain('Jean');
                        expect(html, where).toContain('Ceinture'.length && belt.name);
                        expect(flat, where).toContain(formatMoney(belt.price, lang));
                    }
                    if (page === 'product') {
                        expect(flat, where).toContain(formatMoney(jean.salePrice, lang));
                        expect(flat, where).toContain(formatMoney(jean.price, lang));
                        for (const size of ['38', '40', '44']) expect(html, where).toContain(`>${size}<`);
                        // 42 exists but is sold out: shown as such, not choosable
                        expect(html, where).toMatch(/pick-size is-out"><input type="radio" name="size" value="42" disabled><span class="size">42</);
                        expect(html, where).toContain('data-add-form');
                        for (const color of ['Noir', 'Bleu']) expect(html, where).toContain(color);
                        expect(html, where).toContain('jean-1.jpg');
                        expect(html, where).toContain('Coupe droite');
                        expect(html, where).toContain('wa.me/213555123456');
                        expect(html, where).toMatch(/<bdi dir="ltr">[\d\s\u00a0\u202f]+<\/bdi>/);
                        expect(html, where).toContain('<bdi dir="ltr">0555 12 34 56</bdi>');
                    }
                    if (page === 'category' && id === 'sale') {
                        expect(html, where).toContain('Jean');
                        expect(html, where).not.toContain(`data-product="belt"`);
                    }
                }
            }
        }
    });

    it('the shop\'s words are text, never markup; links stay on the website', () => {
        const evil = deepFreeze({
            ...clone(snapshot),
            shop: { ...snapshot.shop, name: '<img src=x onerror=alert(1)>', description: '"><script>alert(2)</script>' },
            products: snapshot.products.map(p => ({ ...p, name: `${p.name}</a><script>alert(3)</script>`, variants: p.variants.map(v => ({ ...v, colorCode: 'red;background:url(https://evil.example)' })) })),
        });
        for (const theme of registry.list()) {
            for (const [page, id] of PAGES) {
                const html = renderPage({ snapshot: evil, theme, page, id, lang: 'fr' });
                expect(ONLY_OWN_SCRIPT(html)).not.toMatch(/<script|<img src=x/i);
                expect(html).not.toContain('evil.example');
                expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
            }
        }
        // Every link of the published website points to one of its own pages (or WhatsApp / phone),
        // in every theme; forms go to its own search page or to the shop's own API
        const files = new Set([...pagesOf(snapshot).map(p => p.path), 'assets/store.css']);
        const api = 'https://shop-api.example.workers.dev/api/orders';
        for (const theme of registry.list()) {
            for (const { page, id } of pagesOf(snapshot)) {
                const html = renderPage({ snapshot, theme, page, id, lang: 'fr', orderUrl: api, assetUrl: (name) => `images/${name}` });
                for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
                    expect(files.has(href) || /^(https:\/\/wa\.me\/|tel:\+|images\/[\w.-]+$|data:,$)/.test(href), `${theme.id} ${page}:${id} ${href}`).toBe(true);
                }
                for (const [, action] of html.matchAll(/action="([^"]*)"/g)) expect(['search.html', api], action).toContain(action);
                for (const [, src] of html.matchAll(/src="([^"]*)"/g)) expect(src, src).toMatch(/^(images\/|data:image\/svg\+xml|assets\/store\.js$)/);
            }
        }
    });

    it('pay on delivery: one big "Order now", the cart second, what is true about paying and delivery, the bar for phones', () => {
        for (const theme of registry.list()) {
            const html = renderPage({ snapshot, theme, page: 'product', id: 'jean', lang: 'ar' });
            const buttons = [...html.matchAll(/<button class="btn[^"]*" type="submit" name="action" value="(\w+)"/g)].map(m => m[1]);
            expect(buttons, theme.id).toEqual(['buy', 'add']);
            expect(html).toContain('الدفع عند الاستلام');
            // Courier offices offered at checkout (none ticked = all companies): said here too
            const trust = /<ul class="trust[^"]*">[\s\S]*?<\/ul>/.exec(html)[0];
            expect(trust).toContain('التوصيل إلى ولايتك');
            expect(trust).toContain('مكتب شركة التوصيل');
            expect(html).toContain('data-buy-bar hidden');
            // WhatsApp is a question, not a second way to order; no call button on the article
            expect((html.match(/https:\/\/wa\.me\//g) || []).length).toBe(1);
            expect(html).not.toMatch(/class="btn[^"]*" href="tel:/);
            // The first photo is asked for first, the others when they come near
            expect(html).toMatch(/class="pdp-img" src="[^"]*jean-1\.jpg" alt="[^"]*" fetchpriority="high"/);
            expect(html).toMatch(/class="pdp-img" src="[^"]*jean-2\.jpg" alt="[^"]*" loading="lazy"/);
        }
        // No courier office at checkout: no promise of one on the article
        const homeOnly = { ...snapshot, shop: { ...snapshot.shop, couriers: [] } };
        const page = renderPage({ snapshot: homeOnly, theme: registry.get('sport'), page: 'product', id: 'jean', lang: 'ar' });
        expect(/<ul class="trust[^"]*">[\s\S]*?<\/ul>/.exec(page)[0]).not.toContain('مكتب شركة التوصيل');
        expect(renderPage({ snapshot: homeOnly, theme: registry.get('sport'), page: 'page', id: 'checkout', lang: 'ar' })).not.toContain('value="office"');
    });

    it('the font comes from the website itself (or inside the preview), never from an outside service', () => {
        const { buildSite } = require('../electron/website/publish/siteBuilder');
        const { css } = require('../electron/website/storefront/css');
        const site = buildSite({ snapshot, theme: registry.get('atelier'), lang: 'ar' });
        const fonts = site.files.filter(f => f.path.startsWith('assets/fonts/'));
        expect(fonts.map(f => f.path).sort()).toEqual(['assets/fonts/cairo-arabic.woff2', 'assets/fonts/cairo-latin.woff2']);
        expect(fonts.every(f => Buffer.isBuffer(f.content) && f.content.subarray(0, 4).toString() === 'wOF2')).toBe(true);
        const sheet = site.files.find(f => f.path === 'assets/store.css').content;
        expect(sheet).toContain("src:url(fonts/cairo-arabic.woff2) format('woff2')");
        expect(sheet).not.toMatch(/url\((https?:)?\/\//);
        const home = site.files.find(f => f.path === 'index.html').content;
        expect(home).toContain('font-src \'self\'');
        expect(home).toContain('<link rel="preload" href="assets/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossorigin>');
        // Program's preview: the font is inside the page (it loads nothing from anywhere)
        expect(css(registry.get('atelier'), { preview: true })).toContain('url(data:font/woff2;base64,');
        expect(renderPage({ snapshot, theme: registry.get('atelier'), page: 'home', lang: 'ar', preview: true })).toContain("font-src data:");
    });

    it('in the program\'s preview: links go nowhere, pictures come from the program', () => {
        for (const theme of registry.list()) {
            const html = renderPage({ snapshot, theme, page: 'product', id: 'jean', lang: 'ar', preview: true, assetUrl: (p) => `app://${encodeURIComponent(p)}` });
            expect([...html.matchAll(/href="([^"]*)"/g)].every(([, h]) => h === '#')).toBe(true);
            expect(html).toContain('src="app://jean-1.jpg"');
            expect(html).toMatch(/img-src 'self' data: app:/);
        }
    });

    it('an empty catalogue: nothing invented, a plain "your articles appear here"', async () => {
        const { api: empty } = await createShop();
        empty.run('DELETE FROM product_variants');
        empty.run('DELETE FROM products');
        const snap = buildSnapshot(empty);
        for (const theme of registry.list()) {
            const html = renderPage({ snapshot: snap, theme, page: 'home', lang: 'ar' });
            expect(html).toContain('ستظهر سلعك هنا.');
            expect(html).not.toContain('data-product=');
            expect(renderPage({ snapshot: snap, theme, page: 'product', lang: 'ar' })).not.toContain('data-product=');
        }
        expect(empty.all('SELECT * FROM products')).toEqual([]);
    });
});

describe('website themes: choosing one changes the look only', () => {
    let api, settings, service;
    beforeEach(async () => {
        ({ api } = await createShop());
        settings = { store_config: { businessName: 'Boutique Yasmine' } };
        service = createWebsiteService({
            api, getSetting: (key) => settings[key] ?? null,
            saveSetting: (key, value) => { settings[key] = clone(value); },
            codedError: catalog.codedError,
        });
        service.create({ name: 'boutique-yasmine', theme: 'elegant' });
    });

    it('every theme chosen and previewed: the shop\'s data and the website\'s other settings stay the same', () => {
        expect(service.view().theme).toBe('luxury');
        const before = shopData(api);
        const website = clone(settings.website);
        let current = 'luxury';
        for (const id of IDS) {
            for (const page of ['home', 'category', 'product']) {
                const r = service.previewTheme({ theme: id, page });
                expect(r).toMatchObject({ theme: id, page });
                expect(r.html).toContain(`theme-${id}`);
            }
            // Preview alone saves nothing
            expect(settings.website.theme).toBe(current);
            expect(service.setTheme(id).theme).toBe(id);
            current = id;
        }
        expect(shopData(api)).toBe(before);
        expect({ ...settings.website, theme: 'luxury' }).toEqual(website);
        expect(codeOf(() => service.setTheme('neon'))).toBe('WEBSITE_THEME_UNKNOWN');
        expect(codeOf(() => service.previewTheme({ theme: 'neon' }))).toBe('WEBSITE_THEME_UNKNOWN');
        // The screen gets descriptions only (no code)
        const shown = service.view().themes;
        expect(shown.map(t => t.id)).toEqual(IDS);
        expect(shown[0]).toEqual(expect.objectContaining({ name: expect.any(Object), colors: expect.any(Object), look: expect.any(Object) }));
    });

    it('the preview uses the chosen theme when none is given, and an existing article', () => {
        service.setTheme('kids');
        const r = service.previewTheme({ page: 'product', id: 'not-an-article' });
        expect(r.theme).toBe('kids');
        expect(r.html).toMatch(/data-product="|class="pdp/);
    });
});
