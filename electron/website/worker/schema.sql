-- The shop's website database (Cloudflare D1, on the shop's own account).
-- No article is kept here: the articles stay in Afus Boutique (SQLite) and
-- are published as pages. This holds what the website receives: order
-- requests from customers, and what was last published.
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    wilaya TEXT NOT NULL DEFAULT '',
    commune TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    delivery TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL DEFAULT '',
    ip_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at);
CREATE INDEX IF NOT EXISTS orders_ip ON orders (ip_hash, created_at);
CREATE TABLE IF NOT EXISTS site_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
