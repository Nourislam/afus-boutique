import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, sell, loadShiftService } from './helpers/shop';

const require = createRequire(import.meta.url);
const returnService = require('../electron/services/returnService');

describe('store credit (avoir) on a return', () => {
    let api, v;
    beforeEach(async () => { ({ api, v } = await createShop()); });

    const giveBack = (id, refund_method) => returnService.createReturn(api, {
        id, sale_id: 's1', return_number: `RET-${id}`, total_refund: 3000, employee_id: 'cash1', refund_method,
        items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 3000, condition: 'sellable' }],
    });

    it('gives a card of the amount instead of money, and the drawer does not pay it out', () => {
        const shifts = loadShiftService(api);
        const shift = shifts.startShift('cash1', 1000);
        api.run("INSERT INTO customers (id, name) VALUES ('c1', 'Karima')");
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }], { customer: 'c1' });
        const saved = giveBack('r1', 'store_credit');
        expect(saved.store_credit.code).toMatch(/^AV[A-Z0-9]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        const card = api.get('SELECT * FROM gift_cards WHERE code = ?', [saved.store_credit.code]);
        expect(card).toMatchObject({ kind: 'store_credit', current_balance: 3000, customer_id: 'c1', return_id: 'r1' });
        const stats = shifts.getShiftStats(shift.id);
        // The return is counted, but no cash went out of the drawer
        expect(stats.total_refunds).toBe(3000);
        expect(stats.total_cash_refunds).toBe(0);
        expect(stats.expected_cash).toBe(1000 + 6000);
        // A refund in money is paid out as before
        giveBack('r2', 'cash');
        expect(shifts.getShiftStats(shift.id).total_cash_refunds).toBe(3000);
    });
});
