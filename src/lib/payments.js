// Payment methods used in Algerian shops. The stored value never changes;
// only the label follows the interface language.
import { t } from '../i18n';

const LABEL_KEYS = {
    cash: 'pay.cash',
    card: 'pay.card',
    transfer: 'pay.transfer',
    credit: 'pay.credit',
    gift_card: 'pay.giftCard',
    exchange: 'pay.exchange',
    split: 'pay.split',
    mixed: 'pay.split',
};

export function paymentLabel(method) {
    const key = LABEL_KEYS[method];
    return key ? t(key) : String(method || '').replace(/_/g, ' ');
}

/** Amount handed over by the customer, stored with a cash payment. */
export function cashTendered(payment) {
    if (!payment || payment.method !== 'cash' || !payment.reference) return null;
    try {
        const value = JSON.parse(payment.reference)?.tendered;
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

/** Suggested notes for a cash payment: next round amounts above the total. */
export function quickCashAmounts(total, count = 3) {
    if (!(total > 0)) return [500, 1000, 2000];
    const steps = [100, 500, 1000, 2000, 5000];
    const values = new Set();
    for (const step of steps) {
        const v = Math.ceil(total / step) * step;
        if (v > total) values.add(v);
    }
    return [...values].sort((a, b) => a - b).slice(0, count);
}
