import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { nextReceiptNumber } = require('../electron/services/receiptNumber');

/** The sales table seen by nextReceiptNumber: the numbers already given. */
const apiWith = (numbers) => ({
    get: (_sql, [like]) => {
        const day = like.replace('%', '');
        const same = numbers.filter(n => n.startsWith(day)).sort((a, b) => b.length - a.length || b.localeCompare(a));
        return same.length ? { receipt_number: same[0] } : undefined;
    },
});

describe('ticket numbers', () => {
    it('use the shop\'s own day (a sale just after midnight is on the new day)', () => {
        expect(nextReceiptNumber(apiWith([]), new Date(2026, 9, 11, 0, 30))).toBe('202610110001');
        expect(nextReceiptNumber(apiWith(['202610100007']), new Date(2026, 9, 10, 23, 59))).toBe('202610100008');
    });

    it('have no limit on the number of tickets in a day', () => {
        expect(nextReceiptNumber(apiWith(['202610109999']), new Date(2026, 9, 10, 12))).toBe('2026101010000');
        expect(nextReceiptNumber(apiWith(['202610109999', '2026101010000']), new Date(2026, 9, 10, 12))).toBe('2026101010001');
    });
});
