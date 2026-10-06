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
 * Save a return: the header, its lines, the stock of sellable pieces and the
 * status of the sale (refunded / partially refunded).
 * data: { id, sale_id, return_number, total_refund, reason, employee_id,
 *         items: [{ sale_item_id, product_id, variant_id, quantity, refund_amount, condition }] }
 */
function createReturn(api, data) {
    countedSaleOrThrow(api, data.sale_id);
    api.run(`
        INSERT INTO returns (id, sale_id, return_number, total_refund, reason, employee_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [data.id, data.sale_id, data.return_number, data.total_refund, data.reason ?? null, data.employee_id ?? null]);

    for (const item of data.items) {
        const saleItem = item.sale_item_id
            ? api.get('SELECT product_id, variant_id, product_name, variant_label, quantity FROM sale_items WHERE id = ?', [item.sale_item_id])
            : null;
        // Never more pieces back than were sold on the line (earlier returns included)
        if (saleItem) {
            const left = returnableQuantity(api, item.sale_item_id);
            if (Number(item.quantity) > left) {
                throw catalog.codedError('RETURN_TOO_MANY', {
                    product: saleItem.variant_label ? `${saleItem.product_name} (${saleItem.variant_label})` : saleItem.product_name,
                    left,
                });
            }
        }
        const variantId = item.variant_id || (saleItem && saleItem.variant_id) || null;
        const productId = item.product_id || (saleItem && saleItem.product_id);

        api.run(`
            INSERT INTO return_items (id, return_id, sale_item_id, product_id, variant_id, quantity, refund_amount, condition)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [api.uuid(), data.id, item.sale_item_id ?? null, productId ?? null, variantId, item.quantity, item.refund_amount, item.condition ?? null]);

        // Restock if sellable
        if (item.condition === 'sellable' && productId && api.get('SELECT id FROM products WHERE id = ?', [productId])) {
            catalog.adjustStock(api, {
                productId,
                variantId,
                delta: item.quantity,
                type: 'return',
                reason: `Return: ${data.return_number}`,
                employeeId: data.employee_id || null,
            });
        }
    }

    // Fully refunded when everything sold was given back
    const sale = api.get('SELECT total FROM sales WHERE id = ?', [data.sale_id]);
    const totalReturned = api.get('SELECT SUM(total_refund) AS total FROM returns WHERE sale_id = ?', [data.sale_id])?.total || 0;
    const itemsTotal = api.get('SELECT SUM(quantity * unit_price) AS total FROM sale_items WHERE sale_id = ?', [data.sale_id])?.total || sale.total;
    api.run('UPDATE sales SET status = ? WHERE id = ?', [totalReturned >= itemsTotal ? 'refunded' : 'partially_refunded', data.sale_id]);
    return data;
}

module.exports = { createReturn, returnableQuantity, countedSaleOrThrow };
