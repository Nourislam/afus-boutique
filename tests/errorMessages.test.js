import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { translate } from '../src/i18n';
import { translateError, errorCode } from '../src/i18n/errors';

const require = createRequire(import.meta.url);
const { friendlyError } = require('../electron/ecommerce/EcommerceSyncManager');

// What the window receives from the main process
const ipc = (message) => new Error(`Error invoking remote method 'x': Error: ${message}`);

describe('error messages say what to do', () => {
    it('online store errors become plain advice, never the technical text', () => {
        expect(friendlyError('getaddrinfo ENOTFOUND shop.example')).toBe('ECOM_OFFLINE|{}');
        expect(friendlyError('TypeError: fetch failed')).toBe('ECOM_OFFLINE|{}');
        expect(friendlyError('Invalid URL')).toBe('ECOM_BAD_URL|{}');
        expect(friendlyError('Request failed with status 401')).toBe('ECOM_AUTH|{}');
        expect(friendlyError('weird thing')).toBe('ECOM_FAILED|{}');
        expect(friendlyError('ECOM_AUTH|{}')).toBe('ECOM_AUTH|{}');
    });

    it('each code is translated with the action to take, in the three languages', () => {
        for (const code of ['PRINT_FAILED', 'BACKUP_DISK_FULL', 'BACKUP_NO_ACCESS', 'RESTORE_FAILED', 'ECOM_OFFLINE', 'LOGIN_REQUIRED',
            'COUNT_CODE_UNKNOWN', 'EXCHANGE_CREDIT_SALE', 'SALE_NOT_COUNTED', 'DISCOUNT_NEEDS_MANAGER', 'EXPENSE_MORE_THAN_DRAWER', 'IMPORT_EXISTS']) {
            for (const lang of ['en', 'fr', 'ar']) {
                const text = translate(lang, `errors.${code}`);
                expect(text, `${code} ${lang}`).not.toBe(`errors.${code}`);
                // "what happened — what to do" (or a clear instruction)
                expect(text.length).toBeGreaterThan(15);
            }
        }
        expect(translate('ar', 'errors.PRINT_FAILED')).toContain('اضغط طباعة من جديد');
    });

    it('the window shows the translated text and can read the code', () => {
        const error = ipc('DISCOUNT_NEEDS_MANAGER|{"max":5,"given":12.5}');
        expect(errorCode(error)).toEqual({ code: 'DISCOUNT_NEEDS_MANAGER', params: { max: 5, given: 12.5 } });
        expect(translateError(error)).not.toMatch(/Error invoking|DISCOUNT_NEEDS_MANAGER/);
        expect(errorCode(new Error('plain text'))).toBeNull();
    });
});
