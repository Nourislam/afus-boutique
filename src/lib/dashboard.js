// Home screen logic, kept pure so it can be tested: who sees what, the
// "what do I do now?" list, the plain-words comparisons and the date limits.
import { PERMISSIONS } from './permissions';

export const TABS = ['today', 'sales', 'stock', 'cash'];
export const MAX_ALERTS = 5;
export const BACKUP_OLD_DAYS = 7;
const DAY = 24 * 3600 * 1000;

/**
 * What the user may see. The role decides, there is no switch:
 * - shop figures (whole shop, other tabs): whoever may see the reports
 * - profit: the same people (never the cashier)
 * - stock value and purchase prices: the owner only
 */
export function dashboardAccess({ role, can = () => false }) {
    const shop = can(PERMISSIONS.REPORTS_VIEW);
    return {
        shop,
        profit: shop,
        stockValue: role === 'admin',
        tabs: shop ? TABS : ['today'],
        settings: can(PERMISSIONS.SETTINGS_VIEW),
        inventory: can(PERMISSIONS.INVENTORY_VIEW),
        products: can(PERMISSIONS.PRODUCTS_EDIT),
        credit: shop && can(PERMISSIONS.CUSTOMERS_VIEW),
        promotions: can(PERMISSIONS.PROMOTIONS_MANAGE),
    };
}

