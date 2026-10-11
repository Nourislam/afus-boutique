/**
 * The shop's "New products" and "Best sellers", by AFUS's rules (one place,
 * read only; used by the website and anything else that shows them).
 *
 * NEW PRODUCTS: the articles added to the AFUS database during the last 7
 * days (products.created_at), however they were added (product form, Excel
 * import, ...). Active articles only. Not related to sales.
 *
 * BEST SELLERS: the pieces sold by the whole shop during the last 7 days,
 * from completed sales only (saleStatus.completedSale): the till's sales and
 * the website orders whose money was received (each of those is recorded
 * as one AFUS sale at that moment: website/orders/orderBook.js). A website
 * order before "money received" (new, confirmed, preparing, shipped,
 * delivered) is not a sale and is not counted. Every sale line counts once,
 * minus the pieces returned against it (several returns add up, never
 * below 0), so nothing is counted twice.
 *
 * Dates: SQLite keeps UTC text ('YYYY-MM-DD HH:MM:SS'); the window is the
 * 7 x 24 hours before `now`.
 */
const { completedSale } = require('./saleStatus');

const DAYS = 7;
const DAY_MS = 86400000;
const since = (now, days) => new Date(new Date(now).getTime() - days * DAY_MS).toISOString();

/** [{ id, createdAt }] newest first. */
function newProducts(api, { now = Date.now(), days = DAYS, limit = 200 } = {}) {
    return api.all(`
        SELECT id, created_at AS createdAt FROM products
        WHERE COALESCE(is_active, 1) = 1 AND created_at IS NOT NULL
          AND julianday(created_at) >= julianday(?) AND julianday(created_at) <= julianday(?)
        ORDER BY julianday(created_at) DESC, id
        LIMIT ?`, [since(now, days), new Date(now).toISOString(), limit]).map(r => ({ id: String(r.id), createdAt: r.createdAt }));
}

/** [{ id, sold }] most pieces first (ties: the article sold last, then id). */
function bestSellers(api, { now = Date.now(), days = DAYS, limit = 24 } = {}) {
    return api.all(`
        SELECT si.product_id AS id, SUM(MAX(si.quantity - COALESCE(r.returned, 0), 0)) AS sold, MAX(julianday(s.created_at)) AS last
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN (
            SELECT sale_item_id, SUM(quantity) AS returned FROM return_items
            WHERE sale_item_id IS NOT NULL GROUP BY sale_item_id
        ) r ON r.sale_item_id = si.id
        WHERE si.product_id IS NOT NULL AND ${completedSale('s')}
          AND julianday(s.created_at) >= julianday(?) AND julianday(s.created_at) <= julianday(?)
        GROUP BY si.product_id
        HAVING sold > 0
        ORDER BY sold DESC, last DESC, si.product_id
        LIMIT ?`, [since(now, days), new Date(now).toISOString(), limit]).map(r => ({ id: String(r.id), sold: Number(r.sold) }));
}

module.exports = { newProducts, bestSellers, DAYS };
