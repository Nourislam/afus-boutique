/**
 * The sales journal of a period, for the shop's accountant: one line per
 * ticket that counts and one line (negative) per return, with the amount
 * without TVA, the TVA and the total, and how it was paid. It is a working
 * file for the accountant, not a tax declaration: the declarations (G50,
 * annual statements) stay the accountant's, from these figures.
 * Its totals are those of the Reports screen (salesStatsService.js).
 * `api` is the { all, get } database adapter.
 */
const { countedSale } = require('./saleStatus');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100 + 0;
// Minus, never -0 (an Excel cell "-0" puzzles the reader)
const neg = (n) => (r2(n) ? -r2(n) : 0);
const METHODS = ['cash', 'card', 'transfer', 'credit', 'gift_card'];

function salesJournal(api, { startDate, endDate } = {}) {
    const sales = api.all(`
        SELECT s.id, s.created_at, s.receipt_number, s.total, COALESCE(s.tax_amount, 0) AS tax, c.name AS customer, e.name AS employee
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        LEFT JOIN employees e ON e.id = s.employee_id
        WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?) AND ${countedSale('s')}
        ORDER BY s.created_at, s.receipt_number
    `, [startDate, endDate]);
    const paid = new Map();
    for (const p of api.all(`
        SELECT p.sale_id, LOWER(p.method) AS method, SUM(p.amount) AS amount
        FROM payments p JOIN sales s ON s.id = p.sale_id
        WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?) AND ${countedSale('s')}
        GROUP BY p.sale_id, LOWER(p.method)
    `, [startDate, endDate])) {
        if (!paid.has(p.sale_id)) paid.set(p.sale_id, {});
        paid.get(p.sale_id)[p.method] = r2(p.amount);
    }
    const rows = sales.map(s => {
        const ways = paid.get(s.id) || {};
        const other = r2(Object.entries(ways).filter(([m]) => !METHODS.includes(m)).reduce((t, [, a]) => t + a, 0));
        return {
            date: s.created_at, type: 'sale', number: s.receipt_number, customer: s.customer || '', employee: s.employee || '',
            amount_ht: r2(s.total - s.tax), tva: r2(s.tax), amount_ttc: r2(s.total),
            ...Object.fromEntries(METHODS.map(m => [m, ways[m] || 0])), other,
        };
    });
    const returns = api.all(`
        SELECT r.created_at, r.return_number, r.total_refund, COALESCE(r.credit_reduced, 0) AS credit_reduced, r.refund_method,
               -- Saved before returns lowered the kridi: on a kridi sale no cash went out (as the drawer counts it)
               (r.credit_reduced IS NULL AND EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = r.sale_id AND LOWER(p.method) = 'credit')) AS legacy_credit,
               EXISTS (SELECT 1 FROM exchanges x WHERE x.return_id = r.id) AS exchange,
               s.total AS sale_total, COALESCE(s.tax_amount, 0) AS sale_tax, s.receipt_number, c.name AS customer, e.name AS employee
        FROM returns r
        LEFT JOIN sales s ON s.id = r.sale_id
        LEFT JOIN customers c ON c.id = s.customer_id
        LEFT JOIN employees e ON e.id = r.employee_id
        WHERE datetime(r.created_at) BETWEEN datetime(?) AND datetime(?) AND ${countedSale('s')}
        ORDER BY r.created_at
    `, [startDate, endDate]);
    for (const r of returns) {
        const tax = r.sale_total > 0 ? r.total_refund * r.sale_tax / r.sale_total : 0;
        const handBack = r2(r.total_refund - r.credit_reduced);
        // Not cash: an exchange (the value paid for the new piece), an older kridi return
        const notCash = r.exchange || r.legacy_credit || r.refund_method === 'store_credit';
        rows.push({
            date: r.created_at, type: 'return', number: `${r.return_number} (${r.receipt_number || ''})`, customer: r.customer || '', employee: r.employee || '',
            amount_ht: neg(r.total_refund - tax), tva: neg(tax), amount_ttc: neg(r.total_refund),
            cash: notCash ? 0 : neg(handBack), card: 0, transfer: 0,
            credit: neg(r.credit_reduced), gift_card: r.refund_method === 'store_credit' ? neg(handBack) : 0,
            other: r.exchange || r.legacy_credit ? neg(handBack) : 0,
        });
    }
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const totals = { amount_ht: 0, tva: 0, amount_ttc: 0 };
    for (const row of rows) for (const k of Object.keys(totals)) totals[k] = r2(totals[k] + row[k]);
    return { rows, totals };
}

module.exports = { salesJournal, METHODS };
