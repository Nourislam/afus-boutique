import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { readInternal, readPrivateMarkers } = require('../electron/website/publicData/internal');
const { toPublic, publicInfo, PUBLIC_SHAPE } = require('../electron/website/publicData/public');
const { checkPublic, checkFiles } = require('../electron/website/publicData/guard');
const { buildPublicData, checkSiteFiles, summarize } = require('../electron/website/publicData');
const { buildSite } = require('../electron/website/publish/siteBuilder');
const { renderPage } = require('../electron/website/storefront/render');
const { registry } = require('../electron/website/themes/registry');
const { createWebsiteService } = require('../electron/website/websiteService');
const catalog = require('../electron/services/catalogService');

const NOW = Date.parse('2026-10-11T12:00:00Z');
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const flatten = (o) => JSON.stringify(o);
/** Every key used anywhere in an object. */
const keysOf = (o, out = new Set()) => {
    if (Array.isArray(o)) o.forEach(v => keysOf(v, out));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keysOf(v, out); }
    return out;
};

/**
 * A shop full of private things next to its public catalogue: costs,
 * wholesale prices, a supplier, SKUs / barcodes, employees with PIN hashes,
 * customers with phones and e-mails, tax numbers, a coupon promotion, sales.
 */
async function privateShop() {
    const { api } = await createShop();
    api.run("INSERT INTO categories (id, name) VALUES ('c-jeans', 'Jeans'), ('c-empty', 'Vide')");
    api.run("INSERT INTO suppliers (id, name, phone, email) VALUES ('s1', 'Fournisseur Secret', '0550998877', 'fournisseur@secret.dz')");
    api.run(`UPDATE products SET category_id = 'c-jeans', brand = 'Levi''s', description = 'Coupe droite, 98% coton', image_path = 'jean-1.jpg',
             gallery = '["jean-2.jpg","../etc/passwd.jpg","virus.exe","jean-1.jpg"]', cost = 1800, wholesale_price = 2350, supplier_id = 's1',
             sku = 'SKU-JEAN-SECRET', barcode = '6130000000017' WHERE id = 'jean'`);
    api.run("UPDATE product_variants SET color_code = '#111111' WHERE product_id = 'jean' AND color = 'Noir'");
    api.run("UPDATE product_variants SET color_code = 'url(https://evil.example/x)' WHERE product_id = 'jean' AND color = 'Bleu'");
    api.run("UPDATE product_variants SET cost = 1700 WHERE product_id = 'jean'");
    catalog.saveProduct(api, { id: 'old', name: 'Ancien article', price: 500, cost: 100, is_active: 0 }, []);
    api.run("UPDATE products SET is_active = 0 WHERE id = 'old'");
    api.run("INSERT INTO customers (id, name, phone, email) VALUES ('k1', 'Client Privé', '0661223344', 'client@prive.dz')");
    api.run("INSERT INTO employees (id, name, pin, role) VALUES ('e9', 'Employé Secret', 'pinhash-ABCDEF123456', 'cashier')");
    api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, applies_to_ids, auto_apply, start_date, end_date)
             VALUES ('live', 'Soldes jean', 'percentage', 20, 1, 'product', '["jean"]', 1, '2026-10-01', '2026-10-31'),
                    ('expired', 'Ancienne promo', 'percentage', 50, 1, 'all', '[]', 1, '2025-01-01', '2025-01-31')`);
    api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, applies_to_ids, auto_apply, coupon_code)
             VALUES ('coupon', 'Code caché', 'percentage', 40, 1, 'all', '[]', 1, 'SECRET40')`);
    api.run("INSERT INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify({
        businessName: 'Boutique Yasmine', shopLogo: 'logo.png', shopDescription: 'Mode femme à Alger', businessPhone: '0555 12 34 56',
        businessEmail: 'contact@yasmine.dz', businessAddress: '12 rue Didouche', businessCity: 'Alger', businessWilaya: 'Alger',
        ownerName: 'Propriétaire Secret', businessRc: 'RC-16-B-0099887', businessTaxId: 'NIF-001122334455', businessNis: 'NIS-99887766', businessAi: 'AI-16001234',
        currency: 'DZD', defaultLanguage: 'fr', receiptHeader: 'Merci', taxRate: 19,
    })]);
    return api;
}

