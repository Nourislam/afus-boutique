import { create } from 'zustand';
import { withManagerApproval } from '../lib/approval';

// Training mode lives in the main process (a copy of the shop's data in
// memory). Here: is it on, which guided exercise is running, which are passed.
// The exercise is kept for the session, so it continues after a log in.
const KEY = 'training_exercise';

function readSaved() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') || { current: null, base: null, done: [] }; } catch { return { current: null, base: null, done: [] }; }
}
function save(state) {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export const useTrainingStore = create((set, get) => ({
    active: false,
    pickerOpen: false,
    ...readSaved(),

    load: async () => {
        try {
            const status = await window.electronAPI.training.status();
            set({ active: !!status?.active });
            // Training ended (program restarted): no exercise left half way
            if (!status?.active && get().current) get().reset();
            let autostart = null;
            try { autostart = sessionStorage.getItem('training_autostart'); sessionStorage.removeItem('training_autostart'); } catch { /* ignore */ }
            if (status?.active && autostart) await get().startExercise(autostart);
        } catch { /* not in the desktop app */ }
    },

    /**
     * Start training (a cashier needs a manager's PIN); the screens reload on the copy.
     * exercise: a guided exercise to open straight away (e.g. 'sale').
     */
    start: async (exercise = null) => {
        await withManagerApproval((approval) => window.electronAPI.training.start({ approval }));
        try {
            sessionStorage.setItem('training_notice', 'started');
            if (exercise) sessionStorage.setItem('training_autostart', exercise);
        } catch { /* ignore */ }
        window.location.reload();
    },

    /** Leave training: the copy is thrown away, the screens reload on the shop's data. */
    stop: async () => {
        await window.electronAPI.training.stop();
        get().reset();
        try { sessionStorage.setItem('training_notice', 'stopped'); } catch { /* ignore */ }
        window.location.reload();
    },

    openPicker: (open = true) => set({ pickerOpen: open }),

    startExercise: async (id) => {
        const base = await window.electronAPI.training.progress();
        const next = { current: id, base, done: get().done };
        save(next);
        set({ ...next, pickerOpen: false });
    },

    finishExercise: (id) => {
        const next = { current: get().current, base: get().base, done: [...new Set([...get().done, id])] };
        save(next);
        set(next);
    },

    closeExercise: () => {
        const next = { current: null, base: null, done: get().done };
        save(next);
        set(next);
    },

    reset: () => {
        const next = { current: null, base: null, done: [] };
        save(next);
        set(next);
    },
}));
