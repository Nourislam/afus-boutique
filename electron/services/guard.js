/**
 * Money protections checked by the main process (not only hidden buttons):
 * - a cashier gives at most the discount set by the owner (Employees ›
 *   Cashiers' rights); above it, a manager types their PIN;
 * - returns and exchanges are made by a manager, or by a cashier when the
 *   owner allows it, or with a manager's PIN.
 * Who acts comes from the session (services/session.js), never from the
 * window. `approval` is { employeeId, pin } of the manager who agreed.
 */
const catalog = require('./catalogService');
const { checkEmployeePin } = require('./pinService');
const { isManager } = require('./session');
// Same promotion rules as the sales screen (ES module, loaded with require)
const { isPromotionLive, promotionDiscount } = require('../shared/promotions.mjs');

const DEFAULT_RULES = { cashierMaxDiscount: 0, cashierReturns: false };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function readRules(api) {
    const row = api.get("SELECT value FROM settings WHERE key = 'security'");
    let saved = {};
    try { saved = row ? JSON.parse(row.value) || {} : {}; } catch { saved = {}; }
    const max = Number(saved.cashierMaxDiscount);
    return {
        cashierMaxDiscount: Number.isFinite(max) ? Math.min(100, Math.max(0, max)) : DEFAULT_RULES.cashierMaxDiscount,
        cashierReturns: saved.cashierReturns === true,
    };
}

/** The manager whose PIN was typed, or null (wrong PIN, cashier, inactive). */
function approver(api, approval) {
    if (!approval || !approval.employeeId || !approval.pin) return null;
    const employee = checkEmployeePin(api, approval.employeeId, approval.pin);
    return employee && isManager({ role: String(employee.role || '').toLowerCase() }) ? employee : null;
}

function needLogin(actor) {
    if (!actor || !actor.id) throw catalog.codedError('LOGIN_REQUIRED', {});
}

/** Returns and exchanges. @returns the manager who approved (or null when not needed) */
function checkReturn(api, actor, approval) {
    needLogin(actor);
    if (isManager(actor) || readRules(api).cashierReturns) return null;
    const manager = approver(api, approval);
    if (!manager) throw catalog.codedError('RETURN_NEEDS_MANAGER', {});
    return manager;
}

/**
 * Discount given by hand on a ticket (lines sold under their price + discount
 * typed on the ticket), promotions excluded. Prices are read from the
 * database, not from the window.
 * @returns {{ amount, percent, base }}
 */
function manualDiscount(api, sale) {
    let base = 0;
    let given = 0;
    for (const item of sale.items || []) {
        const qty = Number(item.quantity) || 0;
        const variant = item.variant_id ? api.get('SELECT price FROM product_variants WHERE id = ?', [item.variant_id]) : null;
        const product = api.get('SELECT price FROM products WHERE id = ?', [item.product_id]);
        // Packs and quotes keep their own price
        const listPrice = product ? catalog.effectivePrice(product, variant) : Number(item.unit_price) || 0;
        const paid = Number(item.unit_price) || 0;
        base += listPrice * qty;
        given += Math.max(0, listPrice - paid) * qty + Math.max(0, Number(item.discount) || 0);
    }
    given += Math.max(0, Number(sale.manual_discount) || 0);
    return { amount: r2(given), base: r2(base), percent: base > 0 ? r2((given / base) * 100) : 0 };
}

/** Discount the sale's promotion really gives (0 when none, ended or not for these articles). */
function promotionAmount(api, sale, now = Date.now()) {
    if (!sale.promotion_id) return 0;
    const promo = api.get('SELECT * FROM promotions WHERE id = ?', [sale.promotion_id]);
    if (!promo || !isPromotionLive(promo, now)) return 0;
    if (!promo.auto_apply) {
        const typed = String(sale.coupon || '').trim().toLowerCase();
        if (!typed || !promo.coupon_code || promo.coupon_code.trim().toLowerCase() !== typed) return 0;
    }
    // Categories from the database, prices as sold
    const items = (sale.items || []).map(item => ({
        ...item,
        category_id: api.get('SELECT category_id FROM products WHERE id = ?', [item.product_id])?.category_id || null,
    }));
    return promotionDiscount(promo, items);
}

/**
 * Check a sale before saving it. Also refuses totals that do not add up
 * (a ticket cannot be lowered without it showing as a discount).
 */
function checkSale(api, actor, sale, approval) {
    needLogin(actor);
    const items = sale.items || [];
    const lines = r2(items.reduce((s, i) => s + (Number(i.total) || 0), 0));
    for (const item of items) {
        const expected = r2((Number(item.quantity) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount) || 0));
        if (Math.abs(expected - (Number(item.total) || 0)) > 0.01) throw catalog.codedError('SALE_TOTAL_MISMATCH', {});
    }
    const discount = Number(sale.discount_amount) || 0;
    const minimum = r2(lines - discount + (Number(sale.service_charge) || 0));
    if (Math.abs(lines - (Number(sale.subtotal) || 0)) > 0.01 || (Number(sale.total) || 0) < minimum - 0.01) {
        throw catalog.codedError('SALE_TOTAL_MISMATCH', {});
    }
    // The ticket discount must be the promotion (computed again here) + what the cashier typed
    const promo = promotionAmount(api, sale);
    if (discount - promo - Math.max(0, Number(sale.manual_discount) || 0) > 0.01) throw catalog.codedError('SALE_TOTAL_MISMATCH', {});

    const given = manualDiscount(api, sale);
    if (given.amount <= 0 || isManager(actor)) return { discount: given, approvedBy: null };
    const { cashierMaxDiscount } = readRules(api);
    if (given.percent <= cashierMaxDiscount + 0.001) return { discount: given, approvedBy: null };
    const manager = approver(api, approval);
    if (!manager) throw catalog.codedError('DISCOUNT_NEEDS_MANAGER', { max: cashierMaxDiscount, given: given.percent });
    return { discount: given, approvedBy: manager };
}

module.exports = { readRules, approver, checkReturn, checkSale, manualDiscount, promotionAmount, DEFAULT_RULES };
