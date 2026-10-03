/**
 * Versioned schema migrations.
 *
 * The legacy migrations in init.js check columns one by one. New structural
 * changes are recorded here with a version id in `schema_migrations`, so each
 * one runs exactly once per database and existing installations upgrade in
 * place without losing data.
 *
 * Every function receives a raw sql.js Database so the migrations can be
 * tested in plain Node without Electron.
 */

function getColumns(db, table) {
    try {
        const result = db.exec(`PRAGMA table_info(${table})`);
        if (result.length === 0) return [];
        const nameIndex = result[0].columns.indexOf('name');
        return result[0].values.map(row => row[nameIndex]);
    } catch {
        return [];
    }
}

function tableExists(db, table) {
    const result = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
    return result.length > 0;
}

function addColumnIfMissing(db, table, column, definition) {
    if (!tableExists(db, table)) return false;
    if (getColumns(db, table).includes(column)) return false;
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
}

const MIGRATIONS = [
    {
        version: '2025_01_clothing_variants',
        description: 'Product variants (color/size), variant-level inventory and identifiers',
        up(db) {
            // Product-level clothing attributes
            addColumnIfMissing(db, 'products', 'brand', 'TEXT');
            addColumnIfMissing(db, 'products', 'gender', 'TEXT');
            addColumnIfMissing(db, 'products', 'season', 'TEXT');
            addColumnIfMissing(db, 'products', 'has_variants', 'INTEGER DEFAULT 0');

            db.run(`
                CREATE TABLE IF NOT EXISTS product_variants (
                    id TEXT PRIMARY KEY,
                    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                    color TEXT,
                    size TEXT,
                    sku TEXT NOT NULL,
                    barcode TEXT,
                    qr_code TEXT NOT NULL,
                    price REAL,
                    cost REAL,
                    stock_quantity INTEGER DEFAULT 0,
                    min_stock_level INTEGER DEFAULT 2,
                    is_active INTEGER DEFAULT 1,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_synced INTEGER DEFAULT 0,
                    remote_id TEXT
                )
            `);
            // Identifiers are compared case-insensitively because scanners and
            // keyboard layouts do not always preserve letter case.
            db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku COLLATE NOCASE)');
            db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_qr ON product_variants(qr_code COLLATE NOCASE)');
            db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL AND barcode <> ''");
            db.run('CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id)');
            db.run('CREATE INDEX IF NOT EXISTS idx_variants_synced ON product_variants(is_synced)');

            // Variant references on every table that moves or records stock
            const variantRefTables = [
                'sale_items', 'inventory_logs', 'return_items', 'purchase_order_items',
                'receiving_items', 'purchase_return_items', 'quotation_items',
            ];
            for (const table of variantRefTables) {
                if (addColumnIfMissing(db, table, 'variant_id', 'TEXT')) {
                    db.run(`CREATE INDEX IF NOT EXISTS idx_${table}_variant ON ${table}(variant_id)`);
                }
            }
            // Snapshot of what was sold, so receipts and history stay readable
            // even if the variant is renamed later.
            addColumnIfMissing(db, 'sale_items', 'variant_label', 'TEXT');
            addColumnIfMissing(db, 'sale_items', 'sku', 'TEXT');
            addColumnIfMissing(db, 'quotation_items', 'variant_label', 'TEXT');
            addColumnIfMissing(db, 'purchase_order_items', 'variant_label', 'TEXT');
        },
    },
    {
        version: '2025_02_remove_legacy_activation',
        description: 'Remove the old online activation/account data; the POS is local-only',
        up(db) {
            // Account e-mail/uid/plan of the previous product's online activation
            db.run("DELETE FROM settings WHERE key = 'activation_data'");
            // The previous product's hosted cloud sync no longer exists: fall back to local mode
            const result = db.exec("SELECT value FROM settings WHERE key = 'sync_settings'");
            if (result.length > 0) {
                let config = {};
                try { config = JSON.parse(result[0].values[0][0]) || {}; } catch { config = {}; }
                if (config.provider && config.provider !== 'none') {
                    config.provider = 'none';
                    db.run("UPDATE settings SET value = ? WHERE key = 'sync_settings'", [JSON.stringify(config)]);
                }
            }
        },
    },
];

function ensureMigrationsTable(db) {
    db.run(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            description TEXT,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

function getAppliedVersions(db) {
    ensureMigrationsTable(db);
    const result = db.exec('SELECT version FROM schema_migrations');
    return new Set(result.length ? result[0].values.map(row => row[0]) : []);
}

function getPendingMigrations(db) {
    const applied = getAppliedVersions(db);
    return MIGRATIONS.filter(m => !applied.has(m.version));
}

/**
 * Apply all pending migrations. Each migration runs inside a transaction and is
 * rolled back completely if any statement fails, leaving the database as it was.
 *
 * @param {object} db sql.js Database
 * @param {object} [options]
 * @param {Function} [options.beforeApply] called once before the first pending
 *   migration runs (used to write a backup copy of the database file)
 * @param {Function} [options.log]
 * @returns {string[]} versions applied
 */
function applyMigrations(db, options = {}) {
    const log = options.log || (() => { });
    const pending = getPendingMigrations(db);
    if (pending.length === 0) return [];

    if (options.beforeApply) options.beforeApply(pending);

    const applied = [];
    for (const migration of pending) {
        db.run('BEGIN');
        try {
            migration.up(db);
            db.run('INSERT INTO schema_migrations (version, description) VALUES (?, ?)', [migration.version, migration.description]);
            db.run('COMMIT');
            applied.push(migration.version);
            log(`Applied migration ${migration.version}`);
        } catch (error) {
            try { db.run('ROLLBACK'); } catch { /* already rolled back */ }
            throw new Error(`Migration ${migration.version} failed: ${error.message}`);
        }
    }
    return applied;
}

module.exports = { MIGRATIONS, applyMigrations, getPendingMigrations, getColumns };
