import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { createShop, sell } from './helpers/shop';

const require = createRequire(import.meta.url);
const catalog = require('../electron/services/catalogService');
const partners = require('../electron/services/partnersService');
const stockCounts = require('../electron/services/stockCountService');

describe('no cap of 100 (or 10, 50, 1000…) on the lists of the shop', () => {
    it('120 pieces, 105 sales of a customer, 105 stock counts: all returned', async () => {
        const { api } = await createShop();
        for (let i = 0; i < 115; i++) catalog.saveProduct(api, { id: `a${i}`, name: `Art ${i}`, price: 100 }, [{ size: 'M', sku: `CAP-${i}`, stock_quantity: 1 }], { isNew: true });
        expect(catalog.searchVariants(api, 'CAP-')).toHaveLength(115);
        expect(catalog.searchVariants(api, '')).toHaveLength(120);
        api.run("INSERT INTO customers (id, name) VALUES ('c1', 'Karima')");
        for (let i = 0; i < 105; i++) sell(api, `s${i}`, [{ product: 'belt', qty: 0, price: 0 }], { customer: 'c1' });
        expect(partners.customerHistory(api, 'c1').sales).toHaveLength(105);
        for (let i = 0; i < 105; i++) api.run("INSERT INTO stock_counts (id, status, created_at) VALUES (?, 'cancelled', datetime('now'))", [`sc${i}`]);
        expect(stockCounts.listCounts(api)).toHaveLength(105);
    });

    it('the main process asks the database for every row unless a page size is given', () => {
        const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
        // A fixed LIMIT is only allowed for one row, or top-5 summaries
        const fixed = [...main.matchAll(/LIMIT (\d+)/g)].map(m => Number(m[1])).filter(n => n !== 1 && n !== 5);
        expect(fixed).toEqual([]);
        expect(main).not.toMatch(/LIMIT 100\b|LIMIT 50\b|\.slice\(0, 100\)|limit = (10|20|50|100)\b/);
    });
});
