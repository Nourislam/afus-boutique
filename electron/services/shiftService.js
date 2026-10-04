const { v4: uuid } = require('uuid');
const { runInsert, getOne, runQuery } = require('../database/init');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

        // Refunds handed back in cash (a return on a kridi sale lowers the debt instead)
        const cashRefunds = getOne(`
            SELECT COALESCE(SUM(r.total_refund), 0) AS total
            FROM returns r
            WHERE r.employee_id = ? AND datetime(r.created_at) BETWEEN datetime(?) AND datetime(?)
              AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = r.sale_id AND LOWER(p.method) = 'credit')
        `, [shift.employee_id, shift.start_time, endTime]);

        // Kridi repaid in cash to this employee goes into the same drawer
        const creditCollected = getOne(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM credit_payments
            WHERE received_by = ? AND LOWER(payment_method) = 'cash'
              AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
        `, [shift.employee_id, shift.start_time, endTime]);

        const items = getOne(`
            SELECT COALESCE(SUM(si.quantity), 0) AS total
            FROM sale_items si JOIN sales s ON s.id = si.sale_id
            WHERE s.employee_id = ? AND datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)
        `, [shift.employee_id, shift.start_time, endTime]);

        const openingCash = Number(shift.opening_cash) || 0;
        const totalCashSales = cashSales.total_cash || 0;
        const totalRefunds = refunds.total_refunds || 0;
        const totalCashRefunds = cashRefunds.total || 0;
        const totalCreditCollected = creditCollected.total || 0;
        const expectedCash = round2(openingCash + totalCashSales + totalCreditCollected - totalCashRefunds);
        const durationMinutes = Math.max(0, Math.round((new Date(endTime) - new Date(shift.start_time)) / 60000));

        return {
            ...salesStats,
            employee_id: shift.employee_id,
            items_sold: items.total || 0,
            total_cash_sales: totalCashSales,
            total_card_sales: cardSales.total_card || 0,
            total_transfer_sales: transferSales.total_transfer || 0,
            total_credit_sales: creditSales.total_credit || 0,
            total_gift_card_sales: giftCardSales.total_gift_card || 0,
            total_refunds: totalRefunds,
            total_cash_refunds: totalCashRefunds,
            credit_collected_cash: totalCreditCollected,
            opening_cash: openingCash,
            expected_cash: expectedCash,
            closing_cash: shift.closing_cash,
            cash_difference: shift.closing_cash === null || shift.closing_cash === undefined ? null : round2(Number(shift.closing_cash) - expectedCash),
            duration_minutes: durationMinutes,
            start_time: shift.start_time,
            end_time: shift.end_time
        };
    }

    /** Drawers still open, with who opened them. */
    getOpenShifts() {
        return runQuery(`
            SELECT s.*, e.name AS employee_name
            FROM shifts s LEFT JOIN employees e ON e.id = s.employee_id
            WHERE s.end_time IS NULL
            ORDER BY s.start_time
        `);
    }

    /** Last closed drawer: its counted cash is the next opening amount. */
    getLastClosedShift() {
        return getOne(`
            SELECT s.*, e.name AS employee_name
            FROM shifts s LEFT JOIN employees e ON e.id = s.employee_id
            WHERE s.end_time IS NOT NULL
            ORDER BY datetime(s.end_time) DESC
            LIMIT 1
        `);
    }

    /**
     * What each employee did in a period: time worked (drawer open time),
     * sales, pieces sold, refunds and cash differences at closing.
     */
    getEmployeeActivity(startDate, endDate) {
        const employees = runQuery('SELECT id, name, role, is_active FROM employees ORDER BY name');
        const shifts = runQuery(`
            SELECT * FROM shifts
            WHERE datetime(start_time) <= datetime(?) AND (end_time IS NULL OR datetime(end_time) >= datetime(?))
        `, [endDate, startDate]);
        const sales = runQuery(`
            SELECT employee_id, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
            FROM sales
            WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)
            GROUP BY employee_id
        `, [startDate, endDate]);
        const items = runQuery(`
            SELECT s.employee_id, COALESCE(SUM(si.quantity), 0) AS qty
            FROM sale_items si JOIN sales s ON s.id = si.sale_id
            WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)
            GROUP BY s.employee_id
        `, [startDate, endDate]);
        const refunds = runQuery(`
            SELECT employee_id, COUNT(*) AS count, COALESCE(SUM(total_refund), 0) AS total
            FROM returns
            WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)
            GROUP BY employee_id
        `, [startDate, endDate]);

        const from = new Date(startDate).getTime();
        const to = Math.min(new Date(endDate).getTime(), Date.now());
        return employees.map(emp => {
            const own = shifts.filter(s => s.employee_id === emp.id);
            let minutes = 0;
            let difference = 0;
            let closed = 0;
            for (const shift of own) {
                const start = Math.max(new Date(shift.start_time).getTime(), from);
                const end = Math.min(shift.end_time ? new Date(shift.end_time).getTime() : Date.now(), to);
                if (end > start) minutes += (end - start) / 60000;
                if (shift.end_time && shift.closing_cash !== null && shift.closing_cash !== undefined) {
                    try {
                        const stats = this.getShiftStats(shift.id);
                        difference += stats.cash_difference || 0;
                        closed += 1;
                    } catch { /* skip a broken shift */ }
                }
            }
            const sale = sales.find(r => r.employee_id === emp.id) || {};
            const item = items.find(r => r.employee_id === emp.id) || {};
            const refund = refunds.find(r => r.employee_id === emp.id) || {};
            const openShift = own.find(s => !s.end_time) || null;
            return {
                ...emp,
                shifts: own.length,
                closed_shifts: closed,
                minutes_worked: Math.round(minutes),
                sales_count: sale.count || 0,
                sales_total: round2(sale.total || 0),
                items_sold: item.qty || 0,
                refunds_count: refund.count || 0,
                refunds_total: round2(refund.total || 0),
                cash_difference: round2(difference),
                open_shift_start: openShift ? openShift.start_time : null,
                last_activity: own.reduce((last, s) => {
                    const time = s.end_time || s.start_time;
                    return !last || new Date(time) > new Date(last) ? time : last;
                }, null),
            };
        });
    }


    getShiftHistory(startDate, endDate) {
        // Adjust dates to cover full days if needed
        const shifts = runQuery(`
            SELECT 
                s.*,
                e.name as employee_name
            FROM shifts s
            JOIN employees e ON s.employee_id = e.id
            WHERE datetime(s.start_time) BETWEEN datetime(?) AND datetime(?)
               OR (s.end_time IS NULL AND datetime(s.start_time) <= datetime(?))
            ORDER BY s.start_time DESC
        `, [startDate, endDate, endDate]);

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
