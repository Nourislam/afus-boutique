/**
 * Loyalty points: 1 point for every 100 DA of a ticket with a customer
 * (earned in db:sales:create). A return takes back the points of what was
 * given back, so buying then returning never leaves points. The owner may
 * set what one point is worth (settings.loyalty.pointValue, in DA; 0 = points
 * are only counted): the customer's points then become an avoir card, spent
 * at the till like any gift card. Call these inside a transaction.
 */
const catalog = require('./catalogService');

const DA_PER_POINT = 100;

const pointsOf = (amount) => Math.max(0, Math.floor((Number(amount) || 0) / DA_PER_POINT));

/** settings.loyalty: { pointValue } (DA for one point, 0 = no conversion). */
function readLoyalty(api) {
    const row = api.get("SELECT value FROM settings WHERE key = 'loyalty'");
    let value = {};
    try { value = row ? JSON.parse(row.value) || {} : {}; } catch { value = {}; }
    const pointValue = Number(value.pointValue);
    return { pointValue: Number.isFinite(pointValue) && pointValue > 0 ? Math.round(pointValue * 100) / 100 : 0 };
}

/**
 * A return of `refund` on this sale (`before` = what earlier returns gave
 * back): the customer loses the points those pieces earned, and his total
 * spent goes down with it. The points are those of the part that earned
 * them (sales.loyalty_base; the whole total on older sales).
 */
function onReturn(api, sale, before, refund) {
    if (!sale || !sale.customer_id || !(refund > 0)) return 0;
    const total = Number(sale.total) || 0;
    if (!(total > 0)) return 0;
    const base = sale.loyalty_base === null || sale.loyalty_base === undefined ? total : Number(sale.loyalty_base) || 0;
    const kept = (left) => pointsOf(base * Math.max(0, left) / total + 1e-9);
    const points = kept(total - before) - kept(total - before - refund);
    api.run(`UPDATE customers SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) - ?),
             total_spent = MAX(0, COALESCE(total_spent, 0) - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [points, refund, sale.customer_id]);
    return points;
}

/**
 * Turn `points` of the customer into an avoir card. Refused when the owner
 * has not set a value, or the customer has fewer points.
 */
function redeem(api, { customerId, points, employeeId = null }, createCard) {
    const { pointValue } = readLoyalty(api);
    if (!(pointValue > 0)) throw catalog.codedError('LOYALTY_OFF', {});
    const customer = api.get('SELECT id, loyalty_points FROM customers WHERE id = ?', [customerId]);
    if (!customer) throw catalog.codedError('CUSTOMER_NOT_FOUND', {});
    const wanted = Math.floor(Number(points) || 0);
    const has = Number(customer.loyalty_points) || 0;
    if (wanted <= 0 || wanted > has) throw catalog.codedError('LOYALTY_NOT_ENOUGH', { points: has });
    const amount = Math.round(wanted * pointValue * 100) / 100;
    api.run('UPDATE customers SET loyalty_points = loyalty_points - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [wanted, customerId]);
    const card = createCard(api, { returnId: null, amount, customerId, employeeId, kind: 'loyalty' });
    return { ...card, points: wanted, left: has - wanted };
}

module.exports = { DA_PER_POINT, pointsOf, readLoyalty, onReturn, redeem };
