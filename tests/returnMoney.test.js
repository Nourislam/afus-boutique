import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, sell, loadShiftService } from './helpers/shop';

const require = createRequire(import.meta.url);
const returnService = require('../electron/services/returnService');
const exchangeService = require('../electron/services/exchangeService');

/** A kridi ticket: the sale, its credit payment and the customer's invoice. */
function sellOnKridi(api, id, lines, { customer = 'c1', paidNow = 0 } = {}) {
    const sale = sell(api, id, lines, { customer, method: 'credit' });
    const owed = sale.total - paidNow;
    if (paidNow > 0) {
        api.run("UPDATE payments SET amount = ? WHERE sale_id = ?", [owed, id]);
        api.run("INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, 'cash', ?)", [`pc-${id}`, id, paidNow]);
    }
    api.run(`INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, amount_paid, status, due_date)
             VALUES (?, ?, ?, ?, ?, 0, 'pending', '2026-12-31')`, [`cs-${id}`, id, customer, `INV-${id}`, owed]);
    api.run('UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?', [owed, customer]);
    return sale;
}

const giveBack = (api, id, saleId, lineId, quantity, extra = {}) => returnService.createReturn(api, {
    id, sale_id: saleId, return_number: `RET-${id}`, total_refund: 999999, employee_id: 'cash1',
    items: [{ sale_item_id: lineId, quantity, refund_amount: 999999, condition: 'sellable' }], ...extra,
});

describe('a return on a kridi sale lowers the debt first', () => {
    let api, v, shifts, shift;
    beforeEach(async () => {
        ({ api, v } = await createShop());
        api.run("INSERT INTO customers (id, name, credit_enabled, credit_limit, credit_balance) VALUES ('c1', 'Karima', 1, 20000, 0)");
        shifts = loadShiftService(api);
        shift = shifts.startShift('cash1', 1000);
    });
    const owed = () => api.get("SELECT credit_balance AS n FROM customers WHERE id = 'c1'").n;

    it('a full return of an unpaid kridi ticket clears the debt, no cash out', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]);
        expect(owed()).toBe(6000);
        const saved = giveBack(api, 'r1', 's1', 's1-0', 2);
        expect(saved).toMatchObject({ total_refund: 6000, credit_reduced: 6000, hand_back: 0 });
        expect(owed()).toBe(0);
        expect(api.get("SELECT amount_due, status FROM credit_sales WHERE id = 'cs-s1'")).toMatchObject({ amount_due: 0, status: 'paid' });
        expect(api.get("SELECT status FROM sales WHERE id = 's1'").status).toBe('refunded');
        const stats = shifts.getShiftStats(shift.id);
        expect(stats.total_cash_refunds).toBe(0);
        expect(stats.expected_cash).toBe(1000);
    });

    it('a part return lowers the debt by the pieces brought back', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]);
        giveBack(api, 'r1', 's1', 's1-0', 1);
        expect(owed()).toBe(3000);
        expect(api.get("SELECT amount_due, status FROM credit_sales WHERE id = 'cs-s1'")).toMatchObject({ amount_due: 3000, status: 'pending' });
        expect(api.get("SELECT status FROM sales WHERE id = 's1'").status).toBe('partially_refunded');
    });

    it('debt already partly repaid: only what is left is taken off, the rest is given back in cash', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]);
        // 5 000 of the 6 000 repaid in cash at the till
        api.run("UPDATE credit_sales SET amount_paid = 5000, status = 'partial' WHERE id = 'cs-s1'");
        api.run("UPDATE customers SET credit_balance = 1000 WHERE id = 'c1'");
        api.run("INSERT INTO credit_payments (id, credit_sale_id, amount, payment_method, received_by) VALUES ('cp1', 'cs-s1', 5000, 'cash', 'cash1')");
        const saved = giveBack(api, 'r1', 's1', 's1-0', 1);
        expect(saved).toMatchObject({ total_refund: 3000, credit_reduced: 1000, hand_back: 2000 });
        expect(owed()).toBe(0);
        expect(api.get("SELECT amount_due, amount_paid, status FROM credit_sales WHERE id = 'cs-s1'")).toMatchObject({ amount_due: 5000, amount_paid: 5000, status: 'paid' });
        const stats = shifts.getShiftStats(shift.id);
        expect(stats.total_cash_refunds).toBe(2000);
        // 1 000 opening + 5 000 repaid - 2 000 given back
        expect(stats.expected_cash).toBe(4000);
    });

    it('with an avoir, the card is only the part not owed (never a card on top of a debt)', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]);
        const saved = giveBack(api, 'r1', 's1', 's1-0', 1, { refund_method: 'store_credit' });
        expect(saved.credit_reduced).toBe(3000);
        expect(saved.store_credit).toBeUndefined();
        expect(api.get("SELECT COUNT(*) AS n FROM gift_cards WHERE kind = 'store_credit'").n).toBe(0);
        api.run("UPDATE credit_sales SET amount_paid = 3000, status = 'paid' WHERE id = 'cs-s1'");
        api.run("UPDATE customers SET credit_balance = 0 WHERE id = 'c1'");
        const second = giveBack(api, 'r2', 's1', 's1-0', 1, { refund_method: 'store_credit' });
        expect(second).toMatchObject({ credit_reduced: 0, hand_back: 3000 });
        expect(second.store_credit.amount).toBe(3000);
    });

    it('half paid in cash, half on kridi: the debt goes first, then cash', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }], { paidNow: 3000 });
        expect(owed()).toBe(3000);
        const saved = giveBack(api, 'r1', 's1', 's1-0', 2);
        expect(saved).toMatchObject({ total_refund: 6000, credit_reduced: 3000, hand_back: 3000 });
        expect(owed()).toBe(0);
        expect(shifts.getShiftStats(shift.id).total_cash_refunds).toBe(3000);
    });

    it('an exchange on a kridi sale is refused (the debt stays as it is)', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 1, price: 3000 }]);
        expect(() => exchangeService.createExchange(api, { sale_id: 's1', sale_item_id: 's1-0', quantity: 1, new_variant_id: v['J-B-40'], condition: 'sellable', payment_method: 'cash', employee_id: 'cash1' }))
            .toThrow(/EXCHANGE_CREDIT_SALE/);
        expect(owed()).toBe(3000);
        expect(api.get("SELECT COUNT(*) AS n FROM returns WHERE sale_id = 's1'").n).toBe(0);
    });

    it('a return saved before this rule (credit_reduced empty) is read as before', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 1, price: 3000 }]);
        api.run("INSERT INTO returns (id, sale_id, return_number, total_refund, employee_id) VALUES ('old', 's1', 'RET-OLD', 3000, 'cash1')");
        expect(shifts.getShiftStats(shift.id).total_cash_refunds).toBe(0);
    });
});

