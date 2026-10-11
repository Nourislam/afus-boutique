/**
 * Reservations with a deposit: the customer pays part now, the pieces are put
 * aside (taken out of the stock that can be sold) until the customer comes
 * back, pays the rest and leaves with them, or the reservation is cancelled
 * (pieces back in stock, the deposit given back or kept).
 *
 * The deposit taken in cash goes into the drawer of the employee who took it
 * (shiftService counts it); at the till the deposit is a payment "deposit" of
 * the sale, so the same money is never counted twice.
 * Call inside a transaction. `api` is the { all, get, run, uuid } adapter.
 */
const catalog = require('./catalogService');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

function nextNumber(api, now = new Date()) {
    const day = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const last = api.get("SELECT number FROM reservations WHERE number LIKE ? ORDER BY length(number) DESC, number DESC LIMIT 1", [`RES-${day}-%`]);
    const seq = last ? (parseInt(String(last.number).split('-').pop(), 10) || 0) + 1 : 1;
    return `RES-${day}-${String(seq).padStart(3, '0')}`;
}

/**
 * Put pieces aside for a customer.
 * data: { customer_id, items: [{ product_id, variant_id, quantity, unit_price, product_name, variant_label }],
 *         deposit, deposit_method, expires_at, notes, employee_id, shift_id }
 */
function createReservation(api, data) {
    const customer = data.customer_id ? api.get('SELECT id, name FROM customers WHERE id = ?', [data.customer_id]) : null;
    if (!customer) throw catalog.codedError('RESERVATION_NEEDS_CUSTOMER', {});
    const items = (data.items || []).filter(i => Number(i.quantity) > 0);
    if (!items.length) throw catalog.codedError('RESERVATION_EMPTY', {});
    const total = r2(items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0));
    const deposit = r2(data.deposit);
    if (deposit < 0 || deposit > total) throw catalog.codedError('RESERVATION_DEPOSIT', { total });

    const id = data.id || api.uuid();
    const number = nextNumber(api);
    api.run(`INSERT INTO reservations (id, number, customer_id, employee_id, shift_id, total, deposit, deposit_method, status, expires_at, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [id, number, customer.id, data.employee_id || null, data.shift_id || null, total, deposit, data.deposit_method === 'card' ? 'card' : 'cash',
        data.expires_at || null, data.notes || null]);
    for (const item of items) {
        const product = api.get('SELECT id, name, stock_quantity FROM products WHERE id = ?', [item.product_id]);
        if (!product) throw catalog.codedError('VARIANT_GONE', { product: item.product_name || '' });
        const variant = item.variant_id ? api.get('SELECT * FROM product_variants WHERE id = ?', [item.variant_id]) : null;
        if (item.variant_id && !variant) throw catalog.codedError('VARIANT_GONE', { product: product.name });
        const available = variant ? variant.stock_quantity || 0 : product.stock_quantity || 0;
        if (Number(item.quantity) > available) {
            throw catalog.codedError('STOCK_INSUFFICIENT', { product: variant ? `${product.name} (${catalog.variantLabel(variant)})` : product.name, available });
        }
        api.run(`INSERT INTO reservation_items (id, reservation_id, product_id, variant_id, product_name, variant_label, quantity, unit_price)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [api.uuid(), id, product.id, variant ? variant.id : null, product.name, variant ? catalog.variantLabel(variant) : null, Number(item.quantity), Number(item.unit_price) || 0]);
        // Put aside: no longer sold to someone else
        catalog.adjustStock(api, { productId: product.id, variantId: variant ? variant.id : null, delta: -Number(item.quantity), type: 'reservation', reason: `Reservation ${number}`, employeeId: data.employee_id || null });
    }
    return getReservation(api, id);
}

function getReservation(api, id) {
    const reservation = api.get(`SELECT r.*, c.name AS customer_name, c.phone AS customer_phone
                                 FROM reservations r LEFT JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`, [id]);
    if (!reservation) return null;
    return { ...reservation, items: api.all('SELECT * FROM reservation_items WHERE reservation_id = ?', [id]) };
}

/** Reservations (open first, then the latest), with their pieces. */
function listReservations(api, { status = null } = {}) {
    const rows = api.all(`SELECT r.*, c.name AS customer_name, c.phone AS customer_phone
                          FROM reservations r LEFT JOIN customers c ON c.id = r.customer_id
                          ${status ? 'WHERE r.status = ?' : ''}
                          ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC`, status ? [status] : []);
    return rows.map(r => ({ ...r, items: api.all('SELECT * FROM reservation_items WHERE reservation_id = ?', [r.id]) }));
}

/** Pieces back in the stock that can be sold. */
function release(api, reservation, type, employeeId) {
    for (const item of api.all('SELECT * FROM reservation_items WHERE reservation_id = ?', [reservation.id])) {
        catalog.adjustStock(api, { productId: item.product_id, variantId: item.variant_id || null, delta: Number(item.quantity), type, reason: `Reservation ${reservation.number}`, employeeId });
    }
}

function openOrThrow(api, id) {
    const reservation = api.get('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!reservation) throw catalog.codedError('RESERVATION_NOT_FOUND', {});
    if (reservation.status !== 'open') throw catalog.codedError('RESERVATION_CLOSED', { number: reservation.number });
    return reservation;
}

/**
 * Cancel: the pieces go back in stock; `refund` of the deposit is given back
 * in cash (0 = the shop keeps the deposit).
 */
function cancelReservation(api, id, { refund = 0, employeeId = null } = {}) {
    const reservation = openOrThrow(api, id);
    const given = r2(refund);
    if (given < 0 || given > reservation.deposit) throw catalog.codedError('RESERVATION_DEPOSIT', { total: reservation.deposit });
    release(api, reservation, 'reservation_cancel', employeeId);
    api.run("UPDATE reservations SET status = 'cancelled', refunded = ?, closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE id = ?", [given, employeeId, id]);
    return getReservation(api, id);
}

/**
 * The customer comes back: called by the sale, in its transaction, before its
 * lines take the pieces out of stock again. The sale must pay the deposit as
 * a "deposit" payment (no more than was paid).
 */
function completeForSale(api, sale) {
    const reservation = openOrThrow(api, sale.reservation_id);
    const depositPaid = r2((sale.payments || []).filter(p => p.method === 'deposit').reduce((s, p) => s + (Number(p.amount) || 0), 0));
    if (depositPaid > reservation.deposit + 0.004) throw catalog.codedError('RESERVATION_DEPOSIT', { total: reservation.deposit });
    release(api, reservation, 'reservation_release', sale.employee_id || null);
    api.run("UPDATE reservations SET status = 'completed', sale_id = ?, closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE id = ?", [sale.id, sale.employee_id || null, reservation.id]);
    return reservation;
}

module.exports = { createReservation, getReservation, listReservations, cancelReservation, completeForSale, nextNumber };
