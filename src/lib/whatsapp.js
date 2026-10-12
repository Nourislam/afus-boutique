// Credit reminder sent through WhatsApp, the way shops already do it by hand:
// the program only opens WhatsApp (app or web) on the customer's number with
// a ready message; the cashier presses Send. No account, no server, no API.
import { t } from '../i18n';
import { formatMoney, formatDate } from '../i18n/format';

/**
 * International number for wa.me (digits only), or null when it cannot be one.
 * Algerian numbers typed as 0555 12 34 56 become 213555123456.
 */
export function whatsappNumber(phone) {
    let digits = String(phone || '').replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    else if (digits.startsWith('00')) digits = digits.slice(2);
    else if (/^0[5-7]\d{8}$/.test(digits)) digits = `213${digits.slice(1)}`;
    digits = digits.replace(/\D/g, '');
    return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** The ready-made message: customer, amount still owed, shop, due date when set. */
export function reminderMessage({ customerName, amount, shopName, dueDate }) {
    const due = dueDate ? t('whatsapp.due', { date: formatDate(dueDate) }) : '';
    return t('whatsapp.message', { name: customerName || '', amount: formatMoney(amount), shop: shopName || '', due }).replace(/\s+([.،,])/g, '$1').trim();
}

/** https://wa.me link that opens the chat with the message typed. */
export function whatsappLink(phone, text) {
    const number = whatsappNumber(phone);
    return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}
