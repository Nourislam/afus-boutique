/**
 * Training mode for a new cashier. While it is on, the program works on a
 * copy of the shop's data kept in memory (database/init.js startSandbox):
 * sales, returns, exchanges, kridi and drawer closings happen for real in the
 * copy, so the screens behave exactly as usual, but stock, cash, reports and
 * the shop's file are never changed. Leaving training throws the copy away;
 * closing the program does the same.
 *
 * The copy gets a training article and a training customer (allowed kridi)
 * so the five guided exercises always work, even in an empty shop.
 * `api` is the { all, get, run, uuid } database adapter.
 */
const catalog = require('./catalogService');

const TRAINING_PRODUCT = 'training-article';
const TRAINING_CUSTOMER = 'training-customer';

/** Training article (3 sizes) and customer, in the copy only. Names in the shop's language. */
function seed(api, { productName, customerName } = {}) {
    if (!api.get('SELECT id FROM products WHERE id = ?', [TRAINING_PRODUCT])) {
        try {
            catalog.saveProduct(api, { id: TRAINING_PRODUCT, name: productName || 'Training', price: 2500, cost: 1200, has_sizes: 1 }, [
                { size: 'S', sku: 'TRAIN-S', stock_quantity: 10 },
                { size: 'M', sku: 'TRAIN-M', stock_quantity: 10 },
                { size: 'L', sku: 'TRAIN-L', stock_quantity: 10 },
            ], { isNew: true });
        } catch (error) {
            // A shop already using these codes: the exercises use its own articles
            console.warn('Training article not added:', error.message);
        }
    }
    if (!api.get('SELECT id FROM customers WHERE id = ?', [TRAINING_CUSTOMER])) {
        const columns = api.all('PRAGMA table_info(customers)').map(c => c.name);
        const fields = { id: TRAINING_CUSTOMER, name: customerName || 'Training', phone: '0555 00 00 00' };
        if (columns.includes('credit_enabled')) fields.credit_enabled = 1;
        if (columns.includes('credit_limit')) fields.credit_limit = 100000;
        if (columns.includes('is_active')) fields.is_active = 1;
        const keys = Object.keys(fields);
        api.run(`INSERT INTO customers (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Object.values(fields));
    }
    return { productId: TRAINING_PRODUCT, customerId: TRAINING_CUSTOMER };
}

/** What has been done, counted for the exercises (compared with the count when an exercise starts). */
function progress(api) {
    const n = (sql) => api.get(sql)?.n || 0;
    return {
        sales: n('SELECT COUNT(*) AS n FROM sales'),
        twoSizeSales: n(`
            SELECT COUNT(*) AS n FROM sales s WHERE EXISTS (
                SELECT 1 FROM sale_items a JOIN sale_items b
                  ON a.sale_id = b.sale_id AND a.product_id = b.product_id AND a.variant_id <> b.variant_id
                WHERE a.sale_id = s.id)`),
        exchanges: n('SELECT COUNT(*) AS n FROM exchanges'),
        creditSales: n('SELECT COUNT(*) AS n FROM credit_sales'),
        closedShifts: n('SELECT COUNT(*) AS n FROM shifts WHERE end_time IS NOT NULL'),
    };
}

module.exports = { seed, progress, TRAINING_PRODUCT, TRAINING_CUSTOMER };
