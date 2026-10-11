/**
 * Markdown manager: suggests a discount in steps (10 %, then 20 %, then 30 %)
 * on the articles that do not sell, the owner approves or refuses each one,
 * and the result of every approved markdown is measured (did it sell faster?).
 *
 * Nothing changes on its own: a suggestion is only a line on the screen. An
 * approval creates one promotion on that article (14 days, from today); a
 * refusal is noted so the article is not suggested again for 14 days.
 *
 * An article is weak when it has stock, is older than 30 days, and less than
 * 20 % of what there was to sell went in the last 30 days (sold / (sold +
 * in stock)). The next step comes only once the previous markdown has ended
 * and the article is still weak; after 30 % nothing more is suggested.
 * `api` is the { all, get, run } adapter; dates as in sales.created_at (UTC).
 */
const { countedSale } = require('./saleStatus');
const { codedError } = require('./catalogService');
const { NET_SALE_ITEMS, PRODUCT_STOCK } = require('./dashboardService');
const { isPromotionLive, parseIds, addDays } = require('../shared/promotions.mjs');

const STEPS = [10, 20, 30];
const WINDOW_DAYS = 30;
const WEAK_RATE = 20;
const RUN_DAYS = 14;
const REFUSED_DAYS = 14;
const EARLY_DAYS = 3;

const DAY = 86400000;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100 + 0;
const toDb = (date) => new Date(date).toISOString().replace('T', ' ').slice(0, 19);
const fromDb = (text) => Date.parse(`${String(text).replace(' ', 'T')}Z`);

function soldBetween(api, productId, from, to) {
    const row = api.get(`
        SELECT COALESCE(SUM(si.net_quantity), 0) AS sold,
               COALESCE(SUM(CASE WHEN si.quantity > 0 THEN (si.total - COALESCE(si.tax_amount, 0)) * si.net_quantity * 1.0 / si.quantity ELSE 0 END), 0) AS revenue
        FROM ${NET_SALE_ITEMS} si JOIN sales s ON s.id = si.sale_id
        WHERE si.product_id = ? AND ${countedSale('s')} AND s.created_at >= ? AND s.created_at <= ?
    `, [productId, from, to]) || {};
    return { sold: Number(row.sold) || 0, revenue: r2(row.revenue) };
}

/** Each article's decisions, newest first. */
function decisionsOf(api) {
    const map = new Map();
    for (const row of api.all('SELECT * FROM markdowns ORDER BY created_at DESC, rowid DESC')) {
        if (!map.has(row.product_id)) map.set(row.product_id, []);
        map.get(row.product_id).push(row);
    }
    return map;
}

/** Articles already on a discount the shop made itself (by article). */
function discountedByShop(api, now) {
    const ids = new Set();
    const ours = new Set(api.all('SELECT promotion_id FROM markdowns WHERE promotion_id IS NOT NULL').map(r => r.promotion_id));
    for (const promo of api.all("SELECT * FROM promotions WHERE applies_to = 'product'")) {
        if (ours.has(promo.id) || !isPromotionLive(promo, now)) continue;
        for (const id of parseIds(promo.applies_to_ids)) ids.add(id);
    }
    return ids;
}

/** What the next step would be for an article, or null (running, refused lately, at the last step). */
function nextStep(decisions, now) {
    const last = (decisions || [])[0];
    if (!last) return { step: STEPS[0], previous: null };
    if (last.status === 'refused') {
        if (now - fromDb(last.created_at) < REFUSED_DAYS * DAY) return null;
        const approved = decisions.find(d => d.status === 'approved');
        return approved ? stepAfter(approved.percent) : { step: STEPS[0], previous: null };
    }
    if (now < fromDb(last.ends_at)) return null;
    return stepAfter(last.percent);
}

function stepAfter(percent) {
    const index = STEPS.indexOf(Number(percent));
    const step = STEPS[index + 1];
    return step ? { step, previous: Number(percent) } : null;
}

/** The suggestions of today, the slowest first. */
function suggestions(api, { now = Date.now() } = {}) {
    const since = toDb(now - WINDOW_DAYS * DAY);
    const decisions = decisionsOf(api);
    const discounted = discountedByShop(api, now);
    const rows = api.all(`
        SELECT p.id AS product_id, p.name, p.price, p.cost, ${PRODUCT_STOCK} AS stock,
               (SELECT COALESCE(SUM(si.net_quantity), 0) FROM ${NET_SALE_ITEMS} si JOIN sales s ON s.id = si.sale_id
                WHERE si.product_id = p.id AND ${countedSale('s')} AND s.created_at >= ?) AS sold
        FROM products p
        WHERE p.is_active = 1 AND COALESCE(p.created_at, '2000-01-01 00:00:00') <= ? AND ${PRODUCT_STOCK} > 0
    `, [since, since]);
    const out = [];
    for (const row of rows) {
        const stock = Number(row.stock) || 0;
        const sold = Number(row.sold) || 0;
        const rate = r2((sold / (sold + stock)) * 100);
        if (rate >= WEAK_RATE || discounted.has(row.product_id)) continue;
        const next = nextStep(decisions.get(row.product_id), now);
        if (!next) continue;
        const price = Number(row.price) || 0;
        const cost = Number(row.cost) || 0;
        const newPrice = r2(price * (1 - next.step / 100));
        out.push({
            product_id: row.product_id, name: row.name, stock, sold, rate, price, cost,
            step: next.step, previous_step: next.previous, new_price: newPrice,
            margin_after: cost > 0 ? r2(newPrice - cost) : null,
            below_cost: cost > 0 && newPrice < cost,
        });
    }
    return out.sort((a, b) => a.rate - b.rate || b.stock - a.stock || a.name.localeCompare(b.name));
}

