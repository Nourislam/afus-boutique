/**
 * The website's orders, kept in AFUS (SQLite) with their delivery status.
 * Cash on delivery: an order is not a sale while it is on its way.
 *
 *   new -> contacted -> confirmed -> preparing -> shipped -> delivered -> money_received
 *
 * Only the steps of NEXT can be taken (a step can be skipped forward, a
 * click by mistake set one step back); the money is received only once the
 * parcel left (shipped or delivered); the parcel cannot be cancelled once
 * it left (it is Returned when it comes back). Cancelled and Returned are
 * never a sale; they are set back to New to take the order again (a
 * returned parcel only once it was checked).
 *
 * The customer is recognised by the phone number (phone.js): every order of
 * one phone makes their history (customerStats / customerHistory). AFUS
 * only: none of it is published.
 *
 * Stock (as the till's reservations, services/reservationService.js):
 *   confirmed, preparing, shipped, delivered: the pieces are PUT ASIDE (out
 *     of the stock that can be sold, inventory log "website_reserve"), not
 *     sold: no sale, no figure counts them;
 *   back to new / contacted, cancelled: they come back in stock;
 *   returned: the parcel is on its way back: the pieces stay out until the
 *     shop has them in hand and checks them (checkReturn): the sellable ones
 *     go back in stock ("website_return"), the damaged ones stay out, as a
 *     damaged piece brought back at the till (returnService.js);
 *   money received: they are released and the sale takes them out (the
 *     same pieces, once: the stock does not move at that moment).
 * Before it is confirmed nothing moves (an order alone never touches stock).
 *
 * Only "money_received" is a completed sale: at that moment AFUS records
 * the order as ONE ordinary sale (lines, stock out, payment "cod"), in the
 * same transaction as the status. From then on the order counts in the
 * shop's figures (revenue, reports, dashboard, best sellers, the
 * customer's purchases) through that sale only, so it can never be counted
 * twice: the order itself is never counted, an order has one sale at most
 * (unique index), and money_received cannot be set again (a second click
 * changes nothing). To undo it later, the sale is returned at the till like
 * any sale.
 *
 *   importOrders(api, remote)      new orders from the website API (never
 *                                  changes an order already kept)
 *   listOrders(api, { limit })     newest first, with their lines
 *   setStatus(api, { id, status, employeeId, now })
 *   nextStatuses(order)            the steps it can take now
 *   checkReturn(api, { id, lines })  the returned parcel in hand, piece by piece
 *   updateDetails(api, { id, details, ... })   what the customer confirmed on
 *                                              the phone (lines, place, delivery)
 *   customerStats(api, { phones?, search?, limit? })   per phone
 *   customerHistory(api, phone)                        one customer
 */
const catalog = require('../../services/catalogService');
const { phoneKey } = require('./phone');
const { isPromotionLive, promotionDiscount } = require('../../shared/promotions.mjs');
const { nextReceiptNumber } = require('../../services/receiptNumber');

