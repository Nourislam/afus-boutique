const { v4: uuid } = require('uuid');
const { runInsert, getOne, runQuery } = require('../database/init');

class ShiftService {
    constructor() {}

    startShift(employeeId, openingCash, notes = '') {
        // Check if there is already an active shift for this employee
        const activeShift = this.getCurrentShift(employeeId);
        if (activeShift) {
            throw new Error('Employee already has an active shift.');
        }

        const shift = {
            id: uuid(),
            employee_id: employeeId,
            start_time: new Date().toISOString(),
            opening_cash: openingCash,
            notes: notes
        };

        runInsert(`
            INSERT INTO shifts (id, employee_id, start_time, opening_cash, notes)
            VALUES (?, ?, ?, ?, ?)
        `, [shift.id, shift.employee_id, shift.start_time, shift.opening_cash, shift.notes]);

        return shift;
    }

    endShift(shiftId, closingCash, notes = '') {
        const shift = this.getShiftById(shiftId);
        if (!shift) throw new Error('Shift not found');
        if (shift.end_time) throw new Error('Shift already closed');

        const endTime = new Date().toISOString();

        runInsert(`
            UPDATE shifts 
            SET end_time = ?, closing_cash = ?, notes = COALESCE(notes, '') || ?
            WHERE id = ?
        `, [endTime, closingCash, notes ? `\nClosing Note: ${notes}` : '', shiftId]);

        return { ...shift, end_time: endTime, closing_cash: closingCash };
    }

    getCurrentShift(employeeId) {
        return getOne(`
            SELECT * FROM shifts 
            WHERE employee_id = ? AND end_time IS NULL
        `, [employeeId]);
    }

    getShiftById(shiftId) {
        return getOne('SELECT * FROM shifts WHERE id = ?', [shiftId]);
    }

