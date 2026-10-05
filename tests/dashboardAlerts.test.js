import { describe, it, expect } from 'vitest';
import { hasPermission } from '../src/lib/permissions';
import {
    dashboardAccess, buildAlerts, compare, dashboardRanges, profitState, isFirstDay, greetingKey, daysWithoutSale, MAX_ALERTS,
} from '../src/lib/dashboard';

const NOW = new Date(2026, 9, 5, 15, 0, 0); // Monday 5 Oct 2026, 15:00 local
const accessFor = (role) => dashboardAccess({ role, can: (p) => hasPermission(role, p) });
const ALL_ON = { credit: true, promotions: true, purchaseOrders: true, suppliers: true };

// A day where everything goes wrong
const BAD_DAY = {
    printers: { receipt: 'missing', label: 'missing' },
    openShifts: [{ id: 'sh1', employee_id: 'cashier1', employee_name: 'Amina', start_time: '2026-10-04 08:00:00' }],
    outOfStock: { count: 3, items: [{ product_name: 'Jean', size: '40' }] },
    overdueCredit: { customers: 2, amount: 9000 },
    lastBackupAt: new Date(2026, 8, 26).toISOString(),
    lowCount: 7,
    missingCost: { count: 4, names: [] },
    offersEnding: [{ id: 'o1', name: 'Soldes', end_date: '2026-10-06' }],
};
const GOOD_DAY = {
    printers: { receipt: 'ok', label: 'ok' }, openShifts: [], outOfStock: { count: 0, items: [] }, overdueCredit: { customers: 0, amount: 0 },
    lastBackupAt: new Date(2026, 9, 5, 8).toISOString(), lowCount: 0, missingCost: { count: 0 }, offersEnding: [],
};
const ids = (home, role, features = ALL_ON, user = { id: 'cashier1' }) => buildAlerts(home, { access: accessFor(role), features, user, now: NOW }).map(a => a.id);

describe('who sees what on the home screen', () => {
    it('the owner sees every tab, the profit and the stock value', () => {
        expect(accessFor('admin')).toMatchObject({ shop: true, profit: true, stockValue: true, tabs: ['today', 'sales', 'stock', 'cash'] });
    });

    it('the manager sees the shop and the profit, not the stock value at purchase price', () => {
        expect(accessFor('manager')).toMatchObject({ shop: true, profit: true, stockValue: false, tabs: ['today', 'sales', 'stock', 'cash'] });
    });

    it('the cashier only sees his own day: no profit, no purchase prices, no other tab', () => {
        const access = accessFor('cashier');
        expect(access).toMatchObject({ shop: false, profit: false, stockValue: false, tabs: ['today'] });
        expect(profitState(access, 0)).toBe('hidden');
    });

    it('marks the profit approximate when articles were sold without purchase price', () => {
        expect(profitState(accessFor('admin'), 4)).toBe('approx');
        expect(profitState(accessFor('admin'), 0)).toBe('exact');
    });
});

