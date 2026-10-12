import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MESSAGES } from '../src/i18n/messages';
import { translate } from '../src/i18n';
import { formatMoney, formatNumber } from '../src/i18n/format';

function sourceFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
    }
    return out;
}

describe('translations', () => {
    it('every message has English, French and Arabic text', () => {
        const incomplete = Object.entries(MESSAGES)
            .filter(([, v]) => !Array.isArray(v) || v.length !== 3 || v.some(s => typeof s !== 'string' || !s.trim()))
            .map(([k]) => k);
        expect(incomplete).toEqual([]);
    });

    it('placeholders are the same in the three languages', () => {
        const mismatched = Object.entries(MESSAGES).filter(([, v]) => {
            const names = v.map(s => (s.match(/\{\w+(?=[:}])/g) || []).sort().join(','));
            return names[0] !== names[1] || names[0] !== names[2];
        }).map(([k]) => k);
        expect(mismatched).toEqual([]);
    });

    it('every t("...") key used in the source code exists', () => {
        const root = path.resolve(__dirname, '../src');
        const missing = new Set();
        for (const file of sourceFiles(root)) {
            const code = fs.readFileSync(file, 'utf8');
            for (const m of code.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g)) {
                if (!MESSAGES[m[1]]) missing.add(`${m[1]} (${path.relative(root, file)})`);
            }
        }
        expect([...missing]).toEqual([]);
    });

    it('never hides the translator behind a local variable named t', () => {
        const root = path.resolve(__dirname, '../src');
        const offenders = sourceFiles(root)
            .filter(file => !file.includes(`${path.sep}i18n${path.sep}`))
            .filter(file => {
                const code = fs.readFileSync(file, 'utf8');
                return /\bt\('/.test(code) && /(\(t\)\s*=>|[^\w.]t\s*=>|\(t,\s*\w+\)\s*=>|\b(const|let|var)\s+t\s*=)/.test(code);
            })
            .map(file => path.relative(root, file));
        expect(offenders).toEqual([]);
    });

    it('translates with interpolation and falls back to the key', () => {
        expect(translate('fr', 'common.deleteConfirm', { name: 'Jean' })).toBe('Supprimer « Jean » ?');
        expect(translate('ar', 'nav.sales')).toBe('البيع');
        expect(translate('en', 'no.such.key')).toBe('no.such.key');
    });

    it('never shows the word POS in the interface', () => {
        const offenders = Object.entries(MESSAGES).filter(([, v]) => v.some(s => /\bPOS\b/.test(s))).map(([k]) => k);
        expect(offenders).toEqual([]);
    });
});

describe('Algerian formatting', () => {
    it('formats dinars without decimals for whole amounts', () => {
        const sp = (text) => text.replace(/\u00a0/g, ' ');
        expect(sp(formatMoney(2500, { lang: 'fr', currency: 'DZD' }))).toBe('2 500 DA');
        expect(sp(formatMoney(2500, { lang: 'ar', currency: 'DZD' }))).toBe('2 500 د.ج');
        expect(sp(formatMoney(1999.5, { lang: 'en', currency: 'DZD' }))).toBe('1 999,50 DA');
        // No-break spaces, so the bidi algorithm does not split the number in Arabic
        expect(formatMoney(2500, { lang: 'ar', currency: 'DZD' })).toBe('2\u00a0500\u00a0د.ج');
    });

    it('uses Western digits', () => {
        expect(formatNumber(1234567)).toBe('1\u00a0234\u00a0567');
    });
});

describe('message modules', () => {
    it('define every key only once', () => {
        const dir = path.resolve(__dirname, '../src/i18n/messages');
        const seen = new Map();
        const duplicates = [];
        for (const file of fs.readdirSync(dir).filter(f => f !== 'index.js')) {
            for (const m of fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/^\s*'([^']+)': \[/gm)) {
                if (seen.has(m[1])) duplicates.push(`${m[1]} (${seen.get(m[1])}, ${file})`);
                else seen.set(m[1], file);
            }
        }
        expect(duplicates).toEqual([]);
    });

    it('translates the stock reasons and payment methods', async () => {
        const { useLanguageStore } = await import('../src/i18n');
        const { stockReasonLabel } = await import('../src/lib/stockReasons');
        const { paymentLabel, quickCashAmounts, cashTendered } = await import('../src/lib/payments');
        const { translateError } = await import('../src/i18n/errors');
        useLanguageStore.setState({ lang: 'fr' });
        expect(stockReasonLabel('Sale #R-12')).toBe('Vente n° R-12');
        expect(stockReasonLabel('Received shipment')).toBe('Réception de marchandise');
        expect(stockReasonLabel('damaged')).toBe('Abîmé');
        expect(stockReasonLabel('Custom text')).toBe('Custom text');
        expect(paymentLabel('transfer')).toBe('Virement (BaridiMob / CCP)');
        expect(translateError('EXCEL_MISSING|{"field":"price"}')).toBe('Valeur manquante : Prix de vente');
        useLanguageStore.setState({ lang: 'ar' });
        expect(paymentLabel('cash')).toBe('نقداً');
        expect(quickCashAmounts(2350)).toEqual([2400, 2500, 3000]);
        expect(cashTendered({ method: 'cash', reference: '{"tendered":5000}' })).toBe(5000);
        expect(cashTendered({ method: 'card', reference: null })).toBeNull();
    });
});
