// A small clothing shop on a fresh test database: used by the exchange,
// stock count, cash and permission tests.
import path from 'path';
import { createRequire } from 'module';
import { createLegacyDb, createApi } from './testDb';

const require = createRequire(import.meta.url);
const { applyMigrations } = require('../../electron/database/migrations');
const catalog = require('../../electron/services/catalogService');

const initSqlJs = require('sql.js');

/** Columns init.js adds on a real installation, when the test schema lacks them. */
export function addInitColumns(api) {
    const add = (table, column, type) => {
        if (!api.all(`PRAGMA table_info(${table})`).some(c => c.name === column)) api.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    };
    add('customers', 'credit_enabled', 'INTEGER DEFAULT 0');
    add('customers', 'is_active', 'INTEGER DEFAULT 1');
    add('sales', 'service_charge', 'REAL DEFAULT 0');
    add('sales', 'tax_exempt', 'INTEGER DEFAULT 0');
}

/**
 * Jean (3 000 DA) in black 38/40/42 and blue 40, a dearer 44 (3 500 DA),
 * a belt without variants (800 DA), a cashier and a manager.
 */
export async function createShop() {
    const db = await createLegacyDb();
    applyMigrations(db);
    const api = createApi(db);
    addInitColumns(api);
    catalog.saveProduct(api, { id: 'jean', name: 'Jean', price: 3000, cost: 1800 }, [
        { color: 'Noir', size: '38', sku: 'J-N-38', stock_quantity: 4 },
        { color: 'Noir', size: '40', sku: 'J-N-40', stock_quantity: 2 },
        { color: 'Noir', size: '42', sku: 'J-N-42', stock_quantity: 0 },
        { color: 'Bleu', size: '40', sku: 'J-B-40', stock_quantity: 3 },
        { color: 'Noir', size: '44', sku: 'J-N-44', stock_quantity: 2, price: 3500 },
    ], { isNew: true });
    catalog.saveProduct(api, { id: 'belt', name: 'Ceinture', price: 800, cost: 300, stock_quantity: 10 }, [], { isNew: true });
    api.run("INSERT INTO employees (id, name, pin, role) VALUES ('cash1', 'Amina', '1111', 'cashier'), ('boss', 'Karim', '9999', 'manager'), ('owner', 'Nadia', '0000', 'admin')");
    const v = Object.fromEntries(catalog.getVariants(api, 'jean').map(x => [x.sku, x.id]));
    return { db, api, v, catalog };
}

/** A paid ticket. lines: [{ product, variant, qty, price }], options: { method, discount, tax, status, employee, customer } */
export function sell(api, id, lines, { method = 'cash', discount = 0, tax = 0, status = 'completed', employee = 'cash1', customer = null, inclusive = true } = {}) {
    const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const total = inclusive ? subtotal - discount : subtotal - discount + tax;
    api.run(`INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, tax_amount, discount_amount, total, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, `R-${id}`, employee, customer, subtotal, tax, discount, total, status]);
    lines.forEach((l, i) => {
        api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, variant_label, product_name, quantity, unit_price, total, unit_cost)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [`${id}-${i}`, id, l.product, l.variant || null, l.label || null, l.name || 'Jean', l.qty, l.price, l.qty * l.price, l.cost ?? 1800]);
        if (l.variant) api.run('UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?', [l.qty, l.variant]);
    });
    if (total > 0) api.run('INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, ?, ?)', [`p-${id}`, id, method, total]);
    return { id, total };
}

/** shiftService talks to database/init directly: point it at this db. */
export function loadShiftService(api) {
    const initPath = path.resolve(__dirname, '../../electron/database/init.js');
    require.cache[initPath] = {
        id: initPath, filename: initPath, loaded: true,
        exports: { runQuery: (sql, p) => api.all(sql, p), getOne: (sql, p) => api.get(sql, p), runInsert: (sql, p) => api.run(sql, p) },
    };
    const servicePath = path.resolve(__dirname, '../../electron/services/shiftService.js');
    delete require.cache[servicePath];
    const ShiftService = require(servicePath);
    return new ShiftService();
}

/** Save the database to bytes and open it again, as after closing the program. */
export async function reopen(db) {
    const SQL = await initSqlJs();
    const again = new SQL.Database(db.export());
    return { db: again, api: createApi(again) };
}

export const stockOf = (api, variantId) => api.get('SELECT stock_quantity FROM product_variants WHERE id = ?', [variantId]).stock_quantity;
