import { describe, it, expect } from 'vitest';
import { EXERCISES, exerciseState, hasTwoSizes } from '../src/lib/trainingExercises';
import { MESSAGES } from '../src/i18n/messages';

const ex = (id) => EXERCISES.find(e => e.id === id);
const base = { sales: 3, twoSizeSales: 0, exchanges: 0, creditSales: 1, closedShifts: 2 };
const ctx = (over = {}) => ({ hash: '#/', cart: { items: [], customer: null }, progress: { ...base }, base, has: () => false, ...over });

describe('guided training exercises', () => {
    it('are the five of the report, each with a title, a goal and a text for every step in 3 languages', () => {
        expect(EXERCISES.map(e => e.id)).toEqual(['sale', 'twoSizes', 'exchange', 'credit', 'closing']);
        for (const e of EXERCISES) {
            for (const key of [`training.ex.${e.id}.title`, `training.ex.${e.id}.goal`, ...e.steps.map(s => `training.step.${s.id}`)]) {
                expect(MESSAGES[key], key).toHaveLength(3);
            }
        }
        expect(MESSAGES['training.fail.notTwoSizes']).toBeDefined();
        expect(MESSAGES['training.fail.notCredit']).toBeDefined();
    });

    it('simple sale: page, a piece in the ticket, paid', () => {
        expect(exerciseState(ex('sale'), ctx())).toEqual({ step: 0, finished: false, failed: null });
        expect(exerciseState(ex('sale'), ctx({ hash: '#/pos' })).step).toBe(1);
        expect(exerciseState(ex('sale'), ctx({ hash: '#/pos', cart: { items: [{ product_id: 'a' }] } })).step).toBe(2);
        expect(exerciseState(ex('sale'), ctx({ progress: { ...base, sales: 4 } })).finished).toBe(true);
    });

    it('two sizes: same article twice in different sizes; another sale is a clear failure', () => {
        expect(hasTwoSizes([{ product_id: 'a', variant_id: 's' }, { product_id: 'a', variant_id: 'm' }])).toBe(true);
        expect(hasTwoSizes([{ product_id: 'a', variant_id: 's' }, { product_id: 'b', variant_id: 'm' }])).toBe(false);
        expect(hasTwoSizes([{ product_id: 'a', variant_id: 's', quantity: 2 }])).toBe(false);
        const two = { items: [{ product_id: 'a', variant_id: 's' }, { product_id: 'a', variant_id: 'm' }] };
        expect(exerciseState(ex('twoSizes'), ctx({ hash: '#/pos', cart: two })).step).toBe(2);
        expect(exerciseState(ex('twoSizes'), ctx({ progress: { ...base, sales: 4 } })).failed).toBe('notTwoSizes');
        expect(exerciseState(ex('twoSizes'), ctx({ progress: { ...base, sales: 4, twoSizeSales: 1 } })).finished).toBe(true);
    });

    it('exchange: sales list, exchange window, confirmed', () => {
        expect(exerciseState(ex('exchange'), ctx({ hash: '#/transactions' })).step).toBe(1);
        expect(exerciseState(ex('exchange'), ctx({ hash: '#/transactions', has: (s) => s.includes('exchange-modal') })).step).toBe(2);
        expect(exerciseState(ex('exchange'), ctx({ progress: { ...base, exchanges: 1 } })).finished).toBe(true);
    });

    it('kridi: customer chosen and paid on credit; paid otherwise is a clear failure', () => {
        const cart = { items: [{ product_id: 'a' }], customer: { id: 'c' } };
        expect(exerciseState(ex('credit'), ctx({ hash: '#/pos', cart })).step).toBe(3);
        expect(exerciseState(ex('credit'), ctx({ progress: { ...base, sales: 4 } })).failed).toBe('notCredit');
        expect(exerciseState(ex('credit'), ctx({ progress: { ...base, sales: 4, creditSales: 2 } })).finished).toBe(true);
    });

    it('drawer closing: closing window, then closed', () => {
        expect(exerciseState(ex('closing'), ctx({ has: (s) => s.includes('shift-close') })).step).toBe(1);
        expect(exerciseState(ex('closing'), ctx({ progress: { ...base, closedShifts: 3 } })).finished).toBe(true);
    });
});
