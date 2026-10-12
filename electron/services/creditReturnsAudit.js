/**
 * Returns on kridi sales saved before returns lowered the debt
 * (returns.credit_reduced empty): what each one did to the customer's
 * account, as far as the records can prove it. The report
 * (auditLegacyCreditReturns) only reads. settleProvenLegacyReturns lowers the
 * debt of the proven cases only, and can be run again without effect.
 *
 * For every return on a sale paid (partly) on kridi:
 *   ALREADY_SETTLED          saved with credit_reduced: the debt went down then
 *   SETTLED_BY_AVOIR         an avoir card was given for it (lowering the debt too would count it twice)
 *   EXCHANGE                 part of an exchange: the value paid for the new piece
 *   CASH_REFUNDED            the drawer proves the money was handed out (closing short by
 *                            the amount, or an expense of the amount): the debt stays
 *   DEBT_NOT_LOWERED         no cash went out (drawer closed without difference), no avoir,
 *                            nothing paid beyond the pieces kept, the accounts agree:
 *                            the debt was not lowered and should be by `impact`
 *   MANUAL_REVIEW_REQUIRED   the records do not say how it was settled (reason given)
 *
 * shiftStats(shiftId) -> { cash_difference } is the drawer's own figure (shiftService).
 */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100 + 0;
const TOLERANCE = 1; // DA: rounding of a drawer count
const near = (a, b) => Math.abs(r2(a) - r2(b)) <= TOLERANCE;
// Dates written as "2026-10-11 09:00:00" or "2026-10-11T09:00:00.000Z": compared the same way
const when = (v) => String(v || '').replace('T', ' ').replace(/\.\d+Z?$|Z$/, '').slice(0, 19);

const STATUS = {
    ALREADY_SETTLED: 'ALREADY_SETTLED',
    SETTLED_BY_AVOIR: 'SETTLED_BY_AVOIR',
    EXCHANGE: 'EXCHANGE',
    CASH_REFUNDED: 'CASH_REFUNDED',
    DEBT_NOT_LOWERED: 'DEBT_NOT_LOWERED',
    MANUAL: 'MANUAL_REVIEW_REQUIRED',
};
const CONFIRMED = new Set([STATUS.ALREADY_SETTLED, STATUS.SETTLED_BY_AVOIR, STATUS.EXCHANGE, STATUS.CASH_REFUNDED, STATUS.DEBT_NOT_LOWERED]);

const hasTable = (api, name) => !!api.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
const hasColumn = (api, table, column) => api.all(`PRAGMA table_info(${table})`).some(c => c.name === column);

/** The drawer the return was made in: the employee's shift around that time. */
function shiftOf(api, employeeId, at) {
    if (!employeeId) return null;
    return api.get(`SELECT * FROM shifts WHERE employee_id = ? AND datetime(start_time) <= datetime(?)
                    AND (end_time IS NULL OR datetime(end_time) >= datetime(?)) ORDER BY start_time DESC LIMIT 1`, [employeeId, at, at]) || null;
}

