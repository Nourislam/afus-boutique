/**
 * Stock count (inventaire / جرد): the shop scans or types what is really on
 * the shelves, sees the difference with the program, and only changes the
 * stock when the count is confirmed (with a reason). While counting, nothing
 * is touched; a cancelled count changes nothing either.
 *
 * Only the pieces counted are corrected: a piece of the section that was not
 * scanned keeps its stock and is listed as "not counted" in the report.
 * `api` is the { all, get, run, transaction, uuid } database adapter.
 */
const catalog = require('./catalogService');

const err = (code, params = {}) => catalog.codedError(code, params);

function getCount(api, countId) {
    const count = api.get(`
        SELECT sc.*, c.name AS category_name, e.name AS employee_name
        FROM stock_counts sc
        LEFT JOIN categories c ON c.id = sc.category_id
        LEFT JOIN employees e ON e.id = sc.employee_id
        WHERE sc.id = ?
    `, [countId]);
    if (!count) throw err('COUNT_NOT_FOUND');
    return count;
}

function openCountOrThrow(api, countId) {
    const count = getCount(api, countId);
    if (count.status !== 'open') throw err('COUNT_CLOSED');
    return count;
}

/** The count in progress, if any (one at a time, so two people never count apart). */
function currentCount(api) {
    const row = api.get("SELECT id FROM stock_counts WHERE status = 'open' ORDER BY created_at DESC LIMIT 1");
    return row ? getCount(api, row.id) : null;
}

/** Start counting the whole shop (categoryId null) or one section. */
function startCount(api, { categoryId = null, employeeId = null, note = null } = {}) {
    const open = currentCount(api);
    if (open) throw err('COUNT_ALREADY_OPEN');
    if (categoryId && !api.get('SELECT id FROM categories WHERE id = ?', [categoryId])) throw err('COUNT_NOT_FOUND');
    const id = api.uuid();
    api.run(`INSERT INTO stock_counts (id, status, category_id, employee_id, note, created_at)
             VALUES (?, 'open', ?, ?, ?, ?)`, [id, categoryId, employeeId, note, new Date().toISOString()]);
    return getCount(api, id);
}

const CURRENT_STOCK = `CASE WHEN l.variant_id IS NOT NULL
    THEN (SELECT v.stock_quantity FROM product_variants v WHERE v.id = l.variant_id)
    ELSE (SELECT p2.stock_quantity FROM products p2 WHERE p2.id = l.product_id) END`;

/** Lines of the count: counted, stock in the program now (or when confirmed), difference. */
function countLines(api, countId) {
    const count = getCount(api, countId);
    const rows = api.all(`
        SELECT l.*, p.name AS product_name, p.cost AS product_cost,
               v.color, v.size, v.sku AS variant_sku, v.cost AS variant_cost, p.sku AS product_sku,
               ${CURRENT_STOCK} AS current_stock
        FROM stock_count_lines l
        JOIN products p ON p.id = l.product_id
        LEFT JOIN product_variants v ON v.id = l.variant_id
        WHERE l.count_id = ?
        ORDER BY p.name, v.sort_order, v.color, v.size
    `, [countId]);
    return rows.map(r => {
        const expected = count.status === 'confirmed' ? Number(r.expected) || 0 : Number(r.current_stock) || 0;
        const counted = Number(r.counted) || 0;
        const cost = r.variant_cost !== null && r.variant_cost !== undefined ? Number(r.variant_cost) : Number(r.product_cost) || 0;
        return {
            id: r.id, product_id: r.product_id, variant_id: r.variant_id,
            product_name: r.product_name, color: r.color, size: r.size, sku: r.variant_sku || r.product_sku || null,
            expected, counted, difference: counted - expected, cost,
        };
    });
}

function findLine(api, countId, productId, variantId) {
    return variantId
        ? api.get('SELECT * FROM stock_count_lines WHERE count_id = ? AND variant_id = ?', [countId, variantId])
        : api.get('SELECT * FROM stock_count_lines WHERE count_id = ? AND product_id = ? AND variant_id IS NULL', [countId, productId]);
}

/** One scan = one piece more (the same code scanned twice = 2 pieces). */
function scan(api, countId, code, quantity = 1) {
    const count = openCountOrThrow(api, countId);
    const found = catalog.lookupCode(api, code);
    if (!found) throw err('COUNT_CODE_UNKNOWN', { code: String(code || '').trim() });
    if (found.needsVariant) throw err('COUNT_NEEDS_VARIANT', { product: found.product.name });
    if (count.category_id && found.product.category_id !== count.category_id) {
        throw err('COUNT_OUT_OF_SCOPE', { product: found.product.name, category: count.category_name || '' });
    }
    const productId = found.product.id;
    const variantId = found.type === 'variant' ? found.variant.id : null;
    const add = Math.max(1, parseInt(quantity, 10) || 1);
    const line = findLine(api, countId, productId, variantId);
    if (line) {
        api.run('UPDATE stock_count_lines SET counted = counted + ?, updated_at = ? WHERE id = ?', [add, new Date().toISOString(), line.id]);
    } else {
        api.run(`INSERT INTO stock_count_lines (id, count_id, product_id, variant_id, counted, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`, [api.uuid(), countId, productId, variantId, add, new Date().toISOString()]);
    }
    const id = findLine(api, countId, productId, variantId).id;
    return countLines(api, countId).find(l => l.id === id);
}

