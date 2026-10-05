import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { formatMoney as uiMoney } from '../src/i18n/format';

const require = createRequire(import.meta.url);
const ReceiptService = require('../electron/services/receiptService');
const receiptService = new ReceiptService();
const labelService = require('../electron/services/labelService');
const i18n = require('../electron/i18n');
// Amounts use no-break spaces; compare with normal spaces for readability
const sp = (text) => text.replace(/\u00a0/g, ' ');

const SHOP = {
    businessName: 'Boutique Amina',
    businessAddress: 'Rue Larbi Ben M\'hidi',
    businessCity: 'Bab Ezzouar',
    businessWilaya: '16 - Alger',
    businessPhone: '0555 12 34 56',
    businessRc: '16/00-1234567A21',
    businessTaxId: '000116123456789',
    taxName: 'TVA',
    taxType: 'inclusive',
    currency: 'DZD',
};

const SALE = {
    receipt_number: 'R-0042',
    created_at: '2025-06-01 10:30:00',
    employee_name: 'Karim',
    subtotal: 4500,
    tax_amount: 0,
    discount_amount: 500,
    total: 4000,
    items: [
        { product_name: 'T-shirt', color: 'Black', color_code: 'black', size: 'M', sku: 'TSH-BLK-M-001', quantity: 1, unit_price: 1500, total: 1500 },
        { product_name: 'Jean', variant_label: 'Bleu / 40', sku: 'JEA-001', quantity: 1, unit_price: 3000, total: 3000 },
    ],
    payments: [{ method: 'cash', amount: 4000, reference: JSON.stringify({ tendered: 5000 }) }],
};

describe('thermal receipt', () => {
    it('is printed right to left in Arabic with translated colours, amount received and change', () => {
        const html = sp(receiptService.generateThermalReceiptHtml(SALE, { ...SHOP, defaultLanguage: 'ar' }));
        expect(html).toContain('dir="rtl"');
        expect(html).toContain('أسود / M');
        expect(html).toContain('4 000 د.ج');
        expect(html).toContain('المبلغ المستلم');
        expect(html).toContain('5 000 د.ج');
        expect(html).toContain('الباقي');
        expect(html).toContain('1 000 د.ج');
        expect(html).toContain('16 - Alger');
        expect(html).toContain('س.ت: 16/00-1234567A21');
        expect(html).toContain('نقداً');
        expect(html).toContain('شكراً على زيارتكم!');
        // No tax line when the shop sells without TVA
        expect(html).not.toContain('TVA');
    });

    it('is printed in French, keeping stored labels for old lines', () => {
        const html = sp(receiptService.generateThermalReceiptHtml(SALE, { ...SHOP, defaultLanguage: 'fr', receiptFooter: 'Échange sous 7 jours' }));
        expect(html).toContain('dir="ltr"');
        expect(html).toContain('Noir / M');
        expect(html).toContain('Bleu / 40');
        expect(html).toContain('Montant reçu');
        expect(html).toContain('Monnaie rendue');
        expect(html).toContain('Remise');
        expect(html).toContain('Échange sous 7 jours');
        expect(html).toContain('NIF: 000116123456789');
        expect(html).not.toMatch(/\bPOS\b/);
    });

    it('prints the purchase order in the shop language', () => {
        const html = receiptService.generateHtml({ po_number: 'PO-1', items: [], subtotal: 0, total: 0 }, { ...SHOP, type: 'purchase_order', defaultLanguage: 'fr' });
        expect(html).toContain('BON DE COMMANDE');
        expect(html).not.toContain('fonts.googleapis.com');
    });
});

