import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const license = require('../electron/services/licenseService');
const updates = require('../electron/services/updateService');
const logs = require('../electron/services/logService');

describe('offline licence', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pub = publicKey.export({ type: 'spki', format: 'pem' });
    const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });

    it('accepts a key signed by the publisher, refuses a changed one, sees the expiry', () => {
        const key = license.sign({ shop: 'Boutique Amina', plan: 'standard', issued: '2026-10-10' }, priv);
        expect(license.check(key, pub)).toMatchObject({ status: 'valid', license: { shop: 'Boutique Amina' } });
        const [payload, sig] = key.split('.');
        const forged = Buffer.from(JSON.stringify({ shop: 'Other', plan: 'pro' })).toString('base64url');
        expect(license.check(`${forged}.${sig}`, pub).status).toBe('invalid');
        expect(license.check(`${payload}.AAAA`, pub).status).toBe('invalid');
        expect(license.check('', pub).status).toBe('none');
        expect(license.check(key, '').status).toBe('not_configured');
        const old = license.sign({ shop: 'X', expires: '2026-01-01' }, priv);
        expect(license.check(old, pub, Date.parse('2026-10-10')).status).toBe('expired');
    });
});

describe('updates', () => {
    it('compares versions and reads the published file safely', async () => {
        expect(updates.compareVersions('1.10.0', '1.9.3')).toBe(1);
        expect(updates.compareVersions('1.2.0', '1.2')).toBe(0);
        expect(updates.readRelease({ version: '1.3.0', url: 'https://x.dz/s.exe' }, '1.2.9')).toMatchObject({ available: true, url: 'https://x.dz/s.exe' });
        expect(updates.readRelease({ version: '1.3.0', url: 'file:///C:/evil.exe' }, '1.2.9').url).toBeNull();
        expect(await updates.checkForUpdate('', '1.0.0')).toMatchObject({ available: false, configured: false });
        const offline = async () => { throw new Error('offline'); };
        expect(await updates.checkForUpdate('https://x.dz/latest.json', '1.0.0', offline)).toMatchObject({ error: 'UPDATE_UNREACHABLE' });
        const ok = async () => ({ ok: true, json: async () => ({ version: '2.0.0', url: 'https://x.dz/a.exe' }) });
        expect(await updates.checkForUpdate('https://x.dz/latest.json', '1.0.0', ok)).toMatchObject({ available: true, version: '2.0.0' });
    });
});

describe('log and support file', () => {
    it('writes a log a day and never puts secrets in the support file', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-log-'));
        logs.init(dir, { captureConsole: false });
        logs.write('error', 'Print failed', { printer: 'EPSON', password: 'hunter2' });
        const text = logs.supportBundle({ version: '1.2.3', settings: { email_settings: { user: 'a@b.dz', pass: 'secret1' }, sync: { token: 'tok' } } });
        expect(text).toContain('Version: 1.2.3');
        expect(text).toContain('Print failed');
        expect(text).not.toMatch(/hunter2|secret1|"tok"/);
        expect(fs.readdirSync(path.join(dir, 'logs')).some(n => n.endsWith('.log'))).toBe(true);
    });
});
