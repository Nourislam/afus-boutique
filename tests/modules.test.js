import { describe, it, expect } from 'vitest';
import { resolveFeatures, effectiveFeatures, offersEnabled, DEFAULT_FEATURES } from '../src/lib/features';
import { offerTabs } from '../src/lib/modules';

describe('modules', () => {
    it('keeps the saved choices and drops removed modules', () => {
        const f = resolveFeatures({ ai: true, quotations: true, giftCards: true });
        expect(f.ai).toBeUndefined();
        expect(f.quotations).toBeUndefined();
        expect(f.giftCards).toBe(true);
        expect(f.credit).toBe(DEFAULT_FEATURES.credit);
    });
    it('hides purchase orders when suppliers are hidden', () => {
        expect(effectiveFeatures({ suppliers: false, purchaseOrders: true }).purchaseOrders).toBe(false);
        expect(effectiveFeatures({ suppliers: true, purchaseOrders: true }).purchaseOrders).toBe(true);
    });
    it('has no Offers screen when promotions, packs and gift cards are all hidden', () => {
        const none = effectiveFeatures({ promotions: false, bundles: false, giftCards: false });
        expect(offersEnabled(none)).toBe(false);
        expect(offerTabs(none)).toEqual([]);
        expect(offerTabs(effectiveFeatures({ promotions: false, bundles: false, giftCards: true }))).toEqual(['giftCards']);
    });
    it('shows a tab only with the module on and the permission', () => {
        const all = effectiveFeatures({ giftCards: true });
        expect(offerTabs(all, (p) => p === 'gift_cards.view')).toEqual(['giftCards']);
    });
});
