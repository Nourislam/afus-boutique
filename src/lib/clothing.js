// Clothing reference data shared with the main process (electron/shared/clothing.json):
// colours with stable codes, size sets, genders, Algerian seasons, suggested
// categories and default brands. Names are shown in the interface language.
import CLOTHING from '../../electron/shared/clothing.json';
import { currentLanguage } from '../i18n';

// Built-in palette and size sets (the shop can hide some and add its own,
// see setCatalogCustomization; screens use getColors() / getSizeSets())
export const COLORS = CLOTHING.colors;
export const SIZE_SETS = CLOTHING.sizeSets;
export const GENDERS = CLOTHING.genders;
export const SEASONS = CLOTHING.seasons;
export const CATEGORY_SUGGESTIONS = CLOTHING.categories;
export const DEFAULT_CATEGORY_CODES = CLOTHING.defaultCategories;

const name = (entry, lang) => (entry ? entry[lang] || entry.en : '');

const COLOR_BY_KEY = new Map();
const indexColor = (c) => {
    for (const key of [c.code, c.en, c.fr, c.ar]) if (key) COLOR_BY_KEY.set(String(key).trim().toLowerCase(), c);
};
COLORS.forEach(indexColor);

// The shop's own choices, saved in settings (catalog_custom)
export const EMPTY_CUSTOMIZATION = { hiddenColors: [], customColors: [], hiddenSizeSets: [], customSizeSets: [] };
let customization = { ...EMPTY_CUSTOMIZATION };
const listeners = new Set();

/** Apply the shop's colours and sizes (hidden built-ins, added ones). */
export function setCatalogCustomization(value) {
    customization = { ...EMPTY_CUSTOMIZATION, ...(value || {}) };
    customization.customColors.forEach(indexColor);
    customization.customSizeSets.forEach(indexSizeSet);
    listeners.forEach(fn => fn(customization));
}

export const getCatalogCustomization = () => customization;
export function onCatalogCustomization(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Load the saved colours and sizes (at start-up and after Settings are saved). */
export async function loadCatalogCustomization() {
    try {
        const saved = await window.electronAPI?.settings?.get('catalog_custom');
        setCatalogCustomization(saved);
    } catch { /* built-in palette only */ }
}

/** Colours offered when entering articles. */
export function getColors({ includeHidden = false } = {}) {
    const hidden = new Set(customization.hiddenColors);
    return [...COLORS.filter(c => includeHidden || !hidden.has(c.code)), ...customization.customColors];
}

/** Size sets offered when entering articles. */
export function getSizeSets({ includeHidden = false } = {}) {
    const hidden = new Set(customization.hiddenSizeSets);
    return [...SIZE_SETS.filter(s => includeHidden || !hidden.has(s.code)), ...customization.customSizeSets];
}

/** Palette entry for a colour code or a colour name in any language. */
export function findColor(codeOrName) {
    if (!codeOrName) return null;
    return COLOR_BY_KEY.get(String(codeOrName).trim().toLowerCase()) || null;
}

/** Colour name in the current language (custom colours are shown as typed). */
export function colorName(variantOrColor, lang = currentLanguage()) {
    if (!variantOrColor) return '';
    if (typeof variantOrColor === 'string') return name(findColor(variantOrColor), lang) || variantOrColor;
    const entry = findColor(variantOrColor.color_code) || findColor(variantOrColor.color);
    return entry ? name(entry, lang) : (variantOrColor.color || '');
}

export function colorHex(variantOrColor) {
    const entry = typeof variantOrColor === 'string'
        ? findColor(variantOrColor)
        : (findColor(variantOrColor?.color_code) || findColor(variantOrColor?.color));
    return entry ? entry.hex : null;
}

const SIZE_UNITS = {
    Y: { en: 'yrs', fr: 'ans', ar: 'سنوات' },
    M: { en: 'mo', fr: 'mois', ar: 'أشهر' },
};

/** "2Y" -> "2 ans", "TU" -> "Taille unique"; other sizes are shown as stored. */
export function sizeLabel(size, lang = currentLanguage()) {
    if (!size) return '';
    const special = CLOTHING.sizeLabels[size];
    if (special) return name(special, lang);
    const m = /^(\d+)([YM])$/.exec(size);
    if (m) return `${m[1]} ${SIZE_UNITS[m[2]][lang] || SIZE_UNITS[m[2]].en}`;
    return size;
}

export function variantLabel(variant, lang = currentLanguage()) {
    if (!variant) return '';
    return [colorName(variant, lang), sizeLabel(variant.size, lang)].filter(Boolean).join(' / ');
}

export const genderLabel = (code, lang = currentLanguage()) => name(GENDERS.find(g => g.code === code), lang) || code || '';
export const seasonLabel = (code, lang = currentLanguage()) => name(SEASONS.find(s => s.code === code), lang) || code || '';
export const sizeSetLabel = (set, lang = currentLanguage()) => name(set, lang);
export const categoryName = (entry, lang = currentLanguage()) => name(entry, lang);

/** Size set suggested for a category name (matches the suggestion list in any language). */
export function sizeSetForCategory(categoryNameText) {
    if (!categoryNameText) return null;
    const key = categoryNameText.trim().toLowerCase();
    const cat = CATEGORY_SUGGESTIONS.find(c => [c.en, c.fr, c.ar].some(n => n.toLowerCase() === key));
    return cat ? SIZE_SETS.find(s => s.code === cat.sizeSet) || null : null;
}

// Order of sizes as they are hung in the shop (XS, S, M… then 36, 38…)
const SIZE_ORDER = new Map();
let sizeSetCount = 0;
function indexSizeSet(set) {
    const si = sizeSetCount++;
    (set.sizes || []).forEach((size, i) => {
        if (!SIZE_ORDER.has(size)) SIZE_ORDER.set(size, si * 1000 + i);
    });
}
SIZE_SETS.forEach(indexSizeSet);

/** Sort sizes in their natural order; unknown sizes go last, numbers numerically. */
export function sortSizes(sizes) {
    return [...sizes].sort((a, b) => {
        const oa = SIZE_ORDER.get(a);
        const ob = SIZE_ORDER.get(b);
        if (oa !== undefined && ob !== undefined) return oa - ob;
        if (oa !== undefined) return -1;
        if (ob !== undefined) return 1;
        const na = parseFloat(a);
        const nb = parseFloat(b);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(a).localeCompare(String(b));
    });
}