describe('"what do I do now?"', () => {
    it('sorts the problems from the most serious and says nothing on a good day', () => {
        expect(ids(BAD_DAY, 'admin')).toEqual(['printer', 'labelPrinter', 'drawer', 'outOfStock', 'overdueCredit', 'backup', 'lowStock', 'missingCost', 'offerEnding']);
        expect(ids(GOOD_DAY, 'admin')).toEqual([]);
        expect(MAX_ALERTS).toBe(5);
    });

    it('each line leads to the right screen', () => {
        const alerts = buildAlerts(BAD_DAY, { access: accessFor('admin'), features: ALL_ON, now: NOW });
        const action = (id) => alerts.find(a => a.id === id).action;
        expect(action('printer')).toMatchObject({ to: '/settings?tab=receipt' });
        expect(action('drawer')).toMatchObject({ closeShift: 'sh1' });
        expect(action('outOfStock')).toMatchObject({ to: '/purchase-orders' });
        expect(action('overdueCredit')).toMatchObject({ to: '/credit-sales' });
        expect(action('backup')).toMatchObject({ to: '/settings?tab=backup' });
        expect(action('missingCost')).toMatchObject({ to: '/products' });
        expect(action('offerEnding')).toMatchObject({ to: '/offers?tab=promotions' });
        expect(alerts.find(a => a.id === 'offerEnding').text[0]).toBe('dash.alert.offerEndsTomorrow');
    });

    it('the cashier gets only what concerns his work: printer, his drawer, sizes at 0', () => {
        expect(ids(BAD_DAY, 'cashier')).toEqual(['printer', 'drawer', 'outOfStock']);
        const printer = buildAlerts(BAD_DAY, { access: accessFor('cashier'), features: ALL_ON, user: { id: 'cashier1' }, now: NOW })[0];
        expect(printer.action).toMatchObject({ recheck: true }); // he cannot open the settings
        expect(ids(BAD_DAY, 'cashier', ALL_ON, { id: 'someone-else' })).not.toContain('drawer');
    });

    it('the manager has no backup line (no settings) and the same shop problems', () => {
        expect(ids(BAD_DAY, 'manager')).toEqual(['printer', 'drawer', 'outOfStock', 'overdueCredit', 'lowStock', 'missingCost', 'offerEnding']);
    });

    it('hides the credit line when the credit module is hidden', () => {
        expect(ids(BAD_DAY, 'admin', { ...ALL_ON, credit: false })).not.toContain('overdueCredit');
        expect(ids(BAD_DAY, 'admin', { ...ALL_ON, credit: true })).toContain('overdueCredit');
    });

    it('hides the offer line when the offers are hidden, and orders from the inventory without purchase orders', () => {
        expect(ids(BAD_DAY, 'admin', { ...ALL_ON, promotions: false })).not.toContain('offerEnding');
        const alerts = buildAlerts(BAD_DAY, { access: accessFor('admin'), features: { ...ALL_ON, purchaseOrders: false }, now: NOW });
        expect(alerts.find(a => a.id === 'outOfStock').action).toMatchObject({ to: '/inventory' });
    });

    it('backup: nothing when recent, a line when older than a week or never made', () => {
        expect(ids({ ...GOOD_DAY }, 'admin')).not.toContain('backup');
        const old = buildAlerts({ ...GOOD_DAY, lastBackupAt: new Date(2026, 8, 26).toISOString() }, { access: accessFor('admin'), features: ALL_ON, now: NOW });
        expect(old[0]).toMatchObject({ id: 'backup', text: ['dash.alert.oldBackup', { n: 9 }] });
        expect(buildAlerts({ ...GOOD_DAY, lastBackupAt: null }, { access: accessFor('admin'), features: ALL_ON, now: NOW })[0].text[0]).toBe('dash.alert.noBackup');
    });

    it('printer: nothing when found or not set, a line when the chosen one is missing', () => {
        expect(ids({ ...GOOD_DAY, printers: { receipt: 'ok', label: 'none' } }, 'admin')).toEqual([]);
        expect(ids({ ...GOOD_DAY, printers: { receipt: 'unknown', label: 'none' } }, 'admin')).toEqual([]);
        expect(ids({ ...GOOD_DAY, printers: { receipt: 'missing', label: 'none' } }, 'admin')).toEqual(['printer']);
    });

    it('articles without purchase price: a line for who can edit the articles', () => {
        expect(ids({ ...GOOD_DAY, missingCost: { count: 4 } }, 'admin')).toEqual(['missingCost']);
        expect(ids({ ...GOOD_DAY, missingCost: { count: 4 } }, 'cashier')).toEqual([]);
    });

    it('no data at all: no line and the first-day screen', () => {
        expect(buildAlerts(null, { access: accessFor('admin') })).toEqual([]);
        expect(isFirstDay({ products: 0, sales: 0, shifts: 0 })).toBe(true);
        expect(isFirstDay({ products: 5, sales: 1, shifts: 1 })).toBe(false);
    });
});

describe('plain words and dates', () => {
    it('compares in money, never in percent', () => {
        expect(compare(48500, 42500)).toEqual({ direction: 'up', diff: 6000 });
        expect(compare(1000, 3000)).toEqual({ direction: 'down', diff: 2000 });
        expect(compare(500, 500)).toEqual({ direction: 'same', diff: 0 });
        expect(compare(0, 0)).toEqual({ direction: 'none', diff: 0 });
    });

    it('compares today with yesterday until the same hour, the week from Saturday', () => {
        const r = dashboardRanges(NOW);
        const local = (s) => new Date(`${s.replace(' ', 'T')}Z`);
        expect(local(r.periods.today.previous.endDate).getTime()).toBe(NOW.getTime() - 24 * 3600 * 1000);
        expect(local(r.periods.week.current.startDate).getTime()).toBe(new Date(2026, 9, 3).getTime()); // Saturday
        expect(r.today).toBe('2026-10-05');
        expect(r.tomorrow).toBe('2026-10-06');
        expect(local(r.periods.month.previous.startDate).getTime()).toBe(new Date(2026, 8, 1).getTime());
    });

    it('greets by the time of day and counts the days without sale', () => {
        expect(greetingKey(9)).toBe('dash.greet.morning');
        expect(greetingKey(14)).toBe('dash.greet.afternoon');
        expect(greetingKey(20)).toBe('dash.greet.evening');
        expect(daysWithoutSale({ last_sale_at: new Date(2026, 7, 6, 15).toISOString() }, NOW)).toBe(60);
        expect(daysWithoutSale({}, NOW)).toBeNull();
    });
});
