import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { applyMigrations } = require('../electron/database/migrations');
const partners = require('../electron/services/partnersService');

/** Columns init.js adds on a real installation, when the test schema lacks them. */
function addMissingColumns(api) {
    const add = (table, column, type) => {
        const columns = api.all(`PRAGMA table_info(${table})`).map(c => c.name);
        if (!columns.includes(column)) api.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    };
    add('customers', 'credit_enabled', 'INTEGER DEFAULT 0');
    add('customers', 'credit_limit', 'REAL DEFAULT 0');
    add('customers', 'credit_balance', 'REAL DEFAULT 0');
    add('customers', 'is_active', 'INTEGER DEFAULT 1');
    add('purchase_orders', 'amount_paid', 'REAL DEFAULT 0');
    add('purchase_orders', 'payment_status', "TEXT DEFAULT 'unpaid'");
    add('suppliers', 'balance', 'REAL DEFAULT 0');
}

describe('customers at a glance', () => {
    let api;

    beforeEach(async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        api = createApi(db);
        addMissingColumns(api);
        api.run(`INSERT INTO customers (id, name, phone, credit_enabled, credit_limit) VALUES
            ('c1', 'Amine', '0555 12 34 56', 1, 20000),
            ('c2', 'Sara', '0661000000', 0, 0)`);
        api.run("INSERT INTO customers (id, name, is_active) VALUES ('c3', 'Old', 0)");
        api.run(`INSERT INTO sales (id, receipt_number, customer_id, subtotal, total, status, created_at) VALUES
            ('s1', 'R1', 'c1', 5000, 5000, 'completed', '2026-01-10 10:00:00'),
            ('s2', 'R2', 'c1', 3000, 3000, 'completed', '2026-02-01 10:00:00'),
            ('s3', 'R3', 'c1', 9000, 9000, 'cancelled', '2026-03-01 10:00:00'),
            ('s4', 'R4', 'c2', 1000, 1000, 'completed', '2026-01-05 10:00:00')`);
        api.run(`INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, amount_paid, status, due_date, created_at) VALUES
            ('cr1', 's1', 'c1', 'INV-1', 5000, 2000, 'partial', '2026-01-20', '2026-01-10 10:00:00'),
            ('cr2', 's2', 'c1', 'INV-2', 3000, 3000, 'paid', '2026-02-10', '2026-02-01 10:00:00')`);
        api.run(`INSERT INTO credit_payments (id, credit_sale_id, amount, payment_method, created_at) VALUES
            ('p1', 'cr1', 2000, 'cash', '2026-01-15 09:00:00'),
            ('p2', 'cr2', 3000, 'transfer', '2026-02-05 09:00:00')`);
    });

    it('shows what each active customer still owes, purchases and last activity', () => {
        const rows = partners.customersOverview(api);
        expect(rows.map(r => r.id)).toEqual(['c1', 'c2']); // inactive customer left out
        const amine = rows.find(r => r.id === 'c1');
        expect(amine).toMatchObject({
            owed: 3000, open_credits: 1, oldest_due: '2026-01-20',
            sales_count: 2, sales_total: 8000, // the cancelled sale does not count
            last_sale_at: '2026-02-01 10:00:00', last_payment_at: '2026-02-05 09:00:00',
        });
        expect(rows.find(r => r.id === 'c2')).toMatchObject({ owed: 0, open_credits: 0, sales_count: 1, last_payment_at: null });
    });

    it('lists unpaid credit, the payments and the last purchases of one customer', () => {
        const history = partners.customerHistory(api, 'c1');
        expect(history.owed).toBe(3000);
        expect(history.paid).toBe(5000);
        expect(history.credits.map(c => [c.id, c.remaining, c.receipt_number])).toEqual([['cr2', 0, 'R2'], ['cr1', 3000, 'R1']]);
        expect(history.payments.map(p => p.id)).toEqual(['p2', 'p1']);
        expect(history.sales.map(s => s.id)).toEqual(['s2', 's1']);
    });

    it('never counts more than due when a credit sale was overpaid', () => {
        api.run("UPDATE credit_sales SET amount_paid = 6000 WHERE id = 'cr1'");
        expect(partners.customersOverview(api).find(r => r.id === 'c1').owed).toBe(0);
        expect(partners.customerHistory(api, 'c1').owed).toBe(0);
    });
});

describe('suppliers at a glance', () => {
    let api;

    beforeEach(async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        api = createApi(db);
        addMissingColumns(api);
        api.run(`INSERT INTO suppliers (id, name, phone, balance) VALUES
            ('f1', 'Textile Oran', '041 00 00 00', -999),
            ('f2', 'Jeans Alger', NULL, 0)`);
        api.run(`INSERT INTO purchase_orders (id, po_number, supplier_id, status, total, amount_paid, created_at, updated_at) VALUES
            ('o1', 'PO-1', 'f1', 'received', 50000, 20000, '2026-01-01', '2026-01-05 12:00:00'),
            ('o2', 'PO-2', 'f1', 'partial', 10000, 0, '2026-02-01', '2026-02-03 12:00:00'),
            ('o3', 'PO-3', 'f1', 'sent', 7000, 0, '2026-03-01', '2026-03-01'),
            ('o4', 'PO-4', 'f1', 'cancelled', 9000, 0, '2026-03-02', '2026-03-02'),
            ('o5', 'PO-5', 'f2', 'draft', 4000, 0, '2026-03-03', '2026-03-03')`);
        api.run("INSERT INTO receivings (id, receive_number, supplier_id, received_date) VALUES ('rc1', 'RC-1', 'f1', '2026-02-04 08:00:00')");
        api.run("INSERT INTO supplier_payments (id, supplier_id, amount, payment_method, paid_at) VALUES ('sp1', 'f1', 20000, 'cash', '2026-01-06 10:00:00')");
    });

    it('computes what the shop still owes from the goods received, not the stored balance', () => {
        const rows = partners.suppliersOverview(api);
        const oran = rows.find(r => r.id === 'f1');
        expect(oran).toMatchObject({
            received_total: 60000, received_paid: 20000, owed: 40000,
            waiting_orders: 1, orders_count: 3, // the cancelled order is left out
            last_received_at: '2026-02-04 08:00:00', last_payment_at: '2026-01-06 10:00:00',
        });
        expect(rows.find(r => r.id === 'f2')).toMatchObject({ owed: 0, received_total: 0, waiting_orders: 1, last_received_at: null });
    });

    it('takes the goods sent back off what is owed, never below zero', () => {
        api.run("INSERT INTO purchase_returns (id, return_number, supplier_id, total_amount, status) VALUES ('rt1', 'RET-1', 'f1', 5000, 'complated')");
        expect(partners.suppliersOverview(api).find(r => r.id === 'f1')).toMatchObject({ owed: 35000, returned_total: 5000 });
        api.run("UPDATE purchase_returns SET total_amount = 90000 WHERE id = 'rt1'");
        expect(partners.suppliersOverview(api).find(r => r.id === 'f1').owed).toBe(0);
    });

    it('uses the date of the received order when there is no receiving record', () => {
        api.run('DELETE FROM receivings');
        expect(partners.suppliersOverview(api).find(r => r.id === 'f1').last_received_at).toBe('2026-02-03 12:00:00');
    });
});
