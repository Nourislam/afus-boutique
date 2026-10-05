/**
 * Light / dark theme. The choice ('dark' | 'light' | 'system') is a per-computer
 * preference kept in localStorage; 'system' follows macOS / Windows.
 * The theme is a class on <html> (theme-light) read by index.css.
 */
const STORAGE_KEY = 'ui_theme';
export const THEMES = ['dark', 'light', 'system'];

const listeners = new Set();
let media = null;

export function getThemePreference() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return THEMES.includes(saved) ? saved : 'dark';
    } catch {
        return 'dark';
    }
}

function systemPrefersLight() {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
}

/** The theme actually shown: 'dark' or 'light'. */
export function resolveTheme(preference = getThemePreference()) {
    if (preference === 'system') return systemPrefersLight() ? 'light' : 'dark';
    return preference === 'light' ? 'light' : 'dark';
}

function apply(preference) {
    const theme = resolveTheme(preference);
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    document.documentElement.dataset.theme = theme;
    // Native parts of the window (Windows title bar buttons, background while loading)
    window.electronAPI?.app?.setTheme?.(theme, preference)?.catch?.(() => { });
    listeners.forEach(fn => fn(theme, preference));
    return theme;
}

export function setThemePreference(preference) {
    const value = THEMES.includes(preference) ? preference : 'dark';
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* still applied for this session */ }
    return apply(value);
}

/** Call once at start-up, before the first render, to avoid a flash. */
export function initTheme() {
    apply(getThemePreference());
    media = window.matchMedia?.('(prefers-color-scheme: light)');
    media?.addEventListener?.('change', () => {
        if (getThemePreference() === 'system') apply('system');
    });
}

export function onThemeChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
