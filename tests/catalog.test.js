import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { applyMigrations, getPendingMigrations, getColumns } = require('../electron/database/migrations');
const catalog = require('../electron/services/catalogService');

function makeVariants(colors, sizes, stock = 5) {
    const list = [];
    for (const color of colors) {
        for (const size of sizes) list.push({ color, size, stock_quantity: stock, min_stock_level: 2 });
    }
    return list;
}

describe('versioned migrations', () => {
    it('upgrades a legacy database in place and keeps existing data', async () => {
        const db = await createLegacyDb();
        db.run("INSERT INTO products (id, sku, name, price, stock_quantity) VALUES ('p1', 'OLD-1', 'Old product', 10, 7)");
        db.run("INSERT INTO sales (id, receipt_number, subtotal, total) VALUES ('s1', 'R-1', 10, 10)");
        db.run("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, total) VALUES ('si1', 's1', 'p1', 'Old product', 1, 10, 10)");

        const applied = applyMigrations(db);
        expect(applied).toContain('2025_01_clothing_variants');

        expect(getColumns(db, 'products')).toEqual(expect.arrayContaining(['brand', 'has_variants']));
        expect(getColumns(db, 'sale_items')).toEqual(expect.arrayContaining(['variant_id', 'variant_label', 'sku']));
        expect(getColumns(db, 'inventory_logs')).toContain('variant_id');

        const api = createApi(db);
        expect(api.get('SELECT * FROM products WHERE id = ?', ['p1'])).toMatchObject({ name: 'Old product', stock_quantity: 7, has_variants: 0 });
        expect(api.get('SELECT COUNT(*) AS n FROM sale_items').n).toBe(1);
    });

    it('removes the legacy online activation data and disables the old hosted sync', async () => {
        const db = await createLegacyDb();
        db.run("INSERT INTO settings (key, value) VALUES ('activation_data', ?)", [JSON.stringify({ uid: 'x', email: 'a@b.c' })]);
        db.run("INSERT INTO settings (key, value) VALUES ('sync_settings', ?)", [JSON.stringify({ provider: 'firebase', interval: '5' })]);
        db.run("INSERT INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify({ businessName: 'My Shop' })]);
        applyMigrations(db);
        const api = createApi(db);
        expect(api.get("SELECT * FROM settings WHERE key = 'activation_data'")).toBeNull();
        expect(JSON.parse(api.get("SELECT value FROM settings WHERE key = 'sync_settings'").value)).toEqual({ provider: 'none', interval: '5' });
        // Shop data is untouched
        expect(JSON.parse(api.get("SELECT value FROM settings WHERE key = 'store_config'").value).businessName).toBe('My Shop');
    });

    it('creates the brands list (defaults + brands already used) and colour codes for existing variants', async () => {
        const db = await createLegacyDb();
        // Bring the database to the state just before the brands migration
        applyMigrations(db);
        db.run("DELETE FROM schema_migrations WHERE version = '2025_03_brands_and_color_codes'");
        db.run('DROP TABLE brands');
        db.run('ALTER TABLE product_variants DROP COLUMN color_code');
        db.run("INSERT INTO products (id, name, price, brand, has_variants) VALUES ('p1', 'Tee', 10, 'Marque Locale', 1)");
        db.run("INSERT INTO product_variants (id, product_id, color, size, sku, qr_code) VALUES ('v1', 'p1', 'Noir', 'M', 'A-1', 'A-1'), ('v2', 'p1', 'أبيض', 'L', 'A-2', 'A-2'), ('v3', 'p1', 'Fuchsia', 'L', 'A-3', 'A-3')");

        applyMigrations(db);
        const api = createApi(db);
        const brands = api.all('SELECT name FROM brands').map(b => b.name);
        expect(brands).toEqual(expect.arrayContaining(['Nike', 'LC Waikiki', 'Marque Locale']));
        const codes = Object.fromEntries(api.all('SELECT id, color_code, color, sku FROM product_variants').map(v => [v.id, v]));
        expect(codes.v1.color_code).toBe('black');
        expect(codes.v2.color_code).toBe('white');
        expect(codes.v3.color_code).toBeNull();
        // Original text and SKUs are untouched
        expect(codes.v1.color).toBe('Noir');
        expect(codes.v1.sku).toBe('A-1');
    });

    it('clears only the untouched English default receipt footer', async () => {
        const db = await createLegacyDb();
        db.run("INSERT INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify({ businessName: 'A', receiptFooter: 'Thank you for your purchase!', taxRate: 0 })]);
        applyMigrations(db);
        const api = createApi(db);
        const config = JSON.parse(api.get("SELECT value FROM settings WHERE key = 'store_config'").value);
        expect(config).toMatchObject({ businessName: 'A', receiptFooter: '', taxRate: 0 });

        const db2 = await createLegacyDb();
        db2.run("INSERT INTO settings (key, value) VALUES ('store_config', ?)", [JSON.stringify({ receiptFooter: 'Échange sous 7 jours' })]);
        applyMigrations(db2);
        const kept = JSON.parse(createApi(db2).get("SELECT value FROM settings WHERE key = 'store_config'").value);
        expect(kept.receiptFooter).toBe('Échange sous 7 jours');
    });

    it('is idempotent', async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        expect(getPendingMigrations(db)).toHaveLength(0);
        expect(applyMigrations(db)).toEqual([]);
    });

    it('calls beforeApply (backup hook) only when something is pending', async () => {
        const db = await createLegacyDb();
        let calls = 0;
        applyMigrations(db, { beforeApply: () => { calls++; } });
        applyMigrations(db, { beforeApply: () => { calls++; } });
        expect(calls).toBe(1);
    });
});

describe('catalog service', () => {
    let db;
    let api;

    beforeEach(async () => {
        db = await createLegacyDb();
        applyMigrations(db);
        api = createApi(db);
    });

    it('generates deterministic, unique SKUs', () => {
        const variants = makeVariants(['Black', 'White'], ['M', 'L']);
        const skus = catalog.generateSkus(api, { name: 'T-Shirt Nike Basic' }, variants);
        expect(skus).toEqual(['TSH-BLK-M-001', 'TSH-BLK-L-001', 'TSH-WHT-M-001', 'TSH-WHT-L-001']);
        expect(catalog.generateSkus(api, { name: 'T-Shirt Nike Basic' }, variants)).toEqual(skus);
    });

    it('maps French and Arabic colour names to the same codes', () => {
        const skus = catalog.generateSkus(api, { name: 'Robe' }, [{ color: 'Noir', size: 'S' }, { color: 'أبيض', size: 'S' }]);
        expect(skus).toEqual(['ROB-BLK-S-001', 'ROB-WHT-S-001']);
    });

    it('skips sequence numbers already taken in the database', () => {
        const variants = makeVariants(['Black'], ['M']).map(v => ({ ...v, sku: 'TSH-BLK-M-001' }));
        catalog.saveProduct(api, { id: 'p1', name: 'T-Shirt', price: 20 }, variants, { isNew: true });
        const [next] = catalog.generateSkus(api, { name: 'T-Shirt Other' }, [{ color: 'Black', size: 'M' }]);
        expect(next).toBe('TSH-BLK-M-002');
    });

    it('creates a product with variants, initial stock logs and derived product stock', () => {
        const variants = makeVariants(['Black', 'White'], ['S', 'M']);
        const skus = catalog.generateSkus(api, { name: 'Tee' }, variants);
        variants.forEach((v, i) => { v.sku = skus[i]; });
        variants[1].stock_quantity = 8;

        const result = catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 25 }, variants, { isNew: true });
        expect(result.product.has_variants).toBe(1);
        expect(result.variants).toHaveLength(4);
        expect(result.product.stock_quantity).toBe(5 + 8 + 5 + 5);
        // QR code defaults to the SKU
        expect(result.variants[0].qr_code).toBe(result.variants[0].sku);
        const logs = api.all("SELECT * FROM inventory_logs WHERE type = 'initial'");
        expect(logs).toHaveLength(4);
        expect(logs.every(l => l.variant_id)).toBe(true);
    });

    it('rejects duplicate SKUs within a product and across products', () => {
        const dup = [
            { color: 'Black', size: 'M', sku: 'DUP-1', stock_quantity: 1 },
            { color: 'Black', size: 'L', sku: 'dup-1', stock_quantity: 1 },
        ];
        expect(() => catalog.saveProduct(api, { id: 'p1', name: 'A', price: 1 }, dup, { isNew: true })).toThrow(/ID_DUPLICATE_IN_FORM/);

        catalog.saveProduct(api, { id: 'p1', name: 'A', price: 1 }, [{ color: 'Black', size: 'M', sku: 'AAA-1', stock_quantity: 1 }], { isNew: true });
        expect(() => catalog.saveProduct(api, { id: 'p2', name: 'B', price: 1 }, [{ color: 'Red', size: 'M', sku: 'aaa-1', stock_quantity: 1 }], { isNew: true }))
            .toThrow(/ID_TAKEN\|.*"owner":"A \(/);
        // A simple product cannot take a variant SKU either
        expect(() => catalog.saveProduct(api, { id: 'p3', name: 'C', price: 1, sku: 'AAA-1' }, [], { isNew: true })).toThrow(/ID_TAKEN/);
        // Nothing was half-written by the failed saves
        expect(api.get("SELECT COUNT(*) AS n FROM products WHERE id IN ('p2','p3')").n).toBe(0);
    });

    it('rejects identifiers that scanners cannot type reliably', () => {
        expect(catalog.validateIdentifier('TSH BLK')).toMatch(/^ID_INVALID_CHARS\|/);
        expect(catalog.validateIdentifier('تيشيرت')).toMatch(/^ID_INVALID_CHARS\|/);
        expect(catalog.validateIdentifier('tsh-blk-m-001')).toBeNull();
    });

    it('looks up variants by QR, SKU and barcode, case-insensitively', () => {
        catalog.saveProduct(api, { id: 'p1', name: 'Jeans', price: 50 }, [
            { color: 'Blue', size: '32', sku: 'JEA-BLU-32-001', barcode: '6130000000017', price: 55, stock_quantity: 3 },
        ], { isNew: true });

        const byQr = catalog.lookupCode(api, ' jea-blu-32-001\n');
        expect(byQr.type).toBe('variant');
        expect(byQr.variant.size).toBe('32');
        expect(byQr.variant.effective_price).toBe(55);

        expect(catalog.lookupCode(api, '6130000000017').variant.sku).toBe('JEA-BLU-32-001');
        expect(catalog.lookupCode(api, 'NOPE')).toBeNull();
    });

    it('keeps the printed QR valid after the SKU changes, until it is regenerated', () => {
        const { variants } = catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 10 }, [
            { color: 'Red', size: 'M', sku: 'TEE-RED-M-001', stock_quantity: 1 },
        ], { isNew: true });
        const v = variants[0];
        catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 12 }, [{ ...v, sku: 'TEE-RED-M-900' }]);

        expect(catalog.lookupCode(api, 'TEE-RED-M-001').variant.id).toBe(v.id);
        expect(catalog.lookupCode(api, 'TEE-RED-M-900').variant.id).toBe(v.id);

        const regenerated = catalog.regenerateQrCode(api, v.id);
        expect(regenerated.qr_code).toBe('TEE-RED-M-900');
    });

    it('moves stock only on the chosen variant and logs it', () => {
        const { variants } = catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 10 }, [
            { color: 'Black', size: 'M', sku: 'T-B-M', stock_quantity: 8 },
            { color: 'Black', size: 'L', sku: 'T-B-L', stock_quantity: 5 },
        ], { isNew: true });
        const blackM = variants.find(v => v.size === 'M');

        catalog.adjustStock(api, { productId: 'p1', variantId: blackM.id, delta: -1, type: 'sale', reason: 'Sale #1' });

        const after = catalog.getVariants(api, 'p1');
        expect(after.find(v => v.size === 'M').stock_quantity).toBe(7);
        expect(after.find(v => v.size === 'L').stock_quantity).toBe(5);
        expect(api.get('SELECT stock_quantity FROM products WHERE id = ?', ['p1']).stock_quantity).toBe(12);
        const log = api.get("SELECT * FROM inventory_logs WHERE type = 'sale'");
        expect(log).toMatchObject({ variant_id: blackM.id, quantity_change: -1, quantity_before: 8, quantity_after: 7 });
    });

    it('refuses product-level stock moves on products with variants', () => {
        catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 10 }, [{ color: 'Black', size: 'M', sku: 'X-1', stock_quantity: 1 }], { isNew: true });
        expect(() => catalog.adjustStock(api, { productId: 'p1', delta: -1, type: 'sale' })).toThrow(/VARIANT_REQUIRED/);
    });

    it('keeps simple products (no variants) working as before', () => {
        catalog.saveProduct(api, { id: 'p1', name: 'Belt', price: 15, sku: 'BELT-1', stock_quantity: 4 }, [], { isNew: true });
        expect(catalog.lookupCode(api, 'belt-1')).toMatchObject({ type: 'product' });
        catalog.adjustStock(api, { productId: 'p1', delta: -1, type: 'sale' });
        expect(api.get('SELECT stock_quantity FROM products WHERE id = ?', ['p1']).stock_quantity).toBe(3);
    });

    it('deactivates (never deletes) variants removed from the form', () => {
        const { variants } = catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 10 }, [
            { color: 'Black', size: 'M', sku: 'R-1', stock_quantity: 1 },
            { color: 'Black', size: 'L', sku: 'R-2', stock_quantity: 1 },
        ], { isNew: true });
        catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 10 }, [variants[0]]);
        const all = catalog.getVariants(api, 'p1', { includeInactive: true });
        expect(all).toHaveLength(2);
        expect(all.find(v => v.sku === 'R-2').is_active).toBe(0);
        // The retired SKU stays reserved
        expect(catalog.findIdentifierOwner(api, 'R-2')).not.toBeNull();
    });

    it('reports low stock per variant', () => {
        catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 10 }, [
            { color: 'Black', size: 'M', sku: 'L-1', stock_quantity: 1, min_stock_level: 2 },
            { color: 'Black', size: 'L', sku: 'L-2', stock_quantity: 9, min_stock_level: 2 },
        ], { isNew: true });
        const low = catalog.getLowStock(api);
        expect(low).toHaveLength(1);
        expect(low[0]).toMatchObject({ sku: 'L-1', size: 'M' });
    });
});

