import { describe, it, expect } from 'vitest';
import { hasPermission } from '../src/lib/permissions';
import { dashboardAccess, buildAlerts } from '../src/lib/dashboard';
import {
    DASHBOARD_LINKS, STOCK_FILTERS, CREDIT_FILTERS, readFilter, stockMatches, lacksCost, isLateCredit, soldOutOrderLines,
} from '../src/lib/listFilters';

// What a page reads from the link it is opened with (the same as useSearchParams)
const paramsOf = (link) => new URL(link, 'http://app').searchParams;
const NONE = new URLSearchParams('');

// A simple article and a jean with sizes
const belt = { id: 'belt', has_variants: 0, stock_quantity: 0, min_stock_level: 2, cost: 0 };
const shirt = { id: 'shirt', has_variants: 0, stock_quantity: 1, min_stock_level: 2, cost: 900 };
const coat = { id: 'coat', has_variants: 0, stock_quantity: 9, min_stock_level: 2, cost: 5000 };
const jean = { id: 'jean', has_variants: 1, stock_quantity: 5, min_stock_level: 2, cost: 1800 };
const jeanSizes = [
    { id: 'j38', product_id: 'jean', size: '38', stock_quantity: 0, min_stock_level: 2, cost: null },
    { id: 'j40', product_id: 'jean', size: '40', stock_quantity: 5, min_stock_level: 2, cost: 1800 },
];
const variantsOf = (p) => (p.id === 'jean' ? jeanSizes : []);
const filterStock = (link) => [belt, shirt, coat, jean]
    .filter(p => stockMatches(p, variantsOf(p), readFilter(link ? paramsOf(link) : NONE, 'stock', STOCK_FILTERS)))
    .map(p => p.id);

describe('the home screen links', () => {
    const access = dashboardAccess({ role: 'admin', can: (p) => hasPermission('admin', p) });
    const home = {
        printers: {}, openShifts: [], outOfStock: { count: 2, items: [] }, overdueCredit: { customers: 1, amount: 500 },
        lastBackupAt: new Date().toISOString(), lowCount: 3, missingCost: { count: 1 }, offersEnding: [],
    };
    const linkOf = (id, features = { credit: true, purchaseOrders: true }) => buildAlerts(home, { access, features }).find(a => a.id === id).action.to;

    it('carry the filter of each page', () => {
        expect(linkOf('outOfStock')).toBe(DASHBOARD_LINKS.orderSoldOut);
        expect(linkOf('outOfStock', { credit: true, purchaseOrders: false })).toBe(DASHBOARD_LINKS.stockOut);
        expect(linkOf('lowStock')).toBe(DASHBOARD_LINKS.stockLow);
        expect(linkOf('missingCost')).toBe(DASHBOARD_LINKS.productsNoCost);
        expect(linkOf('overdueCredit')).toBe(DASHBOARD_LINKS.creditLate);
        expect(DASHBOARD_LINKS).toEqual({
            stockOut: '/inventory?stock=out',
            stockLow: '/inventory?stock=low',
            productsNoCost: '/products?filter=noCost',
            creditLate: '/credit-sales?status=overdue',
            orderSoldOut: '/purchase-orders?order=soldOut',
        });
    });
});

describe('stock page (/inventory?stock=)', () => {
    it('shows everything when opened without a filter, or with an unknown one', () => {
        expect(filterStock(null)).toEqual(['belt', 'shirt', 'coat', 'jean']);
        expect(filterStock('/inventory?stock=whatever')).toEqual(['belt', 'shirt', 'coat', 'jean']);
    });

    it('"sold out" from the home screen keeps the articles (or one of their sizes) at 0', () => {
        expect(filterStock(DASHBOARD_LINKS.stockOut)).toEqual(['belt', 'jean']); // jean: size 38 at 0
    });

    it('"running low" keeps what is low but not at 0', () => {
        expect(filterStock(DASHBOARD_LINKS.stockLow)).toEqual(['shirt']);
    });
});

describe('products page (/products?filter=noCost)', () => {
    const noCost = (link) => readFilter(link ? paramsOf(link) : NONE, 'filter', ['noCost'], '') === 'noCost';
    const list = (link) => [belt, shirt, coat, jean].filter(p => !noCost(link) || lacksCost(p, variantsOf(p))).map(p => p.id);

    it('shows every article without the filter', () => {
        expect(list(null)).toEqual(['belt', 'shirt', 'coat', 'jean']);
    });

    it('keeps the articles without purchase price, a size without one is enough when the article has none either', () => {
        expect(list(DASHBOARD_LINKS.productsNoCost)).toEqual(['belt']);
        // the size 38 takes the article's price (1 800): it has one. Without it, the jean is listed too
        expect(lacksCost({ ...jean, cost: 0 }, jeanSizes)).toBe(true);
    });
});

describe('credit page (/credit-sales?status=overdue)', () => {
    const today = '2026-10-05';
    const sales = [
        { id: 'late', status: 'partial', amount_due: 5000, amount_paid: 1000, due_date: '2026-09-10' },
        { id: 'notYet', status: 'pending', amount_due: 3000, amount_paid: 0, due_date: '2026-11-01' },
        { id: 'paidLate', status: 'paid', amount_due: 2000, amount_paid: 2000, due_date: '2026-08-01' },
        { id: 'dueToday', status: 'pending', amount_due: 1000, amount_paid: 0, due_date: '2026-10-05T00:00:00.000Z' },
    ];
    const list = (link) => {
        const status = readFilter(link ? paramsOf(link) : NONE, 'status', CREDIT_FILTERS);
        return sales.filter(s => status !== 'overdue' || isLateCredit(s, today)).map(s => s.id);
    };

    it('shows every credit sale without the filter', () => {
        expect(list(null)).toEqual(['late', 'notYet', 'paidLate', 'dueToday']);
    });

    it('"overdue" keeps what is still owed after the due day (the saved status is never "overdue")', () => {
        expect(readFilter(paramsOf(DASHBOARD_LINKS.creditLate), 'status', CREDIT_FILTERS)).toBe('overdue');
        expect(list(DASHBOARD_LINKS.creditLate)).toEqual(['late']);
    });
});

describe('purchase orders (/purchase-orders?order=soldOut)', () => {
    it('prepares one line per colour/size sold out that sells, quantity = sold in 30 days', () => {
        expect(paramsOf(DASHBOARD_LINKS.orderSoldOut).get('order')).toBe('soldOut');
        const lines = soldOutOrderLines([
            { variant_id: 'j38', product_id: 'jean', product_name: 'Jean', color: 'Noir', size: '38', sku: 'J-38', sold: 3 },
            { variant_id: null, product_id: 'belt', product_name: 'Ceinture', sold: 0 },
        ], [jean, belt]);
        expect(lines).toEqual([
            { key: 'j38', product_id: 'jean', variant_id: 'j38', variant_label: 'Noir / 38', sku: 'J-38', product_name: 'Jean', quantity: 3, unit_cost: 1800, total_cost: 5400, tax_rate: 0 },
            { key: 'belt', product_id: 'belt', variant_id: null, variant_label: undefined, sku: undefined, product_name: 'Ceinture', quantity: 1, unit_cost: 0, total_cost: 0, tax_rate: 0 },
        ]);
    });

    it('opens an empty order when the page is opened directly', () => {
        expect(new URLSearchParams('').get('order')).toBeNull();
        expect(soldOutOrderLines([], [])).toEqual([]);
    });
});
