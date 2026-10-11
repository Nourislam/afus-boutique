import { describe, it, expect } from 'vitest';
import { creditAging } from '../src/lib/listFilters';
import { VIZ, methodColor } from '../src/lib/vizColors';

describe('kridi by how late it is', () => {
    const today = '2026-10-11';
    it('splits what is still owed: not due, late 30 days or less, later', () => {
        const a = creditAging([
            { amount_due: 5000, amount_paid: 1000, due_date: '2026-11-01' },
            { amount_due: 3000, amount_paid: 0, due_date: null },
            { amount_due: 2000, amount_paid: 500, due_date: '2026-09-20' },
            { amount_due: 1000, amount_paid: 0, due_date: '2026-09-11' },
            { amount_due: 4000, amount_paid: 0, due_date: '2026-08-01' },
            { amount_due: 900, amount_paid: 900, due_date: '2026-01-01' },
        ], today);
        expect(a).toEqual({ notDue: 7000, late: 2500, veryLate: 4000, total: 13500 });
        expect(creditAging([], today)).toEqual({ notDue: 0, late: 0, veryLate: 0, total: 0 });
    });
});

describe('chart colours', () => {
    it('one fixed order per theme, each payment method keeps its colour', () => {
        for (const theme of [VIZ.dark, VIZ.light]) {
            expect(theme.series).toHaveLength(5);
            expect(new Set(theme.series).size).toBe(5);
            expect(methodColor(theme, 'cash')).toBe(theme.series[0]);
            expect(methodColor(theme, 'card')).toBe(theme.series[1]);
            expect(methodColor(theme, 'unknown')).toBe(theme.series[4]);
        }
    });
});
