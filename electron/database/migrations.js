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
    {
        version: '2025_03_brands_and_color_codes',
        description: 'Brands list and language-independent colour codes on variants',
        up(db) {
            const clothing = require('../shared/clothing.json');
            addColumnIfMissing(db, 'products', 'collection', 'TEXT');

            db.run(`
                CREATE TABLE IF NOT EXISTS brands (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    is_active INTEGER DEFAULT 1,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_synced INTEGER DEFAULT 0,
                    remote_id TEXT
                )
            `);
            db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_name ON brands(name COLLATE NOCASE)');

            // Default brands well known in Algerian shops, plus every brand
            // already typed on existing products
            const names = [...clothing.brands];
            const used = db.exec("SELECT DISTINCT TRIM(brand) FROM products WHERE brand IS NOT NULL AND TRIM(brand) <> ''");
            if (used.length) used[0].values.forEach(([b]) => names.push(b));
            const seen = new Set();
            names.forEach((name, index) => {
                const key = String(name).toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                db.run('INSERT OR IGNORE INTO brands (id, name, sort_order) VALUES (?, ?, ?)',
                    [`brand-${index}-${key.replace(/[^a-z0-9]+/g, '-')}`, name, index]);
            });

            // Colour code: the stored colour text stays as it is (and SKUs never
            // change); the code lets the interface show the colour in any language.
            if (addColumnIfMissing(db, 'product_variants', 'color_code', 'TEXT')) {
                for (const color of clothing.colors) {
                    for (const name of [color.en, color.fr, color.ar, color.code]) {
                        db.run(
                            'UPDATE product_variants SET color_code = ? WHERE color_code IS NULL AND LOWER(TRIM(color)) = LOWER(?)',
                            [color.code, name]
                        );
                    }
                }
            }
        },
    },
    {
        version: '2025_04_language_defaults',
        description: 'Receipts in the shop language: drop the untouched English default footer',
        up(db) {
            // Only the exact defaults written by earlier versions are cleared; a
            // footer typed by the shop is kept. An empty footer prints the
            // thank-you line in the shop's language.
            const OLD_DEFAULTS = ['Thank you for your purchase!', 'Thank you for shopping with us!', 'Please come again!'];
            const result = db.exec("SELECT value FROM settings WHERE key = 'store_config'");
            if (result.length === 0) return;
            let config;
            try { config = JSON.parse(result[0].values[0][0]); } catch { return; }
            if (!config || typeof config !== 'object') return;
            if (OLD_DEFAULTS.includes(String(config.receiptFooter || '').trim())) {
                config.receiptFooter = '';
                db.run("UPDATE settings SET value = ? WHERE key = 'store_config'", [JSON.stringify(config)]);
            }
        },
    },
    {
        version: '2026_05_product_gallery',
        description: 'Up to two more photos per article (the first photo stays in image_path)',
        up(db) {
            // JSON list of image file names; NULL = no extra photo
            addColumnIfMissing(db, 'products', 'gallery', 'TEXT');
        },
    },
    {
        version: '2026_06_colors_sizes_switches',
        description: 'Colours and sizes switched on or off separately for each article',
        up(db) {
            // Only the two new columns are written, from what each article
            // already uses: no colour, size or stock is changed
            addColumnIfMissing(db, 'products', 'has_colors', 'INTEGER DEFAULT 0');
            addColumnIfMissing(db, 'products', 'has_sizes', 'INTEGER DEFAULT 0');
            if (!tableExists(db, 'product_variants')) return;
            db.run(`
                UPDATE products SET
                    has_colors = CASE WHEN EXISTS (
                        SELECT 1 FROM product_variants v
                        WHERE v.product_id = products.id AND v.is_active = 1 AND TRIM(COALESCE(v.color, '')) <> ''
                    ) THEN 1 ELSE 0 END,
                    has_sizes = CASE WHEN EXISTS (
                        SELECT 1 FROM product_variants v
                        WHERE v.product_id = products.id AND v.is_active = 1 AND TRIM(COALESCE(v.size, '')) <> ''
                    ) THEN 1 ELSE 0 END
            `);
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
