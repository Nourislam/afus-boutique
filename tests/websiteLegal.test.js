// Every website: Afus Boutique in the footer, and the same four legal pages
// (returns, terms, privacy, delivery) with only the shop's name and contact.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { legalPage, LEGAL_PAGES } = require('../electron/website/storefront/legal');
const { renderPage, pagesOf } = require('../electron/website/storefront/render');
const { registry } = require('../electron/website/themes/registry');
const { toPublic } = require('../electron/website/publicData/public');

const snapshotOf = (store) => toPublic({ store, products: [], variants: [], categories: [], promotions: [] }, { now: Date.parse('2026-10-11T12:00:00Z') });

describe('legal pages and the footer', () => {
    it('the same words for every shop: only the name and the contact change; e-mail first, else the phone', () => {
        const a = legalPage('returns', 'ar', { name: 'بوتيك ياسمين', email: 'contact@yasmine.dz', phone: '0555123456' });
        const b = legalPage('returns', 'ar', { name: 'Mode Nour', email: '', phone: '0661 22 33 44' });
        const text = (p) => JSON.stringify(p);
        expect(text(a)).toContain('بوتيك ياسمين');
        expect(text(a)).toContain('contact@yasmine.dz');
        expect(text(a)).not.toContain('0555123456');
        expect(text(b)).toContain('0661 22 33 44');
        expect(text(a).replaceAll('بوتيك ياسمين', 'X').replaceAll('contact@yasmine.dz', 'Y')).toBe(text(b).replaceAll('Mode Nour', 'X').replaceAll('0661 22 33 44', 'Y'));
        for (const id of LEGAL_PAGES) for (const lang of ['ar', 'fr', 'en']) {
            const page = legalPage(id, lang, { name: 'S', phone: '1' });
            expect(page.sections.length, `${id} ${lang}`).toBeGreaterThan(2);
            expect(JSON.stringify(page)).not.toMatch(/\{shop\}|\{contact\}/);
        }
        expect(legalPage('../x', 'ar', {})).toBeNull();
    });

    it('published with the website, linked from every footer of every theme, with the Afus Boutique mark', () => {
        const snap = snapshotOf({ businessName: 'Boutique Yasmine', businessPhone: '0555 12 34 56' });
        const paths = pagesOf(snap).map(p => p.path);
        for (const id of LEGAL_PAGES) expect(paths).toContain(`${id}.html`);
        for (const theme of registry.list()) {
            for (const lang of ['ar', 'fr']) {
                const html = renderPage({ snapshot: snap, theme, page: 'home', lang });
                const footer = html.slice(html.indexOf('<footer'));
                for (const id of LEGAL_PAGES) expect(footer, `${theme.id} ${id}`).toContain(`href="${id}.html"`);
                expect(footer).toContain('Afus Boutique');
                expect(footer).toMatch(/class="afus-mark"/);
                expect(footer).toContain('Boutique Yasmine');
            }
        }
        const page = renderPage({ snapshot: snap, theme: registry.get('classic'), page: 'page', id: 'privacy', lang: 'ar' });
        expect(page).toContain('<title>سياسة الخصوصية · Boutique Yasmine</title>');
        expect(page).toContain('0555 12 34 56');
    });
});
