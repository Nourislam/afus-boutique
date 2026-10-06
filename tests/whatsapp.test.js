import { describe, it, expect, beforeEach } from 'vitest';
import { useLanguageStore } from '../src/i18n';
import { whatsappNumber, reminderMessage, whatsappLink } from '../src/lib/whatsapp';

describe('credit reminder on WhatsApp', () => {
    beforeEach(() => useLanguageStore.setState({ lang: 'ar' }));

    it('turns the phone numbers typed in shops into WhatsApp numbers', () => {
        expect(whatsappNumber('0555 12 34 56')).toBe('213555123456');
        expect(whatsappNumber('06.61.22.33.44')).toBe('213661223344');
        expect(whatsappNumber('+213 770 11 22 33')).toBe('213770112233');
        expect(whatsappNumber('00213770112233')).toBe('213770112233');
        expect(whatsappNumber('+33 6 12 34 56 78')).toBe('33612345678');
        expect(whatsappNumber('')).toBeNull();
        expect(whatsappNumber('12')).toBeNull();
        expect(whatsappNumber(null)).toBeNull();
    });

    it('writes the message with the name, the amount owed, the shop and the due date', () => {
        const ar = reminderMessage({ customerName: 'أمين', amount: 4500, shopName: 'Boutique Afus', dueDate: '2026-11-01' });
        expect(ar).toContain('أمين');
        expect(ar).toContain('Boutique Afus');
        expect(ar).toMatch(/4[\s\u00a0\u202f.,]?500/);
        expect(ar).toContain('01/11/2026');
        useLanguageStore.setState({ lang: 'fr' });
        const fr = reminderMessage({ customerName: 'Amine', amount: 1200, shopName: 'Afus' });
        expect(fr).toMatch(/^Bonjour Amine, petit rappel de Afus : il reste 1[\s\u00a0\u202f]?200.*à régler\. Merci\.$/);
        expect(fr).not.toContain('échéance');
    });

    it('builds a wa.me link with the message, or nothing without a valid number', () => {
        const link = whatsappLink('0555123456', 'Bonjour & merci');
        expect(link).toBe('https://wa.me/213555123456?text=Bonjour%20%26%20merci');
        expect(whatsappLink('', 'x')).toBeNull();
    });
});
