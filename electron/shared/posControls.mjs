/**
 * What the sales screen offers, chosen by the owner (Settings › Sales
 * screen), saved in settings.pos_controls. The same rules hide the buttons in
 * the window and refuse the sale in the main process.
 *   discountCashier / discountManager  price lowered by hand on the ticket
 *   cashierMaxDiscount                  how far a cashier with the discount
 *                                       may go alone (%); above it a manager
 *                                       types their PIN. 100 = no limit.
 *   payCard / payTransfer / payCredit   payment methods offered
 * The owner (administrator) always has the discount, managers have no limit.
 * The discount is on: the button shows and the cashier uses it alone. Off:
 * the button is hidden and the main process refuses it.
 */
export const DEFAULT_POS_CONTROLS = {
    discountCashier: true,
    discountManager: true,
    cashierMaxDiscount: 100,
    payCard: true,
    payTransfer: true,
    payCredit: true,
};

export function resolvePosControls(saved) {
    const value = saved && typeof saved === 'object' ? saved : {};
    const out = {};
    for (const key of Object.keys(DEFAULT_POS_CONTROLS)) {
        if (typeof DEFAULT_POS_CONTROLS[key] === 'number') {
            const n = Number(value[key]);
            out[key] = value[key] === undefined || value[key] === null || value[key] === '' || !Number.isFinite(n)
                ? DEFAULT_POS_CONTROLS[key] : Math.min(100, Math.max(0, n));
        } else {
            out[key] = value[key] === undefined ? DEFAULT_POS_CONTROLS[key] : value[key] === true;
        }
    }
    return out;
}

/** May this role lower a price by hand? */
export function canDiscount(controls, role) {
    const c = resolvePosControls(controls);
    const r = String(role || '').toLowerCase();
    if (r === 'admin') return true;
    if (r === 'manager') return c.discountManager;
    return c.discountCashier;
}

const METHOD_KEYS = { card: 'payCard', transfer: 'payTransfer', credit: 'payCredit' };

/** Is this payment method offered? (cash and gift cards always are) */
export function methodAllowed(controls, method) {
    const key = METHOD_KEYS[method];
    return key ? resolvePosControls(controls)[key] : true;
}
