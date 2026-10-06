// The five guided exercises of training mode (UX report, section 15).
// Pure data and checks, so they can be tested: each step says what to do,
// which part of the screen to light up, and when it is done. A step is done
// from what really happened in the training copy (sales, exchanges...) or on
// screen (page open, ticket lines).
//
// ctx = { hash, cart: { items, customer }, progress, base, has(selector) }
// progress/base: counts from training:progress now and when the exercise started.

const more = (ctx, key) => (ctx.progress?.[key] ?? 0) > (ctx.base?.[key] ?? 0);
const onPage = (ctx, path) => String(ctx.hash || '').split('?')[0] === `#${path}`;
const lines = (ctx) => ctx.cart?.items || [];

/** Two lines of the same article in two different sizes/colours. */
export function hasTwoSizes(items = []) {
    const byProduct = new Map();
    for (const item of items) {
        if (!item.variant_id) continue;
        const set = byProduct.get(item.product_id) || new Set();
        set.add(item.variant_id);
        byProduct.set(item.product_id, set);
    }
    return [...byProduct.values()].some(set => set.size >= 2);
}

export const EXERCISES = [
    {
        id: 'sale',
        steps: [
            { id: 'openPos', target: 'aside a[href="#/pos"]', done: (c) => onPage(c, '/pos') },
            { id: 'addPiece', target: '[data-testid=pos-search]', done: (c) => lines(c).length > 0 },
            { id: 'pay', target: '[data-testid=pos-pay]', done: (c) => more(c, 'sales') },
        ],
    },
    {
        id: 'twoSizes',
        steps: [
            { id: 'openPos', target: 'aside a[href="#/pos"]', done: (c) => onPage(c, '/pos') },
            { id: 'addTwoSizes', target: '[data-testid=pos-search]', done: (c) => hasTwoSizes(lines(c)) },
            { id: 'pay', target: '[data-testid=pos-pay]', done: (c) => more(c, 'twoSizeSales') },
        ],
        // Paid, but not two sizes of one article
        fail: (c) => more(c, 'sales') && !more(c, 'twoSizeSales') ? 'notTwoSizes' : null,
    },
    {
        id: 'exchange',
        steps: [
            { id: 'openSales', target: 'aside a[href="#/transactions"]', done: (c) => onPage(c, '/transactions') },
            { id: 'openExchange', target: '[data-testid=exchange-btn]', done: (c) => c.has('[data-testid=exchange-modal]') },
            { id: 'confirmExchange', target: '[data-testid=exchange-confirm]', done: (c) => more(c, 'exchanges') },
        ],
    },
    {
        id: 'credit',
        steps: [
            { id: 'openPos', target: 'aside a[href="#/pos"]', done: (c) => onPage(c, '/pos') },
            { id: 'addPiece', target: '[data-testid=pos-search]', done: (c) => lines(c).length > 0 },
            { id: 'pickCustomer', target: '[data-testid=pos-customer]', done: (c) => !!c.cart?.customer },
            { id: 'payCredit', target: '[data-testid=pos-pay]', done: (c) => more(c, 'creditSales') },
        ],
        // Paid in cash or by card instead of kridi
        fail: (c) => more(c, 'sales') && !more(c, 'creditSales') ? 'notCredit' : null,
    },
    {
        id: 'closing',
        steps: [
            { id: 'openClosing', target: '[data-testid=nav-logout]', done: (c) => c.has('[data-testid=shift-close]') },
            { id: 'countAndClose', target: '[data-testid=shift-close]', done: (c) => more(c, 'closedShifts') },
        ],
    },
];

/**
 * Where the exercise is: index of the first step not done yet (steps are done
 * in order: a later step counts only once the ones before are done, except
 * the last one which ends the exercise).
 * @returns {{ step: number, finished: boolean, failed: string|null }}
 */
export function exerciseState(exercise, ctx) {
    const failed = exercise.fail ? exercise.fail(ctx) : null;
    const last = exercise.steps.length - 1;
    if (exercise.steps[last].done(ctx)) return { step: last + 1, finished: true, failed: null };
    if (failed) return { step: last, finished: false, failed };
    let step = 0;
    while (step < last && exercise.steps[step].done(ctx)) step++;
    return { step, finished: false, failed: null };
}
