/**
 * Figures that help decide: what runs out soon, how much of what was bought
 * has sold (sell-through), the stock of an article colour by size, what the
 * stock is worth and what has not sold for a while. Read-only queries on the
 * local database; `api` is the { all, get } adapter. Dates are passed in the
 * same form as sales.created_at ("YYYY-MM-DD HH:MM:SS", UTC).
 * Pieces sold are those the customer kept (returns taken off).
 */
const { countedSale } = require('./saleStatus');
const { NET_SALE_ITEMS, PRODUCT_STOCK } = require('./dashboardService');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100 + 0;
const DAY = 86400000;
const toDb = (date) => new Date(date).toISOString().replace('T', ' ').slice(0, 19);

/** Pieces kept since a date (or ever), per variant (key v:id) and per article (key p:id). */
function netSold(api, since = null) {
    const rows = api.all(`
        SELECT si.product_id, si.variant_id, SUM(si.net_quantity) AS sold
        FROM ${NET_SALE_ITEMS} si JOIN sales s ON s.id = si.sale_id
        WHERE ${countedSale('s')}${since ? ' AND s.created_at >= ?' : ''}
        GROUP BY si.product_id, si.variant_id
    `, since ? [since] : []);
    const map = new Map();
    for (const r of rows) {
        const sold = Number(r.sold) || 0;
        if (r.variant_id) map.set(`v:${r.variant_id}`, (map.get(`v:${r.variant_id}`) || 0) + sold);
        map.set(`p:${r.product_id}`, (map.get(`p:${r.product_id}`) || 0) + sold);
    }
    return map;
}

/** Every colour / size (and simple article) on sale, with its stock. */
function stockLines(api) {
    return api.all(`
        SELECT p.id AS product_id, p.name AS product_name, p.supplier_id,
               v.id AS variant_id, v.color, v.color_code, v.size, v.sku,
               CASE WHEN v.id IS NULL THEN COALESCE(p.stock_quantity, 0) ELSE COALESCE(v.stock_quantity, 0) END AS stock
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1 AND p.has_variants = 1
        WHERE p.is_active = 1 AND (COALESCE(p.has_variants, 0) = 0 OR v.id IS NOT NULL)
    `);
}

/**
 * 1. What runs out soon: pieces left / pieces sold a day over the last
 * `days` days. Listed when that lasts `horizon` days or less (and something
 * is still in stock: what is at 0 is already in "sold out").
 */
function runOutSoon(api, { now = Date.now(), days = 14, horizon = 7 } = {}) {
    const window = Math.max(1, Number(days) || 14);
    const sold = netSold(api, toDb(Number(now) - window * DAY));
    return stockLines(api)
        .map(line => {
            const n = sold.get(line.variant_id ? `v:${line.variant_id}` : `p:${line.product_id}`) || 0;
            const perDay = n / window;
            return { ...line, sold: n, per_day: r2(perDay), days_left: perDay > 0 ? r2(line.stock / perDay) : null };
        })
        .filter(line => line.stock > 0 && line.days_left !== null && line.days_left <= horizon)
        .sort((a, b) => a.days_left - b.days_left || b.sold - a.sold);
}

/**
 * 2. Sell-through: of the pieces there were to sell (sold + still in
 * stock), how many sold. Per article, collection or season; `since` limits
 * the sales counted (null: all of them).
 * The pieces bought are taken as sold + in stock: a piece lost or given away
 * is not counted, which is what the shop can know without a purchase history.
 */
