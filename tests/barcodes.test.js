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
