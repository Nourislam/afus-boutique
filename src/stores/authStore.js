import { t } from '../i18n';
import { create } from 'zustand';
import { hasPermission as checkPermission, PERMISSIONS } from '../lib/permissions';

// Each new session starts on the user's home screen, not on the page the
// previous user left open (which they may not be allowed to see).
function openHomeScreen(role) {
    if (typeof window === 'undefined') return;
    window.location.hash = role === 'cashier' ? '#/pos' : '#/';
}

export const useAuthStore = create((set, get) => ({
    currentEmployee: null,
    isAuthenticated: false,

    checkAuth: async () => {
        // Check for stored auth in sessionStorage
        const stored = sessionStorage.getItem('pos_auth');
        if (stored) {
            const employee = JSON.parse(stored);
            set({ currentEmployee: employee, isAuthenticated: true });
            return true;
        }
        return false;
    },

    login: async (employeeId, pin) => {
        try {
            const employee = await window.electronAPI.employees.verifyPin({ id: employeeId, pin });
            if (employee) {
                // Store ONLY non-sensitive identifiers in sessionStorage
                // This prevents CodeQL "clear text storage of sensitive information" alerts
                const sessionData = {
                    id: employee.id,
                    name: employee.name,
                    role: employee.role
                };
                sessionStorage.setItem('pos_auth', JSON.stringify(sessionData));
                openHomeScreen(employee.role);
                set({ currentEmployee: employee, isAuthenticated: true });
                return { success: true };
            }
            return { success: false, error: t('login.invalidPin') };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Open a session for an employee that was just created and verified locally
    // (used right after the first-launch shop setup).
    startSession: (employee) => {
        const sessionData = { id: employee.id, name: employee.name, role: employee.role };
        sessionStorage.setItem('pos_auth', JSON.stringify(sessionData));
        openHomeScreen(employee.role);
        set({ currentEmployee: sessionData, isAuthenticated: true });
    },

    logout: () => {
        // The main process forgets who was logged in (protected actions need a new PIN)
        try { window.electronAPI?.auth?.logout?.(); } catch { /* not in the desktop app */ }
        sessionStorage.removeItem('pos_auth');
        set({ currentEmployee: null, isAuthenticated: false });
    },

    isAdmin: () => {
        const { currentEmployee } = get();
        return currentEmployee?.role === 'admin';
    },

    isManager: () => {
        const { currentEmployee } = get();
        return currentEmployee?.role === 'admin' || currentEmployee?.role === 'manager';
    },

    // Check if current user has a specific permission
    hasPermission: (permission) => {
        const { currentEmployee } = get();
        if (!currentEmployee) return false;
        return checkPermission(currentEmployee.role, permission);
    },

    // Helper to check multiple permissions (any)
    hasAnyPermission: (permissions) => {
        const { hasPermission } = get();
        return permissions.some(p => hasPermission(p));
    },

    // Helper to check multiple permissions (all)
    hasAllPermissions: (permissions) => {
        const { hasPermission } = get();
        return permissions.every(p => hasPermission(p));
    },

    // Get current user's role
    getRole: () => {
        const { currentEmployee } = get();
        return currentEmployee?.role || null;
    },
}));

// Export PERMISSIONS for easy access
export { PERMISSIONS };
