/**
 * Sales totals of a period and the money received per payment method.
 * Only the sales that count (see saleStatus.js); refunds are taken off.
 * `api` is the { all, get } database adapter (electron/database/api.js).
 */
const { countedSale } = require('./saleStatus');

const r2 = (n) => Math.round(n * 100) / 100;

function salesStats(api, { startDate, endDate, employeeId } = {}) {
    // Profit = what the customer paid (after every discount, without TVA) minus
    // the purchase cost of the pieces; returns are taken off both.
    const emp = employeeId ? ' AND s.employee_id = ?' : '';
    const params = employeeId ? [startDate, endDate, employeeId] : [startDate, endDate];
    const sales = api.get(`
        SELECT
          COUNT(s.id) AS total_transactions,
          COALESCE(SUM(s.total), 0) AS total_revenue,
          COALESCE(AVG(s.total), 0) AS average_sale,
          COALESCE(SUM(s.tax_amount), 0) AS total_tax,
          COALESCE(SUM(s.discount_amount), 0) AS total_discount,
          COALESCE(SUM(c.cost), 0) AS total_cost,
          COALESCE(SUM(c.pieces), 0) AS items_sold
        FROM sales s
        LEFT JOIN (
          SELECT sale_id, SUM(COALESCE(unit_cost, 0) * quantity) AS cost, SUM(quantity) AS pieces
          FROM sale_items GROUP BY sale_id
        ) c ON c.sale_id = s.id
        WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)${emp} AND ${countedSale('s')}
    `, params) || {};
    const returns = api.get(`
        SELECT
          COUNT(DISTINCT r.id) AS count,
          COALESCE(SUM(r.total_refund), 0) AS refunds
        FROM returns r
        LEFT JOIN sales s ON s.id = r.sale_id
        WHERE datetime(r.created_at) BETWEEN datetime(?) AND datetime(?)${employeeId ? ' AND r.employee_id = ?' : ''} AND ${countedSale('s')}
    `, params) || {};
    const returnedCost = api.get(`
        SELECT COALESCE(SUM(ri.quantity * COALESCE(si.unit_cost, 0)), 0) AS cost
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        LEFT JOIN sales s ON s.id = r.sale_id
        LEFT JOIN sale_items si ON si.id = ri.sale_item_id
        WHERE datetime(r.created_at) BETWEEN datetime(?) AND datetime(?)${employeeId ? ' AND r.employee_id = ?' : ''} AND ${countedSale('s')}
    `, params) || {};

    const revenue = sales.total_revenue || 0;
    const refunds = returns.refunds || 0;
    const netRevenue = revenue - refunds;
    const cost = (sales.total_cost || 0) - (returnedCost.cost || 0);
    const profit = (revenue - (sales.total_tax || 0)) - refunds - cost;
    return {
        total_transactions: sales.total_transactions || 0,
        total_revenue: r2(revenue),
        average_sale: r2(sales.average_sale || 0),
        total_tax: r2(sales.total_tax || 0),
        total_discount: r2(sales.total_discount || 0),
        items_sold: sales.items_sold || 0,
        total_refunds: r2(refunds),
        refunds_count: returns.count || 0,
        net_revenue: r2(netRevenue),
        total_cost: r2(cost),
        total_profit: r2(profit),
        margin_percent: netRevenue > 0 ? r2((profit / netRevenue) * 100) : 0,
    };
}

function paymentMethods(api, { startDate, endDate, employeeId } = {}) {
    const params = [startDate, endDate];
    let query = `
        SELECT p.method, COUNT(*) AS count, SUM(p.amount) AS total
        FROM payments p
        JOIN sales s ON p.sale_id = s.id
        WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?) AND ${countedSale('s')}
    `;
    if (employeeId) {
        query += ' AND s.employee_id = ?';
        params.push(employeeId);
    }
    return api.all(`${query} GROUP BY p.method`, params);
}

module.exports = { salesStats, paymentMethods };
