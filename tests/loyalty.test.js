import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, sell } from './helpers/shop';

const require = createRequire(import.meta.url);
const returnService = require('../electron/services/returnService');
const loyalty = require('../electron/services/loyaltyService');

describe('loyalty points: earned, taken back on a return, turned into a voucher', () => {
    let api, v;
    beforeEach(async () => {
        ({ api, v } = await createShop());
        api.run("INSERT INTO customers (id, name, loyalty_points, total_spent) VALUES ('c1', 'Karima', 0, 0)");
    });
    const points = () => api.get("SELECT loyalty_points AS n FROM customers WHERE id = 'c1'").n;
    // As db:sales:create does: the points of what earned them
    const earn = (id, base) => {
        api.run('UPDATE sales SET loyalty_base = ? WHERE id = ?', [base, id]);
        api.run("UPDATE customers SET loyalty_points = loyalty_points + ?, total_spent = total_spent + ? WHERE id = 'c1'", [loyalty.pointsOf(base), base]);
    };
    const giveBack = (id, saleId, lineId, quantity, extra = {}) => returnService.createReturn(api, {
        id, sale_id: saleId, return_number: `RET-${id}`, total_refund: 999999, employee_id: 'cash1',
        items: [{ sale_item_id: lineId, quantity, refund_amount: 999999, condition: 'sellable' }], ...extra,
    });

    it('1 point per 100 DA', () => {
        expect(loyalty.pointsOf(6050)).toBe(60);
        expect(loyalty.pointsOf(99)).toBe(0);
        expect(loyalty.pointsOf(-5)).toBe(0);
    });

    it('buying then returning everything leaves no point (no double counting)', () => {
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }], { customer: 'c1' });
        earn('s1', 6000);
        expect(points()).toBe(60);
        giveBack('r1', 's1', 's1-0', 1);
        expect(points()).toBe(30);
        giveBack('r2', 's1', 's1-0', 1);
        expect(points()).toBe(0);
        expect(api.get("SELECT total_spent AS n FROM customers WHERE id = 'c1'").n).toBe(0);
    });

    it('rounding over several returns never takes more than was earned', () => {
        // 3 belts at 850 = 2 550 -> 25 points; each one back is 8.5 points
        sell(api, 's1', [{ product: 'belt', qty: 3, price: 850, name: 'Ceinture', cost: 300 }], { customer: 'c1' });
        earn('s1', 2550);
        api.run("UPDATE customers SET loyalty_points = 100 WHERE id = 'c1'");
        giveBack('r1', 's1', 's1-0', 1);
        giveBack('r2', 's1', 's1-0', 1);
        giveBack('r3', 's1', 's1-0', 1);
        expect(points()).toBe(100 - 25);
    });

    it('the part paid with a points voucher earned nothing, and its return takes back nothing more', () => {
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 1, price: 3000 }], { customer: 'c1' });
        earn('s1', 2000); // 1 000 paid with a loyalty voucher
        expect(points()).toBe(20);
        giveBack('r1', 's1', 's1-0', 1);
        expect(points()).toBe(0);
    });

    it('a sale saved before loyalty_base existed: its whole total counts', () => {
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 1, price: 3000 }], { customer: 'c1' });
        api.run("UPDATE customers SET loyalty_points = 30 WHERE id = 'c1'");
        giveBack('r1', 's1', 's1-0', 1);
        expect(points()).toBe(0);
    });

    it('turning points into a voucher: refused while the owner has not set a value', () => {
        api.run("UPDATE customers SET loyalty_points = 50 WHERE id = 'c1'");
        expect(() => loyalty.redeem(api, { customerId: 'c1', points: 50 }, returnService.createStoreCredit)).toThrow(/LOYALTY_OFF/);
        expect(points()).toBe(50);
    });

    it('turning points into a voucher: a card of points x value, the points used up, never more than he has', () => {
        api.run("INSERT INTO settings (key, value) VALUES ('loyalty', ?)", [JSON.stringify({ pointValue: 2 })]);
        api.run("UPDATE customers SET loyalty_points = 50 WHERE id = 'c1'");
        expect(() => loyalty.redeem(api, { customerId: 'c1', points: 51 }, returnService.createStoreCredit)).toThrow(/LOYALTY_NOT_ENOUGH/);
        expect(() => loyalty.redeem(api, { customerId: 'c1', points: 0 }, returnService.createStoreCredit)).toThrow(/LOYALTY_NOT_ENOUGH/);
        const card = loyalty.redeem(api, { customerId: 'c1', points: 50 }, returnService.createStoreCredit);
        expect(card).toMatchObject({ amount: 100, points: 50, left: 0 });
        expect(api.get('SELECT kind, current_balance, customer_id FROM gift_cards WHERE id = ?', [card.id])).toMatchObject({ kind: 'loyalty', current_balance: 100, customer_id: 'c1' });
        expect(points()).toBe(0);
        expect(() => loyalty.redeem(api, { customerId: 'c1', points: 1 }, returnService.createStoreCredit)).toThrow(/LOYALTY_NOT_ENOUGH/);
    });
});
