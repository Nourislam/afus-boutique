/**
 * What to order again: every colour / size (or simple article) at or under
 * its minimum stock, or that sold more in the last 30 days than is left.
 * The quantity proposed covers the next 30 days of sales (or twice the
 * minimum), less what is in stock. `api` is the { all, get } adapter.
 */
const { countedSale } = require('./saleStatus');

function reorderSuggestions(api, { since30 } = {}) {
    const since = since30 || new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    // Sold in 30 days, added up once per piece (not once per row)
    const sold = api.all(`
        SELECT si.product_id, si.variant_id, SUM(si.quantity) AS n
        FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
        WHERE ${countedSale('sa')} AND sa.created_at >= ?
        GROUP BY si.product_id, si.variant_id
    `, [since]);
    const soldByVariant = new Map();
    const soldByProduct = new Map();
    for (const r of sold) {
        if (r.variant_id) soldByVariant.set(r.variant_id, (soldByVariant.get(r.variant_id) || 0) + r.n);
        soldByProduct.set(r.product_id, (soldByProduct.get(r.product_id) || 0) + r.n);
    }
    const rows = api.all(`
        SELECT p.id AS product_id, p.name AS product_name, p.cost AS product_cost, p.min_stock_level AS min_stock,
               p.supplier_id, s.name AS supplier_name,
               v.id AS variant_id, v.color, v.color_code, v.size, v.sku AS variant_sku, v.cost AS variant_cost,
               COALESCE(v.stock_quantity, p.stock_quantity, 0) AS stock
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1 AND p.has_variants = 1
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.is_active = 1 AND (p.has_variants = 0 OR v.id IS NOT NULL)
    `).map(r => ({ ...r, sold30: (r.variant_id ? soldByVariant.get(r.variant_id) : soldByProduct.get(r.product_id)) || 0 }));
    return rows
        .filter(r => r.stock <= (Number(r.min_stock) || 0) || (r.sold30 > 0 && r.sold30 >= r.stock))
        .map(r => {
            const target = Math.max((Number(r.min_stock) || 0) * 2, Number(r.sold30) || 0, 1);
            const cost = r.variant_cost !== null && r.variant_cost !== undefined ? Number(r.variant_cost) : Number(r.product_cost) || 0;
            return { ...r, cost, quantity: Math.max(1, target - Math.max(0, r.stock)) };
        })
        .sort((a, b) => String(a.supplier_name || '~').localeCompare(String(b.supplier_name || '~')) || b.sold30 - a.sold30);
}

module.exports = { reorderSuggestions };