const STATUSES = ['new', 'contacted', 'confirmed', 'preparing', 'shipped', 'delivered', 'money_received', 'returned', 'cancelled'];
const COMPLETED = 'money_received';
// Orders that stopped: never paid from there (set back to New first)
const STOPPED = ['cancelled', 'returned'];
// The pieces are put aside while the order is in one of these
const RESERVING = ['confirmed', 'preparing', 'shipped', 'delivered'];
// What the customer confirmed can still change (not on its way yet)
const EDITABLE = ['new', 'contacted', 'confirmed', 'preparing'];
const RELEASE_TYPE = { cancelled: 'website_cancel', money_received: 'website_release' };
// The steps an order can take from each status: forward (a step may be
// skipped), one back after a click by mistake; paid only once it left
const NEXT = {
    new: ['contacted', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'],
    contacted: ['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'],
    confirmed: ['new', 'contacted', 'preparing', 'shipped', 'delivered', 'cancelled'],
    preparing: ['new', 'contacted', 'confirmed', 'shipped', 'delivered', 'cancelled'],
    // On its way: paid, or the parcel comes back (never cancelled: the pieces are out of the shop)
    shipped: ['preparing', 'delivered', 'money_received', 'returned'],
    delivered: ['shipped', 'money_received', 'returned'],
    money_received: [],
    returned: ['new'],
    cancelled: ['new'],
};
// A status kept by an older AFUS and no longer known: back to New or cancelled
const NEXT_UNKNOWN = ['new', 'cancelled'];
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

/**
 * The discount of a coupon typed on the website, worked out again here by the
 * till's own rule (a live promotion with that code, its articles or
 * categories, its minimum, its cap): 0 when the code gives nothing now.
 */
function couponDiscount(api, code, lines) {
    const typed = String(code || '').trim().toLowerCase();
    if (!typed) return 0;
    const promo = api.all("SELECT * FROM promotions WHERE coupon_code IS NOT NULL AND TRIM(coupon_code) <> ''")
        .find(p => p.coupon_code.trim().toLowerCase() === typed && isPromotionLive(p));
    if (!promo) return 0;
    const items = lines.map(i => ({
        product_id: i.product_id, quantity: i.quantity, unit_price: Number(i.unit_price) || 0,
        category_id: api.get('SELECT category_id FROM products WHERE id = ?', [i.product_id])?.category_id || null,
    }));
    return promotionDiscount(promo, items);
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
            const number = nextOrderNumber(api);
            // An order only: no sale and no stock movement until the money is received
            const receivedAt = Number.isNaN(at.getTime()) ? sqlTime(new Date()) : sqlTime(at);
            // Delivery price worked out by the website's API from the shop's prices; coupon checked again here
            const deliveryFee = Number.isFinite(Number(o.delivery_fee)) && o.delivery_fee !== null && o.delivery_fee !== '' && Number(o.delivery_fee) >= 0 ? Math.round(Number(o.delivery_fee)) : null;
            const coupon = text(o.coupon_code, 30).trim().toUpperCase();
            const discount = coupon ? couponDiscount(api, coupon, lines.map(i => ({ ...i, quantity: Math.min(20, Math.max(1, parseInt(i.quantity, 10) || 1)) }))) : 0;
            api.run(`INSERT INTO website_orders (id, number, received_at, customer_name, first_name, last_name, phone, phone_key, wilaya, commune, address, delivery,
                                                 courier_company, office_wilaya, office_commune, courier_office, note, status, status_at, delivery_fee, coupon_code, coupon_discount)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`, [
                id, number, receivedAt,
                text(o.customer_name, 80), text(o.first_name, 40), text(o.last_name, 40), text(o.phone, 20), phoneKey(o.phone), text(o.wilaya, 60), text(o.commune, 60), text(o.address, 200),
                DELIVERY.includes(o.delivery) ? o.delivery : '',
                text(o.courier_company, 60), text(o.office_wilaya, 60), text(o.office_commune, 60), text(o.courier_office, 120),
                text(o.note, 500), sqlTime(new Date()), deliveryFee, coupon, discount,
            ]);
            api.run("INSERT INTO website_order_events (order_id, status, at) VALUES (?, 'new', ?)", [id, receivedAt]);
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

/** The next order number (W-000001, W-000002, ...): on the shipping label and on the phone. */
function nextOrderNumber(api) {
    const last = api.get("SELECT MAX(CAST(SUBSTR(number, 3) AS INTEGER)) AS n FROM website_orders WHERE number LIKE 'W-%'")?.n || 0;
    return `W-${String(last + 1).padStart(6, '0')}`;
}

/** Of these ids, the ones kept in SQLite (safe to remove from the website's waiting room). */
function knownIds(api, ids) {
    const list = [...new Set(ids.map(String))].filter(Boolean);
    if (!list.length) return [];
    return api.all(`SELECT id FROM website_orders WHERE id IN (${list.map(() => '?').join(',')})`, list).map(r => r.id);
}

function listOrders(api, { limit = 200, id = null, status = null } = {}) {
    const where = [];
    const params = [];
    if (id) { where.push('o.id = ?'); params.push(id); }
    if (status && STATUSES.includes(status)) { where.push('o.status = ?'); params.push(status); }
    const orders = api.all(`
        SELECT o.*, s.receipt_number FROM website_orders o LEFT JOIN sales s ON s.id = o.sale_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY julianday(o.received_at) DESC, o.id LIMIT ?`, [...params, limit]);
    const items = orders.length
        ? api.all(`SELECT * FROM website_order_items WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY order_id, line`, orders.map(o => o.id))
        : [];
    return orders.map(o => ({ ...o, items: items.filter(i => i.order_id === o.id) }));
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** One line of the order as an AFUS sale line: the article and its colour / size, as they are now. */
/** The article of a line and its colour / size, as they are now (the variant put aside first). */
function articleOf(api, item, codedError) {
    const product = api.get('SELECT id, name, price, cost, has_variants, stock_quantity FROM products WHERE id = ?', [item.product_id]);
    if (!product) throw codedError('WEBSITE_ORDER_ITEM_GONE', { product: item.product_name || item.product_id });
    let variant = null;
    if (product.has_variants) {
        variant = (item.variant_id && api.get('SELECT * FROM product_variants WHERE id = ? AND product_id = ?', [item.variant_id, product.id]))
            || api.all('SELECT * FROM product_variants WHERE product_id = ? AND COALESCE(is_active, 1) = 1', [product.id])
                .find(v => same(v.color, item.color) && same(v.size, item.size));
        if (!variant) throw codedError('WEBSITE_ORDER_ITEM_GONE', { product: [item.product_name || product.name, item.color, item.size].filter(Boolean).join(' ') });
    }
    return { product, variant };
}

function saleLine(api, item, codedError) {
    const { product, variant } = articleOf(api, item, codedError);
    const listed = variant && variant.price !== null && variant.price !== undefined ? variant.price : product.price;
    const unitPrice = item.unit_price !== null && item.unit_price !== undefined ? Number(item.unit_price) : Number(listed) || 0;
    const unitCost = variant && variant.cost !== null && variant.cost !== undefined ? variant.cost : (product.cost || 0);
    return { product, variant, quantity: item.quantity, unitPrice, unitCost, total: Math.round(unitPrice * item.quantity * 100) / 100 };
}

/** The order becomes one completed AFUS sale (inside the caller's transaction). */
function recordSale(api, order, { employeeId, now, codedError }) {
    // Never a second sale for one order (whatever the order row says)
    if (api.get('SELECT 1 AS x FROM sales WHERE notes = ? LIMIT 1', [`website:${order.id}`])) throw codedError('WEBSITE_ORDER_FINAL', {});
    const lines = api.all('SELECT * FROM website_order_items WHERE order_id = ? ORDER BY line', [order.id]).map(i => saleLine(api, i, codedError));
    if (!lines.length) throw codedError('WEBSITE_ORDER_EMPTY', {});
    const saleId = api.uuid();
    const receipt = nextReceiptNumber(api, now);
    const subtotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
    // The website coupon (checked when the order came in): a discount on the ticket, never more than the goods
    const discount = Math.min(subtotal, Math.max(0, Number(order.coupon_discount) || 0));
    const total = Math.round((subtotal - discount) * 100) / 100;
    api.run(`INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, tax_amount, discount_amount, total, status, notes, created_at)
             VALUES (?, ?, ?, NULL, ?, 0, ?, ?, 'completed', ?, ?)`, [saleId, receipt, employeeId || null, subtotal, discount, total, `website:${order.id}`, sqlTime(now)]);
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
 * Put the order's pieces aside (inside the caller's transaction). Not more
 * than the stock that can be sold (what other orders and reservations put
 * aside is already out of it). Each line remembers its variant and how many
 * were put aside, so exactly those come back.
 */
function reserve(api, order, { employeeId, codedError }) {
    const lines = api.all('SELECT * FROM website_order_items WHERE order_id = ? ORDER BY line', [order.id]);
    if (!lines.length) throw codedError('WEBSITE_ORDER_EMPTY', {});
    for (const item of lines) {
        const { product, variant } = articleOf(api, item, codedError);
        // Read now: two lines of the same piece add up
        const available = variant ? (api.get('SELECT stock_quantity AS n FROM product_variants WHERE id = ?', [variant.id]).n || 0)
            : (api.get('SELECT stock_quantity AS n FROM products WHERE id = ?', [product.id]).n || 0);
        if (item.quantity > available) {
            throw codedError('STOCK_INSUFFICIENT', { product: variant ? `${product.name} (${catalog.variantLabel(variant)})` : product.name, available });
        }
        catalog.adjustStock(api, {
            productId: product.id, variantId: variant ? variant.id : null, delta: -item.quantity,
            type: 'website_reserve', reason: `Website order ${order.number || order.id}`, employeeId: employeeId || null,
        });
        api.run('UPDATE website_order_items SET variant_id = ?, reserved_qty = ? WHERE order_id = ? AND line = ?', [variant ? variant.id : null, item.quantity, order.id, item.line]);
    }
    api.run('UPDATE website_orders SET reserved = 1 WHERE id = ?', [order.id]);
}

/** The pieces put aside come back in the stock that can be sold. */
function release(api, order, type, employeeId) {
    for (const item of api.all('SELECT * FROM website_order_items WHERE order_id = ? AND reserved_qty > 0 ORDER BY line', [order.id])) {
        const still = item.variant_id
            ? api.get('SELECT id FROM product_variants WHERE id = ?', [item.variant_id])
            : api.get('SELECT id FROM products WHERE id = ?', [item.product_id]);
        // An article removed from the database meanwhile: nothing to put back
        if (still) {
            catalog.adjustStock(api, {
                productId: item.product_id, variantId: item.variant_id || null, delta: item.reserved_qty,
                type, reason: `Website order ${order.number || order.id}`, employeeId: employeeId || null,
            });
        }
        api.run('UPDATE website_order_items SET reserved_qty = 0 WHERE order_id = ? AND line = ?', [order.id, item.line]);
    }
    api.run('UPDATE website_orders SET reserved = 0 WHERE id = ?', [order.id]);
}

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/**
 * What the customer confirmed on the phone: each line's size, colour,
 * quantity and price (a line left out is removed; at least one stays), the
 * wilaya, commune, and the address or the courier office. Only before the
 * order is on its way. Pieces already put aside follow the change (back in
 * stock, then put aside again as confirmed), all at once.
 * details: { lines: [{ line, size, color, quantity, unit_price }], wilaya, commune,
 *            delivery: 'home'|'office', address, courier_company, office_wilaya, office_commune, courier_office }
 */
function updateDetails(api, { id, details = {}, employeeId = null, now = new Date(), codedError }) {
    api.transaction(() => {
        const order = api.get('SELECT * FROM website_orders WHERE id = ?', [String(id || '')]);
        if (!order) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        if (!EDITABLE.includes(order.status) || order.sale_id) throw codedError('WEBSITE_ORDER_LOCKED', {});
        const current = api.all('SELECT * FROM website_order_items WHERE order_id = ? ORDER BY line', [order.id]);
        const wanted = Array.isArray(details.lines) ? details.lines : current.map(l => ({ line: l.line }));
        const lines = [];
        for (const w of wanted) {
            const base = current.find(l => l.line === Number(w.line));
            if (!base) throw codedError('WEBSITE_ORDER_DETAILS', { field: 'line' });
            const quantity = w.quantity === undefined ? base.quantity : num(w.quantity);
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw codedError('WEBSITE_ORDER_DETAILS', { field: 'quantity' });
            const price = w.unit_price === undefined ? base.unit_price : num(w.unit_price);
            if (price !== null && (!Number.isFinite(price) || price < 0 || price >= 1e9)) throw codedError('WEBSITE_ORDER_DETAILS', { field: 'price' });
            const next = { ...base, size: w.size === undefined ? base.size : text(w.size, 40), color: w.color === undefined ? base.color : text(w.color, 40), quantity, unit_price: price, variant_id: null };
            // The colour / size must exist for this article
            articleOf(api, next, codedError);
            lines.push(next);
        }
        if (!lines.length) throw codedError('WEBSITE_ORDER_EMPTY', {});
        const place = {
            wilaya: details.wilaya === undefined ? order.wilaya : text(details.wilaya, 60).trim(),
            commune: details.commune === undefined ? order.commune : text(details.commune, 60).trim(),
            delivery: details.delivery === undefined ? order.delivery : (DELIVERY.includes(details.delivery) ? details.delivery : ''),
            address: details.address === undefined ? order.address : text(details.address, 200).trim(),
            courier_company: details.courier_company === undefined ? order.courier_company : text(details.courier_company, 60).trim(),
            office_wilaya: details.office_wilaya === undefined ? order.office_wilaya : text(details.office_wilaya, 60).trim(),
            office_commune: details.office_commune === undefined ? order.office_commune : text(details.office_commune, 60).trim(),
            courier_office: details.courier_office === undefined ? order.courier_office : text(details.courier_office, 120).trim(),
        };
        if (!place.wilaya) throw codedError('WEBSITE_ORDER_DETAILS', { field: 'wilaya' });
        if (!place.commune) throw codedError('WEBSITE_ORDER_DETAILS', { field: 'commune' });
        if (place.delivery === 'home' && !place.address) throw codedError('WEBSITE_ORDER_DETAILS', { field: 'address' });
        if (place.delivery === 'office' && (!place.courier_company || !place.courier_office)) throw codedError('WEBSITE_ORDER_DETAILS', { field: 'office' });
        if (place.delivery !== 'office') Object.assign(place, { courier_company: '', office_wilaya: '', office_commune: '', courier_office: '' });

        const wasReserved = !!order.reserved;
        if (wasReserved) release(api, order, 'website_unreserve', employeeId);
        api.run('DELETE FROM website_order_items WHERE order_id = ?', [order.id]);
        lines.forEach((l, n) => api.run(`INSERT INTO website_order_items (order_id, line, product_id, product_name, size, color, quantity, unit_price)
                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [order.id, n, l.product_id, l.product_name, l.size, l.color, l.quantity, l.unit_price]));
        api.run(`UPDATE website_orders SET wilaya = ?, commune = ?, delivery = ?, address = ?, courier_company = ?, office_wilaya = ?, office_commune = ?, courier_office = ?
                 WHERE id = ?`, [place.wilaya, place.commune, place.delivery, place.address, place.courier_company, place.office_wilaya, place.office_commune, place.courier_office, order.id]);
        if (wasReserved) reserve(api, { ...order, reserved: 0 }, { employeeId, codedError });
        api.run("INSERT INTO website_order_events (order_id, status, at, employee_id) VALUES (?, 'edited', ?, ?)", [order.id, sqlTime(now), employeeId]);
    });
    return listOrders(api, { id: String(id) })[0];
}

/** The label went to the printer (or a PDF): kept with the order. */
function markLabelPrinted(api, { id, employeeId = null, now = new Date() }) {
    api.transaction(() => {
        api.run('UPDATE website_orders SET label_printed_at = ? WHERE id = ?', [sqlTime(now), String(id)]);
        api.run("INSERT INTO website_order_events (order_id, status, at, employee_id) VALUES (?, 'label_printed', ?, ?)", [String(id), sqlTime(now), employeeId]);
    });
}

/** Each line's price: the one confirmed or sent by the website, else the article's price now. */
function pricedLines(api, items) {
    return items.map(i => {
        if (i.unit_price !== null && i.unit_price !== undefined) return { ...i, price: Number(i.unit_price) };
        const v = i.variant_id ? api.get('SELECT price FROM product_variants WHERE id = ?', [i.variant_id]) : null;
        const p = api.get('SELECT price FROM products WHERE id = ?', [i.product_id]);
        const price = v && v.price !== null && v.price !== undefined ? v.price : p?.price;
        return { ...i, price: Number(price) || 0 };
    });
}

/** The call is done: the details the customer confirmed, then Confirmed (pieces put aside), at once. */
function confirmOrder(api, { id, details, employeeId = null, now = new Date(), codedError }) {
    let result;
    api.transaction(() => {
        updateDetails(api, { id, details, employeeId, now, codedError });
        result = setStatus(api, { id, status: 'confirmed', employeeId, now, codedError });
    });
    return result;
}

/** The parcel came back and its pieces are not checked yet (still out of stock). */
const returnPending = (order) => order.status === 'returned' && !!order.reserved;

/** The steps the order can take now (none once paid; a returned parcel is checked first). */
function nextStatuses(order) {
    if (!order || order.status === COMPLETED || order.sale_id || returnPending(order)) return [];
    return NEXT[order.status] || NEXT_UNKNOWN;
}

/**
 * Change an order's status (one of nextStatuses). "money_received" records
 * its sale (once); after it nothing changes. Returns the order as
 * listOrders shows it, and the sale when one was recorded.
 */
function setStatus(api, { id, status, employeeId = null, now = new Date(), codedError }) {
    if (!STATUSES.includes(status)) throw codedError('WEBSITE_ORDER_STATUS', {});
    let sale = null;
    api.transaction(() => {
        const order = api.get('SELECT * FROM website_orders WHERE id = ?', [String(id || '')]);
        if (!order) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        // Sent twice (a double click, two windows): the first one stands, nothing is done again
        if (status === order.status) return;
        // Money received is final: the sale exists (undo = a return at the till)
        if (order.status === COMPLETED || order.sale_id) throw codedError('WEBSITE_ORDER_FINAL', {});
        if (status === COMPLETED && STOPPED.includes(order.status)) throw codedError('WEBSITE_ORDER_CANCELLED', {});
        if (returnPending(order)) throw codedError('WEBSITE_RETURN_PENDING', {});
        if (!nextStatuses(order).includes(status)) throw codedError('WEBSITE_ORDER_STEP', { from: order.status, to: status });
        if (status === COMPLETED) {
            // The pieces put aside are released; the sale takes the same pieces out
            if (order.reserved) release(api, order, RELEASE_TYPE.money_received, employeeId);
            sale = recordSale(api, order, { employeeId, now, codedError });
            api.run('UPDATE website_orders SET status = ?, status_at = ?, sale_id = ?, money_received_at = ?, employee_id = ? WHERE id = ? AND sale_id IS NULL',
                [COMPLETED, sqlTime(now), sale.saleId, sqlTime(now), employeeId, order.id]);
        } else {
            // Confirmed (or further): put aside, only when it enters these steps (an
            // older order already on its way is not put aside after the fact)
            if (RESERVING.includes(status) && !order.reserved && !RESERVING.includes(order.status)) reserve(api, order, { employeeId, codedError });
            // Back before it or cancelled: back in stock. Returned: the pieces stay out until checked
            if (!RESERVING.includes(status) && status !== 'returned' && order.reserved) release(api, order, RELEASE_TYPE[status] || 'website_unreserve', employeeId);
            if (status === 'returned') {
                api.run('UPDATE website_orders SET return_checked_at = NULL WHERE id = ?', [order.id]);
                api.run('UPDATE website_order_items SET returned_sellable = 0, returned_damaged = 0 WHERE order_id = ?', [order.id]);
            }
            api.run('UPDATE website_orders SET status = ?, status_at = ?, employee_id = ? WHERE id = ?', [status, sqlTime(now), employeeId, order.id]);
        }
        api.run('INSERT INTO website_order_events (order_id, status, at, employee_id) VALUES (?, ?, ?, ?)', [order.id, status, sqlTime(now), employeeId]);
    });
    return { order: listOrders(api, { id: String(id) })[0], sale };
}

/**
 * The returned parcel is in the shop: each piece put aside is checked.
 * lines: [{ line, sellable, damaged }], for every line with pieces out;
 * sellable + damaged = the pieces of the line. The sellable ones go back in
 * the stock that can be sold (the exact colour / size), the damaged ones
 * stay out (as at the till). Once only: then the order can be set back to New.
 */
function checkReturn(api, { id, lines = [], employeeId = null, now = new Date(), codedError }) {
    api.transaction(() => {
        const order = api.get('SELECT * FROM website_orders WHERE id = ?', [String(id || '')]);
        if (!order) throw codedError('WEBSITE_ORDER_NOT_FOUND', {});
        if (!returnPending(order)) throw codedError('WEBSITE_RETURN_NONE', {});
        const items = api.all('SELECT * FROM website_order_items WHERE order_id = ? AND reserved_qty > 0 ORDER BY line', [order.id]);
        const given = Array.isArray(lines) ? lines : [];
        for (const g of given) {
            if (!items.some(i => i.line === Number(g?.line))) throw codedError('WEBSITE_ORDER_DETAILS', { field: 'line' });
        }
        // Everything is checked before anything moves
        const counted = items.map(item => {
            const g = given.find(x => Number(x?.line) === item.line) || {};
            const sellable = num(g.sellable ?? 0);
            const damaged = num(g.damaged ?? 0);
            const product = [item.product_name || item.product_id, item.color, item.size].filter(Boolean).join(' ');
            if (!Number.isInteger(sellable) || !Number.isInteger(damaged) || sellable < 0 || damaged < 0 || sellable + damaged !== item.reserved_qty) {
                throw codedError('WEBSITE_RETURN_CHECK', { product, pieces: item.reserved_qty });
            }
            return { item, sellable, damaged };
        });
        for (const { item, sellable, damaged } of counted) {
            const still = item.variant_id
                ? api.get('SELECT id FROM product_variants WHERE id = ?', [item.variant_id])
                : api.get('SELECT id FROM products WHERE id = ?', [item.product_id]);
            // An article removed from the database meanwhile: nothing to put back
            if (sellable > 0 && still) {
                catalog.adjustStock(api, {
                    productId: item.product_id, variantId: item.variant_id || null, delta: sellable,
                    type: 'website_return', reason: `Website order ${order.number || order.id}`, employeeId: employeeId || null,
                });
            }
            api.run('UPDATE website_order_items SET reserved_qty = 0, returned_sellable = ?, returned_damaged = ? WHERE order_id = ? AND line = ?',
                [sellable, damaged, order.id, item.line]);
        }
        api.run('UPDATE website_orders SET reserved = 0, return_checked_at = ? WHERE id = ?', [sqlTime(now), order.id]);
        api.run("INSERT INTO website_order_events (order_id, status, at, employee_id) VALUES (?, 'return_checked', ?, ?)", [order.id, sqlTime(now), employeeId]);
    });
    return listOrders(api, { id: String(id) })[0];
}

/**
 * Per customer (phone): orders, delivered (delivered or paid), returned,
 * cancelled, successful purchases (money received = a sale) and their
 * total (the sales' totals less what was refunded at the till since).
 */
function customerStats(api, { phones = null, search = '', limit = 200 } = {}) {
    const keys = phones ? [...new Set(phones.map(phoneKey).filter(Boolean))] : null;
    if (keys && !keys.length) return [];
    const where = ["o.phone_key <> ''"];
    const params = [];
    if (keys) { where.push(`o.phone_key IN (${keys.map(() => '?').join(',')})`); params.push(...keys); }
    const term = String(search || '').trim();
    if (term) {
        // A piece of a number, written any way (+213 770, 00213..., 0770...): its digits after the 0
        let digits = term.replace(/\D/g, '');
        if (digits.startsWith('00')) digits = digits.slice(2);
        digits = digits.startsWith('213') ? digits.slice(3) : digits.replace(/^0/, '');
        where.push(`(o.customer_name LIKE ?${digits.length >= 3 ? ' OR o.phone_key LIKE ?' : ''})`);
        params.push(`%${term}%`);
        if (digits.length >= 3) params.push(`%${digits}%`);
    }
    return api.all(`
        SELECT o.phone_key AS phone,
               (SELECT x.customer_name FROM website_orders x WHERE x.phone_key = o.phone_key ORDER BY julianday(x.received_at) DESC LIMIT 1) AS name,
               COUNT(*) AS orders,
               SUM(CASE WHEN o.status IN ('delivered', 'money_received') THEN 1 ELSE 0 END) AS delivered,
               SUM(CASE WHEN o.status = 'returned' THEN 1 ELSE 0 END) AS returned,
               SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
               SUM(CASE WHEN o.status = 'money_received' THEN 1 ELSE 0 END) AS successful,
               SUM(CASE WHEN o.status = 'money_received' THEN MAX(COALESCE(s.total, 0) - COALESCE(r.refund, 0), 0) ELSE 0 END) AS total,
               MAX(o.received_at) AS lastAt
        FROM website_orders o
        LEFT JOIN sales s ON s.id = o.sale_id
        LEFT JOIN (SELECT sale_id, SUM(total_refund) AS refund FROM returns GROUP BY sale_id) r ON r.sale_id = o.sale_id
        WHERE ${where.join(' AND ')}
        GROUP BY o.phone_key
        ORDER BY MAX(julianday(o.received_at)) DESC
        LIMIT ?`, [...params, limit]).map(r => ({ ...r, total: Math.round((Number(r.total) || 0) * 100) / 100 }));
}

/** One customer: their figures and every order (newest first) with its status history. */
function customerHistory(api, phone) {
    const key = phoneKey(phone);
    if (!key) return null;
    const stats = customerStats(api, { phones: [key] })[0];
    if (!stats) return null;
    const orders = api.all(`
        SELECT o.id FROM website_orders o WHERE o.phone_key = ? ORDER BY julianday(o.received_at) DESC LIMIT 200`, [key])
        .map(r => listOrders(api, { id: r.id })[0]);
    const events = orders.length
        ? api.all(`SELECT order_id, status, at FROM website_order_events WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY id`, orders.map(o => o.id))
        : [];
    return { ...stats, list: orders.map(o => ({ ...o, events: events.filter(e => e.order_id === o.id).map(e => ({ status: e.status, at: e.at })) })) };
}

/** How many orders are in each status (the screen's filters). */
function statusCounts(api) {
    return Object.fromEntries(api.all('SELECT status, COUNT(*) AS n FROM website_orders GROUP BY status').map(r => [r.status, r.n]));
}

module.exports = { NEXT, nextStatuses, checkReturn, markLabelPrinted, pricedLines, EDITABLE, statusCounts, STATUSES, COMPLETED, STOPPED, RESERVING, importOrders, knownIds, listOrders, setStatus, updateDetails, confirmOrder, nextOrderNumber, customerStats, customerHistory, sqlTime };