function auditLegacyCreditReturns(api, { shiftStats = null } = {}) {
    const hasCreditReduced = hasColumn(api, 'returns', 'credit_reduced');
    const hasRefundMethod = hasColumn(api, 'returns', 'refund_method');
    const cardsByReturn = hasColumn(api, 'gift_cards', 'return_id');
    const exchanges = hasTable(api, 'exchanges');
    const expenses = hasTable(api, 'cash_expenses');

    // Every return on a sale with a kridi payment or a kridi invoice
    const rows = api.all(`
        SELECT r.id, r.sale_id, r.return_number, r.total_refund, r.employee_id, r.created_at,
               ${hasCreditReduced ? 'r.credit_reduced' : 'NULL AS credit_reduced'},
               ${hasRefundMethod ? 'r.refund_method' : 'NULL AS refund_method'},
               s.receipt_number, s.created_at AS sale_date, s.total AS sale_total, s.customer_id AS sale_customer
        FROM returns r JOIN sales s ON s.id = r.sale_id
        WHERE EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND LOWER(p.method) = 'credit')
           OR EXISTS (SELECT 1 FROM credit_sales cs WHERE cs.sale_id = s.id)
        ORDER BY s.id, datetime(r.created_at), r.id
    `);

    // Legacy kridi refunds per drawer (to read the drawer's difference)
    const legacyByShift = new Map();
    const shiftCache = new Map();
    const drawerOf = (row) => {
        const key = `${row.employee_id}|${row.created_at}`;
        if (!shiftCache.has(key)) shiftCache.set(key, shiftOf(api, row.employee_id, row.created_at));
        return shiftCache.get(key);
    };
    const avoirOf = (row) => (cardsByReturn ? api.get('SELECT id, code, initial_balance, current_balance FROM gift_cards WHERE return_id = ?', [row.id]) : null);
    const exchangeOf = (row) => (exchanges ? api.get('SELECT id FROM exchanges WHERE return_id = ?', [row.id]) : null);
    for (const row of rows) {
        if (row.credit_reduced !== null && row.credit_reduced !== undefined) continue;
        if (avoirOf(row) || exchangeOf(row) || row.refund_method === 'store_credit') continue;
        const shift = drawerOf(row);
        if (shift) legacyByShift.set(shift.id, r2((legacyByShift.get(shift.id) || 0) + (Number(row.total_refund) || 0)));
    }

    // Per customer: the balance kept on the customer and the sum of the open invoices
    const accountCache = new Map();
    const accountOf = (customerId) => {
        if (!customerId) return null;
        if (!accountCache.has(customerId)) {
            const c = api.get('SELECT id, name, phone, credit_balance FROM customers WHERE id = ?', [customerId]);
            const open = api.get('SELECT COALESCE(SUM(MAX(amount_due - COALESCE(amount_paid, 0), 0)), 0) AS owed FROM credit_sales WHERE customer_id = ?', [customerId]).owed;
            accountCache.set(customerId, c ? { ...c, open_invoices: r2(open) } : null);
        }
        return accountCache.get(customerId);
    };

    const cases = [];
    const bySale = new Map();
    for (const row of rows) {
        if (!bySale.has(row.sale_id)) bySale.set(row.sale_id, []);
        bySale.get(row.sale_id).push(row);
    }

    for (const [saleId, saleReturns] of bySale) {
        const invoices = api.all('SELECT * FROM credit_sales WHERE sale_id = ?', [saleId]);
        const invoice = invoices.length === 1 ? invoices[0] : null;
        const creditPaid = r2(api.get("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE sale_id = ? AND LOWER(method) = 'credit'", [saleId]).n);
        const payments = invoice ? api.all('SELECT amount, payment_method, created_at FROM credit_payments WHERE credit_sale_id = ? ORDER BY datetime(created_at)', [invoice.id]) : [];
        // The invoice as first written: what later returns took off is added back
        const lowered = r2(saleReturns.reduce((t, r) => t + (Number(r.credit_reduced) || 0), 0));
        const originalDue = invoice ? r2(Number(invoice.amount_due) + lowered) : null;
        const paid = invoice ? r2(invoice.amount_paid) : 0;
        let owedNowLeft = invoice ? Math.max(0, r2(Number(invoice.amount_due) - paid)) : 0;
        let loweredSoFar = 0;

        for (const row of saleReturns) {
            const refund = r2(row.total_refund);
            const account = accountOf(invoice?.customer_id || row.sale_customer);
            const paidBefore = r2(payments.filter(p => when(p.created_at) <= when(row.created_at)).reduce((t, p) => t + Number(p.amount), 0));
            const paidAfter = r2(paid - paidBefore);
            const base = {
                return_id: row.id, return_number: row.return_number, return_date: row.created_at,
                receipt_number: row.receipt_number, sale_date: row.sale_date,
                customer_id: account?.id || invoice?.customer_id || row.sale_customer || null, customer_name: account?.name || '',
                invoice_number: invoice?.invoice_number || null, invoice_status: invoice?.status || null,
                credit_original: originalDue, credit_on_ticket: creditPaid, credit_paid: paid, paid_before_return: paidBefore, paid_after_return: paidAfter,
                refund, credit_reduced: row.credit_reduced === null || row.credit_reduced === undefined ? null : r2(row.credit_reduced),
                cash_refunded: null, avoir: null,
                owed_now: invoice ? Math.max(0, r2(Number(invoice.amount_due) - paid)) : null,
                customer_balance: account ? r2(account.credit_balance) : null, customer_open_invoices: account ? account.open_invoices : null,
                impact: 0, possible_overpaid: 0,
            };
            const done = (status, reason, extra = {}) => cases.push({ ...base, ...extra, status, confirmed: CONFIRMED.has(status), reason });

            if (base.credit_reduced !== null) {
                loweredSoFar = r2(loweredSoFar + base.credit_reduced);
                done(STATUS.ALREADY_SETTLED, 'Saved with credit_reduced: the debt was lowered at the return');
                continue;
            }
            const card = avoirOf(row);
            if (card || row.refund_method === 'store_credit') {
                done(card ? STATUS.SETTLED_BY_AVOIR : STATUS.MANUAL,
                    card ? `Avoir ${card.code} of ${r2(card.initial_balance)} given for this return (${r2(card.current_balance)} left on it)`
                        : 'Marked as avoir but no avoir card is linked to it', { avoir: card ? r2(card.initial_balance) : null });
                continue;
            }
            if (exchangeOf(row)) { done(STATUS.EXCHANGE, 'Part of an exchange: its value paid for the new piece'); continue; }
            if (!invoice) {
                done(STATUS.MANUAL, invoices.length > 1 ? `${invoices.length} kridi invoices for the same ticket` : 'Paid on kridi but no kridi invoice is recorded for the ticket');
                continue;
            }

            // What lowering the debt at the return would have taken off
            const owedAtReturn = Math.max(0, r2(originalDue - paidBefore - loweredSoFar));
            const shouldLower = r2(Math.min(refund, owedAtReturn));
            const impact = r2(Math.min(shouldLower, owedNowLeft));
            const overpaid = r2(shouldLower - impact);
            const surplus = r2(refund - shouldLower);

            // The drawer: was the money handed out?
            const shift = drawerOf(row);
            const stats = shift && shift.end_time && shift.closing_cash !== null && shift.closing_cash !== undefined && shiftStats ? shiftStats(shift.id) : null;
            const difference = stats && stats.cash_difference !== null && stats.cash_difference !== undefined ? r2(stats.cash_difference) : null;
            const inShift = shift ? legacyByShift.get(shift.id) || 0 : 0;
            const expense = shift && expenses ? api.get('SELECT amount, reason FROM cash_expenses WHERE shift_id = ? AND ABS(amount - ?) <= ? LIMIT 1', [shift.id, refund, TOLERANCE]) : null;

            if (!shift) { done(STATUS.MANUAL, 'No drawer of this employee at the time of the return: cannot tell whether cash was handed out', { impact, possible_overpaid: overpaid }); continue; }
            if (difference === null) { done(STATUS.MANUAL, 'The drawer of the return is not closed (no count): cannot tell whether cash was handed out', { impact, possible_overpaid: overpaid }); continue; }
            if (expense) {
                // Named after the return or the ticket: the refund itself. Otherwise only the same amount.
                const named = [row.return_number, row.receipt_number].some(n => n && String(expense.reason || '').includes(n));
                if (named) done(STATUS.CASH_REFUNDED, `Expense of ${r2(expense.amount)} taken from the drawer for this return ("${expense.reason}"): the debt stays`, { cash_refunded: r2(expense.amount) });
                else done(STATUS.MANUAL, `An expense of the same amount (${r2(expense.amount)}, "${expense.reason}") was taken from the drawer: maybe the refund, maybe not`, { impact, possible_overpaid: overpaid });
                continue;
            }
            if (inShift > 0 && near(difference, -inShift)) {
                // Short by exactly every old kridi refund of this drawer: all of them were handed out
                done(STATUS.CASH_REFUNDED, inShift === refund
                    ? `The drawer closed short by ${-difference}, the amount of this return: the money was handed out, the debt stays`
                    : `The drawer closed short by ${-difference}, exactly all its old kridi returns (${inShift}): each was handed out, the debt stays`, { cash_refunded: refund });
                continue;
            }
            if (inShift > refund && difference < -TOLERANCE && -difference < inShift - TOLERANCE) {
                done(STATUS.MANUAL, `The drawer closed short by ${-difference}, part of its ${inShift} of old kridi returns: which ones were paid in cash cannot be told`, { impact, possible_overpaid: overpaid });
                continue;
            }
            if (!near(difference, 0)) {
                done(STATUS.MANUAL, `The drawer closed with a difference of ${difference} that does not match the return (${refund})`, { impact, possible_overpaid: overpaid });
                continue;
            }

            // No cash went out: the debt should have gone down. Look for signs of a settlement by hand.
            const signs = [];
            if (String(invoice.notes || '').trim()) signs.push(`note on the invoice: "${String(invoice.notes).trim().slice(0, 120)}"`);
            if (invoice.status === 'paid' && r2(Number(invoice.amount_due) - paid) > TOLERANCE) signs.push(`invoice marked paid with ${r2(Number(invoice.amount_due) - paid)} still due`);
            if (account && !near(account.credit_balance, account.open_invoices)) signs.push(`customer balance ${r2(account.credit_balance)} differs from the open invoices ${account.open_invoices}`);
            if (overpaid > 0) signs.push(`${overpaid} paid after the return beyond the pieces kept: the customer may be owed money back`);
            if (surplus > 0) signs.push(`${surplus} of the return was beyond what was still owed and was not handed out`);
            if (signs.length) { done(STATUS.MANUAL, signs.join('; '), { impact, possible_overpaid: overpaid }); continue; }

            owedNowLeft = r2(owedNowLeft - impact);
            loweredSoFar = r2(loweredSoFar + shouldLower);
            done(STATUS.DEBT_NOT_LOWERED, `No cash out (drawer closed without difference), no avoir, accounts agree: the debt should go down by ${impact}`, { impact });
        }
    }

    const sum = (list, key) => r2(list.reduce((t, c) => t + (Number(c[key]) || 0), 0));
    const legacy = cases.filter(c => c.status !== STATUS.ALREADY_SETTLED);
    const manual = cases.filter(c => c.status === STATUS.MANUAL);
    const counts = Object.fromEntries(Object.values(STATUS).map(s => [s, cases.filter(c => c.status === s).length]));
    return {
        checked: cases.length,
        legacy: legacy.length,
        counts,
        confirmed: cases.filter(c => c.confirmed).length,
        manual: manual.length,
        // Debts that the records show were not lowered (owner's approval still needed)
        confirmed_debt_impact: sum(cases.filter(c => c.status === STATUS.DEBT_NOT_LOWERED), 'impact'),
        // Debts that might go down once the owner has checked
        manual_debt_impact: sum(manual, 'impact'),
        manual_possible_overpaid: sum(manual, 'possible_overpaid'),
        cases,
    };
}

