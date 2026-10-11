// Returns on kridi sales: the debt goes down first, nothing is counted twice,
// a refused or failed return changes nothing, old databases are read and
// settled safely. Test databases in memory only.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, sell, loadShiftService, addInitColumns } from './helpers/shop';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const returnService = require('../electron/services/returnService');
const catalog = require('../electron/services/catalogService');
const audit = require('../electron/services/creditReturnsAudit');
const accounting = require('../electron/services/accountingService');
const salesStats = require('../electron/services/salesStatsService');
const { applyMigrations } = require('../electron/database/migrations');

const RANGE = { startDate: '2000-01-01 00:00:00', endDate: '2100-01-01 00:00:00' };
const code = (fn) => { try { fn(); } catch (e) { return String(e.message).split('|')[0]; } return null; };

/** A kridi ticket: sale, kridi payment (and cash part), invoice, customer balance. */
function sellOnKridi(api, id, lines, { customer = 'c1', cashNow = 0 } = {}) {
    const sale = sell(api, id, lines, { customer, method: 'credit' });
    const owed = sale.total - cashNow;
    if (cashNow > 0) {
        api.run('UPDATE payments SET amount = ? WHERE sale_id = ?', [owed, id]);
        api.run("INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, 'cash', ?)", [`pc-${id}`, id, cashNow]);
    }
    api.run(`INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, amount_paid, status, due_date)
             VALUES (?, ?, ?, ?, ?, 0, 'pending', '2026-12-31')`, [`cs-${id}`, id, customer, `INV-${id}`, owed]);
    api.run('UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?', [owed, customer]);
    return sale;
}
const repay = (api, saleId, amount, customer = 'c1') => {
    api.run("INSERT INTO credit_payments (id, credit_sale_id, amount, payment_method, received_by) VALUES (?, ?, ?, 'cash', 'cash1')", [`cp-${saleId}-${amount}`, `cs-${saleId}`, amount]);
    api.run("UPDATE credit_sales SET amount_paid = amount_paid + ?, status = 'partial' WHERE id = ?", [amount, `cs-${saleId}`]);
    api.run('UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?', [amount, customer]);
};
const giveBack = (api, id, saleId, items, extra = {}) => returnService.createReturn(api, {
    id, sale_id: saleId, return_number: `RET-${id}`, total_refund: 999999, employee_id: 'cash1',
    items: items.map(([line, quantity, condition = 'sellable']) => ({ sale_item_id: line, quantity, refund_amount: 999999, condition })), ...extra,
});