/** Local "YYYY-MM-DD". */
export function localDate(date) {
    const pad = (v) => String(v).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Same form as sales.created_at (stored in UTC). */
export const toDb = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// Algerian shops count the week from Saturday
const startOfWeek = (d) => { const s = startOfDay(d); s.setDate(s.getDate() - ((s.getDay() + 1) % 7)); return s; };
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const range = (from, to) => ({ startDate: toDb(from), endDate: toDb(to) });

/**
 * Every date limit the screen needs. A period is always compared with the
 * same length of the previous one up to the same moment (today until now
 * against yesterday until the same hour), so the morning never reads "less
 * than yesterday" just because the day is not over.
 */
export function dashboardRanges(now = new Date()) {
    const today = startOfDay(now);
    const week = startOfWeek(now);
    const month = startOfMonth(now);
    const lastMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const lastMonthNow = new Date(Math.min(lastMonth.getTime() + (now - month), month.getTime()));
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const since30 = new Date(today); since30.setDate(today.getDate() - 30);
    return {
        today: localDate(today),
        tomorrow: localDate(tomorrow),
        since30: toDb(since30),
        offsetMinutes: -now.getTimezoneOffset(),
        periods: {
            today: { current: range(today, now), previous: range(new Date(today - DAY), new Date(now - DAY)), bucket: 'hour' },
            week: { current: range(week, now), previous: range(new Date(week - 7 * DAY), new Date(now - 7 * DAY)), bucket: 'day' },
            month: { current: range(month, now), previous: range(lastMonth, lastMonthNow), bucket: 'day' },
        },
        closuresSince: toDb(new Date(today - 7 * DAY)),
    };
}

/** Plain-words comparison: "more than yesterday by 6 000 DA", never a percentage. */
export function compare(current, previous) {
    const a = Number(current) || 0;
    const b = Number(previous) || 0;
    if (a === 0 && b === 0) return { direction: 'none', diff: 0 };
    const diff = Math.round((a - b) * 100) / 100;
    if (Math.abs(diff) < 1) return { direction: 'same', diff: 0 };
    return { direction: diff > 0 ? 'up' : 'down', diff: Math.abs(diff) };
}

/** Morning, afternoon or evening greeting. */
export function greetingKey(hour) {
    if (hour < 12) return 'dash.greet.morning';
    if (hour < 18) return 'dash.greet.afternoon';
    return 'dash.greet.evening';
}

/** A brand-new shop: nothing sold yet, so the screen shows the first steps instead of zeros. */
export const isFirstDay = (steps) => !!steps && !(steps.sales > 0);

/** The profit card: exact, approximate (articles sold without purchase price) or not shown. */
export function profitState(access, soldWithoutCost) {
    if (!access.profit) return 'hidden';
    return soldWithoutCost > 0 ? 'approx' : 'exact';
}

const SEVERITY = {
    printer: 1, labelPrinter: 2, drawer: 3, outOfStock: 4, overdueCredit: 5, backup: 6, lowStock: 7, missingCost: 8, offerEnding: 9,
};

/**
 * "What do I do now?": one line per problem, most serious first. A line only
 * appears when its module is shown and the user may act on it.
 * home: answer of dashboard:home. ctx: { access, features, user, now }.
 * Each alert: { id, tone, icon, text: [key, params], action: { label, to } | { label, closeShift } | { label, recheck } }
 */
export function buildAlerts(home, { access, features = {}, user = {}, now = new Date() }) {
    if (!home) return [];
    const alerts = [];
    const add = (alert) => alerts.push({ ...alert, severity: SEVERITY[alert.id] });
    const todayStart = startOfDay(now).getTime();

    // Printers: the receipt printer matters to everybody selling
    if (home.printers?.receipt === 'missing') {
        add({
            id: 'printer', tone: 'danger', icon: 'printer', text: ['dash.alert.printer'],
            action: access.settings ? { label: 'dash.do.checkPrinter', to: '/settings?tab=receipt' } : { label: 'dash.do.retry', recheck: true },
        });
    }
    if (home.printers?.label === 'missing' && access.settings) {
        add({ id: 'labelPrinter', tone: 'warning', icon: 'printer', text: ['dash.alert.labelPrinter'], action: { label: 'dash.do.checkPrinter', to: '/settings?tab=labelPrinter' } });
    }

    // A drawer left open since a previous day (the cashier: only his own)
    const parse = (v) => new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v)) ? `${String(v).replace(' ', 'T')}Z` : v).getTime();
    const oldShifts = (home.openShifts || []).filter(s => parse(s.start_time) < todayStart && (access.shop || s.employee_id === user.id));
    if (oldShifts.length) {
        const shift = oldShifts[0];
        add({
            id: 'drawer', tone: 'danger', icon: 'drawer',
            text: access.shop ? ['dash.alert.drawerOldOf', { name: shift.employee_name || '' }] : ['dash.alert.drawerOld'],
            action: { label: 'dash.do.closeDrawer', closeShift: shift.id },
        });
    }

    // Sizes / colours at 0 that sell
    if (home.outOfStock?.count > 0 && access.inventory) {
        const names = home.outOfStock.items.map(i => [i.product_name, i.size, i.color].filter(Boolean).join(' ')).join(' · ');
        add({
            id: 'outOfStock', tone: 'danger', icon: 'stock', text: ['dash.alert.outOfStock', { n: home.outOfStock.count, names }],
            action: access.shop && features.purchaseOrders ? { label: 'dash.do.order', to: '/purchase-orders' } : { label: 'dash.do.see', to: '/inventory' },
        });
    }

    // Credit: only with the module shown
    if (features.credit && access.credit && home.overdueCredit?.customers > 0) {
        add({ id: 'overdueCredit', tone: 'warning', icon: 'credit', text: ['dash.alert.overdueCredit', { n: home.overdueCredit.customers, amount: home.overdueCredit.amount }], action: { label: 'dash.do.collect', to: '/credit-sales' } });
    }

    // Backup: never made or older than a week (only who can reach the settings)
    if (access.settings) {
        const last = home.lastBackupAt ? new Date(home.lastBackupAt).getTime() : null;
        const days = last === null ? null : Math.floor((now.getTime() - last) / DAY);
        if (last === null) add({ id: 'backup', tone: 'warning', icon: 'backup', text: ['dash.alert.noBackup'], action: { label: 'dash.do.backupNow', to: '/settings?tab=backup' } });
        else if (days >= BACKUP_OLD_DAYS) add({ id: 'backup', tone: 'warning', icon: 'backup', text: ['dash.alert.oldBackup', { n: days }], action: { label: 'dash.do.backupNow', to: '/settings?tab=backup' } });
    }

    if (access.shop && access.inventory && home.lowCount > 0) {
        add({ id: 'lowStock', tone: 'warning', icon: 'stock', text: ['dash.alert.lowStock', { n: home.lowCount }], action: { label: 'dash.do.see', to: '/inventory' } });
    }
    if (access.shop && access.products && home.missingCost?.count > 0) {
        add({ id: 'missingCost', tone: 'warning', icon: 'price', text: ['dash.alert.missingCost', { n: home.missingCost.count }], action: { label: 'dash.do.completePrices', to: '/products' } });
    }
    if (features.promotions && access.promotions && home.offersEnding?.length) {
        const offer = home.offersEnding[0];
        const key = offer.end_date && String(offer.end_date).slice(0, 10) === localDate(now) ? 'dash.alert.offerEndsToday' : 'dash.alert.offerEndsTomorrow';
        add({ id: 'offerEnding', tone: 'warning', icon: 'offer', text: [key, { name: offer.name }], action: { label: 'dash.do.seeOffer', to: '/offers?tab=promotions' } });
    }

    return alerts.sort((a, b) => a.severity - b.severity);
}

/** How long since an article last sold, in days (or since it was added, if never). */
export function daysWithoutSale(row, now = new Date()) {
    const value = row.last_sale_at || row.created_at;
    if (!value) return null;
    const text = String(value);
    const time = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text).getTime();
    return Number.isNaN(time) ? null : Math.max(0, Math.floor((now.getTime() - time) / DAY));
}
