/**
 * Small helpers of the storefront renderer: every piece of shop text goes
 * through esc() (names, descriptions, categories are the shop's own words,
 * never trusted as HTML), every address through href()/asset().
 */
const { formatMoney, normalizeLanguage } = require('../../i18n');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Joins pieces of markup, dropping empty ones. */
const html = (...parts) => parts.flat(Infinity).filter(p => p !== null && p !== undefined && p !== false && p !== '').join('');

const money = (amount, lang, currency) => formatMoney(Number(amount) || 0, normalizeLanguage(lang), currency || 'DZD');

/**
 * A price as markup: the figures kept left to right (in Arabic "9 800" would
 * otherwise read "800 9"), the currency in the page's direction.
 */
function moneyHtml(amount, lang, currency) {
    const text = money(amount, lang, currency);
    const m = /[\d][\d\s\u00a0\u202f.,]*\d|\d/.exec(text);
    if (!m) return esc(text);
    return `${esc(text.slice(0, m.index))}<bdi dir="ltr">${esc(m[0])}</bdi>${esc(text.slice(m.index + m[0].length))}`;
}

/** A phone number, always left to right. */
const phoneHtml = (phone) => `<bdi dir="ltr">${esc(phone)}</bdi>`;

const HEX = /^#[0-9a-f]{6}$/i;
/** A colour from the shop's variants, only when it is a plain #rrggbb. */
const safeColor = (code) => (HEX.test(String(code || '')) ? String(code) : null);

/** Phone digits for wa.me / tel: (Algerian 0XXXXXXXXX -> 213XXXXXXXXX). */
function phoneDigits(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 10 && d.startsWith('0')) d = `213${d.slice(1)}`;
    return d.length >= 8 && d.length <= 15 ? d : '';
}

/** A placeholder picture (no shop picture): the article's first letter on the theme's colours. */
function placeholder(name, colors) {
    const letter = esc((String(name || '?').trim()[0] || '?').toUpperCase());
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="${colors.surface}"/><text x="150" y="225" font-family="Georgia,serif" font-size="120" text-anchor="middle" fill="${colors.muted}" opacity="0.45">${letter}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

module.exports = { esc, html, money, moneyHtml, phoneHtml, safeColor, phoneDigits, placeholder };
