import { describe, it, expect, beforeEach } from 'vitest';
import { createShop, sell, loadShiftService } from './helpers/shop';

const code = (fn) => { try { fn(); } catch (e) { return e.message.split('|')[0]; } return null; };
const CASHIER = { id: 'cash1', role: 'cashier' };

describe('cash expenses and drawer closing', () => {
    let api, shifts;
    beforeEach(async () => {
        ({ api } = await createShop());
        shifts = loadShiftService(api);
        api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('sh1', 'cash1', '2000-01-01T00:00:00.000Z', 2000)");
        sell(api, 's1', [{ product: 'belt', qty: 5, price: 800, name: 'Ceinture' }]); // 4 000 cash
    });

    it('no expense: expected cash as before', () => {
        const stats = shifts.getShiftStats('sh1');
        expect(stats).toMatchObject({ total_expenses: 0, expected_cash: 6000, total_sales: 4000 });
    });

    it('one or several expenses lower the cash expected, never the sales', () => {
        shifts.addExpense('sh1', { amount: 300, reason: 'Café' }, CASHIER);
        let stats = shifts.getShiftStats('sh1');
        expect(stats).toMatchObject({ total_expenses: 300, expected_cash: 5700, total_sales: 4000 });
        shifts.addExpense('sh1', { amount: '1200.50', reason: 'Livraison' }, { id: 'boss', role: 'manager' });
        stats = shifts.getShiftStats('sh1');
        expect(stats).toMatchObject({ total_expenses: 1500.5, expected_cash: 4499.5, total_sales: 4000, total_transactions: 1 });
        expect(shifts.getExpenses('sh1').map(x => [x.amount, x.reason, x.employee_name])).toEqual([[300, 'Café', 'Amina'], [1200.5, 'Livraison', 'Karim']]);
    });

    it('refuses a wrong amount, no reason, more than the drawer, someone else, a closed drawer', () => {
        expect(code(() => shifts.addExpense('sh1', { amount: 0, reason: 'x' }, CASHIER))).toBe('EXPENSE_AMOUNT');
        expect(code(() => shifts.addExpense('sh1', { amount: -5, reason: 'x' }, CASHIER))).toBe('EXPENSE_AMOUNT');
        expect(code(() => shifts.addExpense('sh1', { amount: 10, reason: '  ' }, CASHIER))).toBe('EXPENSE_REASON');
        expect(code(() => shifts.addExpense('sh1', { amount: 6001, reason: 'x' }, CASHIER))).toBe('EXPENSE_MORE_THAN_DRAWER');
        api.run("INSERT INTO employees (id, name, pin, role) VALUES ('cash2', 'Sara', '2222', 'cashier')");
        expect(code(() => shifts.addExpense('sh1', { amount: 10, reason: 'x' }, { id: 'cash2', role: 'cashier' }))).toBe('EXPENSE_NOT_ALLOWED');
        expect(code(() => shifts.addExpense('sh1', { amount: 10, reason: 'x' }, {}))).toBe('EXPENSE_NOT_ALLOWED');
        shifts.endShift('sh1', 6000);
        expect(code(() => shifts.addExpense('sh1', { amount: 10, reason: 'x' }, CASHIER))).toBe('SHIFT_ALREADY_CLOSED');
        expect(shifts.getExpenses('sh1')).toEqual([]);
    });

    it('closing: right, short and over, with the detail of the count kept', () => {
        shifts.addExpense('sh1', { amount: 500, reason: 'Ménage' }, CASHIER);
        // Expected 5 500. Counted 2x2000 + 3x500 = 5 500
        shifts.endShift('sh1', 5500, '', { 2000: 2, 500: '3', 200: 0 });
        let stats = shifts.getShiftStats('sh1');
        expect(stats).toMatchObject({ expected_cash: 5500, closing_cash: 5500, cash_difference: 0, closing_count: { 2000: 2, 500: 3 } });

        api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('sh2', 'boss', '2000-01-01T00:00:00.000Z', 1000)");
        shifts.endShift('sh2', 900);
        expect(shifts.getShiftStats('sh2')).toMatchObject({ cash_difference: -100, closing_count: null });
        api.run("INSERT INTO shifts (id, employee_id, start_time, opening_cash) VALUES ('sh3', 'owner', '2000-01-01T00:00:00.000Z', 1000)");
        shifts.endShift('sh3', 1050);
        expect(shifts.getShiftStats('sh3').cash_difference).toBe(50);
        expect(code(() => shifts.endShift('sh3', 1))).toBe('SHIFT_ALREADY_CLOSED');
        stats = shifts.getShiftStats('sh1');
        expect(stats.total_expenses).toBe(500);
    });
});