const PRIVATE_VALUES = ['1800', '2350', '1700', 'Fournisseur Secret', '0550998877', 'fournisseur@secret.dz', 'SKU-JEAN-SECRET', '6130000000017',
    'Client Privé', '0661223344', 'client@prive.dz', 'Employé Secret', 'pinhash-ABCDEF123456', 'SECRET40', 'Code caché', 'Ancienne promo',
    'Propriétaire Secret', 'RC-16-B-0099887', 'NIF-001122334455', 'NIS-99887766', 'AI-16001234', 'Ancien article', 'evil.example', 'passwd', 'virus.exe', 'J-N-38'];
const PRIVATE_KEYS = /cost|wholesale|supplier|sku|barcode|qr_code|stock_quantity|min_stock|pin|password|token|secret|owner|employee|customer|tax|business(Rc|TaxId|Nis|Ai)|receipt/i;

describe('website public data: SQLite internal -> website public', () => {
    let api;
    beforeEach(async () => { api = await privateShop(); });

    it('the internal side reads named columns of five tables only (no SELECT *, no private table)', () => {
        const sql = [];
        const spy = { all: (q, p) => { sql.push(q); return api.all(q, p); }, get: (q, p) => { sql.push(q); return api.get(q, p); } };
        const internal = readInternal(spy);
        expect(sql.join('\n')).not.toMatch(/SELECT\s+\*/i);
        const tables = new Set(sql.flatMap(q => [...q.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map(m => m[1])));
        expect([...tables].sort()).toEqual(['categories', 'product_variants', 'products', 'promotions', 'settings']);
        // Rows hold no private column: stock counts become "available" inside SQL
        for (const row of [...internal.products, ...internal.variants]) {
            for (const k of Object.keys(row)) expect(k, k).not.toMatch(/cost|wholesale|supplier|sku|barcode|qr|stock|min_/);
        }
        // Settings: only the shop's own description keys
        expect(Object.keys(internal.store).sort()).toEqual(['businessAddress', 'businessCity', 'businessEmail', 'businessName', 'businessPhone', 'businessWilaya', 'currency', 'defaultLanguage', 'shopDescription', 'shopLogo']);
        // The coupon promotion is not even read
        expect(internal.promotions.map(p => p.id).sort()).toEqual(['expired', 'live']);
    });

    it('nothing private in the public data: values, field names, coupon, inactive article, tax numbers', () => {
        const data = buildPublicData(api, { now: NOW });
        const text = flatten(data);
        for (const v of PRIVATE_VALUES) expect(text, v).not.toContain(v);
        for (const k of keysOf(data)) expect(k, k).not.toMatch(PRIVATE_KEYS);
        expect(checkPublic(data, { markers: readPrivateMarkers(api) })).toEqual([]);
        // And in every published file (pages, catalogue, README)
        const site = buildSite({ snapshot: data, theme: registry.get('classic'), orderUrl: 'https://shop-api.example.workers.dev/api/orders', readImage: () => Buffer.from([0xff, 0xd8, 0xff]) });
        const all = site.files.filter(f => !f.path.startsWith('images/')).map(f => String(f.content)).join('\n');
        for (const v of PRIVATE_VALUES) expect(all, v).not.toContain(v);
        expect(() => checkSiteFiles(api, site.files, { data })).not.toThrow();
    });

    it('the shop: name, logo, description, contact, address; currency and language', () => {
        const { shop } = buildPublicData(api, { now: NOW });
        expect(shop).toEqual({
            name: 'Boutique Yasmine', logo: 'logo.png', description: 'Mode femme à Alger', phone: '0555 12 34 56', email: 'contact@yasmine.dz',
            address: '12 rue Didouche', city: 'Alger', wilaya: 'Alger', currency: 'DZD', language: 'fr', hours: [], social: {}, mapUrl: '',
        });
    });

    it('products: active only, prices, sale price from live automatic promotions only, descriptions, availability (no counts)', () => {
        const data = buildPublicData(api, { now: NOW });
        expect(data.products.map(p => p.id).sort()).toEqual(['belt', 'jean']);
        const jean = data.products.find(p => p.id === 'jean');
        expect(jean).toMatchObject({ name: 'Jean', price: 3000, salePrice: 2400, brand: "Levi's", description: 'Coupe droite, 98% coton', categoryId: 'c-jeans', available: true });
        const belt = data.products.find(p => p.id === 'belt');
        // The expired promotion (-50% on all) and the coupon (-40%) do not apply
        expect(belt).toMatchObject({ price: 800, salePrice: null, available: true, variants: [] });
        expect(data.promotions.map(p => p.id)).toEqual(['live']);
        expect(data.promotions[0]).toEqual({ id: 'live', name: 'Soldes jean', type: 'percentage', value: 20, appliesTo: 'product', ids: ['jean'], endsAt: '2026-10-31' });
        // Out of stock everywhere -> not available
        api.run("UPDATE product_variants SET stock_quantity = 0 WHERE product_id = 'jean'");
        api.run("UPDATE products SET stock_quantity = 0 WHERE id = 'belt'");
        const after = buildPublicData(api, { now: NOW });
        expect(after.products.every(p => p.available === false)).toBe(true);
        expect(summarize(after)).toMatchObject({ products: 2, available: 0, onSale: 1 });
    });

    it('pictures: shop file names only, each once; broken / outside / non-picture names dropped; missing files left out of the pages', () => {
        const data = buildPublicData(api, { now: NOW });
        expect(data.products.find(p => p.id === 'jean').images).toEqual(['jean-1.jpg', 'jean-2.jpg']);
        api.run("UPDATE products SET gallery = 'not json' , image_path = '../../secret.png' WHERE id = 'jean'");
        api.run(`UPDATE settings SET value = json_set(value, '$.shopLogo', 'C:\\\\Windows\\\\logo.png') WHERE key = 'store_config'`);
        const broken = buildPublicData(api, { now: NOW });
        expect(broken.products.find(p => p.id === 'jean').images).toEqual([]);
        expect(broken.shop.logo).toBe('');
        // Only pictures that exist go out, and the pages never point at a missing one
        const site = buildSite({ snapshot: data, theme: registry.get('kids'), readImage: (n) => (n === 'jean-1.jpg' ? Buffer.from([0xff, 0xd8]) : null) });
        expect(site.files.filter(f => f.path.startsWith('images/')).map(f => f.path)).toEqual(['images/jean-1.jpg']);
        const page = String(site.files.find(f => f.path === 'product-jean.html').content);
        expect(page).toContain('images/jean-1.jpg');
        expect(page).not.toContain('jean-2.jpg');
        expect(page).not.toContain('logo.png');
    });

    it('SVG drawings (can hold script): shown in the program\'s preview only, never published', () => {
        api.run("UPDATE products SET image_path = 'demo-jean.svg', gallery = '[\"jean-2.jpg\"]' WHERE id = 'jean'");
        expect(buildPublicData(api, { now: NOW }).products.find(p => p.id === 'jean').images).toEqual(['jean-2.jpg']);
        expect(buildPublicData(api, { now: NOW, preview: true }).products.find(p => p.id === 'jean').images).toEqual(['demo-jean.svg', 'jean-2.jpg']);
        // Even given an SVG, the site builder sends none
        const data = buildPublicData(api, { now: NOW, preview: true });
        const site = buildSite({ snapshot: data, theme: registry.get('minimal'), readImage: () => Buffer.from('<svg onload="alert(1)"/>') });
        expect(site.files.some(f => f.path.endsWith('.svg'))).toBe(false);
    });

    it('categories: only those with public articles, with their count', () => {
        const data = buildPublicData(api, { now: NOW });
        expect(data.categories).toEqual([{ id: 'c-jeans', name: 'Jeans', count: 1 }]);
        api.run("UPDATE products SET category_id = 'c-empty' WHERE id = 'belt'");
        expect(buildPublicData(api, { now: NOW }).categories.map(c => [c.name, c.count])).toEqual([['Jeans', 1], ['Vide', 1]]);
        expect(buildPublicData(api, { now: NOW }).brands).toEqual(["Levi's"]);
    });

    it('sizes and colours: each variant with its own availability and price; a colour code only when it is a real colour', () => {
        const jean = buildPublicData(api, { now: NOW }).products.find(p => p.id === 'jean');
        expect(jean.variants).toEqual([
            { color: 'Noir', colorCode: '#111111', size: '38', price: null, available: true },
            { color: 'Noir', colorCode: '#111111', size: '40', price: null, available: true },
            { color: 'Noir', colorCode: '#111111', size: '42', price: null, available: false },
            { color: 'Bleu', colorCode: '', size: '40', price: null, available: true },
            { color: 'Noir', colorCode: '#111111', size: '44', price: 3500, available: true },
        ]);
        // On the article page: every size, sold-out ones marked; both colours by name
        const html = renderPage({ snapshot: buildPublicData(api, { now: NOW }), theme: registry.get('classic'), page: 'product', id: 'jean', lang: 'fr' });
        for (const s of ['38', '40', '44']) expect(html).toContain(`class="size">${s}<`);
        expect(html).toContain('class="size is-out">42<');
        expect(html).toContain('Noir');
        expect(html).toContain('Bleu');
        expect(html).not.toContain('evil.example');
    });

    it('the guard: a field outside the public list, a private name, private values or a program key stop the website', () => {
        const data = buildPublicData(api, { now: NOW });
        expect(checkPublic({ ...data, products: [{ ...data.products[0], cost: 1800 }] }).join()).toMatch(/cost: not a public field/);
        expect(checkPublic({ ...data, shop: { ...data.shop, ownerName: 'x' } }).join()).toMatch(/ownerName: not a public field/);
        expect(checkPublic({ ...data, products: [{ ...data.products[0], price: 'free' }] }).join()).toMatch(/price: not number/);
        // A customer's phone typed into a description: publishing stops (and says nothing of the value)
        api.run("UPDATE products SET description = 'Appelez Client au 0661223344' WHERE id = 'belt'");
        let error;
        try { buildPublicData(api, { now: NOW }); } catch (e) { error = e; }
        expect(error).toMatchObject({ code: 'WEBSITE_PRIVATE_DATA' });
        expect(error.problems.join()).not.toContain('0661223344');
        api.run("UPDATE products SET description = '' WHERE id = 'belt'");
        // The shop's own phone is public even if a customer has the same one
        api.run("UPDATE customers SET phone = '0555 12 34 56' WHERE id = 'k1'");
        expect(() => buildPublicData(api, { now: NOW })).not.toThrow();
        // A program key anywhere: stop
        expect(codeOf(() => buildPublicData(api, { now: NOW, secrets: ['Levi\'s brand key'] }))).toBeNull();
        api.run("UPDATE products SET description = 'gho_SECRETTOKEN123' WHERE id = 'belt'");
        expect(codeOf(() => buildPublicData(api, { now: NOW, secrets: ['gho_SECRETTOKEN123'] }))).toBe('WEBSITE_PRIVATE_DATA');
        expect(checkFiles([{ path: 'index.html', content: 'x cf_at_123456789 y' }], { secrets: ['cf_at_123456789'] })).toHaveLength(1);
        // Every public field has a type (the list is the whole truth)
        expect(Object.keys(PUBLIC_SHAPE).sort()).toEqual(['brands', 'builtAt', 'categories', 'products', 'promotions', 'shop', 'version']);
    });

    it('hours, social pages and map: written on the Website screen, cleaned, shown on the website; other links refused', async () => {
        expect(publicInfo({
            hours: 'Samedi – jeudi : 9 h – 20 h\n\nVendredi : fermé\u0007',
            social: { facebook: 'https://www.facebook.com/boutique.yasmine', instagram: 'http://instagram.com/x', tiktok: 'javascript:alert(1)' },
            mapUrl: 'https://maps.app.goo.gl/abc123',
        })).toEqual({
            hours: ['Samedi – jeudi : 9 h – 20 h', 'Vendredi : fermé'],
            social: { facebook: 'https://www.facebook.com/boutique.yasmine' },
            mapUrl: 'https://maps.app.goo.gl/abc123',
        });
        expect(publicInfo({ social: { facebook: 'https://facebook.com.evil.example/x', instagram: 'https://user:pw@instagram.com/x' }, mapUrl: 'https://evil.example/maps' })).toEqual({ hours: [], social: {}, mapUrl: '' });

        const settings = { website: { created: true, name: 'boutique-yasmine', theme: 'classic' } };
        const service = createWebsiteService({ api, getSetting: (k) => settings[k] ?? null, saveSetting: (k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); }, codedError: catalog.codedError });
        const before = api.all('SELECT * FROM settings ORDER BY key');
        const r = service.setPublicInfo({ hours: 'Tous les jours 9h-21h', social: { instagram: 'https://instagram.com/yasmine', tiktok: 'https://evil.example' }, mapUrl: 'https://www.google.com/maps/place/Alger' });
        expect(r.result.refused).toEqual(['tiktok']);
        expect(r.publicInfo).toEqual({ hours: ['Tous les jours 9h-21h'], social: { instagram: 'https://instagram.com/yasmine' }, mapUrl: 'https://www.google.com/maps/place/Alger' });
        // The shop's own settings are not touched
        expect(api.all('SELECT * FROM settings ORDER BY key')).toEqual(before);
        const html = service.previewTheme({ page: 'home' }).html;
        expect(html).toContain('Tous les jours 9h-21h');
        expect(html).toContain('Instagram');
        // In the preview the outside links go nowhere; on the published site they open the shop's pages
        expect(html).not.toContain('instagram.com/yasmine');
        const published = renderPage({ snapshot: buildPublicData(api, { now: NOW, info: settings.website.publicInfo }), theme: registry.get('classic'), page: 'home', lang: 'fr' });
        expect(published).toContain('href="https://instagram.com/yasmine" rel="noopener" target="_blank"');
        expect(published).toContain('https://www.google.com/maps/place/Alger');
    });

    it('the Website screen gets a plain message when the check stops the preview', () => {
        const settings = { website: { created: true, name: 'boutique-yasmine', theme: 'classic' } };
        const service = createWebsiteService({ api, getSetting: (k) => settings[k] ?? null, saveSetting: (k, v) => { settings[k] = v; }, codedError: catalog.codedError });
        api.run("UPDATE products SET description = 'fournisseur@secret.dz' WHERE id = 'belt'");
        expect(codeOf(() => service.preview())).toBe('WEBSITE_PRIVATE_DATA');
        expect(codeOf(() => service.previewTheme({}))).toBe('WEBSITE_PRIVATE_DATA');
    });
});

describe('website public data: the shape is the same for every theme', () => {
    it('toPublic on an empty shop: nothing invented', () => {
        const data = toPublic({ store: {}, products: [], variants: [], categories: [{ id: 'c', name: 'C' }], promotions: [] }, { now: NOW });
        expect(data).toMatchObject({ version: 1, categories: [], brands: [], products: [], promotions: [], shop: { name: '', currency: 'DZD', language: 'ar' } });
        expect(checkPublic(data)).toEqual([]);
    });
});