function sellThrough(api, { by = 'product', since = null } = {}) {
    const sold = netSold(api, since);
    const products = api.all(`
        SELECT p.id, p.name, NULLIF(TRIM(COALESCE(p.collection, '')), '') AS collection, NULLIF(p.season, '') AS season,
               ${PRODUCT_STOCK} AS stock
        FROM products p WHERE p.is_active = 1
    `);
    const groups = new Map();
    for (const p of products) {
        const key = by === 'collection' ? p.collection : by === 'season' ? p.season : p.id;
        if (key === null || key === undefined) continue;
        const g = groups.get(key) || { key, label: by === 'product' ? p.name : key, sold: 0, stock: 0, articles: 0 };
        g.sold += sold.get(`p:${p.id}`) || 0;
        g.stock += Math.max(0, Number(p.stock) || 0);
        g.articles += 1;
        groups.set(key, g);
    }
    const rows = [...groups.values()]
        .filter(g => g.sold + g.stock > 0)
        .map(g => ({ ...g, rate: r2((g.sold / (g.sold + g.stock)) * 100) }))
        .sort((a, b) => (b.sold + b.stock) - (a.sold + a.stock) || a.label.localeCompare(b.label));
    const sumSold = rows.reduce((t, g) => t + g.sold, 0);
    const sumStock = rows.reduce((t, g) => t + g.stock, 0);
    return { rows, total: { sold: sumSold, stock: sumStock, rate: sumSold + sumStock > 0 ? r2((sumSold / (sumSold + sumStock)) * 100) : null } };
}

/**
 * 3. The stock of an article, colour by size, with the pieces sold since
 * `since` (null: ever) in each cell. Colours and sizes in the article's order.
 */
function productMatrix(api, productId, { since = null } = {}) {
    const product = api.get('SELECT id, name, sku, price, has_variants, stock_quantity FROM products WHERE id = ?', [productId]);
    if (!product) return null;
    const sold = netSold(api, since);
    const variants = api.all(`
        SELECT id, color, color_code, size, sku, COALESCE(stock_quantity, 0) AS stock, COALESCE(sort_order, 0) AS sort_order
        FROM product_variants WHERE product_id = ? AND is_active = 1
        ORDER BY sort_order, rowid
    `, [productId]);
    const colors = [];
    const sizes = [];
    for (const v of variants) {
        const color = v.color || '';
        const size = v.size || '';
        if (!colors.some(c => c.key === color)) colors.push({ key: color, code: v.color_code || null });
        if (!sizes.includes(size)) sizes.push(size);
    }
    const cells = variants.map(v => ({ id: v.id, color: v.color || '', size: v.size || '', sku: v.sku, stock: v.stock, sold: sold.get(`v:${v.id}`) || 0 }));
    const sum = (list, k) => list.reduce((t, c) => t + c[k], 0);
    return {
        product: { id: product.id, name: product.name, sku: product.sku, price: product.price, has_variants: !!product.has_variants },
        colors, sizes, cells,
        totals: {
            stock: variants.length ? sum(cells, 'stock') : Number(product.stock_quantity) || 0,
            sold: variants.length ? sum(cells, 'sold') : sold.get(`p:${product.id}`) || 0,
            bySize: sizes.map(size => ({ size, stock: sum(cells.filter(c => c.size === size), 'stock'), sold: sum(cells.filter(c => c.size === size), 'sold') })),
            byColor: colors.map(color => ({ color: color.key, stock: sum(cells.filter(c => c.color === color.key), 'stock'), sold: sum(cells.filter(c => c.color === color.key), 'sold') })),
        },
    };
}

/** Articles with stock, there before `since`, that sold nothing (kept) since then. */
function dormantRows(api, since) {
    return api.all(`
        SELECT p.id AS product_id, p.name, ${PRODUCT_STOCK} AS stock,
               CASE WHEN COALESCE(p.has_variants, 0) = 1
                    THEN (SELECT COALESCE(SUM(v.stock_quantity * COALESCE(v.cost, p.cost, 0)), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_quantity > 0)
                    ELSE COALESCE(p.stock_quantity, 0) * COALESCE(p.cost, 0) END AS cost_value,
               CASE WHEN COALESCE(p.has_variants, 0) = 1
                    THEN (SELECT COALESCE(SUM(v.stock_quantity * COALESCE(v.price, p.price, 0)), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_quantity > 0)
                    ELSE COALESCE(p.stock_quantity, 0) * COALESCE(p.price, 0) END AS retail_value,
               (SELECT MAX(s.created_at) FROM ${NET_SALE_ITEMS} si JOIN sales s ON s.id = si.sale_id
                WHERE si.product_id = p.id AND si.net_quantity > 0 AND ${countedSale('s')}) AS last_sale_at,
               p.created_at
        FROM products p
        WHERE p.is_active = 1 AND COALESCE(p.created_at, '2000-01-01 00:00:00') <= ?
          AND ${PRODUCT_STOCK} > 0
          AND NOT EXISTS (
            SELECT 1 FROM ${NET_SALE_ITEMS} si JOIN sales s ON s.id = si.sale_id
            WHERE si.product_id = p.id AND si.net_quantity > 0 AND s.created_at >= ? AND ${countedSale('s')})
        ORDER BY cost_value DESC, stock DESC, p.name
    `, [since, since]).map(r => ({ ...r, cost_value: r2(r.cost_value), retail_value: r2(r.retail_value) }));
}

