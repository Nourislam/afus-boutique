import { describe, it, expect } from 'vitest';
import { resolveUiMode, SIMPLE_PATHS } from '../src/lib/uiMode';

describe('simple / full menu', () => {
    it('keeps the full menu for shops set up before the option, and accepts only known modes', () => {
        expect(resolveUiMode(undefined)).toBe('full');
        expect(resolveUiMode('simple')).toBe('simple');
        expect(resolveUiMode('full')).toBe('full');
        expect(resolveUiMode('other')).toBe('full');
    });
    it('shows sales, articles, stock, labels, credit and reports in simple mode', () => {
        expect(SIMPLE_PATHS).toEqual(['/pos', '/products', '/inventory', '/labels', '/credit-sales', '/reports']);
    });
});
