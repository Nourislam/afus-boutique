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

// Each sale line with the pieces the customer kept: sold minus everything
// returned against that line (several returns add up), never below 0.
const NET_SALE_ITEMS = `(
    SELECT sale_items.*, MAX(sale_items.quantity - COALESCE(r.returned, 0), 0) AS net_quantity
    FROM sale_items
    LEFT JOIN (
        SELECT sale_item_id, SUM(quantity) AS returned
        FROM return_items WHERE sale_item_id IS NOT NULL
        GROUP BY sale_item_id
    ) r ON r.sale_item_id = sale_items.id
)`;

function topSizes(api, range, limit = 8) {
    const { where, params } = salesFilter(range);
    return api.all(`
        SELECT v.size AS size, SUM(si.net_quantity) AS quantity, SUM(si.total) AS revenue
        FROM ${NET_SALE_ITEMS} si
        JOIN sales s ON s.id = si.sale_id
        JOIN product_variants v ON v.id = si.variant_id
        WHERE ${where} AND v.size IS NOT NULL AND v.size <> ''
        GROUP BY v.size
        HAVING SUM(si.net_quantity) > 0
        ORDER BY quantity DESC
        LIMIT ?
    `, [...params, limit]);
}

function topColors(api, range, limit = 8) {
    const { where, params } = salesFilter(range);
    return api.all(`
        SELECT COALESCE(NULLIF(v.color_code, ''), v.color) AS color_key,
               MAX(v.color) AS color, MAX(v.color_code) AS color_code,
               SUM(si.net_quantity) AS quantity, SUM(si.total) AS revenue
        FROM ${NET_SALE_ITEMS} si
        JOIN sales s ON s.id = si.sale_id
        JOIN product_variants v ON v.id = si.variant_id
        WHERE ${where} AND v.color IS NOT NULL AND v.color <> ''
        GROUP BY color_key
        HAVING SUM(si.net_quantity) > 0
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


// ------------------------------------------------------------------
// Home screen ("what do I do now?") — read-only, nothing is written.
// Dates are passed by the screen in the same form as sales.created_at.
// ------------------------------------------------------------------

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Pieces left of an article: its variants for an article with colours/sizes, itself otherwise
const PRODUCT_STOCK = `CASE WHEN COALESCE(p.has_variants, 0) = 1
    THEN (SELECT COALESCE(SUM(v.stock_quantity), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1)
    ELSE p.stock_quantity END`;

/** Best 5 articles, colours and sizes of the period, each with the pieces left. */
function bestSellers(api, range, limit = 5) {
    const { where, params } = salesFilter(range);
    const products = api.all(`
        SELECT si.product_id, MAX(si.product_name) AS name, SUM(si.net_quantity) AS quantity, SUM(si.total) AS revenue,
               (SELECT ${PRODUCT_STOCK} FROM products p WHERE p.id = si.product_id) AS stock
        FROM ${NET_SALE_ITEMS} si JOIN sales s ON s.id = si.sale_id
        WHERE ${where} AND si.product_id IS NOT NULL
        GROUP BY si.product_id
        HAVING SUM(si.net_quantity) > 0
        ORDER BY quantity DESC
        LIMIT ?
    `, [...params, limit]);
    const colorStock = (key) => api.get(`
        SELECT COALESCE(SUM(v.stock_quantity), 0) AS stock
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND COALESCE(NULLIF(v.color_code, ''), v.color) = ?
    `, [key])?.stock || 0;
    const sizeStock = (size) => api.get(`
        SELECT COALESCE(SUM(v.stock_quantity), 0) AS stock
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND v.size = ?
    `, [size])?.stock || 0;
    return {
        products: products.map(r => ({ ...r, stock: r.stock ?? 0 })),
        colors: topColors(api, range, limit).map(r => ({ ...r, stock: colorStock(r.color_key) })),
        sizes: topSizes(api, range, limit).map(r => ({ ...r, stock: sizeStock(r.size) })),
    };
}

/** Pieces sold (and not returned) since a date, per variant (or per article without variants). */
function soldSince(api, since) {
    return api.all(`
        SELECT si.product_id, si.variant_id, SUM(si.net_quantity) AS sold
        FROM ${NET_SALE_ITEMS} si JOIN sales s ON s.id = si.sale_id
        WHERE datetime(s.created_at) >= datetime(?) AND COALESCE(s.status, 'completed') <> 'voided'
        GROUP BY si.product_id, si.variant_id
        HAVING SUM(si.net_quantity) > 0
    `, [since]);
}

/** Colours/sizes (or articles) at 0 that were sold since the date: the ones worth ordering again. */
function outOfStockSelling(api, since) {
    const sold = soldSince(api, since);
    const byVariant = new Map(sold.filter(r => r.variant_id).map(r => [r.variant_id, r.sold]));
    const byProduct = new Map();
    for (const r of sold) byProduct.set(r.product_id, (byProduct.get(r.product_id) || 0) + r.sold);
    return catalog.getLowStock(api)
        .filter(r => r.stock_quantity <= 0)
        .map(r => ({ ...r, sold: r.variant_id ? (byVariant.get(r.variant_id) || 0) : (byProduct.get(r.product_id) || 0) }))
        .filter(r => r.sold > 0)
        .sort((a, b) => b.sold - a.sold);
}

/** Running low but not at 0 yet. */
function runningLow(api) {
    return catalog.getLowStock(api).filter(r => r.stock_quantity > 0);
}

/**
 * Articles that sell but miss some sizes: a size is missing when every
 * colour of it is at 0 while other sizes are still there.
 */
function missingSizes(api, since) {
    const soldProducts = new Set(soldSince(api, since).map(r => r.product_id));
    const rows = api.all(`
        SELECT p.id AS product_id, p.name AS product_name, v.size, SUM(v.stock_quantity) AS stock, MIN(v.sort_order) AS sort_order
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND p.has_variants = 1 AND v.size IS NOT NULL AND v.size <> ''
        GROUP BY p.id, v.size
        ORDER BY p.name, sort_order
    `);
    const byProduct = new Map();
    for (const r of rows) {
        if (!soldProducts.has(r.product_id)) continue;
        const entry = byProduct.get(r.product_id) || { product_id: r.product_id, product_name: r.product_name, missing: [], available: [] };
        (r.stock > 0 ? entry.available : entry.missing).push(r.size);
        byProduct.set(r.product_id, entry);
    }
    return [...byProduct.values()].filter(e => e.missing.length > 0 && e.available.length > 0);
}

/** Articles with pieces in stock and no sale since the date (new articles are left out). */
function slowMovers(api, since, limit = 5) {
    return api.all(`
        SELECT p.id AS product_id, p.name, ${PRODUCT_STOCK} AS stock, p.created_at,
               (SELECT MAX(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                WHERE si.product_id = p.id AND COALESCE(s.status, 'completed') <> 'voided') AS last_sale_at
        FROM products p
        WHERE p.is_active = 1 AND datetime(COALESCE(p.created_at, '2000-01-01')) <= datetime(?)
          AND ${PRODUCT_STOCK} > 0
          AND NOT EXISTS (
            SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
            WHERE si.product_id = p.id AND datetime(s.created_at) >= datetime(?) AND COALESCE(s.status, 'completed') <> 'voided')
        ORDER BY stock DESC, p.name
        LIMIT ?
    `, [since, since, limit]);
}

/** Active articles without a purchase price (their profit cannot be known). */
function missingCost(api) {
    const rows = api.all(`
        SELECT p.id, p.name FROM products p
        WHERE p.is_active = 1 AND (
            (COALESCE(p.has_variants, 0) = 0 AND COALESCE(p.cost, 0) <= 0)
            OR (p.has_variants = 1 AND EXISTS (
                SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND COALESCE(v.cost, p.cost, 0) <= 0)))
        ORDER BY p.name
    `);
    return { count: rows.length, names: rows.slice(0, 5).map(r => r.name) };
}

/** Articles sold in the period whose purchase price was not known: the profit of the period is only approximate. */
function soldWithoutCost(api, range) {
    const { where, params } = salesFilter(range);
    return api.get(`
        SELECT COUNT(DISTINCT COALESCE(si.product_id, si.product_name)) AS count
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${where} AND COALESCE(si.unit_cost, 0) <= 0
    `, params)?.count || 0;
}

/** Customers late with their credit (due date before today), and how much they still owe. */
function overdueCredit(api, today) {
    const row = api.get(`
        SELECT COUNT(DISTINCT customer_id) AS customers, COALESCE(SUM(amount_due - COALESCE(amount_paid, 0)), 0) AS amount
        FROM credit_sales
        WHERE amount_due - COALESCE(amount_paid, 0) > 0.004 AND date(due_date) < date(?)
    `, [today]) || {};
    return { customers: row.customers || 0, amount: round(row.amount) };
}

/** Active promotions ending today or tomorrow. */
function offersEnding(api, today, tomorrow) {
    return api.all(`
        SELECT id, name, end_date FROM promotions
        WHERE is_active = 1 AND end_date IS NOT NULL AND date(end_date) BETWEEN date(?) AND date(?)
        ORDER BY end_date
    `, [today, tomorrow]);
}

/** Credit given (new credit sales) and credit received (payments) in the period. */
function creditMoves(api, { startDate, endDate }) {
    const given = api.get(`
        SELECT COALESCE(SUM(amount_due), 0) AS amount, COUNT(*) AS count FROM credit_sales
        WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)
    `, [startDate, endDate]) || {};
    const received = api.get(`
        SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM credit_payments
        WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)
    `, [startDate, endDate]) || {};
    return { given: round(given.amount), givenCount: given.count || 0, received: round(received.amount), receivedCount: received.count || 0 };
}

/**
 * Sales per hour (one day) or per day (week, month), in the shop's local time.
 * offsetMinutes: minutes to add to the stored time to get the local time.
 */
function salesSeries(api, range, bucket = 'day', offsetMinutes = 0) {
    const { where, params } = salesFilter(range);
    const shift = `${offsetMinutes >= 0 ? '+' : ''}${Math.round(offsetMinutes)} minutes`;
    const key = bucket === 'hour' ? "strftime('%H', datetime(s.created_at, ?))" : "date(datetime(s.created_at, ?))";
    return api.all(`
        SELECT ${key} AS bucket, COUNT(*) AS count, COALESCE(SUM(s.total), 0) AS total
        FROM sales s WHERE ${where}
        GROUP BY bucket ORDER BY bucket
    `, [shift, ...params]).map(r => ({ ...r, total: round(r.total) }));
}

/** Is there anything at all yet? (for the first-day screen) */
function firstSteps(api) {
    return {
        products: api.get('SELECT COUNT(*) AS n FROM products WHERE is_active = 1')?.n || 0,
        sales: api.get('SELECT COUNT(*) AS n FROM sales')?.n || 0,
        shifts: api.get('SELECT COUNT(*) AS n FROM shifts')?.n || 0,
    };
}

module.exports = {
    getClothingDashboard, topSizes, topColors, stockValue,
    bestSellers, outOfStockSelling, runningLow, missingSizes, slowMovers, missingCost, soldWithoutCost,
    overdueCredit, offersEnding, creditMoves, salesSeries, firstSteps,
};