describe('returns on kridi sales', () => {
    let api, v, shifts, shift;
    beforeEach(async () => {
        ({ api, v } = await createShop());
        api.run("INSERT INTO customers (id, name, credit_enabled, credit_limit, credit_balance) VALUES ('c1', 'Karima', 1, 50000, 0)");
        shifts = loadShiftService(api);
        shift = shifts.startShift('cash1', 1000);
    });
    const balance = () => api.get("SELECT credit_balance AS n FROM customers WHERE id = 'c1'").n;
    const invoice = (id = 's1') => api.get('SELECT amount_due, amount_paid, status FROM credit_sales WHERE id = ?', [`cs-${id}`]);
    const openInvoices = () => api.get("SELECT COALESCE(SUM(MAX(amount_due - amount_paid, 0)), 0) AS n FROM credit_sales WHERE customer_id = 'c1'").n;
    const stock = (sku) => api.get('SELECT stock_quantity AS n FROM product_variants WHERE id = ?', [v[sku]]).n;

    it('1. debt still owed after the return: lowered by the piece, nothing given back', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]);
        const saved = giveBack(api, 'r1', 's1', [['s1-0', 1]]);
        expect(saved).toMatchObject({ total_refund: 3000, credit_reduced: 3000, hand_back: 0 });
        expect(balance()).toBe(3000);
        expect(invoice()).toMatchObject({ amount_due: 3000, status: 'pending' });
        expect(shifts.getShiftStats(shift.id).total_cash_refunds).toBe(0);
    });

    it('2. the return clears the whole remaining debt', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]);
        repay(api, 's1', 2000);
        // 4 000 still owed; 2 pieces back = 6 000: 4 000 off the debt, the 2 000 paid come back
        const saved = giveBack(api, 'r1', 's1', [['s1-0', 2]]);
        expect(saved).toMatchObject({ credit_reduced: 4000, hand_back: 2000 });
        expect(balance()).toBe(0);
        expect(invoice()).toMatchObject({ amount_due: 2000, amount_paid: 2000, status: 'paid' });
        expect(shifts.getShiftStats(shift.id).total_cash_refunds).toBe(2000);
    });

    it('3. return worth more than the debt left: only what was paid comes back, never more', () => {
        // 3 000 cash at the till + 3 000 on kridi, then 1 000 repaid: 4 000 paid in all
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }], { cashNow: 3000 });
        repay(api, 's1', 1000);
        const saved = giveBack(api, 'r1', 's1', [['s1-0', 2]]);
        expect(saved).toMatchObject({ total_refund: 6000, credit_reduced: 2000, hand_back: 4000 });
        expect(balance()).toBe(0);
        // Nothing left to give back on this ticket
        expect(code(() => giveBack(api, 'r2', 's1', [['s1-0', 1]]))).toBe('RETURN_TOO_MANY');
        // With an avoir: the card is the part paid, not the part owed
        sellOnKridi(api, 's2', [{ product: 'jean', variant: v['J-N-40'], qty: 1, price: 3000 }]);
        repay(api, 's2', 1000);
        const avoir = giveBack(api, 'r3', 's2', [['s2-0', 1]], { refund_method: 'store_credit' });
        expect(avoir).toMatchObject({ credit_reduced: 2000, hand_back: 1000 });
        expect(avoir.store_credit.amount).toBe(1000);
    });

    it('4. part of a ticket with several articles', () => {
        sellOnKridi(api, 's1', [
            { product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 },
            { product: 'belt', qty: 2, price: 800, name: 'Ceinture', cost: 300 },
        ]);
        expect(balance()).toBe(7600);
        const before = { jean: stock('J-N-38'), belt: api.get("SELECT stock_quantity AS n FROM products WHERE id = 'belt'").n };
        const saved = giveBack(api, 'r1', 's1', [['s1-0', 1], ['s1-1', 1, 'damaged']]);
        expect(saved).toMatchObject({ total_refund: 3800, credit_reduced: 3800, hand_back: 0 });
        expect(balance()).toBe(3800);
        expect(api.all("SELECT quantity, refund_amount, condition FROM return_items WHERE return_id = 'r1' ORDER BY refund_amount DESC"))
            .toEqual([{ quantity: 1, refund_amount: 3000, condition: 'sellable' }, { quantity: 1, refund_amount: 800, condition: 'damaged' }]);
        // Sellable back in stock, damaged not
        expect(stock('J-N-38')).toBe(before.jean + 1);
        expect(api.get("SELECT stock_quantity AS n FROM products WHERE id = 'belt'").n).toBe(before.belt);
        expect(api.get("SELECT status FROM sales WHERE id = 's1'").status).toBe('partially_refunded');
    });

    it('5. a return already saved is not counted again (same id or number sent twice)', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }]);
        giveBack(api, 'r1', 's1', [['s1-0', 1]]);
        const after = { balance: balance(), invoice: invoice(), stock: stock('J-N-38') };
        expect(code(() => giveBack(api, 'r1', 's1', [['s1-0', 1]]))).toBe('RETURN_ALREADY_SAVED');
        expect(code(() => giveBack(api, 'other-id', 's1', [['s1-0', 1]], { return_number: 'RET-r1' }))).toBe('RETURN_ALREADY_SAVED');
        expect({ balance: balance(), invoice: invoice(), stock: stock('J-N-38') }).toEqual(after);
        expect(api.get("SELECT COUNT(*) AS n FROM returns WHERE sale_id = 's1'").n).toBe(1);
    });

    it('6. a refused or failed return changes nothing (debt, stock, return, drawer)', () => {
        sellOnKridi(api, 's1', [
            { product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 },
            { product: 'belt', qty: 1, price: 800, name: 'Ceinture', cost: 300 },
        ]);
        sell(api, 'other', [{ product: 'jean', variant: v['J-N-40'], qty: 1, price: 3000 }]);
        const snapshot = () => ({ balance: balance(), invoice: invoice(), stock: stock('J-N-38'), returns: api.get('SELECT COUNT(*) AS n FROM returns').n,
            items: api.get('SELECT COUNT(*) AS n FROM return_items').n, cash: shifts.getShiftStats(shift.id).expected_cash });
        const before = snapshot();
        // Refused before anything is written, even with no transaction around the call
        expect(code(() => giveBack(api, 'r1', 's1', [['s1-0', 1], ['s1-1', 2]]))).toBe('RETURN_TOO_MANY');
        expect(code(() => giveBack(api, 'r2', 's1', [['s1-0', 2], ['s1-0', 1]]))).toBe('RETURN_TOO_MANY');
        expect(code(() => giveBack(api, 'r3', 's1', [['other-0', 1]]))).toBe('RETURN_LINE_UNKNOWN');
        for (const q of [0, -1, 1.5]) expect(code(() => giveBack(api, `rq${q}`, 's1', [['s1-0', q]]))).toBe('RETURN_QUANTITY');
        expect(code(() => giveBack(api, 'r4', 's1', []))).toBe('RETURN_NO_LINE');
        expect(snapshot()).toEqual(before);
        // A failure half way (after the debt was lowered and the return written): all undone
        const adjust = catalog.adjustStock;
        catalog.adjustStock = () => { throw new Error('disk full'); };
        try {
            expect(() => api.transaction(() => giveBack(api, 'r5', 's1', [['s1-0', 1]]))).toThrow('disk full');
        } finally {
            catalog.adjustStock = adjust;
        }
        expect(snapshot()).toEqual(before);
        // And the same return goes through afterwards
        expect(api.transaction(() => giveBack(api, 'r5', 's1', [['s1-0', 1]])).credit_reduced).toBe(3000);
    });

    it('7. customer balance, invoices, returns, drawer, avoirs and reports agree', () => {
        sellOnKridi(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }], { cashNow: 2000 });
        sellOnKridi(api, 's2', [{ product: 'jean', variant: v['J-N-40'], qty: 1, price: 3000 }]);
        sell(api, 's3', [{ product: 'belt', qty: 1, price: 800, name: 'Ceinture', cost: 300 }]);
        repay(api, 's2', 3000);
        giveBack(api, 'r1', 's1', [['s1-0', 1]]); // 3 000 off a 4 000 debt
        giveBack(api, 'r2', 's1', [['s1-0', 1]], { refund_method: 'store_credit' }); // 1 000 off, 2 000 avoir
        giveBack(api, 'r3', 's2', [['s2-0', 1]]); // paid in full: 3 000 cash back
        giveBack(api, 'r4', 's3', [['s3-0', 1]]); // cash sale: 800 cash back
        expect(balance()).toBe(openInvoices());
        expect(balance()).toBe(0);
        const rows = api.all('SELECT id, total_refund, credit_reduced, refund_method FROM returns ORDER BY id');
        expect(rows).toEqual([
            { id: 'r1', total_refund: 3000, credit_reduced: 3000, refund_method: null },
            { id: 'r2', total_refund: 3000, credit_reduced: 1000, refund_method: 'store_credit' },
            { id: 'r3', total_refund: 3000, credit_reduced: 0, refund_method: null },
            { id: 'r4', total_refund: 800, credit_reduced: 0, refund_method: null },
        ]);
        expect(api.all("SELECT initial_balance AS amount FROM gift_cards WHERE kind = 'store_credit'")).toEqual([{ amount: 2000 }]);
        const stats = shifts.getShiftStats(shift.id);
        // Cash in: 2 000 (s1) + 800 (s3) + 3 000 repaid; out: 3 000 + 800
        expect(stats.total_cash_refunds).toBe(3800);
        expect(stats.expected_cash).toBe(1000 + 2000 + 800 + 3000 - 3800);
        const journal = accounting.salesJournal(api, RANGE);
        const backs = journal.rows.filter(r => r.type === 'return');
        expect(backs.reduce((t, r) => t + r.credit, 0)).toBe(-4000);
        expect(backs.reduce((t, r) => t + r.cash, 0)).toBe(-3800);
        expect(backs.reduce((t, r) => t + r.gift_card, 0)).toBe(-2000);
        expect(journal.totals.amount_ttc).toBe(salesStats.salesStats(api, RANGE).net_revenue);
        // Nothing for the reconciliation report to settle
        expect(audit.auditLegacyCreditReturns(api, { shiftStats: (id) => shifts.getShiftStats(id) }).legacy).toBe(0);
    });
});

