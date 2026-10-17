// The 1541 communes of the 58 wilayas: shipped with the program, published with
// the website for the order forms' list, written into the shop's Worker.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const COMMUNES = require('../electron/shared/communes.json');
const { buildSite } = require('../electron/website/publish/siteBuilder');
const { registry } = require('../electron/website/themes/registry');
const { toPublic } = require('../electron/website/publicData/public');

describe('communes', () => {
    it('58 wilayas, 1541 communes, each with its Latin and Arabic name', () => {
        expect(Object.keys(COMMUNES).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 58 }, (_, i) => i + 1));
        const all = Object.values(COMMUNES).flat();
        expect(all.length).toBe(1541);
        for (const [latin, arabic] of all) {
            expect(latin).toMatch(/^[A-Za-z][A-Za-z' .()-]*$/);
            expect(arabic).toMatch(/[؀-ۿ]/);
        }
        expect(COMMUNES['16'].some(([l, a]) => l === 'Kouba' && a === 'القبة')).toBe(true);
    });

    it('published with the website (assets/communes.json) and written into the Worker sent to Cloudflare', () => {
        const snap = toPublic({ store: { businessName: 'S' }, products: [], variants: [], categories: [], promotions: [] }, { now: Date.now() });
        const site = buildSite({ snapshot: snap, theme: registry.get('classic') });
        const file = site.files.find(f => f.path === 'assets/communes.json');
        expect(JSON.parse(file.content)).toEqual(COMMUNES);
        const fs = require('fs');
        const path = require('path');
        const raw = fs.readFileSync(path.join(__dirname, '../electron/website/worker/worker.mjs'), 'utf8');
        expect(raw).toContain('/*@COMMUNES@*/{}');
        const src = fs.readFileSync(path.join(__dirname, '../electron/website/websiteService.js'), 'utf8');
        expect(src).toMatch(/replace\('\/\*@COMMUNES@\*\/\{\}'/);
    });
});