describe('labels', () => {
    const label = { productName: 'T-shirt', variantLabel: 'Noir / M', sku: 'TSH-BLK-M-001', qrValue: 'TSH-BLK-M-001', price: 1500, currency: 'DZD', quantity: 1 };

    it('prints the price in the shop language and an optional Code 128 barcode', () => {
        const plain = sp(labelService.buildLabelsHtml([label], {}, { name: 'Boutique', lang: 'fr' }));
        expect(plain).toContain('1 500 DA');
        expect((plain.match(/<svg/g) || []).length).toBe(1);

        const withBars = sp(labelService.buildLabelsHtml([label], { showBarcode: true }, { name: 'Boutique', lang: 'ar' }));
        expect(withBars).toContain('1 500 د.ج');
        expect(withBars).toContain('dir="rtl"');
        expect((withBars.match(/<svg/g) || []).length).toBe(2);
    });

    it('centres the QR on round stickers instead of putting it beside the text', () => {
        const html = labelService.buildLabelsHtml([label], { template: 'round-40', codeType: 'qr' }, { name: 'Boutique', lang: 'fr' });
        expect(html).toContain('code-label round');
    });

    it('says which codes are too small to be scanned on the label size', () => {
        const check = (template, symbology, dpi = 203) => labelService.inspectLabels([{ ...label, symbology, ...(symbology === 'ean13' ? { qrValue: '2001234567893' } : {}) }], { template }, { name: 'Boutique' }, { dpi })[0];
        expect(check('roll-30x20', 'code39').ok).toBe(false);
        expect(check('roll-50x30', 'code39').ok).toBe(true);
        expect(check('roll-30x20', 'ean13').ok).toBe(true);
        expect(check('round-30', undefined).ok).toBe(true);
        // A finer printer prints thinner bars cleanly
        expect(check('roll-40x30', 'code39', 203).ok).toBe(false);
        expect(check('roll-40x30', 'code39', 600).ok).toBe(true);
        const bars = labelService.inspectLabels([label], { template: 'roll-30x20', showBarcode: true }, {}, { dpi: 203 }).find(e => e.kind === 'bars');
        expect(bars.ok).toBe(false);
        expect(labelService.minModuleMm(false, 203)).toBeCloseTo(0.1876, 3);
    });
});

describe('ticket extras', () => {
    it('prints the small Afus Boutique line unless it is turned off', () => {
        expect(receiptService.generateThermalReceiptHtml(SALE, { ...SHOP })).toContain('class="brand">Afus Boutique<');
        expect(receiptService.generateThermalReceiptHtml(SALE, { ...SHOP, receiptShowBrand: false })).not.toContain('class="brand"');
    });
});

describe('money formatting', () => {
    it('is identical on screen and on printed documents', () => {
        for (const lang of ['ar', 'fr', 'en']) {
            for (const amount of [0, 1500, 2500.5, 1234567]) {
                expect(i18n.formatMoney(amount, lang)).toBe(uiMoney(amount, { lang, currency: 'DZD' }));
            }
        }
    });

    it('keeps amounts in one piece for right-to-left text (no-break spaces)', () => {
        expect(i18n.formatMoney(2500, 'ar')).toBe('2\u00a0500\u00a0د.ج');
        expect(i18n.formatDate('2025-06-01 10:30:00', 'ar')).toMatch(/^\d{2}\/\d{2}\/2025 \d{2}:30$/);
    });

    it('has the three languages for every printed text', () => {
        const incomplete = Object.entries(i18n.MESSAGES).filter(([, v]) => v.length !== 3 || v.some(x => !x)).map(([k]) => k);
        expect(incomplete).toEqual([]);
    });
});

describe('TVA of past sales (Settings › TVA turned off later)', () => {
    const InvoiceService = require('../electron/services/invoiceService');
    const OLD_SALE = { ...SALE, tax_amount: 639, total: 4000 };
    const TVA_OFF = { ...SHOP, taxEnabled: false, taxRate: 0, defaultLanguage: 'fr' };

    it('scenario 1: an old sale saved with TVA keeps its TVA line on every document', () => {
        const ticket = sp(receiptService.generateThermalReceiptHtml(OLD_SALE, TVA_OFF));
        expect(ticket).toMatch(/<span>TVA<\/span><span class="ltr">639 DA<\/span>/);
        const a4 = sp(receiptService.generateHtml(OLD_SALE, { ...TVA_OFF, type: 'invoice' }));
        expect(a4).toContain('<span>TVA</span>');
        expect(a4).toContain('639 DA');
        const credit = InvoiceService.generateInvoiceHtml({ ...OLD_SALE, items: [], amount_due: 4000, amount_paid: 0 }, { store_config: TVA_OFF });
        expect(credit).toContain('<span>TVA</span>');
        // The stored amount is shown as saved, with a neutral name (the type and name were not saved)
        expect(ticket).not.toContain('incl');
    });

    it('scenario 2: a sale made after TVA was turned off has no TVA and no TVA line', () => {
        const NEW_SALE = { ...SALE, tax_amount: 0 };
        expect(receiptService.generateThermalReceiptHtml(NEW_SALE, TVA_OFF)).not.toContain('TVA');
        expect(receiptService.generateHtml(NEW_SALE, { ...TVA_OFF, type: 'invoice' })).not.toContain('<span>TVA</span>');
        expect(InvoiceService.generateInvoiceHtml({ ...NEW_SALE, items: [], amount_due: 4000, amount_paid: 0 }, { store_config: TVA_OFF })).not.toContain('<span>TVA</span>');
    });
});