/**
 * The owner's answer to one suggestion. approve: a promotion of `percent` on
 * the article, from today for 14 days; refuse: noted, not suggested again for
 * 14 days. Refused when the article has a markdown still running.
 */
function decide(api, { productId, percent, approve, employeeId = null, name = null, now = Date.now() } = {}) {
    const step = Number(percent);
    if (!STEPS.includes(step)) throw codedError('MARKDOWN_STEP');
    const product = api.get(`SELECT p.id, p.name, ${PRODUCT_STOCK} AS stock FROM products p WHERE p.id = ? AND p.is_active = 1`, [productId]);
    if (!product) throw codedError('MARKDOWN_NO_ARTICLE');
    const last = (decisionsOf(api).get(productId) || [])[0];
    if (last && last.status === 'approved' && now < fromDb(last.ends_at)) throw codedError('MARKDOWN_RUNNING');

    const id = `md-${productId}-${now}`;
    const before = soldBetween(api, productId, toDb(now - WINDOW_DAYS * DAY), toDb(now));
    const row = {
        id, product_id: productId, percent: step, status: approve ? 'approved' : 'refused', promotion_id: null,
        started_at: null, ends_at: null, stock_before: Number(product.stock) || 0, sold_before: before.sold,
        rate_before: r2(before.sold / WINDOW_DAYS), employee_id: employeeId, created_at: toDb(now),
    };
    if (approve) {
        const end = new Date(now);
        end.setDate(end.getDate() + RUN_DAYS);
        end.setHours(23, 59, 59, 0);
        row.promotion_id = `promo-${id}`;
        row.started_at = toDb(now);
        row.ends_at = toDb(end);
        api.run(`
            INSERT INTO promotions (id, name, description, type, value, min_purchase, start_date, end_date, is_active, applies_to, applies_to_ids, auto_apply)
            VALUES (?, ?, ?, 'percentage', ?, 0, ?, ?, 1, 'product', ?, 1)
        `, [row.promotion_id, name || `-${step}% ${product.name}`, 'markdown', step, addDays(now, 0), addDays(now, RUN_DAYS), JSON.stringify([productId])]);
    }
    api.run(`
        INSERT INTO markdowns (id, product_id, percent, status, promotion_id, started_at, ends_at, stock_before, sold_before, rate_before, employee_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [row.id, row.product_id, row.percent, row.status, row.promotion_id, row.started_at, row.ends_at,
        row.stock_before, row.sold_before, row.rate_before, row.employee_id, row.created_at]);
    return row;
}

/**
 * "Did the markdown work?": pieces sold a day before (30 days) and during
 * the markdown, for each approved one, the newest first.
 * worked: sold out, or at least 1.5 times faster (2 pieces or more when
 * nothing sold before); some: faster, not that much; no: not faster;
 * early: less than 3 days, too soon to say.
 */
function results(api, { now = Date.now() } = {}) {
    return api.all(`
        SELECT m.*, p.name, ${PRODUCT_STOCK} AS stock
        FROM markdowns m LEFT JOIN products p ON p.id = m.product_id
        WHERE m.status = 'approved'
        ORDER BY m.started_at DESC, m.rowid DESC
    `).map(m => {
        const start = fromDb(m.started_at);
        const end = Math.min(fromDb(m.ends_at), now);
        const days = Math.max(0, (end - start) / DAY);
        const during = soldBetween(api, m.product_id, m.started_at, toDb(end));
        const rateDuring = r2(during.sold / Math.max(1, days));
        const before = Number(m.rate_before) || 0;
        const stock = Math.max(0, Number(m.stock) || 0);
        let verdict;
        if (stock === 0 && during.sold > 0) verdict = 'worked';
        else if (days < EARLY_DAYS) verdict = 'early';
        else if (during.sold === 0) verdict = 'no';
        else if (before === 0) verdict = during.sold >= 2 ? 'worked' : 'some';
        else verdict = rateDuring >= before * 1.5 ? 'worked' : rateDuring > before ? 'some' : 'no';
        return {
            id: m.id, product_id: m.product_id, name: m.name, percent: m.percent,
            started_at: m.started_at, ends_at: m.ends_at, running: now < fromDb(m.ends_at),
            days: r2(days), stock_before: m.stock_before, stock,
            rate_before: before, sold: during.sold, revenue: during.revenue, rate_during: rateDuring, verdict,
        };
    });
}

module.exports = { STEPS, WEAK_RATE, WINDOW_DAYS, RUN_DAYS, REFUSED_DAYS, suggestions, decide, results };
