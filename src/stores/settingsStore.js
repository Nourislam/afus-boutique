import { create } from 'zustand';
import { resolveFeatures, effectiveFeatures } from '../lib/features';
import { resolveUiMode } from '../lib/uiMode';
import { useLanguageStore, normalizeLanguage } from '../i18n';
import { formatMoney } from '../i18n/format';

export const useSettingsStore = create((set, get) => ({
    settings: {
        currency: 'DZD',
        currencySymbol: 'DA',
        taxRate: 10,
        taxType: 'exclusive',
        taxName: 'Tax',
        businessName: '',
        businessAddress: '',
        businessPhone: '',
        businessEmail: '',
        poSignatureName: '',
        poSignatureTitle: '',
        receiptHeader: '',
        receiptFooter: '',
        features: resolveFeatures(),
        uiMode: 'full',
    },
    loading: false,
    error: null,

    loadSettings: async () => {
        set({ loading: true });
        try {
            const data = await window.electronAPI.settings.getAll();
            let parsedSettings = { ...data };

            // Parse store_config if present
            if (data.store_config) {
                try {
                    // store_config may already be an object (from getAll) or a string (legacy)
                    let storeConfig = data.store_config;
                    if (typeof storeConfig === 'string') {
                        storeConfig = JSON.parse(storeConfig);
                    }
                    parsedSettings = { ...parsedSettings, ...storeConfig };
                } catch (e) {
                    console.error('Failed to parse store_config', e);
                }
            }

            // What the menus and screens show (a module needing a hidden one is hidden)
            parsedSettings.features = effectiveFeatures(data.features);
            parsedSettings.uiMode = resolveUiMode(data.ui_mode);

            // The language saved with the shop settings wins over the local cache
            if (parsedSettings.defaultLanguage) {
                const lang = normalizeLanguage(parsedSettings.defaultLanguage);
                if (lang !== useLanguageStore.getState().lang) useLanguageStore.getState().setLang(lang);
            }

            // Normalize taxRate to float
            if (parsedSettings.taxRate) {
                parsedSettings.taxRate = parseFloat(parsedSettings.taxRate) || 0;
            }

            set({ settings: { ...get().settings, ...parsedSettings }, loading: false });
        } catch (error) {
            console.error('Failed to load settings:', error);
            set({ error: error.message, loading: false });
        }
    },

    // Helper to format currency (dinars by default: "2 500 DA" / "2 500 د.ج")
    formatCurrency: (amount) => formatMoney(amount, { currency: get().settings.currency || 'DZD' }),
}));
