/**
 * Barcode formats offered for free labels, and client-side checks so a typed
 * code is fixed before printing (check digit added, wrong length refused).
 */
export const SYMBOLOGIES = [
    { id: 'ean13', name: 'EAN-13', kind: '1D', digits: 13, hint: 'labels.sym.ean13' },
    { id: 'code128', name: 'Code 128', kind: '1D', hint: 'labels.sym.code128' },
    { id: 'qrcode', name: 'QR', kind: '2D', hint: 'labels.sym.qrcode' },
    { id: 'ean8', name: 'EAN-8', kind: '1D', digits: 8, hint: 'labels.sym.ean8' },
    { id: 'code39', name: 'Code 39', kind: '1D', hint: 'labels.sym.code39' },
    { id: 'upca', name: 'UPC-A', kind: '1D', digits: 12, hint: 'labels.sym.upca' },
    { id: 'itf14', name: 'ITF-14', kind: '1D', digits: 14, hint: 'labels.sym.itf14' },
    { id: 'datamatrix', name: 'DataMatrix', kind: '2D', hint: 'labels.sym.datamatrix' },
];

export const symbology = (id) => SYMBOLOGIES.find(s => s.id === id) || SYMBOLOGIES[0];

/** GS1 check digit (EAN-8, EAN-13, UPC-A, ITF-14): weights 3,1,3… from the right. */
export function gs1CheckDigit(body) {
    const digits = String(body).split('').map(Number).reverse();
    const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    return String((10 - (sum % 10)) % 10);
}

/**
 * Normalise a typed code for a symbology.
 * Returns { code } or { error: i18n key, params }.
 */
export function normalizeCode(type, raw) {
    let code = String(raw ?? '').trim();
    if (!code) return { error: 'labels.err.empty' };
    const spec = symbology(type);
    if (spec.digits) {
        code = code.replace(/\s+/g, '');
        if (!/^\d+$/.test(code)) return { error: 'labels.err.digitsOnly', params: { name: spec.name } };
        if (code.length === spec.digits - 1) return { code: code + gs1CheckDigit(code) };
        if (code.length !== spec.digits) {
            return { error: 'labels.err.length', params: { name: spec.name, n: spec.digits, m: spec.digits - 1 } };
        }
        if (gs1CheckDigit(code.slice(0, -1)) !== code.slice(-1)) {
            return { error: 'labels.err.checkDigit', params: { digit: gs1CheckDigit(code.slice(0, -1)) } };
        }
        return { code };
    }
    if (type === 'code39') {
        code = code.toUpperCase();
        if (!/^[0-9A-Z .$/+%-]+$/.test(code)) return { error: 'labels.err.code39' };
        return { code };
    }
    if (type === 'code128' && !/^[\x20-\x7e]+$/.test(code)) return { error: 'labels.err.ascii' };
    if (code.length > 120) return { error: 'labels.err.tooLong' };
    return { code };
}
