import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const ws = require('../electron/website/websiteState');
const { createWebsiteService } = require('../electron/website/websiteService');
const { buildSnapshot, summarize } = require('../electron/website/catalogSnapshot');
const providers = require('../electron/website/providers');
const ipcGuard = require('../electron/services/ipcGuard');
const catalog = require('../electron/services/catalogService');

const codeOf = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };

describe('website: names, domains, steps', () => {
    it('a free address name from the shop name, Latin letters / digits / dashes only', () => {
        expect(ws.slugify('Boutique Yasmine')).toBe('boutique-yasmine');
        expect(ws.slugify('Élégance & Co.')).toBe('elegance-co');
        expect(ws.slugify('بوتيك الياسمين')).toBe('');
        expect(ws.suggestName('بوتيك الياسمين', () => 0.5)).toMatch(/^boutique-[a-z0-9]{4,}$/);
        expect(ws.isValidName('boutique-yasmine')).toBe(true);
        for (const bad of ['ab', '-shop', 'shop-', 'my--shop', 'Shop', 'shop yasmine', 'a'.repeat(41)]) expect(ws.isValidName(bad), bad).toBe(false);
        expect(ws.freeUrl('boutique-yasmine', 'Yasmine-Shop')).toBe('https://yasmine-shop.github.io/boutique-yasmine/');
    });

    it('own domain: written any way, kept clean; the free address is not one', () => {
        expect(ws.cleanDomain(' https://www.Boutique-Yasmine.com/ ')).toBe('www.boutique-yasmine.com');
        expect(ws.cleanDomain('yasmine.dz')).toBe('yasmine.dz');
        for (const bad of ['', 'yasmine', 'http://', 'yas mine.com', `x.${ws.FREE_HOST}`, '-bad.com']) expect(ws.cleanDomain(bad), bad).toBe('');
    });

    it('status and steps follow the state', () => {
        const s = ws.normalizeState(null);
        expect(ws.statusOf(s)).toBe('none');
        const created = ws.normalizeState({ created: true, name: 'shop-one' });
        expect(ws.statusOf(created)).toBe('accounts');
        expect(ws.stepsOf(created).map(x => x.done)).toEqual([true, false, false, false]);
        const linked = ws.normalizeState({ created: true, name: 'shop-one', accounts: { github: { status: 'connected' }, cloudflare: { status: 'connected' } } });
        expect(ws.statusOf(linked)).toBe('ready');
        expect(ws.statusOf({ ...linked, publishedAt: '2026-10-11' })).toBe('live');
        expect(ws.statusOf({ ...linked, lastError: 'x' })).toBe('error');
        // Unknown theme or fields are dropped
        expect(ws.normalizeState({ theme: 'neon', hacker: 1 })).not.toHaveProperty('hacker');
        expect(ws.normalizeState({ theme: 'neon' }).theme).toBe('fashion-modern');
    });
});

