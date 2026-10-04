import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { heldLines } from '../src/stores/cartStore';

const require = createRequire(import.meta.url);
const { bindable } = require('../electron/database/init');

describe('database parameters', () => {
    it('stores a field the interface did not send as NULL instead of failing', () => {
        expect(bindable(['a', undefined, 0, null, ''])).toEqual(['a', null, 0, null, '']);
        expect(bindable([])).toEqual([]);
    });
});

describe('tickets put on hold', () => {
    const lines = [{ product_name: 'Robe', quantity: 1 }];
    it('reads the lines saved as JSON', () => {
        expect(heldLines({ items_json: JSON.stringify(lines) })).toEqual(lines);
        expect(heldLines({ items: lines })).toEqual(lines);
    });
    it('also reads lines encoded twice', () => {
        expect(heldLines({ items_json: JSON.stringify(JSON.stringify(lines)) })).toEqual(lines);
    });
    it('gives no lines for a damaged record instead of breaking the sales screen', () => {
        expect(heldLines({ items_json: '{not json' })).toEqual([]);
        expect(heldLines({ items_json: '{"a":1}' })).toEqual([]);
        expect(heldLines({})).toEqual([]);
        expect(heldLines(null)).toEqual([]);
    });
});