describe('in-shop barcodes', () => {
    it('generates valid, unique EAN-13 codes that no article uses', async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        const api = createApi(db);
        catalog.saveProduct(api, { id: 'p1', name: 'Tee', price: 10, barcode: '2000000000008' }, [], { isNew: true });
        // A random source that first proposes the code already used
        const digits = ['2', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'];
        let n = 0;
        const random = () => (n < 11 ? Number(digits[1 + n++]) / 10 : Math.random());
        const codes = catalog.generateInternalBarcodes(api, 5, new Set(), random);
        expect(codes).toHaveLength(5);
        expect(new Set(codes).size).toBe(5);
        expect(codes).not.toContain('2000000000008');
        for (const code of codes) {
            expect(code).toMatch(/^2\d{12}$/);
            expect(code[12]).toBe(catalog.ean13CheckDigit(code.slice(0, 12)));
        }
        expect(catalog.ean13CheckDigit('400638133393')).toBe('1');
    });
});

describe('free label codes', () => {
    it('never hands out the same code twice and skips codes already used', async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        const api = createApi(db);
        const first = '290000000001' + catalog.gs1CheckDigit('290000000001');
        // An article already owns the first code of the reserved range
        catalog.saveProduct(api, { id: 'p1', name: 'Jean', price: 10, barcode: first }, [], { isNew: true });
        const a = catalog.generateFreeCodes(api, { type: 'ean13', count: 3 });
        const b = catalog.generateFreeCodes(api, { type: 'ean13', count: 3 });
        expect(a).not.toContain(first);
        expect(new Set([...a, ...b]).size).toBe(6);
        for (const code of [...a, ...b]) {
            expect(code).toMatch(/^29\d{11}$/);
            expect(code[12]).toBe(catalog.ean13CheckDigit(code.slice(0, 12)));
        }
        const ean8 = catalog.generateFreeCodes(api, { type: 'ean8', count: 2 });
        ean8.forEach(code => expect(code.slice(-1)).toBe(catalog.gs1CheckDigit(code.slice(0, 7))));
        expect(catalog.generateFreeCodes(api, { type: 'code39', count: 1 })[0]).toMatch(/^HN\d{8}$/);
        expect(catalog.generateFreeCodes(api, { type: 'itf14', count: 1 })[0]).toMatch(/^29\d{12}$/);
        // Article barcodes never fall in the reserved 29… range
        const own = catalog.generateInternalBarcodes(api, 50);
        own.forEach(code => expect(code.startsWith('29')).toBe(false));
    });
});

