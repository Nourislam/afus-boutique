// Receiving a purchase order: what was ordered against what arrived, per
// colour / size line, and the labels of what arrived only. Pure functions,
// tested in tests/receiving.test.js.

/**
 * State of one line once this delivery is counted:
 * short (pieces still missing), full, or over (more than ordered).
 */
export function lineStatus({ quantity = 0, received_quantity = 0 } = {}, now = 0) {
    const ordered = Math.max(0, Number(quantity) || 0);
    const arrived = Math.max(0, Number(received_quantity) || 0) + Math.max(0, Number(now) || 0);
    const diff = arrived - ordered;
    return { ordered, arrived, diff, status: diff < 0 ? 'short' : diff > 0 ? 'over' : 'full' };
}

/** Totals of a delivery: lines and pieces short / full / over. */
export function receivingSummary(items = []) {
    const out = { lines: 0, full: 0, short: 0, over: 0, missing: 0, extra: 0, pieces: 0 };
    for (const item of items) {
        const s = lineStatus(item, item.receive_now);
        out.lines += 1;
        out[s.status] += 1;
        if (s.diff < 0) out.missing += -s.diff;
        if (s.diff > 0) out.extra += s.diff;
        out.pieces += Math.max(0, Number(item.receive_now) || 0);
    }
    return out;
}

/** Lines of the order grouped by article, in the order's order. */
export function groupByArticle(items = []) {
    const groups = [];
    for (const item of items) {
        const key = item.product_id || item.product_name;
        let g = groups.find(x => x.key === key);
        if (!g) { g = { key, name: item.product_name, items: [] }; groups.push(g); }
        g.items.push(item);
    }
    return groups;
}

/**
 * The labels page opened with the pieces that arrived:
 * /labels?tab=articles&pieces=product:variant:quantity,... (variant empty for an article without sizes).
 */
export function arrivedLabelsLink(received = []) {
    const pieces = received
        .filter(r => r.product_id && Number(r.quantity) > 0)
        .map(r => `${r.product_id}:${r.variant_id || ''}:${Math.floor(Number(r.quantity))}`);
    if (!pieces.length) return null;
    return `/labels?${new URLSearchParams({ tab: 'articles', pieces: pieces.join(',') }).toString()}`;
}

/** What the labels page reads from that link. */
export function readArrivedPieces(params) {
    return String(params?.get?.('pieces') || '').split(',').map(part => {
        const [productId, variantId, qty] = part.split(':');
        const quantity = Math.floor(Number(qty));
        return productId && quantity > 0 ? { productId, variantId: variantId || null, quantity: Math.min(quantity, 1000) } : null;
    }).filter(Boolean);
}
