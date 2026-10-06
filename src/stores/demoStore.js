import { create } from 'zustand';

// The demo shop lives in the main process (its own database file). Here: is
// it open, and the sample accounts shown on the login screen. Entering,
// starting again and leaving reload the screens on the other shop, logged out.
function afterSwitch(notice) {
    try {
        sessionStorage.removeItem('pos_auth');
        sessionStorage.removeItem('training_exercise');
        sessionStorage.setItem('demo_notice', notice);
    } catch { /* storage unavailable */ }
    window.location.hash = '#/';
    window.location.reload();
}

export const useDemoStore = create((set) => ({
    active: false,
    staff: [],

    load: async () => {
        try {
            const status = await window.electronAPI.demo.status();
            set({ active: !!status?.active, staff: status?.staff || [] });
        } catch { /* not in the desktop app */ }
    },

    /** Open the demo shop (created the first time, in the current language). */
    enter: async (lang) => {
        await window.electronAPI.demo.enter({ lang });
        afterSwitch('entered');
    },

    reset: async (lang) => {
        await window.electronAPI.demo.reset({ lang });
        afterSwitch('reset');
    },

    /** Back to the shop's own data; nothing is copied. */
    exit: async () => {
        await window.electronAPI.demo.exit();
        afterSwitch('left');
    },
}));
