import { create } from 'zustand';

// Training (7 days) and the demo shop (3 months) are offered from the install
// date; the main process decides (and refuses them after). Here: what the
// screens show. Until the answer arrives nothing is shown.
export const useTrialStore = create((set) => ({
    loaded: false,
    training: { available: false, daysLeft: 0 },
    demo: { available: false, daysLeft: 0 },

    load: async () => {
        try {
            const status = await window.electronAPI.trial.status();
            set({ loaded: true, training: status.training, demo: status.demo });
        } catch {
            set({ loaded: true });
        }
    },
}));
