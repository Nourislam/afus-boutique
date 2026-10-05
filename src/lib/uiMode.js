// Simple mode shows only the everyday screens of a clothing shop; full mode
// shows every module. Saved for the whole shop in the settings table
// (key ui_mode). A new shop starts in simple mode (set by the setup wizard);
// a shop set up before this option existed keeps the full menu.
export const UI_MODES = ['simple', 'full'];

/** Menu entries kept in simple mode (Settings stays reachable in both). */
export const SIMPLE_PATHS = ['/pos', '/products', '/inventory', '/labels', '/credit-sales', '/reports'];

export function resolveUiMode(saved) {
    return UI_MODES.includes(saved) ? saved : 'full';
}

/** Save the mode for the shop and apply it at once. */
export async function saveUiMode(mode) {
    const value = resolveUiMode(mode);
    await window.electronAPI.settings.set({ key: 'ui_mode', value });
    const { useSettingsStore } = await import('../stores/settingsStore');
    await useSettingsStore.getState().loadSettings();
    return value;
}