describe('website service (settings key "website", catalogue read only)', () => {
    let api, settings, service;
    beforeEach(async () => {
        ({ api } = await createShop());
        settings = { store_config: { businessName: 'Boutique Yasmine', businessPhone: '0555 12 34 56' } };
        api.run("INSERT INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify(settings.store_config)]);
        service = createWebsiteService({
            api,
            getSetting: (key) => settings[key] ?? null,
            saveSetting: (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); },
            codedError: catalog.codedError,
        });
    });

    it('create: a name, a theme, a free address; no technical field asked', async () => {
        const before = service.view();
        expect(before.status).toBe('none');
        expect(before.suggestedName).toBe('boutique-yasmine');
        expect(await codeOf(() => service.create({ name: 'x' }))).toBe('WEBSITE_NAME_INVALID');
        const v = service.create({ name: 'Boutique-Yasmine', theme: 'elegant' });
        expect(v).toMatchObject({ created: true, name: 'boutique-yasmine', theme: 'luxury', status: 'accounts', freeUrl: `https://….${ws.FREE_HOST}/boutique-yasmine/` });
        expect(v.providers).toEqual({ github: { available: false }, cloudflare: { available: false } });
        expect(JSON.stringify(v)).not.toMatch(/token|secret|api_key|account_id/i);
        expect(await codeOf(() => service.create({ name: 'other-name' }))).toBe('WEBSITE_EXISTS');
    });

    it('theme, address name, own domain (optional)', async () => {
        expect(await codeOf(() => service.setTheme('classic'))).toBe('WEBSITE_NOT_CREATED');
        service.create({ name: 'boutique-yasmine' });
        expect(service.setTheme('classic').theme).toBe('classic');
        expect(await codeOf(() => service.setTheme('neon'))).toBe('WEBSITE_THEME_UNKNOWN');
        expect(service.setName('yasmine-shop').freeUrl).toContain('/yasmine-shop/');
        expect(await codeOf(() => service.setDomain('not a domain'))).toBe('WEBSITE_DOMAIN_INVALID');
        expect(service.setDomain('https://www.yasmine.dz/').domain).toMatchObject({ name: 'www.yasmine.dz', status: 'pending' });
        // The free address keeps working with or without a domain
        expect(service.view().freeUrl).toContain('/yasmine-shop/');
        expect(service.removeDomain().domain).toMatchObject({ name: '', status: 'none' });
        settings.website.publishedAt = '2026-10-11T00:00:00Z';
        expect(await codeOf(() => service.setName('again-other'))).toBe('WEBSITE_NAME_LOCKED');
    });

    it('update prepares the figures only; accounts not available: nothing published, nothing saved for them', async () => {
        service.create({ name: 'boutique-yasmine' });
        const before = api.all('SELECT * FROM products').length;
        const r = await service.update();
        expect(r.result).toMatchObject({ published: false, reason: 'accounts' });
        expect(r.lastUpdate).toMatchObject({ products: 2, available: 2, published: false });
        expect(api.all('SELECT * FROM products').length).toBe(before);
        // Without the AFUS app ids in this copy: not linked, told why
        const c = await service.connect('cloudflare');
        expect(c.result).toEqual({ started: false, reason: 'not_configured' });
        expect(c.accounts.cloudflare).toMatchObject({ status: 'not_connected', connected: false });
        const g = await service.connect('github');
        expect(g.result).toEqual({ started: false, reason: 'not_configured' });
        expect(g.accounts.github).toMatchObject({ status: 'not_connected', connected: false });
        expect(await codeOf(() => service.connect('dropbox'))).toBe('WEBSITE_PROVIDER_UNKNOWN');
    });

    it('the catalogue snapshot: prices after live promotions, availability per colour/size, no cost or stock count', () => {
        api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, applies_to_ids, auto_apply)
                 VALUES ('p1', '-10% belt', 'percentage', 10, 1, 'product', '["belt"]', 1)`);
        const snap = buildSnapshot(api);
        expect(snap.shop).toMatchObject({ name: 'Boutique Yasmine', phone: '0555 12 34 56' });
        const belt = snap.products.find(p => p.id === 'belt');
        expect(belt).toMatchObject({ price: 800, salePrice: 720, available: true, variants: [] });
        const jean = snap.products.find(p => p.id === 'jean');
        expect(jean.variants.find(v => v.size === '42')).toMatchObject({ color: 'Noir', available: false });
        expect(jean.variants.find(v => v.size === '38')).toMatchObject({ available: true });
        expect(JSON.stringify(snap)).not.toMatch(/"cost"|stock_quantity|"stock"/);
        expect(summarize(snap)).toEqual({ products: 2, available: 2, onSale: 1, withImages: 0, categories: 0 });
    });

    it('accounts registry: GitHub and Cloudflare; the owner alone changes the website', () => {
        expect(providers.providerIds()).toEqual(['github', 'cloudflare']);
        for (const ch of ['website:create', 'website:setTheme', 'website:setName', 'website:setDomain', 'website:removeDomain', 'website:update', 'website:connect']) {
            const rule = ipcGuard.RULES[ch];
            expect(ipcGuard.allows(rule, { id: 'a', role: 'admin' }), ch).toBe(true);
            expect(ipcGuard.allows(rule, { id: 'm', role: 'manager' }), ch).toBe(false);
        }
        expect(ipcGuard.allows(ipcGuard.RULES['db:settings:set'], { id: 'm', role: 'manager' }, { key: 'website' })).toBe(false);
    });
});
