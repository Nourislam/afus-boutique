import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '../src/stores/cartStore';
import { bestPromotion, promotionDiscount, isPromotionLive } from '../src/lib/promotions';

const tee = { id: 'p-tee', name: 'T-shirt', price: 1500, stock_quantity: 10, category_id: 'cat-tee' };
const jean = { id: 'p-jean', name: 'Jean', price: 4000, stock_quantity: 10, category_id: 'cat-jean' };
const black = { id: 'v-blk-m', color: 'Noir', color_code: 'black', size: 'M', sku: 'TSH-BLK-M-001', stock_quantity: 3, price: null };

const cart = () => useCartStore.getState();

describe('cart totals', () => {
    beforeEach(() => {
        useCartStore.setState({ promotions: [], coupon: '', taxType: 'inclusive', globalTaxRate: 0, taxExempt: false, serviceCharge: 0 });
        cart().clearCart();
    });

    it('adds variants as separate lines and scanning again increases the quantity', () => {
        cart().addItem(tee, 1, black);
        cart().addItem(tee, 1, black);
        cart().addItem(jean);
        expect(cart().items).toHaveLength(2);
        expect(cart().items[0]).toMatchObject({ quantity: 2, total: 3000, color_code: 'black', category_id: 'cat-tee' });
        expect(cart().getTotal()).toBe(7000);
        expect(cart().getItemCount()).toBe(3);
    });

    it('refuses more than the stock of the variant', () => {
        expect(cart().addItem(tee, 4, black).success).toBe(false);
        cart().addItem(tee, 3, black);
        expect(cart().addItem(tee, 1, black).success).toBe(false);
    });

    it('keeps a bargained line price when the quantity changes', () => {
        cart().addItem(jean);
        const id = cart().items[0].id;
        cart().setLinePrice(id, 3500);
        cart().updateItemQuantity(id, 2);
        expect(cart().items[0]).toMatchObject({ unit_price: 3500, original_price: 4000, total: 7000 });
        expect(cart().getTotal()).toBe(7000);
    });

    it('applies a ticket discount without ever going below zero', () => {
        cart().addItem(jean);
        cart().setDiscount(10, 'percent');
        expect(cart().getTotal()).toBe(3600);
        cart().setDiscount(99999, 'fixed');
        expect(cart().getTotal()).toBe(0);
    });

    it('computes TVA on the discounted amount', () => {
        useCartStore.setState({ taxType: 'exclusive', globalTaxRate: 19 });
        cart().addItem(jean);
        cart().setDiscount(1000, 'fixed');
        expect(cart().getTaxAmount()).toBe(570);
        expect(cart().getTotal()).toBe(3570);
        useCartStore.setState({ taxType: 'inclusive' });
        expect(cart().getTotal()).toBe(3000);
        expect(cart().getTaxAmount()).toBe(478.99);
    });

    it('applies the best promotion automatically, here only on trousers', () => {
        useCartStore.setState({
            promotions: [
                { id: 'pr1', name: 'Soldes jeans -20%', type: 'percentage', value: 20, applies_to: 'category', applies_to_ids: '["cat-jean"]', is_active: 1, auto_apply: 1 },
                { id: 'pr2', name: '-100 DA', type: 'fixed', value: 100, applies_to: 'all', is_active: 1, auto_apply: 1 },
            ],
        });
        cart().addItem(tee);
        cart().addItem(jean);
        expect(cart().getPromotion()).toMatchObject({ amount: 800, promotion: { id: 'pr1' } });
        expect(cart().getTotal()).toBe(4700);
    });
});

describe('promotions', () => {
    const items = [
        { product_id: 'a', category_id: 'c1', unit_price: 1000, quantity: 1 },
        { product_id: 'b', category_id: 'c1', unit_price: 2000, quantity: 1 },
        { product_id: 'c', category_id: 'c2', unit_price: 3000, quantity: 1 },
    ];

    it('buy one get one: the cheaper piece is free', () => {
        expect(promotionDiscount({ type: 'bogo', applies_to: 'category', applies_to_ids: '["c1"]' }, items)).toBe(1000);
    });

    it('threshold needs the minimum purchase', () => {
        const promo = { type: 'threshold', value: 10, min_purchase: 10000 };
        expect(promotionDiscount(promo, items)).toBe(0);
        expect(promotionDiscount({ ...promo, min_purchase: 5000 }, items)).toBe(600);
    });

    it('respects dates, uses, coupons and the maximum discount', () => {
        const now = new Date('2025-06-15T12:00:00').getTime();
        expect(isPromotionLive({ is_active: 1, start_date: '2025-06-01', end_date: '2025-06-15' }, now)).toBe(true);
        expect(isPromotionLive({ is_active: 1, end_date: '2025-06-14' }, now)).toBe(false);
        expect(isPromotionLive({ is_active: 1, max_uses: 5, current_uses: 5 }, now)).toBe(false);
        const coupon = { id: 'x', type: 'percentage', value: 50, max_discount: 1000, coupon_code: 'AID2025', auto_apply: 0, is_active: 1 };
        expect(bestPromotion([coupon], items, { now })).toBeNull();
        expect(bestPromotion([coupon], items, { coupon: 'aid2025', now })).toMatchObject({ amount: 1000 });
    });
});
