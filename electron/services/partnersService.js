/**
 * Customers and suppliers at a glance, read from what is already saved
 * (sales, credit sales and their payments, purchase orders, receivings).
 * Nothing is written here: the figures are always computed again, so they
 * can never drift from the operations themselves.
 *
 * Words used on screen: a customer "still owes" what is left of his credit
 * sales; the shop "still owes" a supplier what is left to pay on the goods
 * it received.
 */

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Sales that do not count as a purchase of the customer: the shared rule
const { countedSale } = require('./saleStatus');

/** Every active customer with what he still owes and his last activity. */
function customersOverview(api) {
    return api.all(`
        SELECT c.*,
            COALESCE(s.sales_count, 0) AS sales_count,
            COALESCE(s.sales_total, 0) AS sales_total,
            s.last_sale_at,
            COALESCE(cr.owed, 0) AS owed,
            COALESCE(cr.open_count, 0) AS open_credits,
            cr.oldest_due,
            p.last_payment_at
        FROM customers c
        LEFT JOIN (
            SELECT customer_id, COUNT(*) AS sales_count, SUM(total) AS sales_total, MAX(created_at) AS last_sale_at
            FROM sales WHERE customer_id IS NOT NULL AND ${countedSale(null)}
            GROUP BY customer_id
        ) s ON s.customer_id = c.id
        LEFT JOIN (
            SELECT customer_id,
                SUM(MAX(amount_due - COALESCE(amount_paid, 0), 0)) AS owed,
                SUM(CASE WHEN amount_due - COALESCE(amount_paid, 0) > 0.004 THEN 1 ELSE 0 END) AS open_count,
                MIN(CASE WHEN amount_due - COALESCE(amount_paid, 0) > 0.004 THEN due_date END) AS oldest_due
            FROM credit_sales GROUP BY customer_id
        ) cr ON cr.customer_id = c.id
        LEFT JOIN (
            SELECT cs.customer_id, MAX(cp.created_at) AS last_payment_at
            FROM credit_payments cp JOIN credit_sales cs ON cs.id = cp.credit_sale_id
            GROUP BY cs.customer_id
        ) p ON p.customer_id = c.id
        WHERE COALESCE(c.is_active, 1) = 1
        ORDER BY c.name
    `).map(row => ({ ...row, owed: round(row.owed), sales_total: round(row.sales_total) }));
}

/** One customer: what is still owed per credit sale, the payments, the last purchases. */
function customerHistory(api, customerId, { salesLimit = 20 } = {}) {
    const credits = api.all(`
        SELECT cs.id, cs.invoice_number, cs.amount_due, COALESCE(cs.amount_paid, 0) AS amount_paid,
            MAX(cs.amount_due - COALESCE(cs.amount_paid, 0), 0) AS remaining,
            cs.status, cs.due_date, cs.created_at, s.receipt_number
        FROM credit_sales cs LEFT JOIN sales s ON s.id = cs.sale_id
        WHERE cs.customer_id = ?
        ORDER BY cs.created_at DESC
    `, [customerId]).map(c => ({ ...c, remaining: round(c.remaining) }));
    const payments = api.all(`
        SELECT cp.id, cp.amount, cp.payment_method, cp.created_at, cs.invoice_number, e.name AS received_by_name
        FROM credit_payments cp
        JOIN credit_sales cs ON cs.id = cp.credit_sale_id
        LEFT JOIN employees e ON e.id = cp.received_by
        WHERE cs.customer_id = ?
        ORDER BY cp.created_at DESC
    `, [customerId]);
    const sales = api.all(`
        SELECT id, receipt_number, total, created_at, status
        FROM sales WHERE customer_id = ? AND ${countedSale(null)}
        ORDER BY created_at DESC LIMIT ?
    `, [customerId, salesLimit]);
    const owed = round(credits.reduce((sum, c) => sum + c.remaining, 0));
    const paid = round(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    return { owed, paid, credits, payments, sales };
}

/**
 * Every supplier with: what was received (orders received in full or in
 * part), what was paid on it, what the shop still owes (less the goods sent
 * back), orders waiting, and the last delivery.
 */
function suppliersOverview(api) {
    return api.all(`
        SELECT s.*,
            COALESCE(po.received_total, 0) AS received_total,
            COALESCE(po.received_paid, 0) AS received_paid,
            MAX(COALESCE(po.owed, 0) - COALESCE(ret.returned_total, 0), 0) AS owed,
            COALESCE(ret.returned_total, 0) AS returned_total,
            COALESCE(po.waiting_count, 0) AS waiting_orders,
            COALESCE(po.orders_count, 0) AS orders_count,
            COALESCE(r.last_received_at, po.last_received_po) AS last_received_at,
            pay.last_payment_at
        FROM suppliers s
        LEFT JOIN (
            SELECT supplier_id,
                COUNT(*) AS orders_count,
                SUM(CASE WHEN status IN ('received', 'partial') THEN total ELSE 0 END) AS received_total,
                SUM(CASE WHEN status IN ('received', 'partial') THEN COALESCE(amount_paid, 0) ELSE 0 END) AS received_paid,
                SUM(CASE WHEN status IN ('received', 'partial') THEN MAX(total - COALESCE(amount_paid, 0), 0) ELSE 0 END) AS owed,
                SUM(CASE WHEN status IN ('draft', 'sent') THEN 1 ELSE 0 END) AS waiting_count,
                MAX(CASE WHEN status IN ('received', 'partial') THEN COALESCE(updated_at, created_at) END) AS last_received_po
            FROM purchase_orders WHERE COALESCE(status, '') <> 'cancelled'
            GROUP BY supplier_id
        ) po ON po.supplier_id = s.id
        LEFT JOIN (SELECT supplier_id, MAX(received_date) AS last_received_at FROM receivings GROUP BY supplier_id) r ON r.supplier_id = s.id
        LEFT JOIN (SELECT supplier_id, MAX(paid_at) AS last_payment_at FROM supplier_payments GROUP BY supplier_id) pay ON pay.supplier_id = s.id
        LEFT JOIN (SELECT supplier_id, SUM(total_amount) AS returned_total FROM purchase_returns GROUP BY supplier_id) ret ON ret.supplier_id = s.id
        WHERE COALESCE(s.is_active, 1) = 1
        ORDER BY s.name
    `).map(row => ({
        ...row,
        received_total: round(row.received_total),
        received_paid: round(row.received_paid),
        owed: round(row.owed),
        returned_total: round(row.returned_total),
    }));
}

module.exports = { customersOverview, customerHistory, suppliersOverview };