/** 6. Dormant stock: no piece sold for `days` days (30, 60, 90...). */
function deadStock(api, { now = Date.now(), days = 60 } = {}) {
    const since = toDb(Number(now) - Math.max(1, Number(days) || 60) * DAY);
    const rows = dormantRows(api, since);
    return {
        days: Number(days) || 60,
        rows,
        total: {
            articles: rows.length,
            pieces: rows.reduce((t, r) => t + (Number(r.stock) || 0), 0),
            cost: r2(rows.reduce((t, r) => t + r.cost_value, 0)),
            retail: r2(rows.reduce((t, r) => t + r.retail_value, 0)),
        },
    };
}

/** 5. What the stock is worth: bought for, sold for, the profit in it, and the part asleep. */
function stockWorth(api, { now = Date.now(), dormantDays = 60 } = {}) {
    const lines = api.get(`
        SELECT
          COALESCE(SUM(CASE WHEN p.has_variants = 1 THEN v.stock_quantity * COALESCE(v.cost, p.cost, 0) END), 0)
            + (SELECT COALESCE(SUM(stock_quantity * COALESCE(cost, 0)), 0) FROM products WHERE is_active = 1 AND COALESCE(has_variants, 0) = 0 AND stock_quantity > 0) AS cost,
          COALESCE(SUM(CASE WHEN p.has_variants = 1 THEN v.stock_quantity * COALESCE(v.price, p.price, 0) END), 0)
            + (SELECT COALESCE(SUM(stock_quantity * COALESCE(price, 0)), 0) FROM products WHERE is_active = 1 AND COALESCE(has_variants, 0) = 0 AND stock_quantity > 0) AS retail,
          COALESCE(SUM(CASE WHEN p.has_variants = 1 THEN v.stock_quantity END), 0)
            + (SELECT COALESCE(SUM(stock_quantity), 0) FROM products WHERE is_active = 1 AND COALESCE(has_variants, 0) = 0 AND stock_quantity > 0) AS units
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock_quantity > 0
    `) || {};
    // Pieces in stock without a purchase price: the profit shown is then too high
    const noCost = api.get(`
        SELECT
          (SELECT COALESCE(SUM(v.stock_quantity), 0) FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE v.is_active = 1 AND p.is_active = 1 AND p.has_variants = 1 AND v.stock_quantity > 0 AND COALESCE(v.cost, p.cost, 0) <= 0)
          + (SELECT COALESCE(SUM(stock_quantity), 0) FROM products WHERE is_active = 1 AND COALESCE(has_variants, 0) = 0 AND stock_quantity > 0 AND COALESCE(cost, 0) <= 0) AS units
    `)?.units || 0;
    const dormant = deadStock(api, { now, days: dormantDays }).total;
    const cost = r2(lines.cost);
    const retail = r2(lines.retail);
    return {
        cost, retail, profit: r2(retail - cost), units: Number(lines.units) || 0, units_without_cost: Number(noCost) || 0,
        dormant: { days: dormantDays, cost: dormant.cost, retail: dormant.retail, pieces: dormant.pieces, articles: dormant.articles },
    };
}

/**
 * 7. A season (or collection) from start to end: what was bought, what sold,
 * what is left and what it earned. Per season / collection, from every sale.
 * - bought = pieces sold (kept) + pieces still in stock, at their purchase price
 * - sold = pieces kept, revenue without TVA (returns taken off), purchase cost
 *   of these pieces as saved on the ticket
 * - left = pieces in stock, at purchase and selling price
 * - profit = revenue - cost of the pieces sold
 * Products are listed with their stock so the end-of-season clearance can
 * take the articles that still have pieces.
 */
