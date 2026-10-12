import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, sell } from './helpers/shop';

const require = createRequire(import.meta.url);
const returnService = require('../electron/services/returnService');
const accounting = require('../electron/services/accountingService');
const salesStats = require('../electron/services/salesStatsService');

const RANGE = { startDate: '2000-01-01 00:00:00', endDate: '2100-01-01 00:00:00' };

describe('sales journal for the accountant, and the profit without TVA', () => {
    let api, v;
    beforeEach(async () => { ({ api, v } = await createShop()); });

    it('one line per ticket and per return; totals = the Reports screen', () => {
        // 2 jeans 3 000 TTC with 19 % TVA inside: 6 000 TTC, 957.98 TVA
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000 }], { tax: 957.98 });
        sell(api, 's2', [{ product: 'belt', qty: 1, price: 800, name: 'Ceinture', cost: 300 }], { method: 'card' });
        sell(api, 's3', [{ product: 'belt', qty: 1, price: 800, name: 'Ceinture', cost: 300 }], { status: 'voided' });
        returnService.createReturn(api, { id: 'r1', sale_id: 's1', return_number: 'RET-1', total_refund: 3000, employee_id: 'cash1',
            items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 3000, condition: 'sellable' }] });
        const { rows, totals } = accounting.salesJournal(api, RANGE);
        expect(rows.map(r => r.type)).toEqual(['sale', 'sale', 'return']);
        expect(rows[0]).toMatchObject({ amount_ttc: 6000, tva: 957.98, amount_ht: 5042.02, cash: 6000 });
        expect(rows[1]).toMatchObject({ amount_ttc: 800, card: 800, tva: 0 });
        expect(rows[2]).toMatchObject({ amount_ttc: -3000, tva: -478.99, amount_ht: -2521.01, cash: -3000 });
        const stats = salesStats.salesStats(api, RANGE);
        expect(totals.amount_ttc).toBe(stats.net_revenue);
        expect(totals.tva).toBe(stats.net_tax);
    });

    it('the profit takes off what the returned pieces were paid without TVA', () => {
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 2, price: 3000, cost: 1800 }], { tax: 957.98 });
        returnService.createReturn(api, { id: 'r1', sale_id: 's1', return_number: 'RET-1', total_refund: 3000, employee_id: 'cash1',
            items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 3000, condition: 'sellable' }] });
        const stats = salesStats.salesStats(api, RANGE);
        // One jean kept: 3 000 TTC = 2 521.01 HT, cost 1 800
        expect(stats.total_profit).toBe(721.01);
        expect(stats.net_tax).toBe(478.99);
    });

    it('a kridi return shows the debt lowered, not cash', () => {
        api.run("INSERT INTO customers (id, name, credit_balance) VALUES ('c1', 'Karima', 3000)");
        sell(api, 's1', [{ product: 'jean', variant: v['J-N-38'], qty: 1, price: 3000 }], { method: 'credit', customer: 'c1' });
        api.run("INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, amount_paid, due_date) VALUES ('cs1', 's1', 'c1', 'INV-1', 3000, 0, '2026-12-31')");
        returnService.createReturn(api, { id: 'r1', sale_id: 's1', return_number: 'RET-1', total_refund: 3000, employee_id: 'cash1',
            items: [{ sale_item_id: 's1-0', quantity: 1, refund_amount: 3000, condition: 'sellable' }] });
        const back = accounting.salesJournal(api, RANGE).rows.find(r => r.type === 'return');
        expect(back).toMatchObject({ credit: -3000, cash: 0, customer: 'Karima' });
    });
});