/** Type the number found for a line (0 is allowed: none on the shelf). */
function setCounted(api, countId, lineId, counted) {
    openCountOrThrow(api, countId);
    const value = parseInt(counted, 10);
    if (!Number.isInteger(value) || value < 0) throw err('COUNT_QUANTITY');
    api.run('UPDATE stock_count_lines SET counted = ?, updated_at = ? WHERE id = ? AND count_id = ?', [value, new Date().toISOString(), lineId, countId]);
    return countLines(api, countId).find(l => l.id === lineId) || null;
}

function removeLine(api, countId, lineId) {
    openCountOrThrow(api, countId);
    api.run('DELETE FROM stock_count_lines WHERE id = ? AND count_id = ?', [lineId, countId]);
    return true;
}

function cancelCount(api, countId) {
    openCountOrThrow(api, countId);
    api.run("UPDATE stock_counts SET status = 'cancelled', cancelled_at = ? WHERE id = ?", [new Date().toISOString(), countId]);
    return getCount(api, countId);
}

/** Pieces of the counted section never scanned (their stock is kept). */
function notCounted(api, countId) {
    const count = getCount(api, countId);
    const scope = count.category_id ? 'AND p.category_id = ?' : '';
    const params = count.category_id ? [countId, count.category_id] : [countId];
    const variants = api.get(`
        SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND p.has_variants = 1 ${scope}
          AND NOT EXISTS (SELECT 1 FROM stock_count_lines l WHERE l.count_id = ? AND l.variant_id = v.id)
    `, count.category_id ? [count.category_id, countId] : [countId]).n;
    const products = api.get(`
        SELECT COUNT(*) AS n FROM products p
        WHERE p.is_active = 1 AND COALESCE(p.has_variants, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM stock_count_lines l WHERE l.count_id = ? AND l.product_id = p.id AND l.variant_id IS NULL) ${scope}
    `, params).n;
    return variants + products;
}

/** Totals for the screen and the report. */
function summary(api, countId) {
    const lines = countLines(api, countId);
    const short = lines.filter(l => l.difference < 0);
    const over = lines.filter(l => l.difference > 0);
    const round = (n) => Math.round(n * 100) / 100;
    return {
        count: getCount(api, countId),
        lines,
        counted_lines: lines.length,
        pieces_counted: lines.reduce((s, l) => s + l.counted, 0),
        shortage_pieces: short.reduce((s, l) => s - l.difference, 0),
        surplus_pieces: over.reduce((s, l) => s + l.difference, 0),
        shortage_value: round(short.reduce((s, l) => s - l.difference * l.cost, 0)),
        surplus_value: round(over.reduce((s, l) => s + l.difference * l.cost, 0)),
        unchanged: lines.filter(l => l.difference === 0).length,
        not_counted: notCounted(api, countId),
    };
}

/** Apply the differences (call inside a transaction). A reason is required. */
function confirmCount(api, countId, { reason, employeeId = null } = {}) {
    openCountOrThrow(api, countId);
    const why = String(reason || '').trim();
    if (!why) throw err('COUNT_REASON_REQUIRED');
    for (const line of countLines(api, countId)) {
        // Difference with the stock at this moment (sales made while counting are taken into account)
        if (line.difference !== 0) {
            catalog.adjustStock(api, {
                productId: line.product_id, variantId: line.variant_id, delta: line.difference,
                type: 'count', reason: `Stock count: ${why}`, employeeId,
            });
        }
        api.run('UPDATE stock_count_lines SET expected = ?, difference = ? WHERE id = ?', [line.expected, line.difference, line.id]);
    }
    api.run("UPDATE stock_counts SET status = 'confirmed', reason = ?, confirmed_at = ?, confirmed_by = ? WHERE id = ?",
        [why, new Date().toISOString(), employeeId, countId]);
    return summary(api, countId);
}

/** Past counts, newest first. */
function listCounts(api, limit = 20) {
    return api.all(`
        SELECT sc.*, c.name AS category_name, e.name AS employee_name,
               (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = sc.id) AS lines,
               (SELECT COALESCE(SUM(l.difference), 0) FROM stock_count_lines l WHERE l.count_id = sc.id) AS difference
        FROM stock_counts sc
        LEFT JOIN categories c ON c.id = sc.category_id
        LEFT JOIN employees e ON e.id = sc.employee_id
        ORDER BY sc.created_at DESC LIMIT ?
    `, [limit]);
}

module.exports = { currentCount, startCount, scan, setCounted, removeLine, cancelCount, confirmCount, summary, countLines, listCounts, getCount };
