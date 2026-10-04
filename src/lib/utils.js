import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { format, formatDistanceToNow } from 'date-fns';

export function formatCurrency(amount, currency = 'USD', symbol = '$') {
    return formatMoney(amount || 0);
}

export function formatDate(date, formatStr = 'MMM d, yyyy') {
    return format(new Date(date), formatStr);
}

export function formatDateTime(date) {
    return formatLocalDate(date, 'datetime');
}

export function formatRelativeTime(date) {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function generateId() {
    return crypto.randomUUID();
}

export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function classNames(...classes) {
    return classes.filter(Boolean).join(' ');
}
