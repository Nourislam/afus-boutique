const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { applyMigrations } = require('./migrations');
const { databasePath } = require('../brand');

let db = null;
let SQL = null;
const changeListeners = [];
// Depth of the currently open transaction (0 = none). While a transaction is
// open, writes are not flushed to disk and failures throw instead of being
// swallowed, so the whole unit of work can be rolled back.
let transactionDepth = 0;

function getDbPath() {
    return databasePath(app.getPath('userData'));
}

/**
 * Parameters as sql.js accepts them. sql.js refuses `undefined` ("tried to
 * bind a value of an unknown type"); an optional field the interface did not
 * send is stored as NULL instead of making the whole statement fail.
 */
function bindable(params) {
    return Array.isArray(params) ? params.map(value => (value === undefined ? null : value)) : params;
}

function timestampSuffix() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

async function initDatabase() {
    const dbPath = getDbPath();
    console.log('Database path:', dbPath);

    // Initialize SQL.js
    SQL = await initSqlJs();

    // Try to load existing database
    let isExistingDatabase = false;
    try {
        if (fs.existsSync(dbPath)) {
            const fileBuffer = fs.readFileSync(dbPath);
            db = new SQL.Database(fileBuffer);
            // Force a read so a corrupt file fails here rather than later
            db.exec('SELECT count(*) FROM sqlite_master');
            isExistingDatabase = true;
            console.log('Loaded existing database');
        } else {
            db = new SQL.Database();
            console.log('Created new database');
        }
    } catch (error) {
        console.error('Error loading database:', error);
        // Never overwrite an unreadable database file: keep it aside so the
        // data can still be recovered.
        if (fs.existsSync(dbPath)) {
            const corruptPath = `${dbPath}.unreadable-${timestampSuffix()}`;
            try {
                fs.copyFileSync(dbPath, corruptPath);
                console.error('Unreadable database preserved at:', corruptPath);
            } catch (copyError) {
                console.error('Failed to preserve unreadable database:', copyError);
                throw error;
            }
        }
        db = new SQL.Database();
    }

    // Create tables. The schema ships inside app.asar next to this file; older
    // build configurations copied it to resources/database instead.
    const schemaCandidates = [
        path.join(__dirname, 'schema.sql'),
        process.resourcesPath ? path.join(process.resourcesPath, 'database', 'schema.sql') : null,
    ].filter(Boolean);
    const schemaPath = schemaCandidates.find(p => fs.existsSync(p));
    if (!schemaPath) throw new Error(`Database schema not found (looked in: ${schemaCandidates.join(', ')})`);
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // Run migrations for existing databases
    runMigrations();

    // Versioned migrations (product variants etc.). A backup copy of the file
    // is written before an existing database is upgraded.
    applyMigrations(db, {
        log: (msg) => console.log(msg),
        beforeApply: (pending) => {
            if (!isExistingDatabase || !fs.existsSync(dbPath)) return;
            const backupPath = `${dbPath}.backup-before-${pending[0].version}-${timestampSuffix()}`;
            fs.copyFileSync(dbPath, backupPath);
            console.log('Database backup written before migration:', backupPath);
        },
    });

    // Seed default data if needed
    seedDefaultData();

    // Save database
    saveDatabase();

    // ==========================================
    // MIGRATION: Fix Bundles Schema
    // ==========================================
    const bundleColumns = getTableColumns('bundles');
    if (bundleColumns.length > 0) {
        if (!bundleColumns.includes('stock_quantity')) {
            try {
                db.run('ALTER TABLE bundles ADD COLUMN stock_quantity INTEGER DEFAULT 0');
                console.log('Added stock_quantity column to bundles');
            } catch (e) { console.log('Error adding stock_quantity:', e.message); }
        }
        if (!bundleColumns.includes('deduct_component_stock')) {
            try {
                db.run('ALTER TABLE bundles ADD COLUMN deduct_component_stock INTEGER DEFAULT 1');
                console.log('Added deduct_component_stock column to bundles');
            } catch (e) { console.log('Error adding deduct_component_stock:', e.message); }
        }
    }

    console.log('Database initialized successfully');
    return db;
}

