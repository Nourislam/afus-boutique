import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, reopen } from './helpers/shop';

const require = createRequire(import.meta.url);
const importer = require('../electron/services/productImportService');
const excel = require('../electron/services/excelService');
const catalog = require('../electron/services/catalogService');

const run = (api, rows) => api.transaction(() => importer.importProducts(api, rows));
const row = (n, fields) => ({ row: n, ...fields });

describe('Excel quick start', () => {
    let shop, api;
    beforeEach(async () => {
        shop = await createShop();
        api = shop.api;
        api.run("INSERT INTO categories (id, name) VALUES ('robes', 'Robes')");
    });

    it('the template has colour and size, one row per piece, and reads back as valid', () => {
        // Real round trip: the template file is read again like a shop's file
        const parsed = excel.parseBuffer(excel.generateTemplate('products'));
        expect(parsed.success).toBe(true);
        const sheet = parsed.sheets[parsed.sheetNames[0]];
        expect(sheet.headers.slice(0, 5)).toEqual(['name', 'price', 'color', 'size', 'stock_quantity']);
        const { mappings, missingRequired } = excel.detectColumnMappings(sheet.headers, 'products');
        expect(missingRequired).toEqual([]);
        const result = excel.validateAndTransform(sheet.rows, mappings, 'products');
        expect(result.errors).toEqual([]);
        expect(result.valid.map(r => [r.name, r.color, r.size, r.stock_quantity, r.__row])).toEqual([
            ['Jean slim', 'Noir', '38', 4, 2], ['Jean slim', 'Noir', '40', 2, 3], ['Jean slim', 'Bleu', '44', 1, 4], ['Ceinture cuir', undefined, undefined, 10, 5],
        ]);
        // ...and imports as 2 articles
        const report = run(api, result.valid.map(({ __row, ...r }) => ({ ...r, row: __row })));
        expect(report.imported).toEqual([{ name: 'Jean slim', variants: 3, pieces: 7 }, { name: 'Ceinture cuir', variants: 0, pieces: 10 }]);
        // French / Arabic column names are understood
        expect(excel.detectColumnMappings(['Désignation', 'Prix', 'Couleur', 'المقاس', 'Quantité'], 'products').mappings)
            .toEqual({ name: 0, price: 1, color: 2, size: 3, stock_quantity: 4 });
    });

    it('rows of the same model become one article with its sizes/colours, stock and own prices', () => {
        const report = run(api, [
            row(2, { name: 'Robe été', color: 'Rouge', size: 'S', stock_quantity: 3, price: 4500, cost: 2500, category: 'robes' }),
            row(3, { name: 'Robe été', color: 'Rouge', size: 'M', stock_quantity: 2, price: 4500, cost: 2500, category: 'robes' }),
            row(4, { name: 'robe été ', color: 'Vert', size: 'M', stock_quantity: 1, price: 5000, sku: 'ROBE-V-M' }),
            row(5, { name: 'Foulard', stock_quantity: 7, price: 900, cost: 300, sku: 'FOU-1', barcode: '2000000000015' }),
        ]);
        expect(report.rejected).toEqual([]);
        expect(report.imported).toEqual([{ name: 'Robe été', variants: 3, pieces: 6 }, { name: 'Foulard', variants: 0, pieces: 7 }]);
        const robe = api.get("SELECT * FROM products WHERE name = 'Robe été'");
        expect(robe).toMatchObject({ price: 4500, cost: 2500, has_variants: 1, category_id: 'robes', stock_quantity: 6 });
        const variants = catalog.getVariants(api, robe.id);
        expect(variants.map(x => [x.color, x.size, x.stock_quantity, x.price])).toEqual([
            ['Rouge', 'S', 3, null], ['Rouge', 'M', 2, null], ['Vert', 'M', 1, 5000],
        ]);
        expect(variants.every(x => x.sku)).toBe(true); // made by the program when empty
        expect(variants[2].sku).toBe('ROBE-V-M');
        expect(api.get("SELECT stock_quantity, sku, barcode FROM products WHERE name = 'Foulard'")).toEqual({ stock_quantity: 7, sku: 'FOU-1', barcode: '2000000000015' });
        // Stock movements are logged as initial stock
        expect(api.get("SELECT COUNT(*) AS n FROM inventory_logs WHERE type = 'initial'").n).toBeGreaterThanOrEqual(4);
    });

    it('a bad article is rejected with its rows and the reason, the others are imported', async () => {
        const report = run(api, [
            row(2, { name: 'Jean', color: 'Noir', size: '38', stock_quantity: 1, price: 3000 }), // already in the shop
            row(3, { name: 'Chemise', color: 'Blanc', size: 'L', stock_quantity: 2, price: 2500 }),
            row(4, { name: 'Chemise', color: 'Blanc', size: 'L', stock_quantity: 1, price: 2500 }), // same size twice
            row(5, { name: 'Pull', color: 'Gris', size: 'M', stock_quantity: 2, price: 3200 }),
            row(6, { name: 'Pull', stock_quantity: 1, price: 3200 }), // one row without colour/size
            row(7, { name: 'Bonnet', stock_quantity: 1.5, price: 600 }),
            row(8, { name: 'Gants', stock_quantity: 4, price: -1 }),
            row(9, { name: 'Short', color: 'Bleu', size: 'M', stock_quantity: 5, price: 1500, sku: 'J-N-38' }), // code of another article
            row(10, { name: 'Casquette', stock_quantity: 3, price: 700 }),
        ]);
        expect(report.imported.map(x => x.name)).toEqual(['Casquette']);
        const reasons = Object.fromEntries(report.rejected.map(r => [r.name, [r.rows, r.reason.split('|')[0]]]));
        expect(reasons).toEqual({
            Jean: [[2], 'IMPORT_EXISTS'],
            Chemise: [[3, 4], 'VARIANT_DUPLICATE_COMBO'],
            Pull: [[5, 6], 'IMPORT_MIXED'],
            Bonnet: [[7], 'IMPORT_QUANTITY'],
            Gants: [[8], 'IMPORT_NO_PRICE'],
            Short: [[9], 'ID_TAKEN'],
        });
        // Nothing half-saved of the rejected articles
        for (const name of ['Chemise', 'Pull', 'Short']) expect(api.get('SELECT id FROM products WHERE name = ?', [name])).toBeNull();
        const again = await reopen(shop.db);
        expect(again.api.get("SELECT stock_quantity FROM products WHERE name = 'Casquette'").stock_quantity).toBe(3);
    });
});
