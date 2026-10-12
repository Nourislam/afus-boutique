-- The shop's website database (Cloudflare D1, on the shop's own account).
-- No article is kept here: the articles stay in Afus Boutique (SQLite) and
-- are published as pages. A waiting room for the customers' orders: each
-- one stays until Afus Boutique saved it in the shop's SQLite and said so
-- (ack), then it is deleted. Also what was last published.
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1,
    customer_name TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    wilaya TEXT NOT NULL DEFAULT '',
    commune TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    delivery TEXT NOT NULL DEFAULT '',
    courier_company TEXT NOT NULL DEFAULT '',
    office_wilaya TEXT NOT NULL DEFAULT '',
    office_commune TEXT NOT NULL DEFAULT '',
    courier_office TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL DEFAULT '',
    ip_hash TEXT NOT NULL DEFAULT '',
    order_key TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    delivery_fee REAL,
    coupon_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at);
CREATE INDEX IF NOT EXISTS orders_ip ON orders (ip_hash, created_at);
-- The checkout's order keys (idempotency), kept 30 days after the order
CREATE TABLE IF NOT EXISTS order_keys (
    order_key TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
-- Counts for the limits (orders, wrong keys) per place (hashed), kept one day
CREATE TABLE IF NOT EXISTS hits (
    kind TEXT NOT NULL,
    who TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_who ON hits (kind, who, created_at);
CREATE TABLE IF NOT EXISTS site_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- How many times each page was seen, per day (no person, no address), kept 14 days
CREATE TABLE IF NOT EXISTS views (
    day TEXT NOT NULL,
    page TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, page)
);
