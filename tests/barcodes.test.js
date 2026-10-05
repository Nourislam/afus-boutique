import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { normalizeCode, gs1CheckDigit } from '../src/lib/barcodes';

const require = createRequire(import.meta.url);
const labelService = require('../electron/services/labelService');

describe('free barcode checks', () => {
    it('adds the check digit and refuses wrong codes', () => {
        expect(gs1CheckDigit('400638133393')).toBe('1');
        expect(normalizeCode('ean13', '400638133393')).toEqual({ code: '4006381333931' });
        expect(normalizeCode('ean13', '4006381333932').error).toBe('labels.err.checkDigit');
        expect(normalizeCode('ean13', '12345').error).toBe('labels.err.length');
        expect(normalizeCode('ean8', '9638507')).toEqual({ code: '96385074' });
        expect(normalizeCode('upca', '03600029145')).toEqual({ code: '036000291452' });
        expect(normalizeCode('code39', 'hn-12')).toEqual({ code: 'HN-12' });
        expect(normalizeCode('code128', 'é').error).toBe('labels.err.ascii');
        expect(normalizeCode('qrcode', '').error).toBe('labels.err.empty');
    });

    it('renders every symbology on every label shape', () => {
        const codes = {
            ean13: '4006381333931', ean8: '96385074', upca: '036000291452', itf14: '29000000000013'.slice(0, 13),
            code128: 'HN00000001', code39: 'HN00000002', qrcode: 'HN00000003', datamatrix: 'HN00000004',
        };
        codes.itf14 += gs1CheckDigit(codes.itf14);
        for (const template of ['roll-40x30', 'round-30', 'sheet-a4-3x8']) {
            for (const [symbology, code] of Object.entries(codes)) {
                const html = labelService.buildLabelsHtml(
                    [{ symbology, qrValue: code, sku: code, productName: 'Soldes', price: 1500, quantity: 2 }],
                    { template, showPrice: true }, { name: 'Boutique', lang: 'ar' });
                expect(html).toContain('<svg');
                expect(html).toContain('code-label');
            }
        }
        expect(labelService.resolveLayout({ template: 'round-30' }).shape).toBe('round');
        expect(labelService.resolveLayout({ template: 'roll-40x30', shape: 'round' }).shape).toBe('rect');
        expect(labelService.resolveLayout({ template: 'roll-40x30', shape: 'rounded' }).shape).toBe('rounded');
    });
});

describe('label settings are honoured', () => {
    const label = (symbology) => ({
        symbology, qrValue: symbology ? '2001234567893' : 'TSH-BLK-M-001', sku: 'TSH-BLK-M-001',
        productName: 'T-shirt', variantLabel: 'Noir / M', price: 2500, quantity: 1,
    });
    const shop = { name: 'Boutique Amina', logo: 'data:image/png;base64,iVBORw0KGgo=', lang: 'fr' };
    const all = { showShopName: true, showLogo: true, showProductName: true, showVariant: true, showSku: true, showPrice: true };

    for (const symbology of [undefined, 'ean13']) {
        it(`shows and hides each part (${symbology || 'QR'} label)`, () => {
            const html = (patch) => labelService.buildLabelsHtml([label(symbology)], { template: 'roll-40x30', ...all, ...patch }, shop);
            const full = html({});
            expect(full).toContain('Boutique Amina');
            expect(full).toContain('<img class="logo"');
            // Written once in the style sheet, not in each label
            expect(full.split('data:image/png').length - 1).toBe(1);
            expect(full).toContain('T-shirt');
            expect(full).toContain('Noir / M');
            expect(full).toMatch(/2\u00a0500/);
            expect(html({ showShopName: false })).not.toContain('Boutique Amina');
            expect(html({ showLogo: false })).not.toContain('<img class="logo"');
            expect(html({ showLogo: false })).not.toContain('data:image/png');
            expect(html({ showProductName: false })).not.toContain('class="name');
            expect(html({ showVariant: false })).not.toContain('Noir / M');
            expect(html({ showPrice: false })).not.toMatch(/2\u00a0500/);
            // Code in text: the SKU under a QR, the digits under a barcode
            expect(html({ showSku: false }).length).toBeLessThan(full.length);
        });
    }
});
