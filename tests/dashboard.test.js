import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { applyMigrations } = require('../electron/database/migrations');
const catalog = require('../electron/services/catalogService');
const dashboard = require('../electron/services/dashboardService');

const RANGE = { startDate: '2000-01-01 00:00:00', endDate: '2999-12-31 23:59:59' };

describe('clothing dashboard', () => {
    let api;

    beforeEach(async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        api = createApi(db);
        catalog.saveProduct(api, { id: 'p1', name: 'Jean', price: 3000, cost: 1800 }, [
            { color: 'Noir', size: '40', sku: 'J-1', stock_quantity: 4, min_stock_level: 2 },
            { color: 'Bleu marine', size: '42', sku: 'J-2', stock_quantity: 1, min_stock_level: 2, price: 3200 },
        ], { isNew: true });
        catalog.saveProduct(api, { id: 'p2', name: 'Ceinture', price: 800, cost: 400, stock_quantity: 10 }, [], { isNew: true });

        const [v1, v2] = catalog.getVariants(api, 'p1');
        api.run("INSERT INTO sales (id, receipt_number, subtotal, total, created_at) VALUES ('s1', 'R1', 9000, 9000, '2025-06-01 10:00:00')");
        api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, quantity, unit_price, total)
                 VALUES ('i1', 's1', 'p1', ?, 'Jean', 2, 3000, 6000), ('i2', 's1', 'p1', ?, 'Jean', 1, 3000, 3000)`, [v1.id, v2.id]);
    });

    it('ranks sizes and colours by quantity sold, colours grouped by stable code', () => {
        const result = dashboard.getClothingDashboard(api, RANGE);
        expect(result.topSizes[0]).toMatchObject({ size: '40', quantity: 2 });
        expect(result.topColors[0]).toMatchObject({ color_key: 'black', quantity: 2 });
        expect(result.topColors[1]).toMatchObject({ color_key: 'navy', quantity: 1 });
    });

    it('values the stock at cost and selling price, variants and simple articles', () => {
        const { stockValue } = dashboard.getClothingDashboard(api, RANGE);
        expect(stockValue.units).toBe(15);
        expect(stockValue.cost).toBe(4 * 1800 + 1 * 1800 + 10 * 400);
        expect(stockValue.retail).toBe(4 * 3000 + 1 * 3200 + 10 * 800);
    });

    it('lists the variants running low', () => {
        const { lowStock } = dashboard.getClothingDashboard(api, RANGE);
        expect(lowStock.map(v => v.sku)).toEqual(['J-2']);
    });
});
