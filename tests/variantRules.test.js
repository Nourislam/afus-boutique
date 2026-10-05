import { describe, it, expect } from 'vitest';
import { pickerMode, variantDimensions } from '../src/lib/variantRules';

const pieces = (list) => list.map(([color, size]) => ({ color, size }));

describe('what the cashier is asked (sales screen)', () => {
    it('A: colours only asks only the colour', () => {
        expect(pickerMode({ has_colors: 1, has_sizes: 0 }, pieces([['Black', ''], ['White', '']]))).toBe('color');
    });
    it('B: sizes only asks only the size', () => {
        expect(pickerMode({ has_colors: 0, has_sizes: 1 }, pieces([['', 'S'], ['', 'M']]))).toBe('size');
    });
    it('C: colours and sizes asks both', () => {
        expect(pickerMode({ has_colors: 1, has_sizes: 1 }, pieces([['Black', 'S'], ['Black', 'M']]))).toBe('both');
    });
    it('D: neither asks nothing', () => {
        expect(pickerMode({ has_colors: 0, has_sizes: 0 }, pieces([['', '']]))).toBe('none');
    });
    it('a switch off is never asked, even with old pieces saved; older articles follow their pieces', () => {
        expect(variantDimensions({ has_colors: 0, has_sizes: 1 }, pieces([['Black', 'S']]))).toEqual({ colors: false, sizes: true });
        expect(variantDimensions({}, pieces([['Black', '']]))).toEqual({ colors: true, sizes: false });
    });
});
