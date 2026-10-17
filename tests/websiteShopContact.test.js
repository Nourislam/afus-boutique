// Opening hours, social pages and map: typed once in Settings › Shop
// (store_config), shown on the website; the values typed on the Website
// screen by an older version are copied there once.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { buildPublicData } = require('../electron/website/publicData');
const { renderPage } = require('../electron/website/storefront/render');
const { registry } = require('../electron/website/themes/registry');
const { createWebsiteService } = require('../electron/website/websiteService');
const catalog = require('../electron/services/catalogService');

const NOW = Date.parse('2026-10-11T12:00:00Z');
const setStore = (api, cfg) => api.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify(cfg)]);

describe('shop contact on the website', () => {
    it('the values of Settings › Shop are on the published pages (bad links left out)', async () => {
        const { api } = await createShop();
        setStore(api, {
            businessName: 'Boutique Nour', businessPhone: '0555 11 22 33',
            shopHours: 'Samedi – jeudi : 9h – 20h\nVendredi : fermé', shopFacebook: 'https://facebook.com/nour', shopInstagram: 'http://instagram.com/x',
            shopTiktok: 'https://evil.example/tiktok', shopMapUrl: 'https://maps.app.goo.gl/abc',
        });
        const data = buildPublicData(api, { now: NOW, info: { social: { facebook: 'https://facebook.com/old' }, hours: ['Ancien'] } });
        expect(data.shop.hours).toEqual(['Samedi – jeudi : 9h – 20h', 'Vendredi : fermé']);
        expect(data.shop.social).toEqual({ facebook: 'https://facebook.com/nour' });
        expect(data.shop.mapUrl).toBe('https://maps.app.goo.gl/abc');
        const html = renderPage({ snapshot: data, theme: registry.get('classic'), page: 'home', lang: 'fr' });
        expect(html).toContain('https://facebook.com/nour');
        expect(html).toContain('Vendredi : fermé');
        expect(html).not.toContain('facebook.com/old');
    });

    it('nothing in the settings yet: the values of the Website screen are still shown', async () => {
        const { api } = await createShop();
        setStore(api, { businessName: 'Boutique Nour' });
        const data = buildPublicData(api, { now: NOW, info: { social: { instagram: 'https://instagram.com/nour' }, hours: ['9h-20h'] } });
        expect(data.shop.social).toEqual({ instagram: 'https://instagram.com/nour' });
        expect(data.shop.hours).toEqual(['9h-20h']);
    });

    it('an older version\'s values are copied once to the shop settings, never over what the shop typed', async () => {
        const { api } = await createShop();
        const settings = {
            store_config: { businessName: 'Boutique Nour' },
            website: { publicInfo: { hours: ['9h-20h', 'Vendredi fermé'], social: { facebook: 'https://facebook.com/nour' }, mapUrl: 'https://maps.app.goo.gl/x' } },
        };
        const service = createWebsiteService({ api, getSetting: (k) => settings[k] ?? null, saveSetting: (k, v) => { settings[k] = JSON.parse(JSON.stringify(v)); }, codedError: catalog.codedError });
        service.moveContactToShop();
        expect(settings.store_config).toEqual({
            businessName: 'Boutique Nour', shopHours: '9h-20h\nVendredi fermé', shopFacebook: 'https://facebook.com/nour',
            shopInstagram: '', shopTiktok: '', shopMapUrl: 'https://maps.app.goo.gl/x',
        });
        settings.store_config.shopFacebook = 'https://facebook.com/nouveau';
        service.moveContactToShop();
        expect(settings.store_config.shopFacebook).toBe('https://facebook.com/nouveau');
        // The demo shop or training never write the shop's settings
        const demo = { store_config: {}, website: settings.website };
        createWebsiteService({ api, getSetting: (k) => demo[k] ?? null, saveSetting: (k, v) => { demo[k] = v; }, codedError: catalog.codedError, blockedMode: () => 'demo' }).moveContactToShop();
        expect(demo.store_config).toEqual({});
    });
});
