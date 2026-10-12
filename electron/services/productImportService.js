/**
 * Quick start from an Excel sheet: one row per size/colour, the rows of the
 * same article (same name) make one article with its variants.
 *
 *   name | color | size | quantity | price | cost | sku | barcode | category | brand
 *   Jean |  Noir |  38  |    4     | 3000  | 1800 |     |         | Jeans    |
 *   Jean |  Noir |  40  |    2     | 3000  | 1800 |     |         | Jeans    |
 *
 * Each article is saved on its own: an article with a problem (same size
 * twice, code already used, article already in the shop...) is rejected with
 * the reason and its rows, the others are saved. Nothing is rejected
 * silently: the report lists every row that was not imported.
 * Call inside a transaction (savepoints keep each article all-or-nothing).
 */
const catalog = require('./catalogService');

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const key = (v) => clean(v).toLowerCase();
const num = (v) => (clean(v) === '' ? null : Number(String(v).replace(/[^0-9.-]/g, '')));

/** Group the sheet rows by article. rows: [{ row, name, color, size, stock_quantity, price, cost, sku, barcode, category, brand }] */
function groupRows(rows) {
    const groups = new Map();
    for (const r of rows) {
        const k = key(r.name);
        if (!groups.has(k)) groups.set(k, { name: clean(r.name), rows: [] });
        groups.get(k).rows.push(r);
    }
    return [...groups.values()];
}

// Reasons are sent as "CODE|{params}" and shown in the screen's language
const CODES = { noName: 'IMPORT_NO_NAME', exists: 'IMPORT_EXISTS', noPrice: 'IMPORT_NO_PRICE', mixed: 'IMPORT_MIXED', duplicate: 'IMPORT_DUPLICATE', quantity: 'IMPORT_QUANTITY' };
const message = (code, params) => catalog.coded(CODES[code], params);

/** First problem of a group before trying to save it, or null. */
function checkGroup(api, group) {
    if (!group.name) return message('noName', {});
    if (api.get('SELECT id FROM products WHERE is_active = 1 AND LOWER(TRIM(name)) = ?', [key(group.name)])) {
        return message('exists', { name: group.name });
    }
    const priced = group.rows.map(r => num(r.price)).filter(p => p !== null && Number.isFinite(p));
    if (!priced.length || priced.some(p => p < 0)) return message('noPrice', { name: group.name });
    const withVariant = group.rows.filter(r => clean(r.color) || clean(r.size));
    if (withVariant.length && withVariant.length !== group.rows.length) return message('mixed', { name: group.name });
    if (!withVariant.length && group.rows.length > 1) return message('duplicate', { name: group.name });
    for (const r of group.rows) {
        const qty = num(r.stock_quantity);
        if (qty !== null && (!Number.isInteger(qty) || qty < 0)) return message('quantity', { line: r.row });
    }
    return null;
}

function categoryId(api, name) {
    if (!clean(name)) return null;
    return api.get('SELECT id FROM categories WHERE LOWER(TRIM(name)) = ?', [key(name)])?.id || null;
}

/**
 * @returns {{ imported: [{ name, variants, pieces }], rejected: [{ rows: number[], name, reason }] }}
 */
function importProducts(api, rows, { skuSettings = {}, employeeId = null } = {}) {
    const report = { imported: [], rejected: [] };
    groupRows(rows).forEach((group, index) => {
        const rowNumbers = group.rows.map(r => r.row);
        const problem = checkGroup(api, group);
        if (problem) { report.rejected.push({ rows: rowNumbers, name: group.name, reason: problem }); return; }

        const first = group.rows[0];
        const price = group.rows.map(r => num(r.price)).find(p => p !== null);
        const cost = group.rows.map(r => num(r.cost)).find(c => c !== null) ?? 0;
        const product = {
            id: api.uuid(), name: group.name, price, cost,
            category_id: categoryId(api, first.category), brand: clean(first.brand) || null,
            description: clean(first.description) || null, min_stock_level: num(first.min_stock_level) ?? 2,
            tax_rate: num(first.tax_rate) || 0, is_active: true,
        };
        const hasVariants = !!(clean(first.color) || clean(first.size));
        let variants = [];
        if (hasVariants) {
            variants = group.rows.map(r => {
                const own = num(r.price);
                const ownCost = num(r.cost);
                return {
                    color: clean(r.color) || null, size: clean(r.size) || null,
                    stock_quantity: num(r.stock_quantity) || 0, sku: clean(r.sku) || null, barcode: clean(r.barcode) || null,
                    price: own !== null && own !== price ? own : null,
                    cost: ownCost !== null && ownCost !== cost ? ownCost : null,
                    min_stock_level: num(r.min_stock_level) ?? 2,
                };
            });
            const missing = variants.filter(v => !v.sku);
            if (missing.length) {
                const taken = new Set(variants.map(v => v.sku).filter(Boolean));
                const codes = catalog.generateSkus(api, product, missing, skuSettings, taken);
                missing.forEach((v, i) => { v.sku = codes[i]; });
            }
        } else {
            product.sku = clean(first.sku) || null;
            product.barcode = clean(first.barcode) || null;
            product.stock_quantity = num(first.stock_quantity) || 0;
        }

        const savepoint = `import_${index}`;
        api.run(`SAVEPOINT ${savepoint}`);
        try {
            catalog.saveProduct(api, product, variants, { employeeId, isNew: true });
            api.run(`RELEASE ${savepoint}`);
            report.imported.push({
                name: group.name, variants: variants.length,
                pieces: hasVariants ? variants.reduce((s, v) => s + v.stock_quantity, 0) : product.stock_quantity,
            });
        } catch (error) {
            api.run(`ROLLBACK TO ${savepoint}`);
            api.run(`RELEASE ${savepoint}`);
            report.rejected.push({ rows: rowNumbers, name: group.name, reason: String(error.message || error) });
        }
    });
    return report;
}

module.exports = { importProducts, groupRows };