describe('an old database (returns saved before credit_reduced)', () => {
    // The shop as the old version left it: schema of the time, a closed
    // drawer, kridi tickets and returns that did not touch the debt
    async function oldShop() {
        const db = await createLegacyDb();
        const api = createApi(db);
        addInitColumns(api);
        api.run("INSERT INTO employees (id, name, pin, role) VALUES ('cash1', 'Amina', '1111', 'cashier')");
        api.run("INSERT INTO products (id, name, sku, price, cost, stock_quantity) VALUES ('belt', 'Ceinture', 'BELT', 1000, 300, 5)");
        api.run("INSERT INTO customers (id, name, credit_enabled, credit_limit, credit_balance) VALUES ('c1', 'Karima', 1, 50000, 0), ('c2', 'Nadia', 1, 50000, 0)");
        const ticket = (id, customer, day, total) => {
            api.run(`INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, total, status, created_at) VALUES (?, ?, 'cash1', ?, ?, ?, 'completed', ?)`,
                [id, `R-${id}`, customer, total, total, `${day} 10:00:00`]);
            api.run('INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, total) VALUES (?, ?, \'belt\', \'Ceinture\', ?, 1000, ?)', [`${id}-0`, id, total / 1000, total]);
            api.run("INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, 'credit', ?)", [`p-${id}`, id, total]);
            api.run(`INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, amount_paid, status, due_date, created_at)
                     VALUES (?, ?, ?, ?, ?, 0, 'pending', '2026-03-01', ?)`, [`cs-${id}`, id, customer, `INV-${id}`, total, `${day} 10:00:00`]);
            api.run('UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?', [total, customer]);
        };
        // Day 1: drawer closed exactly as expected (no money handed out) -> provable
        api.run("INSERT INTO shifts (id, employee_id, start_time, end_time, opening_cash, closing_cash) VALUES ('d1', 'cash1', '2026-01-10 08:00:00', '2026-01-10 20:00:00', 500, 500)");
        ticket('s1', 'c1', '2026-01-10', 3000);
        api.run("INSERT INTO returns (id, sale_id, return_number, total_refund, employee_id, created_at) VALUES ('old1', 's1', 'RET-OLD1', 1000, 'cash1', '2026-01-10 12:00:00')");
        api.run("INSERT INTO return_items (id, return_id, sale_item_id, product_id, quantity, refund_amount, condition) VALUES ('old1-i', 'old1', 's1-0', 'belt', 1, 1000, 'sellable')");
        // Day 2: drawer never closed -> cannot be told, must stay as it is
        api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('d2', 'cash1', '2026-01-11 08:00:00', 500)");
        ticket('s2', 'c2', '2026-01-11', 2000);
        api.run("INSERT INTO returns (id, sale_id, return_number, total_refund, employee_id, created_at) VALUES ('old2', 's2', 'RET-OLD2', 1000, 'cash1', '2026-01-11 12:00:00')");
        api.run("INSERT INTO return_items (id, return_id, sale_item_id, product_id, quantity, refund_amount, condition) VALUES ('old2-i', 'old2', 's2-0', 'belt', 1, 1000, 'sellable')");
        return { db, api };
    }

    it('8. the update adds the columns, keeps the old returns readable, settles only what is proven, once', async () => {
        const { db, api } = await oldShop();
        expect(api.all('PRAGMA table_info(returns)').some(c => c.name === 'credit_reduced')).toBe(false);
        applyMigrations(db);
        expect(api.all('PRAGMA table_info(returns)').some(c => c.name === 'credit_reduced')).toBe(true);
        // The old returns are kept as they were: empty credit_reduced, debts untouched
        expect(api.all('SELECT id, credit_reduced FROM returns ORDER BY id')).toEqual([{ id: 'old1', credit_reduced: null }, { id: 'old2', credit_reduced: null }]);
        const shifts = loadShiftService(api);
        const stats = (id) => shifts.getShiftStats(id);
        const drawerBefore = stats('d1');
        // The old rule still reads them: no cash out for a kridi return
        expect(drawerBefore.total_cash_refunds).toBe(0);
        expect(drawerBefore.cash_difference).toBe(0);
        const owed = (c) => api.get('SELECT credit_balance AS n FROM customers WHERE id = ?', [c]).n;

        const report = audit.auditLegacyCreditReturns(api, { shiftStats: stats });
        const byId = Object.fromEntries(report.cases.map(c => [c.return_id, c]));
        expect(byId.old1).toMatchObject({ status: 'DEBT_NOT_LOWERED', impact: 1000 });
        expect(byId.old2).toMatchObject({ status: 'MANUAL_REVIEW_REQUIRED' });

        const first = api.transaction(() => audit.settleProvenLegacyReturns(api, { shiftStats: stats }));
        expect(first.settled).toEqual([expect.objectContaining({ return_id: 'old1', amount: 1000 })]);
        expect(first.left.map(c => c.return_id)).toEqual(['old2']);
        expect(owed('c1')).toBe(2000);
        expect(api.get("SELECT amount_due FROM credit_sales WHERE id = 'cs-s1'").amount_due).toBe(2000);
        // The one that cannot be told is left exactly as it was
        expect(owed('c2')).toBe(2000);
        expect(api.get("SELECT credit_reduced FROM returns WHERE id = 'old2'").credit_reduced).toBe(null);
        // The closed drawer of that day does not move
        expect(stats('d1')).toMatchObject({ expected_cash: drawerBefore.expected_cash, cash_difference: 0, total_cash_refunds: 0 });
        // A second run changes nothing
        const second = audit.settleProvenLegacyReturns(api, { shiftStats: stats });
        expect(second.settled).toEqual([]);
        expect(owed('c1')).toBe(2000);
        expect(audit.auditLegacyCreditReturns(api, { shiftStats: stats }).cases.find(c => c.return_id === 'old1').status).toBe('ALREADY_SETTLED');

        // A new return on the same old ticket counts the old one: never more pieces, never more money
        api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('d3', 'cash1', datetime('now', '-1 hour'), 0)");
        const saved = returnService.createReturn(api, { id: 'new1', sale_id: 's1', return_number: 'RET-NEW1', total_refund: 999999, employee_id: 'cash1',
            items: [{ sale_item_id: 's1-0', quantity: 2, refund_amount: 999999, condition: 'sellable' }] });
        expect(saved).toMatchObject({ total_refund: 2000, credit_reduced: 2000, hand_back: 0 });
        expect(owed('c1')).toBe(0);
        expect(code(() => returnService.createReturn(api, { id: 'new2', sale_id: 's1', return_number: 'RET-NEW2', total_refund: 1, employee_id: 'cash1',
            items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 1, condition: 'sellable' }] }))).toBe('RETURN_TOO_MANY');
    });
});
