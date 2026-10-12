// The website's side of the shop's tools: delivery prices and the order's
// total in the forms, the coupon field, "few left", size guides, and the ads /
// visit tools (pixels) loaded only when the shop gave their ids, each allowed
// by the page's Content-Security-Policy from its own addresses only.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { buildPublicData } = require('../electron/website/publicData');
const { publicInfo, deliveryFee } = require('../electron/website/publicData/public');
const { buildSite } = require('../electron/website/publish/siteBuilder');
const { renderPage, TRACKER_HOSTS } = require('../electron/website/storefront/render');
const { registry } = require('../electron/website/themes/registry');

const NOW = Date.parse('2026-10-11T12:00:00Z');
const ORDER_URL = 'https://shop-api.example.workers.dev/api/orders';
const IDS = { facebook: '123456789012345', tiktok: 'C4ABCDEFGHIJ1234KLMN', snapchat: '0f8fad5b-d9cb-469f-a165-70867728950e', google: 'G-ABC123XYZ9' };
const csp = (html) => html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];

describe('website: delivery prices, coupon, few left, size guide, pixels', () => {
    let api;
    beforeEach(async () => {
        ({ api } = await createShop());
        api.run("INSERT INTO categories (id, name) VALUES ('c-jeans', 'Jeans')");
        api.run("UPDATE products SET category_id = 'c-jeans' WHERE id = 'jean'");
    });
    const data = (info = {}) => buildPublicData(api, { now: NOW, info });
    const page = (snapshot, extra = {}) => renderPage({ snapshot, theme: registry.get('classic'), page: 'product', id: 'jean', lang: 'fr', orderUrl: ORDER_URL, ...extra });

    it('delivery prices: cleaned (1-58, numbers only), the price for a wilaya and kind, free over an amount, false where not delivered', () => {
        const d = publicInfo({ delivery: { home: '600', office: -5, freeOver: 9000, wilayas: [{ code: 16, home: 400 }, { code: 99, home: 1 }, { code: 33, off: true }, { code: 16, home: 1 }, { code: 5 }] } }).delivery;
        expect(d).toEqual({ home: 600, office: null, freeOver: 9000, wilayas: [{ code: 16, home: 400, office: null, off: false }, { code: 33, home: null, office: null, off: true }] });
        expect(deliveryFee(d, 16, 'home', 1000)).toBe(400);
        expect(deliveryFee(d, 31, 'home', 1000)).toBe(600);
        expect(deliveryFee(d, 31, 'office', 1000)).toBeNull();
        expect(deliveryFee(d, 31, 'home', 9000)).toBe(0);
        expect(deliveryFee(d, 33, 'home', 9000)).toBe(false);
    });

    it('the order form: prices given to the script, wilayas not delivered not choosable, a summary with the total; the coupon field only when coupons are on', () => {
        const html = page(data({ delivery: { home: 500, wilayas: [{ code: 33, off: true }] } }));
        expect(html).toContain('data-delivery="');
        expect(html).toMatch(/<option value="33 - [^"]+" disabled>[^<]+— /);
        expect(html).toContain('data-sum-total');
        expect(html).not.toContain('name="coupon"');
        const on = page(data({ features: { coupons: true } }));
        expect(on).toContain('name="coupon"');
        // No API (the preview in AFUS): no coupon field, it could not be checked
        expect(page(data({ features: { coupons: true } }), { preview: true })).not.toContain('name="coupon"');
    });

    it('"few left": on the article when 1 to N pieces are left (N set by the shop); the count itself never on the website', () => {
        // createShop: the jean's sizes have 4, 2, 0, 3, 2 pieces (11 in all)
        const html = page(data());
        // The article as a whole is not "few"; the sizes with 1-3 are (the script shows it for the size chosen)
        expect(html).toMatch(/<p class="few-left" data-few hidden>/);
        const flags = JSON.parse(html.match(/data-variants="([^"]+)"/)[1].replace(/&quot;/g, '"')).map(v => Boolean(v[4]));
        expect(flags).toEqual([0, 1, 0, 1, 1].map(Boolean));
        expect(page(data({ fewLeftAt: 20 }))).toMatch(/<p class="few-left" data-few>/);
        expect(page(data({ features: { fewLeft: false } }))).not.toContain('few-left');
        const json = JSON.stringify(data());
        expect(json).not.toMatch(/stock|quantity/i);
    });

    it('size guide: the article\'s category guide, written by the shop and escaped', () => {
        const html = page(data({ sizeGuides: [{ categoryId: 'c-jeans', text: 'S: 36-38\n<b>M</b>: 40' }, { categoryId: 'other', text: 'x' }] }));
        expect(html).toContain('<details class="size-guide">');
        expect(html).toContain('<p>S: 36-38</p><p>&lt;b&gt;M&lt;/b&gt;: 40</p>');
        expect(page(data())).not.toContain('size-guide">');
    });

    it('pixels off (no id): no tracking script, no outside address in the policy', () => {
        const html = page(data());
        expect(html).not.toContain('assets/track.js');
        expect(html).not.toContain('data-track=');
        for (const hosts of Object.values(TRACKER_HOSTS)) for (const h of Object.values(hosts).flat()) expect(csp(html)).not.toContain(h);
        const site = buildSite({ snapshot: data(), theme: registry.get('classic'), orderUrl: ORDER_URL });
        expect(site.files.map(f => f.path)).not.toContain('assets/track.js');
    });

    it('pixels on: only valid ids are kept; each tool allowed from its own addresses only; the preview never loads them', () => {
        const bad = publicInfo({ tracking: { facebook: '12<script>', tiktok: 'x', snapchat: 'nope', google: 'UA-1' } }).tracking;
        expect(bad).toEqual({ facebook: '', tiktok: '', snapchat: '', google: '' });
        const one = page(data({ tracking: { snapchat: IDS.snapchat } }));
        expect(one).toContain('<script src="assets/track.js" defer></script>');
        expect(csp(one)).toContain('https://sc-static.net');
        expect(csp(one)).not.toContain('facebook');
        expect(csp(one)).not.toContain('google');
        const all = page(data({ tracking: IDS }));
        const policy = csp(all);
        for (const h of ['https://connect.facebook.net', 'https://analytics.tiktok.com', 'https://sc-static.net', 'https://www.googletagmanager.com']) expect(policy).toMatch(new RegExp(`script-src [^;]*${h.replace(/\./g, '\\.')}`));
        expect(policy).toContain("frame-src 'none'");
        expect(policy).toMatch(/connect-src 'self' https:\/\/shop-api\.example\.workers\.dev/);
        expect(all).toContain(`data-track="${JSON.stringify(IDS).replace(/"/g, '&quot;')}"`);
        const site = buildSite({ snapshot: data({ tracking: IDS }), theme: registry.get('classic'), orderUrl: ORDER_URL });
        expect(site.files.map(f => f.path)).toContain('assets/track.js');
        // In AFUS's preview: nothing from outside
        const preview = page(data({ tracking: IDS }), { preview: true });
        expect(preview).not.toContain('track.js');
        expect(preview).not.toContain('facebook.net');
    });

    it('page names for the visit counts: plain and short; the API address for the script', () => {
        const html = page(data());
        expect(html).toContain('data-page="product-jean"');
        expect(html).toContain('data-api="https://shop-api.example.workers.dev"');
        expect(renderPage({ snapshot: data(), theme: registry.get('classic'), page: 'home', lang: 'fr', orderUrl: ORDER_URL })).toContain('data-page="home"');
    });
});
