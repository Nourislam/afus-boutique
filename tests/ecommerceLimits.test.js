import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ShopifyAdapter = require('../electron/ecommerce/adapters/ShopifyAdapter');
const WooCommerceAdapter = require('../electron/ecommerce/adapters/WooCommerceAdapter');

describe('online store: no article left out after the first page', () => {
    it('Shopify stock of 130 items is read 50 at a time, every item', async () => {
        const shop = new ShopifyAdapter({ store_url: 'x.myshopify.com', api_key: 't' });
        shop.locationId = 1;
        const asked = [];
        shop.makeRequest = async (_m, endpoint) => {
            const ids = /inventory_item_ids=([^&]+)/.exec(endpoint)[1].split(',');
            asked.push(ids.length);
            return { inventory_levels: ids.map(id => ({ inventory_item_id: id, location_id: 1, available: 2 })) };
        };
        const ids = Array.from({ length: 130 }, (_, i) => String(i + 1));
        const levels = await shop.fetchInventory(ids);
        expect(levels).toHaveLength(130);
        expect(asked).toEqual([50, 50, 30]);
    });

    it('Shopify product pages follow the Link header', () => {
        const link = '<https://x.myshopify.com/admin/api/2024-01/products.json?limit=50&page_info=abc123>; rel="next", <https://x/p?page_info=zzz>; rel="previous"';
        expect(ShopifyAdapter.nextPageInfo(link)).toBe('abc123');
        expect(ShopifyAdapter.nextPageInfo('')).toBeNull();
    });

    it('WooCommerce stock is read for every product asked (was 20)', async () => {
        const woo = new WooCommerceAdapter({ store_url: 'shop.example', api_key: 'k', api_secret: 's' });
        let calls = 0;
        woo.makeRequest = async () => { calls++; return { id: calls, stock_quantity: 1 }; };
        const result = await woo.fetchInventory(Array.from({ length: 101 }, (_, i) => String(i + 1)));
        expect(calls).toBe(101);
        expect(result).toHaveLength(101);
    });
});
