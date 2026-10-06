import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const guard = require('../electron/services/guard');
const pins = require('../electron/services/pinService');

const code = (fn) => { try { fn(); } catch (e) { return e.message.split('|')[0]; } return null; };
const CASHIER = { id: 'cash1', role: 'cashier' };
const MANAGER = { id: 'boss', role: 'manager' };
const ADMIN = { id: 'owner', role: 'admin' };

/** A ticket as the sales screen sends it. lines: [[sku/product, price paid, qty]] */
function ticket(v, lines, { manual = 0, promotion = null, promoAmount = 0, coupon = null, total = null } = {}) {
    const items = lines.map(([key, price, qty = 1], i) => ({
        id: `i${i}`, product_id: key === 'belt' ? 'belt' : 'jean', variant_id: key === 'belt' ? null : v[key],
        quantity: qty, unit_price: price, discount: 0, total: price * qty,
    }));
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const discount = manual + promoAmount;
    return {
        id: 'sale', items, subtotal, discount_amount: discount, manual_discount: manual,
        promotion_id: promotion, coupon, total: total ?? subtotal - discount, tax_amount: 0, service_charge: 0,
    };
}

describe('discount and return rights, checked by the main process', () => {
    let api, v;
    beforeEach(async () => {
        ({ api, v } = await createShop());
        // PINs hashed as on a real installation
        for (const [id, pin] of [['cash1', '1111'], ['boss', '9999'], ['owner', '0000']]) api.run('UPDATE employees SET pin = ? WHERE id = ?', [pins.hashPin(pin), id]);
    });
    const setRules = (rules) => api.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('security', ?)", [JSON.stringify(rules)]);

    it('defaults: cashier without discount, returns need a manager', () => {
        expect(guard.readRules(api)).toEqual({ cashierMaxDiscount: 0, cashierReturns: false });
        setRules({ cashierMaxDiscount: 250, cashierReturns: 'yes' });
        expect(guard.readRules(api)).toEqual({ cashierMaxDiscount: 100, cashierReturns: false });
    });

    it('a sale at the normal price is fine for everybody; nobody logged in is refused', () => {
        expect(guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 3000], ['belt', 800, 2]])).approvedBy).toBeNull();
        expect(code(() => guard.checkSale(api, null, ticket(v, [['J-N-38', 3000]])))).toBe('LOGIN_REQUIRED');
    });

    it('within the limit the cashier sells; above it a manager PIN is needed', () => {
        setRules({ cashierMaxDiscount: 10 });
        // 10% off the line: allowed
        expect(guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 2700]])).discount).toEqual({ amount: 300, base: 3000, percent: 10 });
        // 500 DA typed on the ticket = 16.67%: refused without a manager
        const sale = ticket(v, [['J-N-38', 3000]], { manual: 500 });
        expect(code(() => guard.checkSale(api, CASHIER, sale))).toBe('DISCOUNT_NEEDS_MANAGER');
        expect(code(() => guard.checkSale(api, CASHIER, sale, { employeeId: 'boss', pin: '1234' }))).toBe('DISCOUNT_NEEDS_MANAGER');
        expect(code(() => guard.checkSale(api, CASHIER, sale, { employeeId: 'cash1', pin: '1111' }))).toBe('DISCOUNT_NEEDS_MANAGER');
        expect(guard.checkSale(api, CASHIER, sale, { employeeId: 'boss', pin: '9999' }).approvedBy).toMatchObject({ id: 'boss' });
        // Managers and the owner have no limit
        expect(guard.checkSale(api, MANAGER, sale).approvedBy).toBeNull();
        expect(guard.checkSale(api, ADMIN, ticket(v, [['J-N-38', 1000]])).approvedBy).toBeNull();
    });

    it('with the default limit (0) any hand discount needs a manager, a promotion does not', () => {
        expect(code(() => guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 2900]])))).toBe('DISCOUNT_NEEDS_MANAGER');
        api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, auto_apply) VALUES ('soldes', 'Soldes', 'percentage', 20, 1, 'all', 1)`);
        expect(guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 3000]], { promotion: 'soldes', promoAmount: 600 })).approvedBy).toBeNull();
        // A coupon promotion counts only with its code typed
        api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, auto_apply, coupon_code) VALUES ('vip', 'VIP', 'fixed', 1000, 1, 'all', 0, 'VIP10')`);
        expect(guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 3000]], { promotion: 'vip', promoAmount: 1000, coupon: 'vip10' })).approvedBy).toBeNull();
        expect(code(() => guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 3000]], { promotion: 'vip', promoAmount: 1000 })))).toBe('SALE_TOTAL_MISMATCH');
    });

    it('cannot be bypassed by sending a different ticket directly', () => {
        // Total lowered without showing a discount
        expect(code(() => guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 3000]], { total: 100 })))).toBe('SALE_TOTAL_MISMATCH');
        // A discount hidden as a promotion that does not exist or has ended
        expect(code(() => guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 3000]], { promotion: 'none', promoAmount: 900 })))).toBe('SALE_TOTAL_MISMATCH');
        api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, auto_apply, end_date) VALUES ('old', 'Old', 'percentage', 50, 1, 'all', 1, '2001-01-01')`);
        expect(code(() => guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 3000]], { promotion: 'old', promoAmount: 1500 })))).toBe('SALE_TOTAL_MISMATCH');
        // A promotion claimed bigger than it is
        api.run(`INSERT INTO promotions (id, name, type, value, is_active, applies_to, auto_apply) VALUES ('p10', 'P10', 'percentage', 10, 1, 'all', 1)`);
        expect(code(() => guard.checkSale(api, CASHIER, ticket(v, [['J-N-38', 3000]], { promotion: 'p10', promoAmount: 1000 })))).toBe('SALE_TOTAL_MISMATCH');
        // A line whose total does not match its price
        const sale = ticket(v, [['J-N-38', 3000]]);
        sale.items[0].total = 10; sale.subtotal = 10; sale.total = 10;
        expect(code(() => guard.checkSale(api, CASHIER, sale))).toBe('SALE_TOTAL_MISMATCH');
    });

    it('returns and exchanges: manager yes, cashier with a manager PIN or when the owner allows it', () => {
        expect(code(() => guard.checkReturn(api, CASHIER))).toBe('RETURN_NEEDS_MANAGER');
        expect(code(() => guard.checkReturn(api, CASHIER, { employeeId: 'boss', pin: '0000' }))).toBe('RETURN_NEEDS_MANAGER');
        expect(guard.checkReturn(api, CASHIER, { employeeId: 'owner', pin: '0000' })).toMatchObject({ id: 'owner' });
        expect(guard.checkReturn(api, MANAGER)).toBeNull();
        expect(code(() => guard.checkReturn(api, null))).toBe('LOGIN_REQUIRED');
        setRules({ cashierReturns: true });
        expect(guard.checkReturn(api, CASHIER)).toBeNull();
    });
});
