// Real pictures in every theme: the shop's own home picture, else its newest
// article photo, else a built-in photo (never an empty grey box).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { buildPublicData } = require('../electron/website/publicData');
const { buildSite } = require('../electron/website/publish/siteBuilder');
const { renderPage } = require('../electron/website/storefront/render');
const { registry } = require('../electron/website/themes/registry');
const { categoryPhoto, heroPhoto, readPhoto, PHOTO_FILES } = require('../electron/website/storefront/photos');

const NOW = Date.parse('2026-10-11T12:00:00Z');
const heroImg = (html) => html.match(/<section class="hero[^"]*">\s*<div class="hero-media"><img src="([^"]+)"/)?.[1] || null;

async function shop({ withPhotos = false } = {}) {
    const { api } = await createShop();
    api.run("INSERT INTO categories (id, name) VALUES ('c-f', 'Femmes'), ('c-k', 'أطفال')");
    api.run("UPDATE products SET category_id = 'c-f' WHERE id = 'jean'");
    api.run("UPDATE products SET category_id = 'c-k' WHERE id = 'belt'");
    if (withPhotos) api.run("UPDATE products SET image_path = 'jean.jpg' WHERE id = 'jean'");
    return api;
}

describe('website pictures', () => {
    it('every built-in photo is there, light (WebP), with its licence noted', () => {
        const fs = require('fs');
        const credits = fs.readFileSync(require.resolve('../electron/website/storefront/photos/CREDITS.md'), 'utf8');
        for (const file of PHOTO_FILES) {
            const data = readPhoto(file);
            expect(data, file).toBeTruthy();
            expect(data.slice(8, 12).toString(), file).toBe('WEBP');
            expect(data.length, file).toBeLessThan(160 * 1024);
            expect(credits, file).toContain(file);
        }
        expect(readPhoto('../photos.js')).toBeNull();
    });

    it('a category photo follows its name in the three languages', () => {
        expect(categoryPhoto('Femmes')).toMatch(/^women/);
        expect(categoryPhoto('ملابس رجالية')).toMatch(/^men|^shirts/);
        expect(categoryPhoto('أطفال')).toMatch(/^kids/);
        expect(categoryPhoto('Chaussures')).toBe('shoes.webp');
        expect(categoryPhoto('حقائب')).toBe('bags.webp');
        expect(PHOTO_FILES).toContain(categoryPhoto('xyz', 3));
        expect(PHOTO_FILES).toContain(heroPhoto('classic'));
    });

    it('a shop without any picture: every theme shows a real photo on its home, category tiles included', async () => {
        const api = await shop();
        const data = buildPublicData(api, { now: NOW });
        for (const theme of registry.list()) {
            const html = renderPage({ snapshot: data, theme, page: 'home', lang: 'ar', assetUrl: (n) => `images/${n}` });
            expect(heroImg(html), theme.id).toMatch(/^photos\/hero-[a-z]+\.webp$/);
            const cats = html.match(/class="cat cat-(tiles|circles)"/);
            if (cats) expect(html, theme.id).toMatch(/<span class="cat-media"><img src="photos\/(women|kids)/);
        }
        const site = buildSite({ snapshot: data, theme: registry.get('classic'), readImage: () => null });
        const published = site.files.filter(f => f.path.startsWith('photos/')).map(f => f.path);
        expect(published.length).toBeGreaterThan(0);
        for (const p of published) expect(Buffer.isBuffer(site.files.find(f => f.path === p).content)).toBe(true);
        // Every photo a page shows is published, and nothing else
        const shown = new Set(site.files.filter(f => f.path.endsWith('.html')).flatMap(f => [...f.content.matchAll(/src="(photos\/[^"]+)"/g)].map(m => m[1])));
        expect([...shown].sort()).toEqual(published.sort());
    });

    it('the shop\'s own home picture and texts replace the built-in ones; article photos fill the tiles', async () => {
        const api = await shop({ withPhotos: true });
        const info = { hero: { image: 'vitrine.jpg', title: 'Nouvelle collection', subtitle: 'Livraison 58 wilayas' } };
        const data = buildPublicData(api, { now: NOW, info });
        expect(data.shop.hero).toEqual({ image: 'vitrine.jpg', title: 'Nouvelle collection', subtitle: 'Livraison 58 wilayas' });
        const site = buildSite({ snapshot: data, theme: registry.get('fashion-modern'), readImage: (n) => (n === 'vitrine.jpg' || n === 'jean.jpg' ? Buffer.from([0xff, 0xd8, 0xff]) : null) });
        const home = site.files.find(f => f.path === 'index.html').content;
        expect(heroImg(home)).toBe('images/vitrine.jpg');
        expect(home).toContain('Nouvelle collection');
        expect(home).toContain('Livraison 58 wilayas');
        expect(site.files.some(f => f.path === 'images/vitrine.jpg')).toBe(true);
        expect(home).not.toMatch(/src="photos\/hero-/);
    });

    it('a home picture that is missing or not a picture is left out (the next one is used)', async () => {
        const api = await shop({ withPhotos: true });
        expect(buildPublicData(api, { now: NOW, info: { hero: { image: '../secret.db' } } }).shop.hero.image).toBe('');
        const data = buildPublicData(api, { now: NOW, info: { hero: { image: 'gone.jpg' } } });
        const site = buildSite({ snapshot: data, theme: registry.get('classic'), readImage: (n) => (n === 'jean.jpg' ? Buffer.from([0xff, 0xd8]) : null) });
        expect(heroImg(site.files.find(f => f.path === 'index.html').content)).toBe('images/jean.jpg');
    });

    it('in the program\'s preview the built-in photos are drawn inside the page (no outside address)', async () => {
        const api = await shop();
        const data = buildPublicData(api, { now: NOW, preview: true });
        const { photoDataUrl } = require('../electron/website/storefront/photos');
        const html = renderPage({ snapshot: data, theme: registry.get('minimal'), page: 'home', preview: true, assetUrl: (p) => `app://${p}`, photoUrl: photoDataUrl });
        expect(heroImg(html)).toMatch(/^data:image\/webp;base64,/);
    });
});
