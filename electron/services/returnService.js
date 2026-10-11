/**
 * Pieces brought back by a customer (returns table). Used by the returns
 * screen and by the exchange (exchangeService.js), so both follow the same
 * rules: never more pieces than are left on the sale line, a voided or
 * cancelled sale cannot be returned, sellable pieces go back into the exact
 * variant that was sold. Call it inside a transaction.
 * `api` is the { all, get, run, uuid } database adapter.
 */
const catalog = require('./catalogService');
const { NOT_COUNTED } = require('./saleStatus');
const { lineRefund } = require('../shared/refund.mjs');
const loyalty = require('./loyaltyService');

/** Pieces of a sale line that can still come back (earlier returns taken off). */
function returnableQuantity(api, saleItemId) {
    const line = api.get('SELECT quantity FROM sale_items WHERE id = ?', [saleItemId]);
    if (!line) return 0;
    const already = api.get('SELECT IFNULL(SUM(quantity), 0) AS n FROM return_items WHERE sale_item_id = ?', [saleItemId]).n;
    return Math.max(0, (Number(line.quantity) || 0) - already);
}

/** The sale must exist and still count (not voided or cancelled). */
function countedSaleOrThrow(api, saleId) {
    const sale = api.get('SELECT * FROM sales WHERE id = ?', [saleId]);
    if (!sale) throw catalog.codedError('SALE_NOT_FOUND', {});
    if (NOT_COUNTED.includes(String(sale.status || '').toLowerCase())) {
        throw catalog.codedError('SALE_NOT_COUNTED', { receipt: sale.receipt_number });
    }
    return sale;
}

/**
 * The lines of a return, checked against the ticket: each one is a line of
 * THIS sale (not of another ticket), a whole number of pieces above 0, and
 * never more than are left on the line once earlier returns and the other
 * lines of this same return are counted.
 */
function checkLines(api, sale, data) {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) throw catalog.codedError('RETURN_NO_LINE', {});
    const asked = new Map();
    return items.map(item => {
        const saleItem = item.sale_item_id
            ? api.get('SELECT id, sale_id, product_id, variant_id, product_name, variant_label, quantity FROM sale_items WHERE id = ?', [item.sale_item_id])
            : null;
        if (!saleItem || saleItem.sale_id !== sale.id) throw catalog.codedError('RETURN_LINE_UNKNOWN', { receipt: sale.receipt_number });
        const quantity = Number(item.quantity);
        const product = saleItem.variant_label ? `${saleItem.product_name} (${saleItem.variant_label})` : saleItem.product_name;
        if (!Number.isInteger(quantity) || quantity <= 0) throw catalog.codedError('RETURN_QUANTITY', { product });
        const total = (asked.get(saleItem.id) || 0) + quantity;
        const left = returnableQuantity(api, saleItem.id);
        if (total > left) throw catalog.codedError('RETURN_TOO_MANY', { product, left });
        asked.set(saleItem.id, total);
        return { saleItem, quantity };
    });
}

/**
 * Save a return: the header, its lines, the stock of sellable pieces and the
 * status of the sale (refunded / partially refunded).
 * data: { id, sale_id, return_number, total_refund, reason, employee_id,
 *         items: [{ sale_item_id, product_id, variant_id, quantity, refund_amount, condition }] }
 */
function createReturn(api, data) {
    const sale = countedSaleOrThrow(api, data.sale_id);
    // 1. Everything is checked before anything is written: a refused line
    //    leaves the debt, the stock and the drawer as they were, even when the
    //    caller has no transaction around it.
    const lines = checkLines(api, sale, data);
    if (api.get('SELECT 1 AS ok FROM returns WHERE id = ? OR return_number = ?', [data.id, data.return_number])) {
        // Sent twice (double click, a retry): the first one stands, nothing is counted again
        throw catalog.codedError('RETURN_ALREADY_SAVED', { number: data.return_number });
    }
    const refundedBefore = api.get('SELECT IFNULL(SUM(total_refund), 0) AS n FROM returns WHERE sale_id = ?', [sale.id]).n;
    data = { ...data, ...paidRefund(api, sale, data) };

    // 2. A sale still owed (kridi): the pieces brought back first lower what is
    //    owed; only what is left over is given back (cash or avoir). An exchange
    //    keeps the debt: the value of the piece pays for the new one.
    const creditReduced = data.exchange ? 0 : lowerDebt(api, data.sale_id, Number(data.total_refund) || 0);
    api.run(`
        INSERT INTO returns (id, sale_id, return_number, total_refund, reason, employee_id, refund_method, credit_reduced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [data.id, data.sale_id, data.return_number, data.total_refund, data.reason ?? null, data.employee_id ?? null,
        data.refund_method === STORE_CREDIT ? STORE_CREDIT : null, creditReduced]);

    data.items.forEach((item, i) => {
        const { saleItem } = lines[i];
        const variantId = saleItem.variant_id || null;
        const productId = saleItem.product_id;

        api.run(`
            INSERT INTO return_items (id, return_id, sale_item_id, product_id, variant_id, quantity, refund_amount, condition)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [api.uuid(), data.id, item.sale_item_id, productId ?? null, variantId, lines[i].quantity, item.refund_amount, item.condition ?? null]);

        // Restock if sellable
        if (item.condition === 'sellable' && productId && api.get('SELECT id FROM products WHERE id = ?', [productId])) {
            catalog.adjustStock(api, {
                productId,
                variantId,
                delta: lines[i].quantity,
                type: 'return',
                reason: `Return: ${data.return_number}`,
                employeeId: data.employee_id || null,
            });
        }
    });

    // Fully refunded when every piece sold was given back
    const pieces = api.get(`SELECT IFNULL(SUM(quantity), 0) AS sold,
        IFNULL((SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE r.sale_id = ?), 0) AS back
        FROM sale_items WHERE sale_id = ?`, [data.sale_id, data.sale_id]);
    api.run('UPDATE sales SET status = ? WHERE id = ?', [pieces.back >= pieces.sold ? 'refunded' : 'partially_refunded', data.sale_id]);

    // The loyalty points of what came back (an exchange keeps them: the value stays spent)
    if (!data.exchange) loyalty.onReturn(api, sale, refundedBefore, Number(data.total_refund) || 0);

    // Store credit (avoir): no money given back, a card the customer spends later
    const handBack = r2((Number(data.total_refund) || 0) - creditReduced);
    const saved = { ...data, credit_reduced: creditReduced, hand_back: handBack };
    if (data.refund_method === STORE_CREDIT && handBack > 0) {
        const customerId = api.get('SELECT customer_id FROM sales WHERE id = ?', [data.sale_id])?.customer_id || null;
        return { ...saved, store_credit: createStoreCredit(api, { returnId: data.id, amount: handBack, customerId, employeeId: data.employee_id || null }) };
    }
    return saved;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Never more money back than was paid: each line gives back at most what its
 * pieces cost after the discounts (shared/refund.mjs), and all the returns of
 * the sale together at most its total. Returns { items, total_refund }.
 */
