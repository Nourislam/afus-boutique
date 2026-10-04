/**
 * Number, money and date formatting for Algeria.
 * - Amounts in dinars: "2 500 DA" (French/English) or "2 500 د.ج" (Arabic).
 *   No decimals for whole amounts, as prices in Algerian shops are whole dinars.
 * - Western digits (0-9) in every language, as is usual in Algeria.
 */
import { currentLanguage, languageInfo } from './index';
import { useSettingsStore } from '../stores/settingsStore';

const GROUPING_LOCALE = 'fr-FR'; // "2 500" style grouping, Latin digits

export function currencySymbolFor(lang, currency = 'DZD') {
    if (!currency || currency === 'DZD') return lang === 'ar' ? 'د.ج' : 'DA';
    return currency;
}

// No-break space: keeps "2 500" in one piece when wrapping and, unlike a
// normal space, is not a word break for the bidi algorithm, so the number is
// not displayed as "500 2" inside Arabic text.
export const NBSP = '\u00a0';

export function formatNumber(value, { decimals } = {}) {
    const n = Number(value) || 0;
    const digits = decimals ?? (Number.isInteger(n) ? 0 : 2);
    return new Intl.NumberFormat(GROUPING_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
        .format(n)
        .replace(/[\u202f\u00a0 ]/g, NBSP);
}

export function formatMoney(amount, { lang = currentLanguage(), currency } = {}) {
    const cur = currency || useSettingsStore.getState?.().settings?.currency || 'DZD';
    const n = Number(amount) || 0;
    if (cur !== 'DZD') {
        try {
            return new Intl.NumberFormat(GROUPING_LOCALE, { style: 'currency', currency: cur }).format(n);
        } catch { /* fall through */ }
    }
    return `${formatNumber(n)}${NBSP}${currencySymbolFor(lang, cur)}`;
}

const DATE_STYLES = {
    date: { year: 'numeric', month: '2-digit', day: '2-digit' },
    time: { hour: '2-digit', minute: '2-digit', hour12: false },
    datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false },
    long: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
    short: { day: 'numeric', month: 'short' },
    month: { month: 'long', year: 'numeric' },
};

export function formatDate(value, style = 'date', { lang = currentLanguage() } = {}) {
    if (!value) return '';
    // SQLite CURRENT_TIMESTAMP values are UTC without a zone marker
    const d = value instanceof Date ? value
        : new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
    if (Number.isNaN(d.getTime())) return String(value);
    // Numeric dates are written dd/mm/yyyy hh:mm in every language; the Arabic
    // locale would add direction marks that scramble them next to Latin text.
    const numeric = !['long', 'short', 'month'].includes(style);
    const locale = numeric && lang === 'ar' ? 'fr-DZ' : languageInfo(lang).locale;
    return new Intl.DateTimeFormat(locale, DATE_STYLES[style] || DATE_STYLES.date).format(d);
}
