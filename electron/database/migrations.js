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
    {
        version: '2026_10_purchase_return_status',
        description: 'Goods sent back to a supplier: fix the misspelt "complated" status',
        up(db) {
            // Only the misspelt value is rewritten; amounts, dates and stock are untouched
            if (!tableExists(db, 'purchase_returns')) return;
            db.run("UPDATE purchase_returns SET status = 'completed' WHERE status = 'complated'");
        },
    },
    {
        version: '2026_10_exchanges',
        description: 'Exchanges: link the return of a piece to the sale of the new one',
        up(db) {
            // New table only: existing sales, returns and stock are not touched
            db.run(`
                CREATE TABLE IF NOT EXISTS exchanges (
                    id TEXT PRIMARY KEY,
                    original_sale_id TEXT NOT NULL REFERENCES sales(id),
                    sale_item_id TEXT REFERENCES sale_items(id),
                    return_id TEXT NOT NULL REFERENCES returns(id),
                    sale_id TEXT NOT NULL REFERENCES sales(id),
                    quantity INTEGER NOT NULL,
                    credit REAL NOT NULL DEFAULT 0,
                    new_total REAL NOT NULL DEFAULT 0,
                    difference REAL NOT NULL DEFAULT 0,
                    refund_method TEXT,
                    employee_id TEXT REFERENCES employees(id),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.run('CREATE INDEX IF NOT EXISTS idx_exchanges_original ON exchanges(original_sale_id)');
            db.run('CREATE INDEX IF NOT EXISTS idx_exchanges_return ON exchanges(return_id)');
        },
    },
    {
        version: '2026_10_stock_counts',
        description: 'Stock counts: what was found on the shelves, applied only when confirmed',
        up(db) {
            // New tables only: the stock itself changes only when a count is confirmed
            db.run(`
                CREATE TABLE IF NOT EXISTS stock_counts (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'open',
                    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
                    employee_id TEXT REFERENCES employees(id),
                    note TEXT,
                    reason TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    confirmed_at DATETIME,
                    confirmed_by TEXT REFERENCES employees(id),
                    cancelled_at DATETIME
                )
            `);
            db.run(`
                CREATE TABLE IF NOT EXISTS stock_count_lines (
                    id TEXT PRIMARY KEY,
                    count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
                    product_id TEXT NOT NULL REFERENCES products(id),
                    variant_id TEXT REFERENCES product_variants(id),
                    counted INTEGER NOT NULL DEFAULT 0,
                    expected INTEGER,
                    difference INTEGER,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.run('CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count ON stock_count_lines(count_id)');
        },
    },
    {
        version: '2026_10_cash_expenses',
        description: 'Cash taken out of the drawer for expenses, and the detail of the closing count',
        up(db) {
            // New table and one new column: existing drawers keep their figures
            db.run(`
                CREATE TABLE IF NOT EXISTS cash_expenses (
                    id TEXT PRIMARY KEY,
                    shift_id TEXT NOT NULL REFERENCES shifts(id),
                    employee_id TEXT REFERENCES employees(id),
                    amount REAL NOT NULL,
                    reason TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.run('CREATE INDEX IF NOT EXISTS idx_cash_expenses_shift ON cash_expenses(shift_id)');
            addColumnIfMissing(db, 'shifts', 'closing_count', 'TEXT');
        },
    },
    {
        version: '2026_10_hash_pins',
        description: 'Employee PINs stored hashed instead of in clear',
        up(db) {
            // Each PIN still in clear is replaced by its hash: the same PIN keeps
            // working, nobody has to change it. Rows already hashed are skipped.
            if (!tableExists(db, 'employees')) return;
            const { hashPin, isHashed } = require('../services/pinService');
            const result = db.exec("SELECT id, pin FROM employees WHERE pin IS NOT NULL AND pin <> ''");
            for (const [id, pin] of (result[0]?.values || [])) {
                if (!isHashed(pin)) db.run('UPDATE employees SET pin = ? WHERE id = ?', [hashPin(pin), id]);
            }
        },
    },
    {
        version: '2026_10_store_credit_reservations_wholesale',
        description: 'Store credit (avoir) for returns, wholesale price and customers, reservations with a deposit',
        up(db) {
            // Only new columns and tables: existing data keeps its meaning
            addColumnIfMissing(db, 'returns', 'refund_method', 'TEXT');
            if (tableExists(db, 'gift_cards')) {
                addColumnIfMissing(db, 'gift_cards', 'kind', "TEXT DEFAULT 'gift'");
                addColumnIfMissing(db, 'gift_cards', 'return_id', 'TEXT');
            }
            addColumnIfMissing(db, 'products', 'wholesale_price', 'REAL');
            if (tableExists(db, 'customers')) {
                addColumnIfMissing(db, 'customers', 'is_wholesale', 'INTEGER DEFAULT 0');
                // Language of this customer's tickets (empty = the shop's)
                addColumnIfMissing(db, 'customers', 'receipt_language', 'TEXT');
            }
            addColumnIfMissing(db, 'sales', 'reservation_id', 'TEXT');
            db.run(`
                CREATE TABLE IF NOT EXISTS reservations (
                    id TEXT PRIMARY KEY,
                    number TEXT UNIQUE NOT NULL,
                    customer_id TEXT REFERENCES customers(id),
                    employee_id TEXT REFERENCES employees(id),
                    shift_id TEXT,
                    total REAL NOT NULL DEFAULT 0,
                    deposit REAL NOT NULL DEFAULT 0,
                    deposit_method TEXT DEFAULT 'cash',
                    status TEXT NOT NULL DEFAULT 'open',
                    expires_at DATETIME,
                    notes TEXT,
                    sale_id TEXT,
                    refunded REAL DEFAULT 0,
                    closed_at DATETIME,
                    closed_by TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.run(`
                CREATE TABLE IF NOT EXISTS reservation_items (
                    id TEXT PRIMARY KEY,
                    reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
                    product_id TEXT NOT NULL,
                    variant_id TEXT,
                    product_name TEXT,
                    variant_label TEXT,
                    quantity INTEGER NOT NULL,
                    unit_price REAL NOT NULL
                )
            `);
            db.run('CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)');
            db.run('CREATE INDEX IF NOT EXISTS idx_reservation_items_res ON reservation_items(reservation_id)');
        },
    },
    {
        version: '2026_10_return_credit_reduced',
        description: 'A return on a kridi sale lowers the debt first (returns.credit_reduced)',
        up(db) {
            // Empty on older returns: the drawer keeps reading them as before
            addColumnIfMissing(db, 'returns', 'credit_reduced', 'REAL');
        },
    },
    {
        version: '2026_10_loyalty_base',
        description: 'Amount of a sale that earned loyalty points (sales.loyalty_base)',
        up(db) {
            // Empty on older sales: their whole total earned points
            addColumnIfMissing(db, 'sales', 'loyalty_base', 'REAL');
        },
    },
    {
        version: '2026_10_markdowns',
        description: 'Markdown steps approved or refused by the owner, to measure their result (markdowns)',
        up(db) {
            // A new table only: nothing already saved is changed
            db.run(`
                CREATE TABLE IF NOT EXISTS markdowns (
                    id TEXT PRIMARY KEY,
                    product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
                    percent REAL NOT NULL,
                    status TEXT NOT NULL,
                    promotion_id TEXT,
                    started_at DATETIME,
                    ends_at DATETIME,
                    stock_before INTEGER,
                    sold_before INTEGER,
                    rate_before REAL,
                    employee_id TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.run('CREATE INDEX IF NOT EXISTS idx_markdowns_product ON markdowns(product_id)');
        },
    },
    {
        version: '2026_10_website_orders',
        description: "Orders from the shop's website kept in AFUS with their delivery status (cash on delivery: a sale only once the money is received)",
        up(db) {
            // New tables only: nothing already saved is changed
            db.run(`
                CREATE TABLE IF NOT EXISTS website_orders (
                    id TEXT PRIMARY KEY,
                    received_at DATETIME NOT NULL,
                    customer_name TEXT NOT NULL DEFAULT '',
                    phone TEXT NOT NULL DEFAULT '',
                    wilaya TEXT NOT NULL DEFAULT '',
                    commune TEXT NOT NULL DEFAULT '',
                    address TEXT NOT NULL DEFAULT '',
                    delivery TEXT NOT NULL DEFAULT '',
                    note TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'new',
                    status_at DATETIME,
                    sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
                    money_received_at DATETIME,
                    employee_id TEXT,
                    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.run(`
                CREATE TABLE IF NOT EXISTS website_order_items (
                    order_id TEXT NOT NULL REFERENCES website_orders(id) ON DELETE CASCADE,
                    line INTEGER NOT NULL,
                    product_id TEXT NOT NULL,
                    product_name TEXT NOT NULL DEFAULT '',
                    size TEXT NOT NULL DEFAULT '',
                    color TEXT NOT NULL DEFAULT '',
                    quantity INTEGER NOT NULL,
                    unit_price REAL,
                    PRIMARY KEY (order_id, line)
                )
            `);
            db.run('CREATE INDEX IF NOT EXISTS idx_website_orders_status ON website_orders(status)');
            // One website order is one sale at most
            db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_website_orders_sale ON website_orders(sale_id) WHERE sale_id IS NOT NULL');
        },
    },
    {
        version: '2026_10_website_orders_courier',
        description: "Website orders: first and last name, delivery to a courier company's office",
        up(db) {
            for (const column of ['first_name', 'last_name', 'courier_company', 'office_wilaya', 'office_commune', 'courier_office']) {
                addColumnIfMissing(db, 'website_orders', column, "TEXT NOT NULL DEFAULT ''");
            }
        },
    },
    {
        version: '2026_10_website_order_history',
        description: "Website orders: the customer recognised by phone, and each order's status history (contacted, returned)",
        up(db) {
            if (!tableExists(db, 'website_orders')) return;
            const { phoneKey } = require('../website/orders/phone');
            // The customer key, filled for the orders already kept (their phone stays as it is)
            addColumnIfMissing(db, 'website_orders', 'phone_key', "TEXT NOT NULL DEFAULT ''");
            const rows = db.exec('SELECT id, phone FROM website_orders')[0]?.values || [];
            const stmt = db.prepare('UPDATE website_orders SET phone_key = ? WHERE id = ?');
            for (const [id, phone] of rows) stmt.run([phoneKey(phone), id]);
            stmt.free();
            db.run('CREATE INDEX IF NOT EXISTS idx_website_orders_phone ON website_orders(phone_key)');
            // Every status an order went through (who, when); the orders already kept get theirs
            db.run(`
                CREATE TABLE IF NOT EXISTS website_order_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id TEXT NOT NULL REFERENCES website_orders(id) ON DELETE CASCADE,
                    status TEXT NOT NULL,
                    at DATETIME NOT NULL,
                    employee_id TEXT
                )
            `);
            db.run('CREATE INDEX IF NOT EXISTS idx_website_order_events_order ON website_order_events(order_id, id)');
            db.run(`INSERT INTO website_order_events (order_id, status, at)
                    SELECT o.id, 'new', o.received_at FROM website_orders o
                    WHERE NOT EXISTS (SELECT 1 FROM website_order_events e WHERE e.order_id = o.id)`);
            db.run(`INSERT INTO website_order_events (order_id, status, at, employee_id)
                    SELECT o.id, o.status, COALESCE(o.status_at, o.received_at), o.employee_id FROM website_orders o
                    WHERE o.status <> 'new' AND NOT EXISTS (SELECT 1 FROM website_order_events e WHERE e.order_id = o.id AND e.status = o.status)`);
        },
    },
    {
        version: '2026_10_website_order_confirm',
        description: 'Website orders: an order number for the shipping label, and the pieces put aside when an order is confirmed',
        up(db) {
            if (!tableExists(db, 'website_orders')) return;
            addColumnIfMissing(db, 'website_orders', 'number', "TEXT NOT NULL DEFAULT ''");
            // 1 while its pieces are put aside (confirmed until paid, cancelled or returned)
            addColumnIfMissing(db, 'website_orders', 'reserved', 'INTEGER NOT NULL DEFAULT 0');
            addColumnIfMissing(db, 'website_orders', 'label_printed_at', 'DATETIME');
            addColumnIfMissing(db, 'website_order_items', 'variant_id', 'TEXT');
            addColumnIfMissing(db, 'website_order_items', 'reserved_qty', 'INTEGER NOT NULL DEFAULT 0');
            // Numbers for the orders already kept, in the order they came (W-000001, ...)
            const rows = db.exec("SELECT id FROM website_orders WHERE number = '' ORDER BY julianday(received_at), id")[0]?.values || [];
            const last = db.exec("SELECT MAX(CAST(SUBSTR(number, 3) AS INTEGER)) FROM website_orders WHERE number LIKE 'W-%'")[0]?.values?.[0]?.[0] || 0;
            const stmt = db.prepare('UPDATE website_orders SET number = ? WHERE id = ?');
            rows.forEach(([id], i) => stmt.run([`W-${String(last + i + 1).padStart(6, '0')}`, id]));
            stmt.free();
            db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_website_orders_number ON website_orders(number) WHERE number <> ''");
        },
    },
    {
        version: '2026_10_website_order_returns',
        description: 'Website orders: a returned parcel is checked piece by piece (sellable back in stock, damaged kept out)',
        up(db) {
            if (!tableExists(db, 'website_orders')) return;
            addColumnIfMissing(db, 'website_orders', 'return_checked_at', 'DATETIME');
            addColumnIfMissing(db, 'website_order_items', 'returned_sellable', 'INTEGER NOT NULL DEFAULT 0');
            addColumnIfMissing(db, 'website_order_items', 'returned_damaged', 'INTEGER NOT NULL DEFAULT 0');
        },
    },
    {
        version: '2026_10_website_order_tools',
        description: 'Website orders: delivery price, coupon, courier tracking; views of the website per day and article',
        up(db) {
            if (tableExists(db, 'website_orders')) {
                // Delivery price asked of the customer (the courier's, not part of the sale)
                addColumnIfMissing(db, 'website_orders', 'delivery_fee', 'REAL');
                // A coupon typed on the website, and the discount it gives (checked again in AFUS)
                addColumnIfMissing(db, 'website_orders', 'coupon_code', "TEXT NOT NULL DEFAULT ''");
                addColumnIfMissing(db, 'website_orders', 'coupon_discount', 'REAL NOT NULL DEFAULT 0');
                // The parcel at the courier: its tracking number, the courier's own state of it
                addColumnIfMissing(db, 'website_orders', 'tracking_number', "TEXT NOT NULL DEFAULT ''");
                addColumnIfMissing(db, 'website_orders', 'courier_state', "TEXT NOT NULL DEFAULT ''");
                addColumnIfMissing(db, 'website_orders', 'courier_state_at', 'DATETIME');
            }
            // How many times each page was seen (no person, no address: a count per day)
            db.run(`
                CREATE TABLE IF NOT EXISTS website_views (
                    day TEXT NOT NULL,
                    page TEXT NOT NULL,
                    views INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (day, page)
                )
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
