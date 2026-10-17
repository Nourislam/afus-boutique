import { create } from 'zustand';

// The demo shop is offered for 3 months from the install date; the main
// process decides (and refuses it after). Here: what the
// screens show. Until the answer arrives nothing is shown.
export const useTrialStore = create((set) => ({
    loaded: false,
    demo: { available: false, daysLeft: 0 },

    load: async () => {
        try {
            const status = await window.electronAPI.trial.status();
            set({ loaded: true, demo: status.demo });
        } catch {
            set({ loaded: true });
        }
    },
}));
