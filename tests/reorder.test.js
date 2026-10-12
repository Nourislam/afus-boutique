import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, sell } from './helpers/shop';

const require = createRequire(import.meta.url);
const { reorderSuggestions } = require('../electron/services/reorderService');

describe('what to order again', () => {
    let api, v;
    beforeEach(async () => {
        ({ api, v } = await createShop());
        api.run("UPDATE products SET min_stock_level = 1 WHERE id = 'jean'");
        api.run("UPDATE products SET min_stock_level = 2 WHERE id = 'belt'");
    });

    it('lists each colour / size at its minimum or selling faster than its stock, with 30 days of sales', () => {
        // J-N-38: 4 in stock, 3 sold -> 1 left; J-N-42 at 0
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 3, price: 3000 }]);
        const list = reorderSuggestions(api, { since30: '2000-01-01 00:00:00' });
        const bySku = Object.fromEntries(list.map(r => [r.variant_sku || r.product_name, r]));
        expect(bySku['J-N-38']).toMatchObject({ stock: 1, sold30: 3, quantity: 2 });
        expect(bySku['J-N-42']).toMatchObject({ stock: 0, quantity: 2 });
        // Blue 40 (3 in stock, nothing sold) is not proposed; the belt (10) neither
        expect(bySku['J-B-40']).toBeUndefined();
        expect(bySku.Ceinture).toBeUndefined();
    });
});