/**
 * Lower the debt of the old returns the records PROVE were not settled
 * (DEBT_NOT_LOWERED), and only those. Every other case is left exactly as
 * it is and listed with its reason. Safe to run again: a settled return gets
 * its credit_reduced, so a second run finds it ALREADY_SETTLED and changes
 * nothing. Each return is settled in its own transaction (`api.transaction`).
 *
 * Only a return lowered by its whole amount is settled: the drawer then still
 * reads no cash out for it, so a closed drawer's figures do not move. Sales,
 * TVA, the drawers and the loyalty points are not touched.
 * Returns { settled: [{ return_id, amount, ... }], left: [cases not settled] }.
 */
function settleProvenLegacyReturns(api, { shiftStats = null, employeeId = null } = {}) {
    const report = auditLegacyCreditReturns(api, { shiftStats });
    const settled = [];
    const left = [];
    for (const c of report.cases) {
        if (c.status !== STATUS.DEBT_NOT_LOWERED) {
            if (c.status !== STATUS.ALREADY_SETTLED) left.push(c);
            continue;
        }
        const result = api.transaction(() => {
            // Read again inside the transaction: nothing settled twice, nothing beyond what is owed
            const row = api.get('SELECT id, sale_id, total_refund, credit_reduced FROM returns WHERE id = ?', [c.return_id]);
            if (!row || (row.credit_reduced !== null && row.credit_reduced !== undefined)) return { skip: 'already settled' };
            const invoice = api.get('SELECT id, customer_id, amount_due, amount_paid FROM credit_sales WHERE sale_id = ?', [row.sale_id]);
            const owed = invoice ? r2(Number(invoice.amount_due) - Number(invoice.amount_paid || 0)) : 0;
            const amount = r2(row.total_refund);
            if (!invoice || !(amount > 0) || !near(c.impact, amount) || amount - owed > 0.004) return { skip: 'not the whole return, or more than is owed now' };
            const due = r2(Number(invoice.amount_due) - amount);
            const paid = Math.round(Number(invoice.amount_paid || 0) * 100) >= Math.round(due * 100);
            api.run('UPDATE returns SET credit_reduced = ? WHERE id = ? AND credit_reduced IS NULL', [amount, row.id]);
            api.run('UPDATE credit_sales SET amount_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [due, paid ? 'paid' : (Number(invoice.amount_paid || 0) > 0 ? 'partial' : 'pending'), invoice.id]);
            if (invoice.customer_id) {
                api.run('UPDATE customers SET credit_balance = MAX(0, COALESCE(credit_balance, 0) - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, invoice.customer_id]);
            }
            if (hasTable(api, 'system_logs')) {
                api.run('INSERT INTO system_logs (id, action_type, description, details, employee_id) VALUES (?, ?, ?, ?, ?)',
                    [api.uuid ? api.uuid() : `${row.id}-settled`, 'legacy_return_settled', `Old kridi return ${c.return_number}: debt lowered by ${amount}`,
                        JSON.stringify({ returnId: row.id, saleId: row.sale_id, amount, reason: c.reason }), employeeId]);
            }
            return { amount };
        });
        if (result.skip) left.push({ ...c, reason: `${c.reason} (not settled: ${result.skip})` });
        else settled.push({ return_id: c.return_id, return_number: c.return_number, receipt_number: c.receipt_number, customer_id: c.customer_id, amount: result.amount });
    }
    return { settled, left, total: r2(settled.reduce((t, x) => t + x.amount, 0)) };
}

const CSV_COLUMNS = ['status', 'reason', 'receipt_number', 'sale_date', 'return_number', 'return_date', 'customer_id', 'customer_name', 'invoice_number', 'invoice_status',
    'credit_original', 'credit_on_ticket', 'credit_paid', 'paid_before_return', 'paid_after_return', 'refund', 'credit_reduced', 'cash_refunded', 'avoir',
    'owed_now', 'customer_balance', 'customer_open_invoices', 'impact', 'possible_overpaid'];

function toCsv(report) {
    const cell = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [CSV_COLUMNS.join(','), ...report.cases.map(c => CSV_COLUMNS.map(k => cell(c[k])).join(','))].join('\n') + '\n';
}

module.exports = { auditLegacyCreditReturns, settleProvenLegacyReturns, toCsv, STATUS, CSV_COLUMNS };
