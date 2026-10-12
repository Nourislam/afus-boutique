/**
 * What to buy next, from what sold: the same rules in the window (the buying
 * plan of an article) and in the main process (tests, reports).
 *
 * mix(items, key): for each size (or colour) the share of the pieces sold
 * (demand) and the share of the pieces that were there to sell (supply =
 * sold + left in stock). Demand above supply by more than 5 points: buy more
 * of it next time; below: buy less. Under MIN_SOLD pieces sold in all, the
 * figures are too thin to advise.
 *
 * plan(cells, total): split `total` new pieces between the colours / sizes in
 * proportion to what sold (a colour / size never sold still gets its small
 * share), in whole pieces that add up exactly to `total`.
 */
export const MIN_SOLD = 10;
const GAP = 0.05;

export function mix(items, key) {
    const groups = new Map();
    for (const item of items || []) {
        const k = item[key];
        if (k === null || k === undefined || k === '') continue;
        const g = groups.get(k) || { key: k, sold: 0, stock: 0 };
        g.sold += Math.max(0, Number(item.sold) || 0);
        g.stock += Math.max(0, Number(item.stock) || 0);
        groups.set(k, g);
    }
    const rows = [...groups.values()];
    const sold = rows.reduce((t, r) => t + r.sold, 0);
    const supply = rows.reduce((t, r) => t + r.sold + r.stock, 0);
    const enough = sold >= MIN_SOLD;
    return {
        sold,
        enough,
        rows: rows.map(r => {
            const demand = sold > 0 ? r.sold / sold : 0;
            const offer = supply > 0 ? (r.sold + r.stock) / supply : 0;
            const advice = !enough ? 'unknown' : demand - offer > GAP ? 'up' : offer - demand > GAP ? 'down' : 'same';
            return { ...r, demand, supply: offer, advice };
        }),
    };
}

/** cells: [{ id, sold }] -> [{ id, quantity }] adding up to total. */
export function plan(cells, total) {
    const n = Math.max(0, Math.floor(Number(total) || 0));
    const list = (cells || []).filter(c => c && c.id !== undefined);
    if (!n || !list.length) return list.map(c => ({ id: c.id, quantity: 0 }));
    // Half a piece added to each: a colour / size never sold is not dropped
    const weights = list.map(c => Math.max(0, Number(c.sold) || 0) + 0.5);
    const sum = weights.reduce((t, w) => t + w, 0);
    const exact = weights.map(w => (w / sum) * n);
    const out = exact.map(Math.floor);
    let left = n - out.reduce((t, q) => t + q, 0);
    // Largest remainders first, then the best sellers
    const order = exact.map((e, i) => ({ i, rest: e - Math.floor(e), w: weights[i] }))
        .sort((a, b) => b.rest - a.rest || b.w - a.w);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
    return list.map((c, i) => ({ id: c.id, quantity: out[i] }));
}
