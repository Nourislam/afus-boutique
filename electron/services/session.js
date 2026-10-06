/**
 * Who is logged in, kept by the main process. Set only by a right PIN
 * (db:employees:verifyPin), cleared at logout. The checks that protect money
 * (discounts, returns, exchanges, cash expenses) read it here, so they cannot
 * be bypassed by calling the database directly from the window.
 */
let current = null;

const ROLE_RANK = { cashier: 1, manager: 2, admin: 3 };

function setEmployee(employee) {
    current = employee ? { id: employee.id, name: employee.name, role: String(employee.role || '').toLowerCase() } : null;
    return current;
}

const getEmployee = () => current;
const clear = () => { current = null; };
const isManager = (employee = current) => !!employee && (ROLE_RANK[employee.role] || 0) >= ROLE_RANK.manager;

module.exports = { setEmployee, getEmployee, clear, isManager };