function runMigrations() {
    // Migration: Add credit columns to customers table
    const customerColumns = getTableColumns('customers');

    if (!customerColumns.includes('credit_enabled')) {
        try {
            db.run('ALTER TABLE customers ADD COLUMN credit_enabled INTEGER DEFAULT 0');
            console.log('Added credit_enabled column to customers');
        } catch {
            console.log('credit_enabled column may already exist');
        }
    }

    if (!customerColumns.includes('credit_limit')) {
        try {
            db.run('ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0');
            console.log('Added credit_limit column to customers');
        } catch {
            console.log('credit_limit column may already exist');
        }
    }

    if (!customerColumns.includes('credit_balance')) {
        try {
            db.run('ALTER TABLE customers ADD COLUMN credit_balance REAL DEFAULT 0');
            console.log('Added credit_balance column to customers');
        } catch {
            console.log('credit_balance column may already exist');
        }
    }

    // Migration: Add POS options columns to sales table
    const salesColumns = getTableColumns('sales');
    if (salesColumns.length > 0) {
        if (!salesColumns.includes('service_charge')) {
            try {
                db.run('ALTER TABLE sales ADD COLUMN service_charge REAL DEFAULT 0');
                console.log('Added service_charge column to sales');
            } catch (e) { console.log('Error adding service_charge:', e.message); }
        }
        if (!salesColumns.includes('tax_exempt')) {
            try {
                db.run('ALTER TABLE sales ADD COLUMN tax_exempt INTEGER DEFAULT 0');
                console.log('Added tax_exempt column to sales');
            } catch (e) { console.log('Error adding tax_exempt:', e.message); }
        }
    }

    // Migration: Create credit_sales table if not exists
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS credit_sales (
                id TEXT PRIMARY KEY,
                sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
                customer_id TEXT REFERENCES customers(id),
                invoice_number TEXT UNIQUE NOT NULL,
                amount_due REAL NOT NULL,
                amount_paid REAL DEFAULT 0,
                status TEXT DEFAULT 'pending',
                due_date DATETIME NOT NULL,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Ensured credit_sales table exists');
    } catch (e) {
        console.log('credit_sales table check:', e.message);
    }

    // Migration: Create credit_payments table if not exists
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS credit_payments (
                id TEXT PRIMARY KEY,
                credit_sale_id TEXT REFERENCES credit_sales(id) ON DELETE CASCADE,
                amount REAL NOT NULL,
                payment_method TEXT NOT NULL,
                reference TEXT,
                received_by TEXT REFERENCES employees(id),
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Ensured credit_payments table exists');
    } catch (e) {
        console.log('credit_payments table check:', e.message);
    }

    // Migration: Create indexes for credit tables
    try {
        db.run('CREATE INDEX IF NOT EXISTS idx_credit_sales_customer ON credit_sales(customer_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_credit_sales_status ON credit_sales(status)');
        db.run('CREATE INDEX IF NOT EXISTS idx_credit_payments_sale ON credit_payments(credit_sale_id)');
    } catch (e) {
        console.log('Credit indexes check:', e.message);
    }

    // ==========================================
    // MIGRATION: Supplier Credit & Returns
    // ==========================================

    // 1. Add columns to purchase_orders
    const poColumns = getTableColumns('purchase_orders');
    if (poColumns.length > 0) { // Table exists
        if (!poColumns.includes('amount_paid')) {
            try {
                db.run('ALTER TABLE purchase_orders ADD COLUMN amount_paid REAL DEFAULT 0');
                console.log('Added amount_paid column to purchase_orders');
            } catch (e) { console.log('Error adding amount_paid:', e.message); }
        }
        if (!poColumns.includes('payment_status')) { // Using 'payment_status' to disambiguate from order status
            try {
                db.run("ALTER TABLE purchase_orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid'");
                console.log('Added payment_status column to purchase_orders');
            } catch (e) { console.log('Error adding payment_status:', e.message); }
        }
    }

    // 2. Add columns to suppliers
    const supplierColumns = getTableColumns('suppliers');
    if (supplierColumns.length > 0) {
        if (!supplierColumns.includes('balance')) {
            try {
                db.run('ALTER TABLE suppliers ADD COLUMN balance REAL DEFAULT 0');
                console.log('Added balance column to suppliers');
            } catch (e) { console.log('Error adding balance:', e.message); }
        }
    }

    // 3. Create supplier_payments table
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS supplier_payments (
                id TEXT PRIMARY KEY,
                purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE CASCADE,
                supplier_id TEXT REFERENCES suppliers(id) ON DELETE CASCADE,
                amount REAL NOT NULL,
                payment_method TEXT NOT NULL,
                reference TEXT,
                notes TEXT,
                paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT REFERENCES employees(id)
            )
        `);
        console.log('Ensured supplier_payments table exists');
        db.run('CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id)');
    } catch (e) { console.log('supplier_payments table check:', e.message); }

    // 4. Create purchase_returns table
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS purchase_returns (
                id TEXT PRIMARY KEY,
                return_number TEXT UNIQUE NOT NULL,
                purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
                supplier_id TEXT REFERENCES suppliers(id) ON DELETE CASCADE,
                status TEXT DEFAULT 'draft',
                total_amount REAL NOT NULL,
                notes TEXT,
                created_by TEXT REFERENCES employees(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Ensured purchase_returns table exists');
        db.run('CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON purchase_returns(supplier_id)');
    } catch (e) { console.log('purchase_returns table check:', e.message); }

    // 5. Create purchase_return_items table
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS purchase_return_items (
                id TEXT PRIMARY KEY,
                return_id TEXT REFERENCES purchase_returns(id) ON DELETE CASCADE,
                product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
                product_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                unit_cost REAL NOT NULL,
                reason TEXT
            )
        `);
        console.log('Ensured purchase_return_items table exists');
        db.run('CREATE INDEX IF NOT EXISTS idx_return_items_return ON purchase_return_items(return_id)');
    } catch (e) { console.log('purchase_return_items table check:', e.message); }

    // ==========================================
    // MIGRATION: Phase 1 Advanced POs (Tax etc)
    // ==========================================
    const poColsAfter = getTableColumns('purchase_orders');
    if (poColsAfter.length > 0) {
        const newCols = [
            { name: 'tax_rate', type: 'REAL DEFAULT 0' },
            { name: 'discount_type', type: "TEXT DEFAULT 'fixed'" },
            { name: 'discount_value', type: 'REAL DEFAULT 0' },
            { name: 'shipping_cost', type: 'REAL DEFAULT 0' }
        ];
        newCols.forEach(col => {
            if (!poColsAfter.includes(col.name)) {
                try {
                    db.run(`ALTER TABLE purchase_orders ADD COLUMN ${col.name} ${col.type}`);
                    console.log(`Added ${col.name} to purchase_orders`);
                } catch (e) { console.log(`Error adding ${col.name}:`, e.message); }
            }
        });
    }

    const poItemCols = getTableColumns('purchase_order_items');
    if (poItemCols.length > 0) {
        const newItemCols = [
            { name: 'tax_rate', type: 'REAL DEFAULT 0' },
            { name: 'tax_amount', type: 'REAL DEFAULT 0' },
            { name: 'discount_amount', type: 'REAL DEFAULT 0' }
        ];
        newItemCols.forEach(col => {
            if (!poItemCols.includes(col.name)) {
                try {
                    db.run(`ALTER TABLE purchase_order_items ADD COLUMN ${col.name} ${col.type}`);
                    console.log(`Added ${col.name} to purchase_order_items`);
                } catch (e) { console.log(`Error adding ${col.name}:`, e.message); }
            }
        });
    }

    // Checking for received_quantity specifically
    if (!poItemCols.includes('received_quantity')) {
        try {
            db.run('ALTER TABLE purchase_order_items ADD COLUMN received_quantity INTEGER DEFAULT 0');
            console.log('Added received_quantity to purchase_order_items');
        } catch (e) { console.log('Error adding received_quantity:', e.message); }
    }

    // ==========================================
    // MIGRATION: Phase 2 Goods Receiving (GRN)
    // ==========================================
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS receivings (
                id TEXT PRIMARY KEY,
                receive_number TEXT UNIQUE NOT NULL,
                purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
                supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
                received_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'completed',
                notes TEXT,
                created_by TEXT REFERENCES employees(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Ensured receivings table exists');
        db.run('CREATE INDEX IF NOT EXISTS idx_receivings_po ON receivings(purchase_order_id)');
    } catch (e) { console.log('receivings table check:', e.message); }

    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS receiving_items (
                id TEXT PRIMARY KEY,
                receiving_id TEXT REFERENCES receivings(id) ON DELETE CASCADE,
                product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
                product_name TEXT NOT NULL,
                quantity_ordered INTEGER NOT NULL,
                quantity_received INTEGER NOT NULL,
                condition TEXT DEFAULT 'good'
            )
        `);
        console.log('Ensured receiving_items table exists');
        db.run('CREATE INDEX IF NOT EXISTS idx_receiving_items_receiving ON receiving_items(receiving_id)');
    } catch (e) { console.log('receiving_items table check:', e.message); }

    // ==========================================
    // MIGRATION: Phase 3 Supplier Invoicing
    // ==========================================
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS supplier_invoices (
                id TEXT PRIMARY KEY,
                purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
                invoice_number TEXT NOT NULL,
                invoice_date DATETIME NOT NULL,
                due_date DATETIME,
                subtotal REAL DEFAULT 0,
                tax_amount REAL DEFAULT 0,
                total_amount REAL DEFAULT 0,
                match_status TEXT DEFAULT 'pending', 
                payment_status TEXT DEFAULT 'unpaid',
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Ensured supplier_invoices table exists');
        db.run('CREATE INDEX IF NOT EXISTS idx_supplier_invoices_po ON supplier_invoices(purchase_order_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_supplier_invoices_number ON supplier_invoices(invoice_number)');
    } catch (e) { console.log('supplier_invoices table check:', e.message); }

    // ==========================================
    // MIGRATION: Phase 4 Intelligence
    // ==========================================
    const prodCols = getTableColumns('products');
    if (prodCols.length > 0) {
        if (!prodCols.includes('max_stock_level')) {
            try {
                db.run('ALTER TABLE products ADD COLUMN max_stock_level INTEGER DEFAULT 20');
                console.log('Added max_stock_level to products');
            } catch (e) { console.log('Error adding max_stock_level:', e.message); }
        }
        if (!prodCols.includes('supplier_id')) {
            try {
                db.run('ALTER TABLE products ADD COLUMN supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL');
                console.log('Added supplier_id to products');
            } catch (e) { console.log('Error adding supplier_id:', e.message); }
        }
        // ==========================================
        // MIGRATION: Cloud Sync Infrastructure
        // ==========================================
        const tablesToSync = [
            'products', 'customers', 'sales', 'inventory_logs',
            'categories', 'suppliers', 'purchase_orders',
            'receivings', 'supplier_invoices', 'employees',
            'gift_cards', 'bundles', 'promotions',
            'sale_items', 'purchase_order_items', 'receiving_items',
            'credit_sales', 'credit_payments',
            'quotations', 'quotation_items',
            'returns', 'return_items', 'supplier_payments'
        ];

        tablesToSync.forEach(tableName => {
            // Check if table exists first (some migration phases might not be run yet in fresh install logic if relying on ordered execution, but here we assume tables exist or are created above)
            // Ideally we check table existence.
            try {
                const tableExists = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
                if (tableExists.length === 0) return;

                const columns = getTableColumns(tableName);

                if (!columns.includes('is_synced')) {
                    try {
                        db.run(`ALTER TABLE ${tableName} ADD COLUMN is_synced INTEGER DEFAULT 0`);
                        console.log(`Added is_synced to ${tableName}`);
                    } catch (e) { console.log(`Error adding is_synced to ${tableName}:`, e.message); }
                }

                if (!columns.includes('remote_id')) {
                    try {
                        db.run(`ALTER TABLE ${tableName} ADD COLUMN remote_id TEXT`);
                        console.log(`Added remote_id to ${tableName}`);
                    } catch (e) { console.log(`Error adding remote_id to ${tableName}:`, e.message); }
                }

                if (!columns.includes('updated_at')) {
                    // Most tables have it, but ensure all do
                    try {
                        db.run(`ALTER TABLE ${tableName} ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
                        console.log(`Added updated_at to ${tableName}`);
                    } catch (e) { console.log(`Error adding updated_at to ${tableName}:`, e.message); }
                }

                // Create Index on is_synced for fast lookup of pending changes
                try {
                    db.run(`CREATE INDEX IF NOT EXISTS idx_${tableName}_synced ON ${tableName}(is_synced)`);
                } catch (e) { console.log(`Error creating index on ${tableName}:`, e.message); }

            } catch (e) {
                console.log(`Error processing sync migration for ${tableName}:`, e.message);
            }
        });

        try {
            const customerCols = getTableColumns('customers');
            if (!customerCols.includes('is_active')) {
                db.run('ALTER TABLE customers ADD COLUMN is_active INTEGER DEFAULT 1');
                console.log('Added is_active to customers');
            }
        } catch (e) {
            console.log('Error adding is_active to customers:', e.message);
        }

        try {
            const saleItemCols = getTableColumns('sale_items');
            if (!saleItemCols.includes('unit_cost')) {
                db.run('ALTER TABLE sale_items ADD COLUMN unit_cost REAL DEFAULT 0');
                console.log('Added unit_cost to sale_items');
                
                // Backfill cost from products table for historical accuracy (best effort)
                db.run(`
                    UPDATE sale_items 
                    SET unit_cost = (SELECT cost FROM products WHERE products.id = sale_items.product_id)
                    WHERE unit_cost = 0 AND product_id IS NOT NULL
                `);
                console.log('Backfilled unit_cost in sale_items');
            }
        } catch (e) {
            console.log('Error adding unit_cost to sale_items:', e.message);
        }

        // ==========================================
        // MIGRATION: System Logs
        // ==========================================
        try {
            db.run(`
                CREATE TABLE IF NOT EXISTS system_logs (
                    id TEXT PRIMARY KEY,
                    action_type TEXT NOT NULL,
                    description TEXT NOT NULL,
                    details TEXT,
                    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Ensured system_logs table exists');
            db.run('CREATE INDEX IF NOT EXISTS idx_system_logs_date ON system_logs(created_at)');
        } catch (e) { console.log('system_logs table check:', e.message); }

        // ==========================================
        // MIGRATION: E-commerce Integration Tables
        // ==========================================
        try {
            // Load e-commerce schema
            const ecommerceSchemaPath = path.join(__dirname, 'ecommerce_schema.sql');
            if (fs.existsSync(ecommerceSchemaPath)) {
                const ecommerceSchema = fs.readFileSync(ecommerceSchemaPath, 'utf8');
                db.exec(ecommerceSchema);
                console.log('E-commerce schema applied successfully');
            }
        } catch (e) {
            console.log('E-commerce schema migration:', e.message);
        }

        // Setup Triggers for Automatic Sync Flagging
        setupSyncTriggers(db, tablesToSync);
    }
}

function setupSyncTriggers(_db, _tables) {
    console.log('Skipping SQLite Sync Triggers (Handled manually to avoid loops)...');
    return; // DISABLED: Triggers cause infinite loops with SyncManager
    
    /*
    console.log('Setting up SQLite Sync Triggers...');
    tables.forEach(table => {
        try {
            // Check if table exists
            const tableExists = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
            if (tableExists.length === 0) return;

            // Trigger: AFTER UPDATE
            db.run(`
                CREATE TRIGGER IF NOT EXISTS trg_${table}_update_sync
                AFTER UPDATE ON ${table}
                FOR EACH ROW
                WHEN NEW.is_synced = OLD.is_synced
                BEGIN
                    UPDATE ${table} 
                    SET is_synced = 0, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = NEW.id;
                END;
            `);

        } catch (e) {
            console.error(`Error setting trigger for ${table}:`, e.message);
        }
    });
    console.log('Sync Triggers setup complete.');
    */
}

function getTableColumns(tableName) {
    try {
        const result = db.exec(`PRAGMA table_info(${tableName})`);
        if (result.length > 0) {
            const nameIndex = result[0].columns.indexOf('name');
            return result[0].values.map(row => row[nameIndex]);
        }
        return [];
    } catch {
        return [];
    }
}

function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        // Write to a temporary file first and then rename it over the real
        // file, so a crash or power loss mid-write cannot leave a truncated
        // database behind.
        const dbPath = getDbPath();
        const tmpPath = `${dbPath}.tmp`;
        fs.writeFileSync(tmpPath, buffer);
        try {
            fs.renameSync(tmpPath, dbPath);
        } catch (error) {
            // Windows can refuse the rename while another process (e.g. an
            // antivirus scanner) holds the file; fall back to a direct write.
            console.warn('Atomic database rename failed, writing directly:', error.message);
            fs.writeFileSync(dbPath, buffer);
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    }
}

function seedDefaultData() {
    // Check if we have any employees
    const result = db.exec('SELECT COUNT(*) as count FROM employees');
    const employeeCount = result.length > 0 ? result[0].values[0][0] : 0;

    if (employeeCount === 0) {
        // We rely on Setup Wizard to create the first admin
        console.log('No employees found. Waiting for Setup Wizard initialization.');
    }

    // Categories are created by the first-launch setup, in the shop's language
    // (see electron/shared/clothing.json), and can be edited at any time.

    // Initialize default settings
    const settingsResult = db.exec('SELECT COUNT(*) as count FROM settings');
    const settingsCount = settingsResult.length > 0 ? settingsResult[0].values[0][0] : 0;

    if (settingsCount === 0) {
        const defaultSettings = {
            setup_completed: 'false',
            businessName: '',
            businessAddress: '',
            businessPhone: '',
            businessEmail: '',
            taxRate: 0,
            taxType: 'inclusive',
            taxName: 'TVA',
            currency: 'DZD',
            currencySymbol: 'DA',
            receiptHeader: '',
            receiptFooter: '',
        };

        for (const [key, value] of Object.entries(defaultSettings)) {
            db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
        }

        console.log('Default settings initialized');
    }

    saveDatabase();
}

function getDatabase() {
    return db;
}

// Helper function to run queries and return results as array of objects
function runQuery(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        if (params.length > 0) {
            stmt.bind(bindable(params));
        }
        const results = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push(row);
        }
        stmt.free();
        return results;
    } catch (error) {
        console.error('Query error:', error, sql);
        return [];
    }
}

function runInsert(sql, params = []) {
    try {
        db.run(sql, bindable(params));
        if (transactionDepth === 0) {
            saveDatabase();
            // Notify listeners
            notifyChangeListeners();
        }
        return true;
    } catch (error) {
        console.error('Insert error:', error);
        // Always reported: the interface shows the error instead of a "saved"
        // message for a change that was not written (and inside a transaction
        // the whole unit of work is rolled back)
        throw error;
    }
}

/**
 * Execute a write statement and throw on failure (runInsert does the same and
 * also logs the error). Used by the newer services.
 */
function runStatement(sql, params = []) {
    db.run(sql, bindable(params));
    if (transactionDepth === 0) {
        saveDatabase();
        notifyChangeListeners();
    }
    return true;
}

/**
 * Run `fn` atomically. All writes inside are committed together and written to
 * disk once; if anything throws, every change is rolled back.
 * `fn` must be synchronous (sql.js is synchronous).
 */
function runTransaction(fn) {
    if (transactionDepth > 0) {
        // Nested call: join the outer transaction
        return fn();
    }
    db.run('BEGIN');
    transactionDepth++;
    let committed = false;
    try {
        const result = fn();
        db.run('COMMIT');
        committed = true;
        return result;
    } catch (error) {
        try { db.run('ROLLBACK'); } catch { /* no active transaction */ }
        throw error;
    } finally {
        transactionDepth--;
        if (committed) {
            saveDatabase();
            notifyChangeListeners();
        }
    }
}

function addDatabaseChangeListener(callback) {
    changeListeners.push(callback);
}

function notifyChangeListeners() {
    changeListeners.forEach(cb => {
        try { cb(); } catch (e) { console.error('Error in db listener:', e); }
    });
}

function getOne(sql, params = []) {
    const results = runQuery(sql, params);
    return results.length > 0 ? results[0] : null;
}

module.exports = {
    initDatabase, getDatabase, saveDatabase, runQuery, runInsert, runStatement, runTransaction,
    getOne, getTableColumns, addDatabaseChangeListener, getDbPath, bindable,
};
