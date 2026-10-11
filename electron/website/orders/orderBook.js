/**
 * The website's orders, kept in AFUS (SQLite) with their delivery status.
 * Cash on delivery: an order is not a sale while it is on its way.
 *
 *   new -> confirmed -> preparing -> shipped -> delivered -> money_received
 *   (cancelled at any step before the money is received)
 *
 * Only "money_received" is a completed sale: at that moment AFUS records
 * the order as ONE ordinary sale (lines, stock out, payment "cod"), in the
 * same transaction as the status. From then on the order counts in the
 * shop's figures (best sellers, reports) through that sale only, so it can
 * never be counted twice: the order itself is never counted, an order has
 * one sale at most (unique index), and money_received cannot be set again.
 * To undo it later, the sale is returned at the till like any sale.
 *
 *   importOrders(api, remote)      new orders from the website API (never
 *                                  changes an order already kept)
 *   listOrders(api, { limit })     newest first, with their lines
 *   setStatus(api, { id, status, employeeId, now })
 */
const catalog = require('../../services/catalogService');
const { nextReceiptNumber } = require('../../services/receiptNumber');

const STATUSES = ['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'money_received', 'cancelled'];
const COMPLETED = 'money_received';
const DELIVERY = ['home', 'office', 'pickup'];
const MAX_LINES = 30;

const text = (v, n) => String(v ?? '').slice(0, n);
const pad = (n) => String(n).padStart(2, '0');
/** SQLite's own time text (UTC), as CURRENT_TIMESTAMP writes it. */
const sqlTime = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

function linesOf(o) {
    let items = o.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
    if (Array.isArray(items) && items.length) return items.slice(0, MAX_LINES);
    // An order of one article (the article page's own form)
    return o.product_id ? [{ product_id: o.product_id, product_name: o.product_name, size: o.size, color: o.color, quantity: o.quantity, unit_price: null }] : [];
}

/** The orders the website API sent, added once each (by their id). Returns how many were new. */
function importOrders(api, remote = []) {
    let added = 0;
    api.transaction(() => {
        for (const o of remote) {
            const id = text(o.id, 40);
            if (!id || api.get('SELECT 1 AS x FROM website_orders WHERE id = ?', [id])) continue;
            const lines = linesOf(o).filter(i => i && i.product_id);
            if (!lines.length) continue;
            const at = new Date(o.created_at);
            // An order only: no sale and no stock movement until the money is received
            api.run(`INSERT INTO website_orders (id, received_at, customer_name, first_name, last_name, phone, wilaya, commune, address, delivery,
                                                 courier_company, office_wilaya, office_commune, courier_office, note, status, status_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`, [
                id, Number.isNaN(at.getTime()) ? sqlTime(new Date()) : sqlTime(at),
                text(o.customer_name, 80), text(o.first_name, 40), text(o.last_name, 40), text(o.phone, 20), text(o.wilaya, 60), text(o.commune, 60), text(o.address, 200),
                DELIVERY.includes(o.delivery) ? o.delivery : '',
                text(o.courier_company, 60), text(o.office_wilaya, 60), text(o.office_commune, 60), text(o.courier_office, 120),
                text(o.note, 500), sqlTime(new Date()),
            ]);
            lines.forEach((i, n) => {
                const price = Number(i.unit_price);
                api.run(`INSERT INTO website_order_items (order_id, line, product_id, product_name, size, color, quantity, unit_price)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                    id, n, text(i.product_id, 80), text(i.product_name, 160), text(i.size, 40), text(i.color, 40),
                    Math.min(20, Math.max(1, parseInt(i.quantity, 10) || 1)),
                    i.unit_price !== null && i.unit_price !== '' && i.unit_price !== undefined && Number.isFinite(price) && price >= 0 ? price : null,
                ]);
            });
            added++;
        }
    });
    return added;
}

/** Of these ids, the ones kept in SQLite (safe to remove from the website's waiting room). */
function knownIds(api, ids) {
    const list = [...new Set(ids.map(String))].filter(Boolean);
    if (!list.length) return [];
    return api.all(`SELECT id FROM website_orders WHERE id IN (${list.map(() => '?').join(',')})`, list).map(r => r.id);
}

function listOrders(api, { limit = 200, id = null } = {}) {
    const orders = api.all(`
        SELECT o.*, s.receipt_number FROM website_orders o LEFT JOIN sales s ON s.id = o.sale_id
        ${id ? 'WHERE o.id = ?' : ''}
        ORDER BY julianday(o.received_at) DESC, o.id LIMIT ?`, id ? [id, limit] : [limit]);
    const items = orders.length
        ? api.all(`SELECT * FROM website_order_items WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY order_id, line`, orders.map(o => o.id))
        : [];
    return orders.map(o => ({ ...o, items: items.filter(i => i.order_id === o.id) }));
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** One line of the order as an AFUS sale line: the article and its colour / size, as they are now. */
function saleLine(api, item, codedError) {
    const product = api.get('SELECT id, name, price, cost, has_variants FROM products WHERE id = ?', [item.product_id]);
    if (!product) throw codedError('WEBSITE_ORDER_ITEM_GONE', { product: item.product_name || item.product_id });
    let variant = null;
    if (product.has_variants) {
        variant = api.all('SELECT * FROM product_variants WHERE product_id = ? AND COALESCE(is_active, 1) = 1', [product.id])
            .find(v => same(v.color, item.color) && same(v.size, item.size));
        if (!variant) throw codedError('WEBSITE_ORDER_ITEM_GONE', { product: [item.product_name || product.name, item.color, item.size].filter(Boolean).join(' ') });
    }
    const listed = variant && variant.price !== null && variant.price !== undefined ? variant.price : product.price;
    const unitPrice = item.unit_price !== null && item.unit_price !== undefined ? Number(item.unit_price) : Number(listed) || 0;
    const unitCost = variant && variant.cost !== null && variant.cost !== undefined ? variant.cost : (product.cost || 0);
    return { product, variant, quantity: item.quantity, unitPrice, unitCost, total: Math.round(unitPrice * item.quantity * 100) / 100 };
}

/** The order becomes one completed AFUS sale (inside the caller's transaction). */
function recordSale(api, order, { employeeId, now, codedError }) {
    const lines = api.all('SELECT * FROM website_order_items WHERE order_id = ? ORDER BY line', [order.id]).map(i => saleLine(api, i, codedError));
    if (!lines.length) throw codedError('WEBSITE_ORDER_EMPTY', {});
    const saleId = api.uuid();
    const receipt = nextReceiptNumber(api, now);
    const total = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
    api.run(`INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, tax_amount, discount_amount, total, status, notes, created_at)
             VALUES (?, ?, ?, NULL, ?, 0, 0, ?, 'completed', ?, ?)`, [saleId, receipt, employeeId || null, total, total, `website:${order.id}`, sqlTime(now)]);
    for (const l of lines) {
        api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, variant_label, sku, product_name, quantity, unit_price, discount, tax_amount, total, unit_cost)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`, [
            api.uuid(), saleId, l.product.id, l.variant ? l.variant.id : null, l.variant ? catalog.variantLabel(l.variant) : null,
            l.variant ? l.variant.sku : null, l.product.name, l.quantity, l.unitPrice, l.total, l.unitCost,
        ]);
        // The pieces left with the delivery: out of stock now (as at the till)
        catalog.adjustStock(api, {
            productId: l.product.id, variantId: l.variant ? l.variant.id : null, delta: -l.quantity,
            type: 'sale', reason: `Website order (Sale #${receipt})`, employeeId: employeeId || null,
        });
    }
    api.run('INSERT INTO payments (id, sale_id, method, amount, reference) VALUES (?, ?, ?, ?, ?)', [api.uuid(), saleId, 'cod', total, `website:${order.id}`]);
    return { saleId, receipt, total };
}

/**
 * Change an order's status. "money_received" records its sale (once);
 * after it nothing changes. Returns the order as listOrders shows it.
 */
function setStatus(api, { id, status, employeeId = null, now = new Date(), codedError }) {
    if (!STATUSES.includes(status)) throw codedError('WEBSITE_ORDER_STATUS', {});
    let sale = null;
    api.transaction(() => {
        const order = api.get('SELECT * FROM website_orders WHERE id = ?', [String(id || '')]);
        if (!order) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        // Money received is final: the sale exists (undo = a return at the till)
        if (order.status === COMPLETED || order.sale_id) throw codedError('WEBSITE_ORDER_FINAL', {});
        if (status === order.status) return;
        if (status === COMPLETED) {
            if (order.status === 'cancelled') throw codedError('WEBSITE_ORDER_CANCELLED', {});
            sale = recordSale(api, order, { employeeId, now, codedError });
            api.run('UPDATE website_orders SET status = ?, status_at = ?, sale_id = ?, money_received_at = ?, employee_id = ? WHERE id = ? AND sale_id IS NULL',
                [COMPLETED, sqlTime(now), sale.saleId, sqlTime(now), employeeId, order.id]);
        } else {
            api.run('UPDATE website_orders SET status = ?, status_at = ?, employee_id = ? WHERE id = ?', [status, sqlTime(now), employeeId, order.id]);
        }
    });
    return { order: listOrders(api, { id: String(id) })[0], sale };
}

module.exports = { STATUSES, COMPLETED, importOrders, knownIds, listOrders, setStatus, sqlTime };