function seasonReport(api, { by = 'season' } = {}) {
    const field = by === 'collection' ? "NULLIF(TRIM(COALESCE(p.collection, '')), '')" : "NULLIF(TRIM(COALESCE(p.season, '')), '')";
    const products = api.all(`
        SELECT p.id, p.name, ${field} AS grp, ${PRODUCT_STOCK} AS stock,
               CASE WHEN COALESCE(p.has_variants, 0) = 1
                    THEN (SELECT COALESCE(SUM(v.stock_quantity * COALESCE(v.cost, p.cost, 0)), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_quantity > 0)
                    ELSE MAX(COALESCE(p.stock_quantity, 0), 0) * COALESCE(p.cost, 0) END AS stock_cost,
               CASE WHEN COALESCE(p.has_variants, 0) = 1
                    THEN (SELECT COALESCE(SUM(v.stock_quantity * COALESCE(v.price, p.price, 0)), 0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_quantity > 0)
                    ELSE MAX(COALESCE(p.stock_quantity, 0), 0) * COALESCE(p.price, 0) END AS stock_retail
        FROM products p
        WHERE p.is_active = 1 AND ${field} IS NOT NULL
    `);
    const sales = new Map(api.all(`
        SELECT si.product_id,
               SUM(si.net_quantity) AS sold,
               SUM(CASE WHEN si.quantity > 0 THEN (si.total - COALESCE(si.tax_amount, 0)) * si.net_quantity * 1.0 / si.quantity ELSE 0 END) AS revenue,
               SUM(COALESCE(si.unit_cost, 0) * si.net_quantity) AS cost
        FROM ${NET_SALE_ITEMS} si JOIN sales s ON s.id = si.sale_id
        WHERE ${countedSale('s')} AND si.product_id IS NOT NULL
        GROUP BY si.product_id
    `).map(r => [r.product_id, r]));
    const groups = new Map();
    for (const p of products) {
        const g = groups.get(p.grp) || {
            key: p.grp, articles: 0, bought: 0, bought_cost: 0, sold: 0, revenue: 0, sold_cost: 0,
            stock: 0, stock_cost: 0, stock_retail: 0, products: [],
        };
        const s = sales.get(p.id) || {};
        const stock = Math.max(0, Number(p.stock) || 0);
        const sold = Number(s.sold) || 0;
        g.articles += 1;
        g.sold += sold;
        g.revenue += Number(s.revenue) || 0;
        g.sold_cost += Number(s.cost) || 0;
        g.stock += stock;
        g.stock_cost += Number(p.stock_cost) || 0;
        g.stock_retail += Number(p.stock_retail) || 0;
        g.products.push({ id: p.id, name: p.name, stock, sold });
        groups.set(p.grp, g);
    }
    const rows = [...groups.values()].map(g => {
        const bought = g.sold + g.stock;
        return {
            key: g.key, articles: g.articles,
            bought, bought_cost: r2(g.sold_cost + g.stock_cost),
            sold: g.sold, revenue: r2(g.revenue), sold_cost: r2(g.sold_cost), profit: r2(g.revenue - g.sold_cost),
            stock: g.stock, stock_cost: r2(g.stock_cost), stock_retail: r2(g.stock_retail),
            rate: bought > 0 ? r2((g.sold / bought) * 100) : null,
            // What the clearance would take: articles still with pieces, the most stock first
            clearance: g.products.filter(p => p.stock > 0).sort((a, b) => b.stock - a.stock).map(p => p.id),
            products: g.products.sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name)),
        };
    }).sort((a, b) => b.bought - a.bought || String(a.key).localeCompare(String(b.key)));
    const sum = (k) => r2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));
    const bought = sum('bought');
    return {
        by: by === 'collection' ? 'collection' : 'season',
        rows,
        total: {
            articles: sum('articles'), bought, bought_cost: sum('bought_cost'), sold: sum('sold'), revenue: sum('revenue'),
            sold_cost: sum('sold_cost'), profit: sum('profit'), stock: sum('stock'), stock_cost: sum('stock_cost'), stock_retail: sum('stock_retail'),
            rate: bought > 0 ? r2((sum('sold') / bought) * 100) : null,
        },
    };
}

module.exports = { netSold, runOutSoon, sellThrough, productMatrix, deadStock, stockWorth, seasonReport };
