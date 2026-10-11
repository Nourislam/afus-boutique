import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { createShop, loadShiftService } from './helpers/shop';

const require = createRequire(import.meta.url);
const reservations = require('../electron/services/reservationService');

const stock = (api, id) => api.get('SELECT stock_quantity FROM product_variants WHERE id = ?', [id]).stock_quantity;
const code = (fn) => { try { fn(); } catch (e) { return e.message.split('|')[0]; } return null; };

describe('reservations with a deposit', () => {
    let api, v, shifts, shift;
    beforeEach(async () => {
        ({ api, v } = await createShop());
        api.run("INSERT INTO customers (id, name) VALUES ('c1', 'Karima')");
        shifts = loadShiftService(api);
        shift = shifts.startShift('cash1', 1000);
    });
    const reserve = (extra = {}) => reservations.createReservation(api, {
        customer_id: 'c1', employee_id: 'cash1', deposit: 2000, deposit_method: 'cash',
        items: [{ product_id: 'jean', variant_id: v['J-N-38'], quantity: 2, unit_price: 3000 }], ...extra,
    });

    it('puts the pieces aside and the deposit in the drawer', () => {
        const r = reserve();
        expect(r.number).toMatch(/^RES-\d{6}-001$/);
        expect(r).toMatchObject({ status: 'open', total: 6000, deposit: 2000 });
        expect(stock(api, v['J-N-38'])).toBe(2);
        expect(shifts.getShiftStats(shift.id)).toMatchObject({ deposits_cash: 2000, expected_cash: 3000 });
        // Rules: a customer, a deposit within the total, the stock
        expect(code(() => reserve({ customer_id: null }))).toBe('RESERVATION_NEEDS_CUSTOMER');
        expect(code(() => reserve({ deposit: 7000 }))).toBe('RESERVATION_DEPOSIT');
        expect(code(() => reserve({ items: [{ product_id: 'jean', variant_id: v['J-N-38'], quantity: 3, unit_price: 3000 }] }))).toBe('STOCK_INSUFFICIENT');
    });

    it('cancelled: pieces back in stock, the deposit given back from the drawer', () => {
        const r = reserve();
        reservations.cancelReservation(api, r.id, { refund: 2000, employeeId: 'cash1' });
        expect(stock(api, v['J-N-38'])).toBe(4);
        expect(shifts.getShiftStats(shift.id)).toMatchObject({ deposits_cash: 2000, deposit_refunds: 2000, expected_cash: 1000 });
        expect(code(() => reservations.cancelReservation(api, r.id))).toBe('RESERVATION_CLOSED');
    });

    it('picked up: the pieces come back for the sale, no deposit paid twice', () => {
        const r = reserve();
        const sale = { id: 's1', employee_id: 'cash1', reservation_id: r.id, payments: [{ method: 'deposit', amount: 2000 }, { method: 'cash', amount: 4000 }] };
        expect(code(() => reservations.completeForSale(api, { ...sale, payments: [{ method: 'deposit', amount: 2500 }] }))).toBe('RESERVATION_DEPOSIT');
        reservations.completeForSale(api, sale);
        // Back in stock, ready for the sale lines to take them out
        expect(stock(api, v['J-N-38'])).toBe(4);
        expect(reservations.getReservation(api, r.id)).toMatchObject({ status: 'completed', sale_id: 's1' });
        expect(reservations.listReservations(api, { status: 'open' })).toHaveLength(0);
    });
});
