/**
 * Exchange: a piece brought back for another one (other size, colour or
 * article). Built on the returns: the old piece is a normal return of the
 * original sale, the new piece a small new sale, and an `exchanges` row links
 * the two. So every figure (sales, refunds, stock, best sellers, drawer)
 * stays right without special cases.
 *
 * Money:
 * - credit: what the customer really paid for the pieces brought back (their
 *   share of the ticket after discounts, TVA of that day included);
 * - new total: today's price of the new pieces, today's TVA;
 * - difference = new total - credit: > 0 the customer pays it, < 0 the shop
 *   gives it back in cash, 0 nothing to pay.
 * The credit is recorded as an "exchange" payment of the new sale, so only
 * the difference moves the drawer.
 */
const catalog = require('./catalogService');
const { createReturn, returnableQuantity, countedSaleOrThrow } = require('./returnService');
const { nextReceiptNumber } = require('./receiptNumber');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const PAY_METHODS = ['cash', 'card', 'transfer'];

/** What the customer paid for one piece of the line (ticket discount and TVA of that day included). */
function paidPerPiece(sale, line) {
    const quantity = Number(line.quantity) || 0;
    if (quantity <= 0) return 0;
    const subtotal = Number(sale.subtotal) || 0;
    const lineTotal = Number(line.total) || 0;
    if (subtotal <= 0) return 0;
    const paidForGoods = (Number(sale.total) || 0) - (Number(sale.service_charge) || 0);
    return (lineTotal / quantity) * (paidForGoods / subtotal);
}

/** Today's price and TVA of `quantity` new pieces. tax: { enabled, rate, inclusive } */
function newPiecesPrice(product, variant, quantity, tax = {}) {
    const unit = catalog.effectivePrice(product, variant);
    const line = r2(unit * quantity);
    const rate = tax.enabled ? ((Number(product.tax_rate) > 0 ? Number(product.tax_rate) : Number(tax.rate) || 0) / 100) : 0;
    const taxAmount = rate > 0 ? r2(tax.inclusive === false ? line * rate : line - line / (1 + rate)) : 0;
    const total = tax.inclusive === false ? r2(line + taxAmount) : line;
    return { unit, line, taxAmount, total };
}

/** The same figures the screen shows before confirming (nothing is saved). */
function previewExchange(api, input, tax = {}) {
    const sale = countedSaleOrThrow(api, input.sale_id);
    if ((api.get("SELECT 1 AS x FROM payments WHERE sale_id = ? AND LOWER(method) = 'credit'", [sale.id]))) {
        throw catalog.codedError('EXCHANGE_CREDIT_SALE', { receipt: sale.receipt_number });
    }
    const line = api.get('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?', [input.sale_item_id, sale.id]);
    if (!line) throw catalog.codedError('SALE_NOT_FOUND', {});
    const quantity = parseInt(input.quantity, 10);
    const label = line.variant_label ? `${line.product_name} (${line.variant_label})` : line.product_name;
    if (!Number.isInteger(quantity) || quantity <= 0) throw catalog.codedError('EXCHANGE_QUANTITY', {});
    const left = returnableQuantity(api, line.id);
    if (quantity > left) throw catalog.codedError('RETURN_TOO_MANY', { product: label, left });

    const variant = input.new_variant_id ? api.get('SELECT * FROM product_variants WHERE id = ?', [input.new_variant_id]) : null;
    const product = api.get('SELECT * FROM products WHERE id = ?', [variant ? variant.product_id : input.new_product_id]);
    if (!product || !product.is_active || (variant && !variant.is_active)) throw catalog.codedError('VARIANT_GONE', { product: label });
    if (product.has_variants && !variant) throw catalog.codedError('VARIANT_REQUIRED', { product: product.name });
    if ((variant ? variant.id : null) === (line.variant_id || null) && product.id === line.product_id) {
        throw catalog.codedError('EXCHANGE_SAME_PIECE', {});
    }
    const available = variant ? (Number(variant.stock_quantity) || 0) : (Number(product.stock_quantity) || 0);
    const newLabel = variant ? `${product.name} (${catalog.variantLabel(variant)})` : product.name;
    if (quantity > available) throw catalog.codedError('STOCK_INSUFFICIENT', { product: newLabel, available });

    const credit = r2(paidPerPiece(sale, line) * quantity);
    const price = newPiecesPrice(product, variant, quantity, tax);
    return {
        sale, line, product, variant, quantity, credit,
        newUnitPrice: price.unit, newLine: price.line, newTax: price.taxAmount, newTotal: price.total,
        difference: r2(price.total - credit),
        newLabel,
    };
}

