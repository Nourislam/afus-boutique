import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
// receiptService loads electron (BrowserWindow) only to print: a stand-in is enough for the HTML
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { BrowserWindow: vi.fn() } };
const ReceiptService = require(path.resolve(__dirname, '../electron/services/receiptService.js'));

const service = new ReceiptService();
const SHOP = {
    businessName: 'Boutique Afus', businessAddress: '12 rue Didouche', businessCity: 'Alger', businessPhone: '0555 00 11 22',
    businessTaxId: '001216099999999', businessNis: '', businessRc: '16/00-1234567B21', defaultLanguage: 'fr', currency: 'DZD',
};
const SALE = {
    id: 's1', receipt_number: '202610050007', created_at: '2026-10-05 10:00:00',
    customer_name: 'Amine B.', customer_phone: '0661 22 33 44', customer_address: 'Oran',
    subtotal: 6000, discount_amount: 600, tax_amount: 862.18, total: 5400, service_charge: 0,
    items: [{ product_name: 'Jean', color: 'Noir', size: '40', sku: 'J-N-40', quantity: 2, unit_price: 3000, total: 6000 }],
    payments: [{ method: 'cash', amount: 5400 }],
};

describe('A4 invoice of a sale', () => {
    it('has the shop, its legal numbers, the customer, number, date, lines and totals with the TVA saved', () => {
        const html = service.generateHtml(SALE, { ...SHOP, type: 'invoice' });
        for (const text of ['FACTURE', 'Boutique Afus', '12 rue Didouche, Alger', '0555 00 11 22', '001216099999999', '16/00-1234567B21',
            'FACTURÉ À', 'Amine B.', 'Oran', '0661 22 33 44', '202610050007', '05/10/2026', 'Jean', 'J-N-40', 'Total HT', 'TOTAL TTC', 'Espèces']) {
            expect(html, text).toContain(text);
        }
        // An empty legal number is not printed, nothing is invented
        expect(html).not.toMatch(/NIS\s*:/);
        // HT = total - TVA saved with the sale
        expect(html).toMatch(/4[\s\u00a0\u202f]?537,82/);
        expect(html).toMatch(/862,18/);
    });

    it('a sale without TVA and without customer: no TVA line, no customer box', () => {
        const html = service.generateHtml({ ...SALE, tax_amount: 0, customer_name: null }, { ...SHOP, type: 'invoice', defaultLanguage: 'ar' });
        expect(html).toContain('فاتورة');
        expect(html).toContain('dir="rtl"');
        expect(html).not.toContain('فاتورة باسم');
        expect(html).not.toContain('المجموع دون رسوم');
    });

    it('in Arabic, phone and legal numbers keep their order (not reversed right to left)', () => {
        const html = service.generateHtml(SALE, { ...SHOP, type: 'invoice', defaultLanguage: 'ar' });
        expect(html).toContain('<bdi dir="ltr">0555 00 11 22</bdi>');
        expect(html).toContain('<bdi dir="ltr">16/00-1234567B21</bdi>');
        expect(html).toContain('<bdi dir="ltr">0661 22 33 44</bdi>');
        const ticket = service.generateHtml(SALE, { ...SHOP, defaultLanguage: 'ar' });
        expect(ticket).toContain('<bdi dir="ltr">001216099999999</bdi>');
    });
});
