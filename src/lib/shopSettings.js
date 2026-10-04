// Defaults for the locally stored shop configuration (settings table).
// store_config holds the shop identity and money settings; the other keys
// hold one JSON object each.

export const DEFAULT_SHOP = {
    businessName: '',
    shopLogo: '',
    ownerName: '',
    businessPhone: '',
    businessEmail: '',
    businessAddress: '',
    businessWilaya: '',
    businessCity: '',
    // Algerian registration numbers printed on receipts (all optional)
    businessRc: '',
    businessTaxId: '', // NIF
    businessNis: '',
    businessAi: '',
    shopDescription: '',
    defaultLanguage: 'ar',
    currency: 'DZD',
    currencySymbol: 'DA',
    taxRate: 0,
    taxName: 'TVA',
    taxType: 'inclusive',
    receiptHeader: '',
    // Empty = translated default thank-you line
    receiptFooter: '',
};

export const DEFAULT_PRINTER_SETTINGS = {
    receipt: { printerName: '', paperWidthMm: 80, copies: 1, autoPrint: false, silent: false },
    label: { printerName: '', copies: 1, silent: false, dpi: 0 },
};

export const DEFAULT_SCANNER_SETTINGS = {
    enabled: true,
    // Key the scanner sends after each code: 'enter', 'tab' or 'none' (end detected by a pause)
    suffix: 'enter',
    // Max milliseconds between two characters sent by the scanner
    maxKeyIntervalMs: 50,
    minLength: 3,
    // 'us': read the physical keys as a US keyboard (correct for scanners in their
    // default US mode while Windows uses Arabic/French/... layouts).
    // 'os': use the characters produced by the active Windows layout.
    layoutMode: 'us',
};

export const DEFAULT_SKU_SETTINGS = {
    prefix: '',
    separator: '-',
    digits: 3,
};

function asObject(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try { return JSON.parse(value) || {}; } catch { return {}; }
    }
    return value;
}

/** Read all shop-related settings, merged with defaults. */
export async function loadShopConfiguration() {
    const all = await window.electronAPI.settings.getAll();
    const saved = asObject(all.store_config);
    const printers = asObject(all.printer_settings);
    return {
        shop: { ...DEFAULT_SHOP, ...saved },
        printers: {
            receipt: { ...DEFAULT_PRINTER_SETTINGS.receipt, ...(printers.receipt || {}) },
            label: { ...DEFAULT_PRINTER_SETTINGS.label, ...(printers.label || {}) },
        },
        scanner: { ...DEFAULT_SCANNER_SETTINGS, ...asObject(all.scanner_settings) },
        sku: { ...DEFAULT_SKU_SETTINGS, ...asObject(all.sku_settings) },
        labels: asObject(all.label_settings),
    };
}

/**
 * Save shop configuration. store_config is merged with what is already saved
 * so fields edited elsewhere in Settings are not lost.
 */
export async function saveShopConfiguration({ shop, printers, scanner, sku, labels }) {
    const api = window.electronAPI.settings;
    if (shop) {
        const current = asObject(await api.get('store_config'));
        await api.set({ key: 'store_config', value: { ...current, ...shop } });
    }
    if (printers) await api.set({ key: 'printer_settings', value: printers });
    if (scanner) await api.set({ key: 'scanner_settings', value: scanner });
    if (sku) await api.set({ key: 'sku_settings', value: sku });
    if (labels) await api.set({ key: 'label_settings', value: labels });
    window.dispatchEvent(new Event('pos:settings-changed'));
}