function paidRefund(api, sale, data) {
    const items = (data.items || []).map(item => {
        const line = item.sale_item_id ? api.get('SELECT quantity, unit_price, discount, total FROM sale_items WHERE id = ?', [item.sale_item_id]) : null;
        if (!line) return item;
        const most = lineRefund(sale, line, item.quantity);
        const asked = Number(item.refund_amount);
        return { ...item, refund_amount: Number.isFinite(asked) && asked >= 0 ? Math.min(r2(asked), most) : most };
    });
    const already = api.get('SELECT IFNULL(SUM(total_refund), 0) AS n FROM returns WHERE sale_id = ?', [sale.id]).n;
    const left = Math.max(0, r2((Number(sale.total) || 0) - (Number(sale.service_charge) || 0) - already));
    const sum = r2(items.reduce((s, i) => s + (Number(i.refund_amount) || 0), 0));
    return { items, total_refund: Math.min(sum, left) };
}

/**
 * Lower the kridi still owed on this sale by up to `amount` (the invoice and
 * the customer's balance). Returns the amount taken off the debt.
 */
function lowerDebt(api, saleId, amount) {
    if (!(amount > 0)) return 0;
    const invoice = api.get('SELECT id, customer_id, amount_due, amount_paid FROM credit_sales WHERE sale_id = ?', [saleId]);
    if (!invoice) return 0;
    const owed = r2((Number(invoice.amount_due) || 0) - (Number(invoice.amount_paid) || 0));
    const reduced = r2(Math.min(amount, Math.max(0, owed)));
    if (!(reduced > 0)) return 0;
    const due = r2((Number(invoice.amount_due) || 0) - reduced);
    const paid = Math.round((Number(invoice.amount_paid) || 0) * 100) >= Math.round(due * 100);
    api.run(`UPDATE credit_sales SET amount_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [due, paid ? 'paid' : ((Number(invoice.amount_paid) || 0) > 0 ? 'partial' : 'pending'), invoice.id]);
    if (invoice.customer_id) {
        api.run('UPDATE customers SET credit_balance = MAX(0, COALESCE(credit_balance, 0) - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [reduced, invoice.customer_id]);
    }
    return reduced;
}

const STORE_CREDIT = 'store_credit';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A new store-credit code: AV + 14 characters, never one already used. */
function storeCreditCode(api) {
    for (;;) {
        let code = 'AV';
        for (let i = 2; i < 16; i++) {
            if (i % 4 === 0) code += '-';
            code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        }
        if (!api.get('SELECT 1 AS ok FROM gift_cards WHERE code = ?', [code])) return code;
    }
}

/**
 * The avoir of a return: a gift card of the amount (kind store_credit), in
 * the customer's name when the sale had one. Paid with like a gift card.
 * Loyalty points turned into money use the same card (kind loyalty).
 */
function createStoreCredit(api, { returnId, amount, customerId = null, employeeId = null, kind = STORE_CREDIT }) {
    const id = api.uuid();
    const code = storeCreditCode(api);
    api.run(`INSERT INTO gift_cards (id, code, initial_balance, current_balance, customer_id, is_active, created_by, kind, return_id)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`, [id, code, amount, amount, customerId, employeeId, kind, returnId]);
    api.run(`INSERT INTO gift_card_transactions (id, gift_card_id, amount, type, balance_before, balance_after)
             VALUES (?, ?, ?, 'issue', 0, ?)`, [api.uuid(), id, amount, amount]);
    return { id, code, amount };
}

module.exports = { createReturn, returnableQuantity, countedSaleOrThrow, createStoreCredit, STORE_CREDIT };