describe('never more money back than was paid', () => {
    let api, v, shifts, shift;
    beforeEach(async () => {
        ({ api, v } = await createShop());
        shifts = loadShiftService(api);
        shift = shifts.startShift('cash1', 10000);
    });

    it('a ticket discount is taken off the refund', () => {
        // 2 jeans at 3 000, 20 % off the ticket: 4 800 paid
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }], { discount: 1200 });
        const saved = giveBack(api, 'r1', 's1', 's1-0', 1);
        expect(saved.total_refund).toBe(2400);
        expect(saved.items[0].refund_amount).toBe(2400);
        giveBack(api, 'r2', 's1', 's1-0', 1);
        expect(api.get("SELECT SUM(total_refund) AS n FROM returns WHERE sale_id = 's1'").n).toBe(4800);
        expect(api.get("SELECT status FROM sales WHERE id = 's1'").status).toBe('refunded');
        expect(shifts.getShiftStats(shift.id).expected_cash).toBe(10000);
    });

    it('a line discount is taken off the refund', () => {
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 1, price: 3000 }]);
        api.run("UPDATE sale_items SET discount = 500, total = 2500 WHERE id = 's1-0'");
        api.run("UPDATE sales SET subtotal = 2500, total = 2500 WHERE id = 's1'");
        expect(giveBack(api, 'r1', 's1', 's1-0', 1).total_refund).toBe(2500);
    });

    it('a smaller amount chosen by the shop is kept', () => {
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 1, price: 3000 }]);
        const saved = returnService.createReturn(api, {
            id: 'r1', sale_id: 's1', return_number: 'RET-r1', total_refund: 2000, employee_id: 'cash1',
            items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 2000, condition: 'damaged' }],
        });
        expect(saved.total_refund).toBe(2000);
    });
});
