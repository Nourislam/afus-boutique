/**
 * Lightweight translation system (no external dependency).
 *
 * Messages live in src/i18n/messages/*.js as { key: [english, french, arabic] }
 * so every key always exists in the three languages.
 *
 * - t(key, params)   translate with {placeholder} interpolation
 * - useT()           React hook, re-renders when the language changes
 * - setLanguage()    switches language, direction (rtl for Arabic) and persists it
 */
import { create } from 'zustand';
import { useCallback } from 'react';
import { MESSAGES } from './messages';

export const LANGUAGES = [
    { value: 'ar', label: 'العربية', dir: 'rtl', locale: 'ar-DZ-u-nu-latn' },
    { value: 'fr', label: 'Français', dir: 'ltr', locale: 'fr-DZ' },
    { value: 'en', label: 'English', dir: 'ltr', locale: 'en-GB' },
];

const INDEX = { en: 0, fr: 1, ar: 2 };
export const DEFAULT_LANGUAGE = 'ar';
const STORAGE_KEY = 'ui_language';

export function normalizeLanguage(lang) {
    return INDEX[lang] !== undefined ? lang : DEFAULT_LANGUAGE;
}

function readCachedLanguage() {
    try {
        return normalizeLanguage(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        return DEFAULT_LANGUAGE;
    }
}

export function languageInfo(lang) {
    return LANGUAGES.find(l => l.value === lang) || LANGUAGES[0];
}

/** Apply language and text direction to the whole document. */
export function applyDocumentLanguage(lang) {
    if (typeof document === 'undefined') return;
    const info = languageInfo(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = info.dir;
    document.documentElement.classList.toggle('lang-ar', lang === 'ar');
}

export const useLanguageStore = create((set) => ({
    lang: typeof window !== 'undefined' ? readCachedLanguage() : DEFAULT_LANGUAGE,
    setLang: (lang) => {
        const value = normalizeLanguage(lang);
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable */ }
        applyDocumentLanguage(value);
        set({ lang: value });
    },
}));

export function translate(lang, key, params) {
    const entry = MESSAGES[key];
    let text;
    if (!entry) {
        text = key;
    } else {
        text = entry[INDEX[normalizeLanguage(lang)]] || entry[0] || key;
    }
    if (params) {
        text = text.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined && params[name] !== null ? String(params[name]) : m));
    }
    return text;
}

/** Translate with the current language (for code outside React components). */
export function t(key, params) {
    return translate(useLanguageStore.getState().lang, key, params);
}

export function currentLanguage() {
    return useLanguageStore.getState().lang;
}

/** React hook: const { t, lang, dir } = useT(); */
export function useT() {
    const lang = useLanguageStore(state => state.lang);
    const tr = useCallback((key, params) => translate(lang, key, params), [lang]);
    return { t: tr, lang, dir: languageInfo(lang).dir, locale: languageInfo(lang).locale };
}

/**
 * Switch language for the whole application and persist it in the local
 * database (store_config.defaultLanguage) so it survives restarts.
 */
export async function setLanguage(lang, { persist = true } = {}) {
    const value = normalizeLanguage(lang);
    // Persist first, so a settings reload during the switch cannot revert it
    if (persist && typeof window !== 'undefined' && window.electronAPI?.settings) {
        const current = (await window.electronAPI.settings.get('store_config')) || {};
        await window.electronAPI.settings.set({ key: 'store_config', value: { ...current, defaultLanguage: value } });
        const { useSettingsStore } = await import('../stores/settingsStore');
        useSettingsStore.setState(state => ({ settings: { ...state.settings, defaultLanguage: value } }));
    }
    useLanguageStore.getState().setLang(value);
    return value;
}

// Apply the cached language immediately so the first paint has the right direction
if (typeof document !== 'undefined') applyDocumentLanguage(useLanguageStore.getState().lang);
