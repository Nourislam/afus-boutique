import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { createRequire } from 'module';
import { createShop, loadShiftService } from './helpers/shop';

const require = createRequire(import.meta.url);
const audit = require('../electron/services/creditReturnsAudit');
const returnService = require('../electron/services/returnService');

const DAY = '2026-01-10';
const at = (time, day = DAY) => `${day} ${time}`;

describe('legacy kridi returns: read-only reconciliation report', () => {
    let db, api, shifts;
    beforeEach(async () => {
        ({ db, api } = await createShop());
        shifts = loadShiftService(api);
        api.run("INSERT INTO customers (id, name, credit_enabled, credit_limit, credit_balance) VALUES ('c1', 'Karima', 1, 50000, 0), ('c2', 'Yacine', 1, 50000, 0)");
    });

    // A kridi ticket as the program saved it: sale, kridi payment, invoice, customer balance
    const sellKridi = (id, total, { customer = 'c1', when = at('10:00:00'), cashNow = 0 } = {}) => {
        const owed = total - cashNow;
        api.run(`INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, tax_amount, discount_amount, total, status, created_at)
                 VALUES (?, ?, 'cash1', ?, ?, 0, 0, ?, 'completed', ?)`, [id, `R-${id}`, customer, total, total, when]);
        api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, quantity, unit_price, total, unit_cost)
                 VALUES (?, ?, 'belt', NULL, 'Ceinture', 2, ?, ?, 300)`, [`${id}-0`, id, total / 2, total]);
        api.run("INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, 'credit', ?)", [`pk-${id}`, id, owed]);
        if (cashNow) api.run("INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, 'cash', ?)", [`pc-${id}`, id, cashNow]);
        api.run(`INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, amount_paid, status, due_date, created_at)
                 VALUES (?, ?, ?, ?, ?, 0, 'pending', '2026-03-01', ?)`, [`cs-${id}`, id, customer, `INV-${id}`, owed, when]);
        api.run('UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?', [owed, customer]);
    };
    // A return as it was saved before credit_reduced existed: the debt untouched
    const legacyReturn = (id, saleId, amount, { when = at('12:00:00'), employee = 'cash1', method = null } = {}) => {
        api.run(`INSERT INTO returns (id, sale_id, return_number, total_refund, employee_id, refund_method, credit_reduced, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`, [id, saleId, `RET-${id}`, amount, employee, method, when]);
        api.run(`INSERT INTO return_items (id, return_id, sale_item_id, product_id, quantity, refund_amount, condition)
                 VALUES (?, ?, ?, 'belt', 1, ?, 'sellable')`, [`${id}-i`, id, `${saleId}-0`, amount]);
    };
    const drawer = (id, { opening = 1000, closing = 1000, start = at('08:00:00'), end = at('20:00:00'), employee = 'cash1' } = {}) => {
        api.run('INSERT INTO shifts (id, employee_id, start_time, end_time, opening_cash, closing_cash) VALUES (?, ?, ?, ?, ?, ?)',
            [id, employee, start, end, opening, closing]);
    };
    const repay = (saleId, amount, when, customer = 'c1') => {
        api.run("INSERT INTO credit_payments (id, credit_sale_id, amount, payment_method, received_by, created_at) VALUES (?, ?, ?, 'cash', 'boss', ?)",
            [`cp-${saleId}-${when}`, `cs-${saleId}`, amount, when]);
        api.run('UPDATE credit_sales SET amount_paid = amount_paid + ?, status = CASE WHEN amount_paid + ? >= amount_due THEN \'paid\' ELSE \'partial\' END WHERE id = ?', [amount, amount, `cs-${saleId}`]);
        api.run('UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?', [amount, customer]);
    };
    const run = () => audit.auditLegacyCreditReturns(api, { shiftStats: (id) => shifts.getShiftStats(id) });
    const only = (report) => report.cases.find(c => c.status !== 'ALREADY_SETTLED') || report.cases[0];

    it('no cash out, no avoir, payments after the return: confirmed, the debt should go down by the piece', () => {
        sellKridi('s1', 6000);
        drawer('d1'); // closed with exactly what it expected: no money handed out
        legacyReturn('r1', 's1', 3000);
        repay('s1', 2000, at('10:00:00', '2026-01-20'));
        const c = only(run());
        expect(c).toMatchObject({ status: 'DEBT_NOT_LOWERED', confirmed: true, credit_original: 6000, credit_paid: 2000, paid_before_return: 0, paid_after_return: 2000,
            refund: 3000, credit_reduced: null, owed_now: 4000, impact: 3000, possible_overpaid: 0 });
    });

    it('the customer repaid everything after the return: the debt cannot go down, he may be owed money -> manual review', () => {
        sellKridi('s1', 6000);
        drawer('d1');
        legacyReturn('r1', 's1', 3000);
        repay('s1', 6000, at('10:00:00', '2026-01-20'));
        const c = only(run());
        expect(c).toMatchObject({ status: 'MANUAL_REVIEW_REQUIRED', confirmed: false, owed_now: 0, impact: 0, possible_overpaid: 3000 });
        expect(c.reason).toMatch(/may be owed money back/);
    });

    it('refunded in cash: the drawer closed short by the amount -> confirmed, the debt stays', () => {
        sellKridi('s1', 6000);
        drawer('d1', { closing: 1000 - 3000 }); // 3 000 short
        legacyReturn('r1', 's1', 3000);
        const c = only(run());
        expect(c).toMatchObject({ status: 'CASH_REFUNDED', confirmed: true, cash_refunded: 3000, impact: 0 });
    });

    it('settled with an avoir: confirmed, lowering the debt too would count it twice', () => {
        sellKridi('s1', 6000);
        drawer('d1');
        legacyReturn('r1', 's1', 3000, { method: 'store_credit' });
        returnService.createStoreCredit(api, { returnId: 'r1', amount: 3000, customerId: 'c1' });
        const c = only(run());
        expect(c).toMatchObject({ status: 'SETTLED_BY_AVOIR', confirmed: true, avoir: 3000, impact: 0 });
    });

    it('already taken off the debt (saved with credit_reduced): confirmed, nothing to do', () => {
        sellKridi('s1', 6000);
        returnService.createReturn(api, { id: 'r1', sale_id: 's1', return_number: 'RET-r1', total_refund: 3000, employee_id: 'cash1',
            items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 3000, condition: 'sellable' }] });
        const report = run();
        expect(report.cases).toHaveLength(1);
        expect(report.cases[0]).toMatchObject({ status: 'ALREADY_SETTLED', credit_reduced: 3000, credit_original: 6000, impact: 0 });
        expect(report.legacy).toBe(0);
    });

    it('records too thin: no drawer, drawer still open, difference not matching, part of two returns -> manual review; all of them -> cash', () => {
        sellKridi('s1', 6000); legacyReturn('r1', 's1', 3000); // no drawer at all
        sellKridi('s2', 4000, { customer: 'c2', when: at('10:00:00', '2026-01-11') });
        drawer('d2', { start: at('08:00:00', '2026-01-11'), end: null, closing: null });
        legacyReturn('r2', 's2', 2000, { when: at('12:00:00', '2026-01-11') });
        sellKridi('s3', 4000, { customer: 'c2', when: at('10:00:00', '2026-01-12') });
        drawer('d3', { start: at('08:00:00', '2026-01-12'), end: at('20:00:00', '2026-01-12'), closing: 1000 - 750 });
        legacyReturn('r3', 's3', 2000, { when: at('12:00:00', '2026-01-12') });
        sellKridi('s4', 4000, { customer: 'c2', when: at('09:00:00', '2026-01-13') });
        sellKridi('s5', 4000, { customer: 'c2', when: at('09:30:00', '2026-01-13') });
        drawer('d4', { start: at('08:00:00', '2026-01-13'), end: at('20:00:00', '2026-01-13'), closing: 1000 - 4000 });
        legacyReturn('r4', 's4', 2000, { when: at('12:00:00', '2026-01-13') });
        legacyReturn('r5', 's5', 2000, { when: at('13:00:00', '2026-01-13') });
        const byId = Object.fromEntries(run().cases.map(c => [c.return_number, c]));
        expect(byId['RET-r1']).toMatchObject({ status: 'MANUAL_REVIEW_REQUIRED', impact: 3000 });
        expect(byId['RET-r1'].reason).toMatch(/No drawer/);
        expect(byId['RET-r2'].reason).toMatch(/not closed/);
        expect(byId['RET-r3'].reason).toMatch(/does not match/);
        // Short by exactly both refunds: both were handed out
        expect(byId['RET-r4']).toMatchObject({ status: 'CASH_REFUNDED', cash_refunded: 2000 });
        expect(byId['RET-r5']).toMatchObject({ status: 'CASH_REFUNDED', cash_refunded: 2000 });
        expect(byId['RET-r4'].reason).toMatch(/exactly all its old kridi returns/);
        // Short by one of the two amounts: one was paid in cash, which one is unknown
        api.run("UPDATE shifts SET closing_cash = ? WHERE id = 'd4'", [1000 - 2000]);
        const again = Object.fromEntries(run().cases.map(c => [c.return_number, c]));
        expect(again['RET-r4'].reason).toMatch(/which ones were paid in cash cannot be told/);
        expect(again['RET-r5'].status).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('signs of a settlement by hand: a note on the invoice, a customer balance that disagrees -> manual review', () => {
        sellKridi('s1', 6000); drawer('d1'); legacyReturn('r1', 's1', 3000);
        api.run("UPDATE credit_sales SET notes = 'réglé au téléphone' WHERE id = 'cs-s1'");
        expect(only(run()).reason).toMatch(/note on the invoice/);
        api.run("UPDATE credit_sales SET notes = NULL WHERE id = 'cs-s1'");
        api.run("UPDATE customers SET credit_balance = 3000 WHERE id = 'c1'");
        const c = only(run());
        expect(c.status).toBe('MANUAL_REVIEW_REQUIRED');
        expect(c.reason).toMatch(/customer balance 3000 differs from the open invoices 6000/);
    });

    it('an expense of the same amount is not proof by itself; named after the return it is', () => {
        sellKridi('s1', 6000); drawer('d1', { closing: 1000 - 3000 }); legacyReturn('r1', 's1', 3000);
        api.run("INSERT INTO cash_expenses (id, shift_id, employee_id, amount, reason, created_at) VALUES ('x1', 'd1', 'cash1', 3000, 'courses', ?)", [at('12:05:00')]);
        expect(only(run()).status).toBe('MANUAL_REVIEW_REQUIRED');
        api.run("UPDATE cash_expenses SET reason = 'remboursement RET-r1' WHERE id = 'x1'");
        expect(only(run())).toMatchObject({ status: 'CASH_REFUNDED', cash_refunded: 3000 });
    });

    it('two returns on one ticket: never more off the debt than was owed', () => {
        sellKridi('s1', 6000); drawer('d1');
        legacyReturn('r1', 's1', 3000, { when: at('11:00:00') });
        // 3 000 repaid in between: the second piece can only take off what is left
        repay('s1', 3000, at('11:30:00'));
        legacyReturn('r2', 's1', 3000, { when: at('12:00:00') });
        const report = run();
        const total = report.cases.reduce((t, c) => t + c.impact, 0);
        expect(total).toBeLessThanOrEqual(3000);
        expect(report.cases.some(c => c.status === 'MANUAL_REVIEW_REQUIRED')).toBe(true);
    });

    it('read only: run twice, the same report, not one byte of the database changed, any write refused', () => {
        sellKridi('s1', 6000); drawer('d1'); legacyReturn('r1', 's1', 3000);
        sellKridi('s2', 4000, { customer: 'c2' }); legacyReturn('r2', 's2', 2000, { employee: 'boss' });
        const hash = () => crypto.createHash('sha256').update(Buffer.from(db.export())).digest('hex');
        const before = hash();
        const readOnly = { all: (s, p) => api.all(s, p), get: (s, p) => api.get(s, p), run: () => { throw new Error('write attempted'); } };
        const first = audit.auditLegacyCreditReturns(readOnly, { shiftStats: (id) => shifts.getShiftStats(id) });
        const second = audit.auditLegacyCreditReturns(readOnly, { shiftStats: (id) => shifts.getShiftStats(id) });
        expect(second).toEqual(first);
        expect(hash()).toBe(before);
        expect(api.get("SELECT credit_balance FROM customers WHERE id = 'c1'").credit_balance).toBe(6000);
        expect(api.get("SELECT amount_due FROM credit_sales WHERE id = 'cs-s1'").amount_due).toBe(6000);
        expect(first).toMatchObject({ checked: 2, legacy: 2 });
        expect(audit.toCsv(first).split('\n')[0]).toBe(audit.CSV_COLUMNS.join(','));
    });
});
