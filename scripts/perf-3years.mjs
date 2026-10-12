// 3 years of a busy clothing shop: how fast are the screens and the saves?
// Run: npx vite-node scripts/perf-3years.mjs (works on a database in memory and a temporary folder)
import { createRequire } from 'module';
import { createLegacyDb, createApi } from '../tests/helpers/testDb.js';
import { addInitColumns } from '../tests/helpers/shop.js';
const require = createRequire(import.meta.url);
const { applyMigrations } = require('../electron/database/migrations');
const dashboard = require('../electron/services/dashboardService');
const partners = require('../electron/services/partnersService');
const { reorderSuggestions } = require('../electron/services/reorderService');
const { nextReceiptNumber } = require('../electron/services/receiptNumber');

const db = await createLegacyDb();
applyMigrations(db);
const api = createApi(db);
addInitColumns(api);
const t = (label, fn) => { const s = performance.now(); const r = fn(); console.log(`${label.padEnd(44)} ${(performance.now() - s).toFixed(0).padStart(6)} ms`); return r; };

const ARTICLES = 600, VARIANTS = 6, DAYS = 3 * 365, PER_DAY = 45, CUSTOMERS = 3000;
t('seed', () => {
    db.run('BEGIN');
    const pv = db.prepare('INSERT INTO product_variants (id, product_id, sku, qr_code, color, size, stock_quantity, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
    for (let a = 0; a < ARTICLES; a++) {
        db.run('INSERT INTO products (id, name, sku, price, cost, stock_quantity, min_stock_level, has_variants, is_active, category_id) VALUES (?, ?, ?, ?, ?, 0, 2, 1, 1, ?)', [`p${a}`, `Article ${a}`, `ART${a}`, 2000 + (a % 30) * 100, 1200, `cat${a % 12}`]);
        for (let v = 0; v < VARIANTS; v++) pv.run([`p${a}v${v}`, `p${a}`, `S${a}-${v}`, `Q${a}-${v}`, `c${v % 3}`, `${36 + v}`, 1 + ((a + v) % 9)]);
    }
    pv.free();
    for (let c = 0; c < CUSTOMERS; c++) db.run('INSERT INTO customers (id, name, phone, credit_enabled, credit_limit, credit_balance) VALUES (?, ?, ?, ?, 50000, 0)', [`c${c}`, `Client ${c}`, `05${String(c).padStart(8, '0')}`, c % 5 === 0 ? 1 : 0]);
    db.run("INSERT INTO employees (id, name, pin, role) VALUES ('e1', 'A', 'x', 'cashier')");
    const sale = db.prepare('INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, tax_amount, discount_amount, total, status, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)');
    const item = db.prepare('INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, quantity, unit_price, total, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1200)');
    const pay = db.prepare('INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, ?, ?)');
    const start = Date.now() - DAYS * 86400000;
    let n = 0;
    for (let d = 0; d < DAYS; d++) {
        for (let k = 0; k < PER_DAY; k++) {
            n++;
            const time = new Date(start + d * 86400000 + (9 + (k % 10)) * 3600000).toISOString().replace('T', ' ').slice(0, 19);
            const a = (n * 7) % ARTICLES, v = n % VARIANTS, q = 1 + (n % 3), price = 2000 + (a % 30) * 100;
            sale.run([`s${n}`, `R${n}`, 'e1', n % 4 === 0 ? `c${n % CUSTOMERS}` : null, q * price, q * price, n % 97 === 0 ? 'refunded' : 'completed', time]);
            item.run([`i${n}`, `s${n}`, `p${a}`, `p${a}v${v}`, `Article ${a}`, q, price, q * price]);
            pay.run([`y${n}`, `s${n}`, n % 10 === 0 ? 'card' : 'cash', q * price]);
        }
    }
    sale.free(); item.free(); pay.free();
    db.run('COMMIT');
    console.log(`  ${n} sales, ${ARTICLES * VARIANTS} pieces, ${CUSTOMERS} customers`);
});
const bytes = t('export (saveDatabase)', () => db.export().length);
console.log(`  database size ${(bytes / 1024 / 1024).toFixed(1)} MB`);
const fs = require('fs'); const path = require('path'); const os = require('os');
const catalog = require('../electron/services/catalogService');
const returnService = require('../electron/services/returnService');
const backupService = require('../electron/services/backupService');
const accounting = require('../electron/services/accountingService');
const stats = require('../electron/services/salesStatsService');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'bench-'));
const dbFile = path.join(dir, 'afus.db');
// As init.saveDatabase: export, write next to the file, rename over it
const persist = () => { const tmp = `${dbFile}.tmp`; fs.writeFileSync(tmp, Buffer.from(db.export())); fs.renameSync(tmp, dbFile); };
const median = (label, runs, fn) => {
    const times = []; for (let i = 0; i < runs; i++) { const s = performance.now(); fn(i); times.push(performance.now() - s); }
    times.sort((a, b) => a - b);
    console.log(`${label.padEnd(44)} ${times[Math.floor(runs / 2)].toFixed(0).padStart(6)} ms (median of ${runs}, max ${times[runs - 1].toFixed(0)})`);
};
persist();
console.log(`  database file ${(fs.statSync(dbFile).size / 1024 / 1024).toFixed(1)} MB`);
const nowSql = new Date().toISOString().replace('T', ' ').slice(0, 19);
median('sale save (ticket + stock + write to disk)', 15, (i) => {
    db.run('BEGIN');
    const id = `bench-s${i}`;
    api.run("INSERT INTO sales (id, receipt_number, employee_id, subtotal, tax_amount, discount_amount, total, status, created_at) VALUES (?, ?, 'e1', 2500, 0, 0, 2500, 'completed', ?)", [id, `B${i}`, nowSql]);
    api.run("INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, quantity, unit_price, total, unit_cost) VALUES (?, ?, 'p1', 'p1v1', 'Article 1', 1, 2500, 2500, 1200)", [`${id}-i`, id]);
    api.run("INSERT INTO payments (id, sale_id, method, amount) VALUES (?, ?, 'cash', 2500)", [`${id}-p`, id]);
    catalog.adjustStock(api, { productId: 'p1', variantId: 'p1v1', delta: -1, type: 'sale', reason: 'bench' });
    db.run('COMMIT');
    persist();
});
median('product save (6 variants + write to disk)', 10, (i) => {
    catalog.saveProduct(api, { id: `bench-p${i}`, name: `Bench ${i}`, price: 3000, cost: 1500 },
        [0, 1, 2, 3, 4, 5].map(v => ({ color: `C${v % 3}`, size: `${38 + v}`, sku: `BENCH-${i}-${v}`, stock_quantity: 3 })), { isNew: true });
    persist();
});
median('return (1 piece, debt/points + write)', 10, (i) => {
    db.run('BEGIN');
    returnService.createReturn(api, { id: `bench-r${i}`, sale_id: `bench-s${i}`, return_number: `BR${i}`, total_refund: 2500, employee_id: 'e1',
        items: [{ sale_item_id: `bench-s${i}-i`, quantity: 1, refund_amount: 2500, condition: 'sellable' }] });
    db.run('COMMIT');
    persist();
});
const base = 'FROM sales s LEFT JOIN employees e ON s.employee_id = e.id LEFT JOIN customers c ON s.customer_id = c.id WHERE 1=1';
median('history: oldest ticket by number (count+page)', 5, () => {
    api.get(`SELECT COUNT(*) AS n ${base} AND (s.receipt_number LIKE ? OR c.name LIKE ? OR e.name LIKE ?)`, ['%R1%', '%R1%', '%R1%']);
    api.all(`SELECT s.*, e.name AS employee_name, c.name AS customer_name ${base} AND (s.receipt_number LIKE ? OR c.name LIKE ? OR e.name LIKE ?) ORDER BY s.created_at DESC LIMIT 50 OFFSET 0`, ['%R1%', '%R1%', '%R1%']);
});
median('history: first page (count + 50 rows)', 5, () => {
    api.get(`SELECT COUNT(*) AS n ${base}`); api.all(`SELECT s.* ${base} ORDER BY s.created_at DESC LIMIT 50`);
});
const today = new Date().toISOString().slice(0, 10);
const since30 = new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
const month = { startDate: since30, endDate: `${today} 23:59:59` };
const year = { startDate: new Date(Date.now() - 365 * 86400000).toISOString().replace('T', ' ').slice(0, 19), endDate: `${today} 23:59:59` };
median('Dashboard open (home + selling + series + stock)', 3, () => {
    dashboard.outOfStockSelling(api, since30); dashboard.runningLow(api); dashboard.missingCost(api); dashboard.overdueCredit(api, today); dashboard.firstSteps(api);
    dashboard.bestSellers(api, month); dashboard.slowMovers(api, since30);
    dashboard.salesSeries(api, month, 'day', 60);
    dashboard.missingSizes(api, since30); dashboard.slowMovers(api, since30, -1); dashboard.stockValue(api);
});
median('Reports: sales stats (1 year)', 3, () => stats.salesStats(api, year));
median('accountant journal (1 year)', 3, () => accounting.salesJournal(api, year));
median('backup (copy of the database file)', 5, () => backupService.createBackup(path.join(dir, 'Backups'), dbFile, { kind: 'auto' }));
fs.rmSync(dir, { recursive: true, force: true });
