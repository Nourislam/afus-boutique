/**
 * What a piece of a sale line was really paid: its share of the ticket after
 * the line's own discount and the ticket's discount (and with the TVA when
 * it was added on top). A return or an exchange gives back this, never more
 * than the customer paid. The returns screen and the main process use the
 * same rule.
 */
export function paidPerPiece(sale, line) {
    const quantity = Number(line?.quantity) || 0;
    if (quantity <= 0) return 0;
    const lineTotal = line.total === null || line.total === undefined
        ? quantity * (Number(line.unit_price) || 0) - (Number(line.discount) || 0)
        : Number(line.total) || 0;
    const subtotal = Number(sale?.subtotal) || 0;
    if (subtotal <= 0) return Math.max(0, lineTotal / quantity);
    const paidForGoods = (Number(sale.total) || 0) - (Number(sale.service_charge) || 0);
    return Math.max(0, (lineTotal / quantity) * (paidForGoods / subtotal));
}

export const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The most `quantity` pieces of this line can give back. */
export function lineRefund(sale, line, quantity) {
    return roundMoney(paidPerPiece(sale, line) * (Number(quantity) || 0));
}
