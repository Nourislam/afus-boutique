-- afus boutique database schema (base tables; later changes are in init.js and migrations.js)

-- Categories
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    icon TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT UNIQUE,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
    price REAL NOT NULL,
    cost REAL DEFAULT 0,
    stock_quantity INTEGER DEFAULT 0,
    min_stock_level INTEGER DEFAULT 5,
    max_stock_level INTEGER DEFAULT 20,
    tax_rate REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    image_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    loyalty_points INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Employees
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    pin TEXT NOT NULL,
    role TEXT DEFAULT 'cashier',
    is_active INTEGER DEFAULT 1,
    avatar_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sales
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    receipt_number TEXT UNIQUE NOT NULL,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    subtotal REAL NOT NULL,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total REAL NOT NULL,
    status TEXT DEFAULT 'completed',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sale Items
CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL NOT NULL
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    reference TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Inventory Logs
CREATE TABLE IF NOT EXISTS inventory_logs (
    id TEXT PRIMARY KEY,
    product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    quantity_change INTEGER NOT NULL,
    quantity_before INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    reason TEXT,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Held Transactions
CREATE TABLE IF NOT EXISTS held_transactions (
    id TEXT PRIMARY KEY,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    items_json TEXT NOT NULL,
    subtotal REAL NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    opening_cash REAL DEFAULT 0,
    closing_cash REAL,
    notes TEXT
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_employee ON sales(employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_product ON inventory_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);

-- ================================================
-- PHASE 2: ADVANCED FEATURES
-- ================================================

-- Gift Cards
CREATE TABLE IF NOT EXISTS gift_cards (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    initial_balance REAL NOT NULL,
    current_balance REAL NOT NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    is_active INTEGER DEFAULT 1,
    expires_at DATETIME,
    created_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Gift Card Transactions
CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id TEXT PRIMARY KEY,
    gift_card_id TEXT REFERENCES gift_cards(id) ON DELETE CASCADE,
    sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL, -- 'redeem', 'reload', 'refund'
    balance_before REAL NOT NULL,
    balance_after REAL NOT NULL,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Promotions/Discounts
CREATE TABLE IF NOT EXISTS promotions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL, -- 'percentage', 'fixed', 'bogo', 'bundle', 'threshold'
    value REAL, -- discount value (percentage or fixed amount)
    min_purchase REAL DEFAULT 0,
    max_discount REAL, -- cap on discount amount
    max_uses INTEGER,
    current_uses INTEGER DEFAULT 0,
    start_date DATETIME,
    end_date DATETIME,
    is_active INTEGER DEFAULT 1,
    applies_to TEXT DEFAULT 'all', -- 'all', 'category', 'product'
    applies_to_ids TEXT, -- JSON array of category/product IDs
    coupon_code TEXT UNIQUE, -- optional coupon code
    auto_apply INTEGER DEFAULT 1, -- auto-apply or require code
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bundles
CREATE TABLE IF NOT EXISTS bundles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    bundle_price REAL NOT NULL,
    original_price REAL, -- sum of individual items
    savings REAL, -- calculated savings
    is_active INTEGER DEFAULT 1,
    deduct_component_stock INTEGER DEFAULT 0, -- If 1, deducts stock from individual items instead of bundle
    stock_quantity INTEGER DEFAULT 0,
    image_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bundle Items
CREATE TABLE IF NOT EXISTS bundle_items (
    id TEXT PRIMARY KEY,
    bundle_id TEXT REFERENCES bundles(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1
);

-- Receipts (for tracking print/email history)
CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'print', 'email', 'pdf'
    email_to TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    error_message TEXT,
    sent_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Email Templates
CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    template_type TEXT DEFAULT 'receipt', -- 'receipt', 'gift_card', 'promotion'
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Additional indexes for new tables
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_customer ON gift_cards(customer_id);
CREATE INDEX IF NOT EXISTS idx_gift_card_trans_card ON gift_card_transactions(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(is_active);
CREATE INDEX IF NOT EXISTS idx_bundles_active ON bundles(is_active);
CREATE INDEX IF NOT EXISTS idx_receipts_sale ON receipts(sale_id);

-- Quotations
CREATE TABLE IF NOT EXISTS quotations (
    id TEXT PRIMARY KEY,
    quote_number TEXT UNIQUE NOT NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    subtotal REAL NOT NULL,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total REAL NOT NULL,
    notes TEXT,
    status TEXT DEFAULT 'active', -- active, converted, expired
    valid_until DATETIME,
    created_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotation_items (
    id TEXT PRIMARY KEY,
    quotation_id TEXT REFERENCES quotations(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL NOT NULL
);

-- Returns
CREATE TABLE IF NOT EXISTS returns (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    return_number TEXT UNIQUE NOT NULL,
    total_refund REAL NOT NULL,
    reason TEXT,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT REFERENCES returns(id) ON DELETE CASCADE,
    sale_item_id TEXT REFERENCES sale_items(id) ON DELETE SET NULL,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL,
    refund_amount REAL NOT NULL,
    condition TEXT DEFAULT 'sellable' -- 'sellable', 'damaged'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);

-- ================================================
-- PHASE 4: SUPPLIER PO SYSTEM
-- ================================================

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    website TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Purchase Orders (Supplier Quotes)
CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    po_number TEXT UNIQUE NOT NULL,
    supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'draft', -- draft, sent, received, cancelled
    expected_date DATETIME,
    subtotal REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount_type TEXT DEFAULT 'fixed',
    discount_value REAL DEFAULT 0,
    shipping_cost REAL DEFAULT 0,
    total REAL DEFAULT 0,
    amount_paid REAL DEFAULT 0, -- Track separate from status
    payment_status TEXT DEFAULT 'unpaid',
    notes TEXT,
    created_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL, -- snapshot in case product is deleted
    quantity INTEGER NOT NULL,
    unit_cost REAL DEFAULT 0, -- cost at time of PO
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total_cost REAL DEFAULT 0
);

-- Indexes for Supplier System
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);

-- Supplier Payments
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
);

-- Purchase Returns (Return to Vendor)
CREATE TABLE IF NOT EXISTS purchase_returns (
    id TEXT PRIMARY KEY,
    return_number TEXT UNIQUE NOT NULL,
    purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier_id TEXT REFERENCES suppliers(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'draft', -- draft, sent, completed
    total_amount REAL NOT NULL,
    notes TEXT,
    created_by TEXT REFERENCES employees(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT REFERENCES purchase_returns(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL,
    reason TEXT
);

-- Indexes for Returns
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON purchase_returns(supplier_id);

-- Goods Receiving (GRN)
CREATE TABLE IF NOT EXISTS receivings (
    id TEXT PRIMARY KEY,
    receive_number TEXT UNIQUE NOT NULL,
    purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
    received_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'completed', -- completed (stock added)
    notes TEXT,
    created_by TEXT REFERENCES employees(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receiving_items (
    id TEXT PRIMARY KEY,
    receiving_id TEXT REFERENCES receivings(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER NOT NULL,
    condition TEXT DEFAULT 'good'
);

CREATE INDEX IF NOT EXISTS idx_receivings_po ON receivings(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_receiving_items_receiving ON receiving_items(receiving_id);

-- Supplier Invoices
CREATE TABLE IF NOT EXISTS supplier_invoices (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL,
    invoice_date DATETIME NOT NULL,
    due_date DATETIME,
    subtotal REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    match_status TEXT DEFAULT 'pending', -- pending, matched, mismatched
    payment_status TEXT DEFAULT 'unpaid', -- unpaid, partial, paid
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_po ON supplier_invoices(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_number ON supplier_invoices(invoice_number);


-- ================================================
-- PHASE 5: CREDIT SALE SYSTEM
-- ================================================

-- Add credit fields to customers table (via separate ALTER commands for compatibility)
-- Note: SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we handle in init.js

-- Credit Sales (sales made on credit)
CREATE TABLE IF NOT EXISTS credit_sales (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id),
    invoice_number TEXT UNIQUE NOT NULL,
    amount_due REAL NOT NULL,
    amount_paid REAL DEFAULT 0,
    status TEXT DEFAULT 'pending', -- 'pending', 'partial', 'paid', 'overdue'
    due_date DATETIME NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Credit Payments (payments against credit sales)
CREATE TABLE IF NOT EXISTS credit_payments (
    id TEXT PRIMARY KEY,
    credit_sale_id TEXT REFERENCES credit_sales(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    reference TEXT,
    received_by TEXT REFERENCES employees(id),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Credit Sales
CREATE INDEX IF NOT EXISTS idx_credit_sales_customer ON credit_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_sales_status ON credit_sales(status);
CREATE INDEX IF NOT EXISTS idx_credit_sales_due_date ON credit_sales(due_date);
CREATE INDEX IF NOT EXISTS idx_credit_payments_sale ON credit_payments(credit_sale_id);