    getShiftStats(shiftId) {
        const shift = this.getShiftById(shiftId);
        if (!shift) throw new Error('Shift not found');

        // Calculate sales totals during this shift
        // We use the shift start time and either the shift end time or current time
        const endTime = shift.end_time || new Date().toISOString();

        const salesStats = getOne(`
            SELECT 
                COUNT(*) as total_transactions,
                COALESCE(SUM(total), 0) as total_sales,
                COALESCE(SUM(tax_amount), 0) as total_tax,
                COALESCE(SUM(discount_amount), 0) as total_discount
            FROM sales 
            WHERE employee_id = ? AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
        `, [shift.employee_id, shift.start_time, endTime]);

        console.log('DEBUG: Shift Stats Query Range:', {
            emp: shift.employee_id,
            start: shift.start_time,
            end: endTime
        }, 'Result:', salesStats);

        // Debug: Get ALL payments for this timeframe and employee
        try {
            const debugPayments = runQuery(`
                SELECT p.method, p.amount, s.created_at, p.id 
                FROM payments p
                JOIN sales s ON p.sale_id = s.id
                WHERE s.employee_id = ? AND datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)
            `, [shift.employee_id, shift.start_time, endTime]);
            console.log('DEBUG: All Payments in range:', JSON.stringify(debugPayments));
        } catch(e) { console.log('DEBUG: Error querying payments', e); }

        // Calculate cash specifically (if you want to reconcile cash drawer)
        const cashSales = getOne(`
            SELECT COALESCE(SUM(amount), 0) as total_cash
            FROM payments p
            JOIN sales s ON p.sale_id = s.id
            WHERE s.employee_id = ? AND datetime(s.created_at) BETWEEN datetime(?) AND datetime(?) AND LOWER(p.method) = 'cash'
        `, [shift.employee_id, shift.start_time, endTime]);

        const refunds = getOne(`
             SELECT COALESCE(SUM(total_refund), 0) as total_refunds
             FROM returns
             WHERE employee_id = ? AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
        `, [shift.employee_id, shift.start_time, endTime]);
        
        // Calculate other payment method totals
        const cardSales = getOne(`
            SELECT COALESCE(SUM(amount), 0) as total_card
            FROM payments p
            JOIN sales s ON p.sale_id = s.id
            WHERE s.employee_id = ? AND datetime(s.created_at) BETWEEN datetime(?) AND datetime(?) AND LOWER(p.method) = 'card'
        `, [shift.employee_id, shift.start_time, endTime]);

        const creditSales = getOne(`
            SELECT COALESCE(SUM(amount), 0) as total_credit
            FROM payments p
            JOIN sales s ON p.sale_id = s.id
            WHERE s.employee_id = ? AND datetime(s.created_at) BETWEEN datetime(?) AND datetime(?) AND LOWER(p.method) = 'credit'
        `, [shift.employee_id, shift.start_time, endTime]);

        const transferSales = getOne(`
            SELECT COALESCE(SUM(amount), 0) as total_transfer
            FROM payments p
            JOIN sales s ON p.sale_id = s.id
            WHERE s.employee_id = ? AND datetime(s.created_at) BETWEEN datetime(?) AND datetime(?) AND LOWER(p.method) = 'transfer'
        `, [shift.employee_id, shift.start_time, endTime]);

        const giftCardSales = getOne(`
            SELECT COALESCE(SUM(amount), 0) as total_gift_card
            FROM payments p
            JOIN sales s ON p.sale_id = s.id
            WHERE s.employee_id = ? AND datetime(s.created_at) BETWEEN datetime(?) AND datetime(?) AND LOWER(p.method) = 'gift_card'
        `, [shift.employee_id, shift.start_time, endTime]);

        // Calculate expected cash in drawer
        const openingCash = shift.opening_cash || 0;
        const totalCashSales = cashSales.total_cash || 0;
        const totalCardSales = cardSales.total_card || 0;
        const totalCreditSales = creditSales.total_credit || 0;
        const totalGiftCardSales = giftCardSales.total_gift_card || 0;
        // Assuming refunds are given in cash for this simple calculation, likely need to filter by return payment method if that exists
        const totalRefunds = refunds.total_refunds || 0; 

        // TODO: Refine refund logic if refunds can be to card/store credit
        
        const expectedCash = openingCash + totalCashSales; // - totalRefunds; (Verify refund logic later)

        return {
            ...salesStats,
            total_cash_sales: totalCashSales,
            total_card_sales: totalCardSales,
            total_transfer_sales: transferSales.total_transfer || 0,
            total_credit_sales: totalCreditSales,
            total_gift_card_sales: totalGiftCardSales,
            total_refunds: totalRefunds,
            opening_cash: openingCash,
            expected_cash: expectedCash,
            start_time: shift.start_time,
            end_time: shift.end_time
        };
    }
    // ... previous methods

    getShiftHistory(startDate, endDate) {
        // Adjust dates to cover full days if needed
        const shifts = runQuery(`
            SELECT 
                s.*,
                e.name as employee_name
            FROM shifts s
            JOIN employees e ON s.employee_id = e.id
            WHERE s.start_time BETWEEN ? AND ?
            ORDER BY s.start_time DESC
        `, [startDate, endDate]);

        // Augment with calculated stats
        return shifts.map(shift => {
            try {
                // Reuse existing logic, but be efficient. 
                // Getting full stats for a list might be heavy if not optimized
                // For a report list, we might just want stored values + simple sales sum
                // But since closing_cash is stored, we mainly need sales total.
                
                // Let's reuse getShiftStats but be mindful it runs multiple queries per row.
                // For a monthly report (30 rows), it's acceptable for electron/sqlite.
                const stats = this.getShiftStats(shift.id);
                return {
                    ...shift,
                    stats
                };
            } catch (e) {
                console.error(`Error calculating stats for shift ${shift.id}`, e);
                return shift;
            }
        });
    }
}

module.exports = ShiftService;
