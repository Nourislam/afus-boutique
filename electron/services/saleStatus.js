/**
 * Which sales count in the figures (totals, payments, drawer, employees,
 * dashboard). A sale whose status is one of NOT_COUNTED never counts.
 *
 * No screen sets these statuses today; the rule is kept in one place so a
 * future "cancel / void a sale" cannot leak into the figures. A sale without
 * status is an ordinary completed sale. Refunded sales still count: their
 * refunds are taken off separately (returns table).
 */
const NOT_COUNTED = ['voided', 'cancelled'];

/** SQL condition: the sale of the given alias counts (e.g. countedSale('s')). */
function countedSale(alias = 's') {
    const column = alias ? `${alias}.status` : 'status';
    return `COALESCE(${column}, 'completed') NOT IN (${NOT_COUNTED.map(s => `'${s}'`).join(', ')})`;
}

module.exports = { NOT_COUNTED, countedSale };
