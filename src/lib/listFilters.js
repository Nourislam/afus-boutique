// Filters a page can be opened with from the home screen (?stock=out, ...).
// Pure functions so the pages and the tests use the same rules as the
// dashboard figures.

/** The home screen links, in one place. */
export const DASHBOARD_LINKS = {
    stockOut: '/inventory?stock=out',
    stockLow: '/inventory?stock=low',
    stockRunOut: '/?tab=stock',
    productsNoCost: '/products?filter=noCost',
    creditLate: '/credit-sales?status=overdue',
    orderSoldOut: '/purchase-orders?order=soldOut',
};

/**
 * The promotion form opened prefilled (end-of-season clearance, a markdown):
 * a percentage on these articles. It only fills the form, the shop saves it.
 */
export function clearanceLink({ ids = [], name = '', percent = 30 } = {}) {
    const params = new URLSearchParams({ tab: 'promotions', discountProducts: ids.join(','), discountName: name, discountValue: String(percent) });
    return `/offers?${params.toString()}`;
}

/** What the promotion form reads from such a link, or null. */
export function readClearance(params) {
    const ids = String(params?.get?.('discountProducts') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return null;
    const value = Number(params.get('discountValue'));
    return { ids, name: params.get('discountName') || '', value: value > 0 && value <= 100 ? value : '' };
}

export const STOCK_FILTERS = ['all', 'out', 'low'];
export const CREDIT_FILTERS = ['all', 'pending', 'partial', 'paid', 'overdue'];

/** The value of a filter in the address, or the default when missing or unknown. */
export function readFilter(params, name, allowed, fallback = 'all') {
    const value = params?.get?.(name);
    return value && allowed.includes(value) ? value : fallback;
}

const hasVariants = (product, variants) => !!product.has_variants && variants.length > 0;

/**
 * Stock filter of an article, at the level the alerts use: its colours/sizes
 * for an article with variants, the article itself otherwise.
 * out: at 0 (or less) - low: running low but not at 0.
 */
export function stockMatches(product, variants = [], filter = 'all') {
    if (filter === 'all') return true;
    const rows = hasVariants(product, variants) ? variants : [product];
    const qty = (r) => Number(r.stock_quantity) || 0;
    if (filter === 'out') return rows.some(r => qty(r) <= 0);
    if (filter === 'low') return rows.some(r => qty(r) > 0 && qty(r) <= (Number(r.min_stock_level) || 0));
    return true;
}

/** Article without a purchase price (one of its colours/sizes without one is enough). */
export function lacksCost(product, variants = []) {
    if (hasVariants(product, variants)) return variants.some(v => (Number(v.cost ?? product.cost) || 0) <= 0);
    return (Number(product.cost) || 0) <= 0;
}

/** Credit sale late: something still owed and the due day is before today ("YYYY-MM-DD"). */
export function isLateCredit(sale, today) {
    const owed = (Number(sale.amount_due) || 0) - (Number(sale.amount_paid) || 0);
    if (!(owed > 0.004) || !sale.due_date) return false;
    return String(sale.due_date).slice(0, 10) < today;
}

/**
 * What is still owed on kridi, by how late it is: not due yet (or no due
 * date), late by 30 days or less, late by more than 30 days. today: local
 * "YYYY-MM-DD".
 */
export function creditAging(sales = [], today) {
    const out = { notDue: 0, late: 0, veryLate: 0, total: 0 };
    const day = (text) => Date.parse(`${String(text).slice(0, 10)}T00:00:00Z`);
    for (const sale of sales) {
        const owed = Math.round(((Number(sale.amount_due) || 0) - (Number(sale.amount_paid) || 0)) * 100) / 100;
        if (!(owed > 0.004)) continue;
        out.total += owed;
        if (!isLateCredit(sale, today)) out.notDue += owed;
        else if ((day(today) - day(sale.due_date)) / 86400000 <= 30) out.late += owed;
        else out.veryLate += owed;
    }
    return out;
}

/**
 * Lines of a new purchase order for the colours/sizes sold out that sell
 * (rows of dashboard:stock outOfStock). Quantity: what sold in 30 days.
 */
export function soldOutOrderLines(rows = [], products = []) {
    return rows.map(row => {
        const product = products.find(p => p.id === row.product_id);
        const cost = Number(product?.cost) || 0;
        const quantity = Math.max(1, Number(row.sold) || 1);
        const label = [row.color, row.size].filter(Boolean).join(' / ');
        return {
            key: row.variant_id || row.product_id,
            product_id: row.product_id,
            variant_id: row.variant_id || null,
            variant_label: label || undefined,
            sku: row.sku || undefined,
            product_name: row.product_name,
            quantity,
            unit_cost: cost,
            total_cost: cost * quantity,
            tax_rate: 0,
        };
    });
}
