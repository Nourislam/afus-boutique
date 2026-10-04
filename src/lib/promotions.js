// Promotions applied at checkout. Pure functions so they can be tested.
//
// A promotion (promotions table) has: type ('percentage' | 'fixed' |
// 'threshold' | 'bogo'), value, min_purchase, max_discount, applies_to
// ('all' | 'category' | 'product'), applies_to_ids (JSON array), coupon_code,
// auto_apply, is_active, start_date, end_date, max_uses, current_uses.
//
// Only the best single promotion is applied (no stacking), which is how
// Algerian shops usually run "soldes": one offer per ticket.

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function parseIds(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function toTime(value) {
    if (!value) return null;
    const text = String(value);
    // Dates picked in the form ("2025-06-01") cover the whole day
    const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Is the promotion usable now (active, in its dates, uses left)? */
export function isPromotionLive(promo, now = Date.now()) {
    if (!promo || !promo.is_active) return false;
    const start = toTime(promo.start_date);
    let end = toTime(promo.end_date);
    if (end !== null && /^\d{4}-\d{2}-\d{2}$/.test(String(promo.end_date))) end += 24 * 3600 * 1000 - 1;
    if (start !== null && now < start) return false;
    if (end !== null && now > end) return false;
    if (promo.max_uses && (promo.current_uses || 0) >= promo.max_uses) return false;
    return true;
}

/** Cart lines the promotion applies to. */
export function eligibleLines(promo, items) {
    const scope = promo.applies_to || 'all';
    if (scope === 'all') return items;
    const ids = new Set(parseIds(promo.applies_to_ids));
    if (scope === 'category') return items.filter(i => i.category_id && ids.has(i.category_id));
    if (scope === 'product') return items.filter(i => ids.has(i.product_id));
    return items;
}

const lineTotal = (item) => (Number(item.unit_price) || 0) * (Number(item.quantity) || 0);

/** Discount (DA) a promotion gives on these cart lines; 0 when it does not apply. */
export function promotionDiscount(promo, items) {
    const lines = eligibleLines(promo, items);
    const base = lines.reduce((sum, i) => sum + lineTotal(i), 0);
    if (base <= 0) return 0;
    const cartTotal = items.reduce((sum, i) => sum + lineTotal(i), 0);
    if ((Number(promo.min_purchase) || 0) > cartTotal) return 0;

    const value = Number(promo.value) || 0;
    let discount = 0;
    switch (promo.type) {
        case 'percentage':
        case 'threshold':
            discount = base * value / 100;
            break;
        case 'fixed':
            discount = Math.min(value, base);
            break;
        case 'bogo': {
            // Every second piece (the cheaper ones) free, or value% off if set
            const units = [];
            for (const i of lines) for (let k = 0; k < (Number(i.quantity) || 0); k++) units.push(Number(i.unit_price) || 0);
            units.sort((a, b) => a - b);
            const free = units.slice(0, Math.floor(units.length / 2)).reduce((a, b) => a + b, 0);
            discount = free * ((value > 0 && value < 100) ? value / 100 : 1);
            break;
        }
        default:
            discount = 0;
    }
    if (promo.max_discount) discount = Math.min(discount, Number(promo.max_discount));
    return round(Math.max(0, Math.min(discount, base)));
}

/**
 * Best promotion for the cart: among live auto-apply promotions, plus the one
 * matching the coupon code typed by the cashier.
 * @returns {{ promotion, amount } | null}
 */
export function bestPromotion(promotions, items, { coupon = '', now = Date.now() } = {}) {
    const code = String(coupon || '').trim().toLowerCase();
    let best = null;
    for (const promo of promotions || []) {
        if (!isPromotionLive(promo, now)) continue;
        const matchesCoupon = code && promo.coupon_code && promo.coupon_code.trim().toLowerCase() === code;
        if (!promo.auto_apply && !matchesCoupon) continue;
        if (promo.coupon_code && !matchesCoupon && !promo.auto_apply) continue;
        const amount = promotionDiscount(promo, items);
        if (amount > 0 && (!best || amount > best.amount)) best = { promotion: promo, amount };
    }
    return best;
}
