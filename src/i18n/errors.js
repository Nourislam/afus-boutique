// Turn errors coming from the main process into messages in the current
// language. Services send user-facing errors as "CODE|{json params}"
// (one per line); anything else is shown as received.
import { t } from './index';
import { MESSAGES } from './messages';

function fieldName(field) {
    for (const key of [`errors.field.${field}`, `excel.field.${field}`]) {
        if (MESSAGES[key]) return t(key);
    }
    return field;
}

const IPC_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

function translateLine(line) {
    const m = /^([A-Z][A-Z0-9_]+)\|(\{.*\})$/.exec(line.trim());
    if (!m) return line;
    let params = {};
    try { params = JSON.parse(m[2]); } catch { /* keep empty */ }
    if (params.field) params.field = fieldName(params.field);
    const text = t(`errors.${m[1]}`, params);
    if (params.row) {
        const where = params.variant ? `${t('errors.row', { n: params.row })} (${params.variant})` : t('errors.row', { n: params.row });
        return `${where} : ${text}`;
    }
    return text;
}

/** @returns {string[]} one translated message per error line */
export function translateErrorLines(error) {
    const raw = String(error?.message ?? error ?? '').replace(IPC_PREFIX, '');
    return raw.split('\n').filter(Boolean).map(translateLine);
}

export function translateError(error) {
    return translateErrorLines(error).join('\n') || t('common.error');
}

/** The code of an error sent by the main process ("CODE|{json}"), or null. */
export function errorCode(error) {
    const raw = String(error?.message ?? error ?? '').replace(IPC_PREFIX, '');
    const m = /^([A-Z][A-Z0-9_]+)\|(\{.*\})$/.exec(raw.split('\n')[0].trim());
    if (!m) return null;
    let params = {};
    try { params = JSON.parse(m[2]); } catch { /* keep empty */ }
    return { code: m[1], params };
}
