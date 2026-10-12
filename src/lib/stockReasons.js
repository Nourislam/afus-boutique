// Stock movement reasons are stored as text (older entries in English).
// Known reasons are shown in the interface language; others as typed.
import { t } from '../i18n';

export const MANUAL_REASONS = ['received', 'count', 'damaged', 'returned', 'shrinkage', 'other'];

// Values saved by older versions of the stock adjustment form
const LEGACY = {
    'Received shipment': 'received',
    'Inventory count': 'count',
    'Damaged goods': 'damaged',
    'Returned items': 'returned',
    Shrinkage: 'shrinkage',
    Other: 'other',
};

const PATTERNS = [
    [/^Sale #(.+)$/, 'stock.reason.sale'],
    [/^Bundle Sale: (.+) \(Sale #(.+)\)$/, 'stock.reason.bundleSale'],
    [/^Return: (.+)$/, 'stock.reason.customerReturn'],
    [/^Exchange #(\S+) \((.+)\)$/, 'stock.reason.exchange'],
    [/^Stock count: (.+)$/, 'stock.reason.stockCount'],
    [/^Return #(.+)$/, 'stock.reason.supplierReturn'],
    [/^GRN: (.+)$/, 'stock.reason.receiving'],
    [/^Received PO #(.+)$/, 'stock.reason.purchaseOrder'],
];

export function stockReasonLabel(reason) {
    if (!reason) return t('stock.reason.none');
    const code = MANUAL_REASONS.includes(reason) ? reason : LEGACY[reason];
    if (code) return t(`stock.reason.${code}`);
    for (const [pattern, key] of PATTERNS) {
        const m = pattern.exec(reason);
        if (m) return t(key, { a: m[1], b: m[2] });
    }
    return reason;
}
