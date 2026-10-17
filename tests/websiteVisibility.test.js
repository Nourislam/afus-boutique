// «يظهر في الموقع»: only the articles the shop ticks are on its website, with
// their own categories, brands, sizes and colours; the rankings keep their order.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const { readInternal } = require('../electron/website/publicData/internal');
const { toPublic } = require('../electron/website/publicData/public');
const catalog = require('../electron/services/catalogService');

const NOW = Date.parse('2026-10-11T12:00:00Z');
const publicOf = (api, internal = readInternal(api, { now: NOW })) => toPublic(internal, { now: NOW });

async function shop() {
    const { api } = await createShop();
    api.run("INSERT INTO categories (id, name) VALUES ('c-jeans', 'Jeans'), ('c-acc', 'Accessoires')");
    api.run("UPDATE products SET category_id = 'c-jeans', brand = 'Levis' WHERE id = 'jean'");
    api.run("UPDATE products SET category_id = 'c-acc', brand = 'Cuirs' WHERE id = 'belt'");
    return api;
}

describe('website visibility per article', () => {
    it('an article saved before the switch, or a new one, is on the website', async () => {
        const api = await shop();
        catalog.saveProduct(api, { id: 'cap', name: 'Casquette', price: 500, stock_quantity: 3 }, [], { isNew: true });
        expect(api.get("SELECT show_on_website AS v FROM products WHERE id = 'cap'").v).toBe(1);
        expect(publicOf(api).products.map(p => p.id).sort()).toEqual(['belt', 'cap', 'jean']);
    });

    it('an unticked article leaves the website with its category, brand, sizes and colours', async () => {
        const api = await shop();
        const jean = api.get("SELECT * FROM products WHERE id = 'jean'");
        catalog.saveProduct(api, { ...jean, show_on_website: false }, catalog.getVariants(api, 'jean'));
        expect(api.get("SELECT show_on_website AS v FROM products WHERE id = 'jean'").v).toBe(0);
        const data = publicOf(api);
        expect(data.products.map(p => p.id)).toEqual(['belt']);
        expect(data.categories.map(c => c.id)).toEqual(['c-acc']);
        expect(data.brands).toEqual(['Cuirs']);
        const text = JSON.stringify(data);
        for (const word of ['Noir', 'Bleu', '"38"', 'Levis', 'Jeans']) expect(text).not.toContain(word);
        // Still in the shop: sold at the till as before
        expect(api.get("SELECT is_active FROM products WHERE id = 'jean'").is_active).toBe(1);
    });

    it('ticking it again puts it back; a save without the field keeps the choice', async () => {
        const api = await shop();
        const belt = api.get("SELECT * FROM products WHERE id = 'belt'");
        catalog.saveProduct(api, { ...belt, show_on_website: 0 }, []);
        catalog.saveProduct(api, { ...belt, show_on_website: undefined, name: 'Ceinture cuir' }, []);
        expect(api.get("SELECT show_on_website AS v FROM products WHERE id = 'belt'").v).toBe(0);
        catalog.saveProduct(api, { ...belt, show_on_website: true }, []);
        expect(publicOf(api).products.some(p => p.id === 'belt')).toBe(true);
    });

    it('best sellers and new articles: hidden ones removed, the order kept (3rd becomes 1st)', async () => {
        const api = await shop();
        catalog.saveProduct(api, { id: 'cap', name: 'Casquette', price: 500, stock_quantity: 3 }, [], { isNew: true });
        api.run("UPDATE products SET show_on_website = 0 WHERE id IN ('jean', 'belt')");
        const internal = { ...readInternal(api, { now: NOW }), bestSellers: ['jean', 'belt', 'cap'], newProducts: ['belt', 'cap', 'jean'] };
        const data = publicOf(api, internal);
        expect(data.bestSellers).toEqual(['cap']);
        expect(data.newProducts).toEqual(['cap']);
        api.run("UPDATE products SET show_on_website = 1 WHERE id = 'belt'");
        const again = publicOf(api, { ...readInternal(api, { now: NOW }), bestSellers: ['jean', 'belt', 'cap'], newProducts: [] });
        expect(again.bestSellers).toEqual(['belt', 'cap']);
    });
});