/**
 * Save the exchange (call inside a transaction).
 * input: { id?, sale_id, sale_item_id, quantity, new_variant_id | new_product_id,
 *          condition ('sellable' | 'damaged'), payment_method, employee_id, reason }
 */
function createExchange(api, input, tax = {}) {
    const p = previewExchange(api, input, tax);
    const employeeId = input.employee_id || null;
    const exchangeId = input.id || api.uuid();
    const returnId = api.uuid();
    const saleId = api.uuid();
    const receipt = nextReceiptNumber(api);

    createReturn(api, {
        id: returnId,
        sale_id: p.sale.id,
        return_number: `EXC-${receipt}`,
        total_refund: p.credit,
        reason: input.reason || 'exchange',
        employee_id: employeeId,
        items: [{
            sale_item_id: p.line.id, product_id: p.line.product_id, variant_id: p.line.variant_id,
            quantity: p.quantity, refund_amount: p.credit, condition: input.condition === 'damaged' ? 'damaged' : 'sellable',
        }],
    });

    api.run(`
        INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, tax_amount, discount_amount, total, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'completed', ?)
    `, [saleId, receipt, employeeId, p.sale.customer_id || null, p.newLine, p.newTax, p.newTotal, `exchange:${p.sale.receipt_number}`]);
    const unitCost = p.variant && p.variant.cost !== null && p.variant.cost !== undefined ? p.variant.cost : (p.product.cost || 0);
    api.run(`
        INSERT INTO sale_items (id, sale_id, product_id, variant_id, variant_label, sku, product_name, quantity, unit_price, discount, tax_amount, total, unit_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `, [api.uuid(), saleId, p.product.id, p.variant ? p.variant.id : null, p.variant ? catalog.variantLabel(p.variant) : null,
        p.variant ? p.variant.sku : (p.product.sku || null), p.product.name, p.quantity, p.newUnitPrice, p.newTax, p.newLine, unitCost]);
    catalog.adjustStock(api, {
        productId: p.product.id, variantId: p.variant ? p.variant.id : null, delta: -p.quantity,
        type: 'sale', reason: `Exchange #${receipt} (${p.sale.receipt_number})`, employeeId,
    });

    // The credit pays the new pieces first; the customer adds the rest
    const usedCredit = r2(Math.min(p.credit, p.newTotal));
    if (usedCredit > 0) {
        api.run('INSERT INTO payments (id, sale_id, method, amount, reference) VALUES (?, ?, ?, ?, ?)', [api.uuid(), saleId, 'exchange', usedCredit, p.sale.receipt_number]);
    }
    const method = PAY_METHODS.includes(input.payment_method) ? input.payment_method : 'cash';
    if (p.difference > 0) {
        api.run('INSERT INTO payments (id, sale_id, method, amount, reference) VALUES (?, ?, ?, ?, NULL)', [api.uuid(), saleId, method, p.difference]);
    }

    api.run(`
        INSERT INTO exchanges (id, original_sale_id, sale_item_id, return_id, sale_id, quantity, credit, new_total, difference, refund_method, employee_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [exchangeId, p.sale.id, p.line.id, returnId, saleId, p.quantity, p.credit, p.newTotal, p.difference, p.difference < 0 ? 'cash' : null, employeeId]);

    return {
        id: exchangeId, return_id: returnId, sale_id: saleId, receipt_number: receipt,
        original_receipt: p.sale.receipt_number, quantity: p.quantity,
        credit: p.credit, new_total: p.newTotal, difference: p.difference,
        payment_method: p.difference > 0 ? method : null,
    };
}

/** Exchanges of a sale (for its history). */
function exchangesOfSale(api, saleId) {
    return api.all(`
        SELECT x.*, s.receipt_number AS new_receipt
        FROM exchanges x LEFT JOIN sales s ON s.id = x.sale_id
        WHERE x.original_sale_id = ? ORDER BY x.created_at
    `, [saleId]);
}

module.exports = { previewExchange, createExchange, exchangesOfSale, paidPerPiece };
