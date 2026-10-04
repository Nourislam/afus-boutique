/**
 * Figures for the clothing shop dashboard: best sizes and colours, stock
 * value and the variants running low. Read-only queries on the local DB.
 * `api` is the { all, get } adapter used by catalogService.
 */
const catalog = require('./catalogService');

function salesFilter({ startDate, endDate, employeeId }) {
    let where = "s.created_at BETWEEN ? AND ? AND COALESCE(s.status, 'completed') <> 'voided'";
    const params = [startDate, endDate];
    if (employeeId) {
        where += ' AND s.employee_id = ?';
        params.push(employeeId);
    }
    return { where, params };
}

function topSizes(api, range, limit = 8) {
    const { where, params } = salesFilter(range);
    return api.all(`
        SELECT v.size AS size, SUM(si.quantity) AS quantity, SUM(si.total) AS revenue
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN product_variants v ON v.id = si.variant_id
        WHERE ${where} AND v.size IS NOT NULL AND v.size <> ''
        GROUP BY v.size
        ORDER BY quantity DESC
        LIMIT ?
    `, [...params, limit]);
}

function topColors(api, range, limit = 8) {
    const { where, params } = salesFilter(range);
    return api.all(`
        SELECT COALESCE(NULLIF(v.color_code, ''), v.color) AS color_key,
               MAX(v.color) AS color, MAX(v.color_code) AS color_code,
               SUM(si.quantity) AS quantity, SUM(si.total) AS revenue
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN product_variants v ON v.id = si.variant_id
        WHERE ${where} AND v.color IS NOT NULL AND v.color <> ''
        GROUP BY color_key
        ORDER BY quantity DESC
        LIMIT ?
    `, [...params, limit]);
}

/** Purchase value and selling value of the stock on hand. */
function stockValue(api) {
    const variants = api.get(`
        SELECT COALESCE(SUM(v.stock_quantity * COALESCE(v.cost, p.cost, 0)), 0) AS cost_value,
               COALESCE(SUM(v.stock_quantity * COALESCE(v.price, p.price, 0)), 0) AS retail_value,
               COALESCE(SUM(v.stock_quantity), 0) AS units
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND p.has_variants = 1 AND v.stock_quantity > 0
    `) || {};
    const simple = api.get(`
        SELECT COALESCE(SUM(stock_quantity * COALESCE(cost, 0)), 0) AS cost_value,
               COALESCE(SUM(stock_quantity * COALESCE(price, 0)), 0) AS retail_value,
               COALESCE(SUM(stock_quantity), 0) AS units
        FROM products
        WHERE is_active = 1 AND COALESCE(has_variants, 0) = 0 AND stock_quantity > 0
    `) || {};
    return {
        cost: (variants.cost_value || 0) + (simple.cost_value || 0),
        retail: (variants.retail_value || 0) + (simple.retail_value || 0),
        units: (variants.units || 0) + (simple.units || 0),
    };
}

function getClothingDashboard(api, range) {
    return {
        topSizes: topSizes(api, range),
        topColors: topColors(api, range),
        stockValue: stockValue(api),
        lowStock: catalog.getLowStock(api).slice(0, 12),
    };
}

module.exports = { getClothingDashboard, topSizes, topColors, stockValue };
