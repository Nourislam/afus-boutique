import { create } from 'zustand';

/**
 * A manager's PIN asked in the middle of an action (discount above the
 * cashier's limit, return, exchange). ask() opens the dialog and resolves
 * with { employeeId, pin }, or null when cancelled.
 */
export const useApprovalStore = create((set, get) => ({
    request: null, // { message, resolve }
    ask: (message) => new Promise((resolve) => {
        get().request?.resolve(null);
        set({ request: { message, resolve } });
    }),
    finish: (value) => {
        const { request } = get();
        set({ request: null });
        request?.resolve(value);
    },
}));