describe('label codes for articles without barcode', () => {
    async function shop() {
        const db = await createLegacyDb();
        applyMigrations(db);
        const api = createApi(db);
        // Imitation jeans in two colours, no manufacturer barcode
        catalog.saveProduct(api, { id: 'jean', name: 'Jean', price: 3000 }, [
            { color: 'Noir', color_code: 'black', size: '40', sku: 'JEAN-BLK-40', stock_quantity: 3 },
            { color: 'Bleu', color_code: 'blue', size: '40', sku: 'JEAN-BLU-40', stock_quantity: 5 },
        ], { isNew: true });
        catalog.saveProduct(api, { id: 'belt', name: 'Ceinture', price: 800, sku: 'CEINT-1' }, [], { isNew: true });
        return api;
    }

    it('gives the whole article one new barcode when colour/size are not counted', async () => {
        const api = await shop();
        expect(catalog.findMissingCodes(api, { scope: 'article' }).map(r => r.productId).sort()).toEqual(['belt', 'jean']);
        const variants = catalog.getVariants(api, 'jean');
        const result = catalog.ensureLabelCodes(api, variants.map(v => ({ variantId: v.id, quantity: v.stock_quantity })), { scope: 'article' });
        expect(result.items).toEqual([{ productId: 'jean', quantity: 8, article: true }]);
        expect(result.created).toBe(1);
        const barcode = api.get('SELECT barcode FROM products WHERE id = ?', ['jean']).barcode;
        expect(barcode).toMatch(/^2[0-8]\d{11}$/);
        // Scanning that code sells a piece without asking colour/size
        const scanned = catalog.lookupCode(api, barcode, { articleScope: true });
        expect(scanned.type).toBe('variant');
        expect(scanned.variant.color).toBe('Bleu'); // the colour with most stock
        // Without article scope the colour/size is asked as before
        expect(catalog.lookupCode(api, barcode).needsVariant).toBe(true);
        // A preview never writes
        const preview = catalog.ensureLabelCodes(api, [{ productId: 'belt', quantity: 1 }], { scope: 'article', dryRun: true });
        expect(preview.items[0].previewBarcode).toMatch(/^2\d{12}$/);
        expect(api.get('SELECT barcode FROM products WHERE id = ?', ['belt']).barcode).toBeFalsy();
    });

    it('gives each colour/size its own barcode when printing EAN-13 labels', async () => {
        const api = await shop();
        expect(catalog.findMissingCodes(api, { scope: 'variant', codeType: 'ean13' })).toHaveLength(3);
        expect(catalog.findMissingCodes(api, { scope: 'variant', codeType: 'qr' })).toHaveLength(0); // SKU/QR exist
        const variants = catalog.getVariants(api, 'jean');
        const result = catalog.ensureLabelCodes(api, variants.map(v => ({ variantId: v.id, quantity: 1 })), { scope: 'variant', codeType: 'ean13' });
        expect(result.created).toBe(2);
        const codes = catalog.getVariants(api, 'jean').map(v => v.barcode);
        expect(new Set(codes).size).toBe(2);
        codes.forEach(code => expect(catalog.lookupCode(api, code).type).toBe('variant'));
        // Printing again creates nothing new
        expect(catalog.ensureLabelCodes(api, variants.map(v => ({ variantId: v.id, quantity: 1 })), { scope: 'variant', codeType: 'ean13' }).created).toBe(0);
    });
});
