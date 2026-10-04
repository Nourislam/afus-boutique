import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { matchPrinter, printContents, loadHtml, TEMP_DIR } = require('../electron/services/printDocument');

// webContents.print stand-in: answers each call from the list
function fakeContents(answers) {
    const calls = [];
    return {
        calls,
        print(options, callback) {
            calls.push(options);
            const answer = answers[calls.length - 1];
            if (answer instanceof Error) throw answer;
            setImmediate(() => callback(answer[0], answer[1]));
        },
    };
}

describe('matchPrinter', () => {
    const installed = [{ name: 'EPSON_TM_T20', displayName: 'EPSON TM-T20' }, { name: 'XP-365B', displayName: 'XP-365B' }];
    it('finds the system name from the exact name, the display name or another case', () => {
        expect(matchPrinter(installed, 'EPSON_TM_T20')).toBe('EPSON_TM_T20');
        expect(matchPrinter(installed, 'EPSON TM-T20')).toBe('EPSON_TM_T20');
        expect(matchPrinter(installed, 'xp-365b')).toBe('XP-365B');
    });
    it('returns null for a printer that is not installed, empty for none chosen', () => {
        expect(matchPrinter(installed, 'Zebra GK420')).toBeNull();
        expect(matchPrinter(installed, '')).toBe('');
    });
});

describe('printContents', () => {
    const size = { width: 80000, height: 120000 };
    it('prints once when it works', async () => {
        const wc = fakeContents([[true]]);
        expect(await printContents(wc, { silent: true, pageSize: size })).toEqual({ success: true });
        expect(wc.calls).toHaveLength(1);
    });
    it('sends again with the driver paper size when the custom size is refused', async () => {
        const wc = fakeContents([[false, 'Print job failed'], [true]]);
        expect(await printContents(wc, { silent: true, pageSize: size, deviceName: 'XP-80' })).toEqual({ success: true, fallback: true });
        expect(wc.calls[1].pageSize).toBeUndefined();
        expect(wc.calls[1].deviceName).toBe('XP-80');
    });
    it('reports a cancelled dialog without an error', async () => {
        const wc = fakeContents([[false, 'Print job canceled']]);
        expect(await printContents(wc, { silent: false, pageSize: size })).toEqual({ success: false, cancelled: true });
    });
    it('does not show the dialog twice', async () => {
        const wc = fakeContents([[false, 'Print job failed']]);
        await expect(printContents(wc, { silent: false, pageSize: size })).rejects.toThrow('Print job failed');
        expect(wc.calls).toHaveLength(1);
    });
    it('fails clearly on an unknown printer', async () => {
        const wc = fakeContents([new Error('Invalid deviceName provided')]);
        await expect(printContents(wc, { silent: true, pageSize: size, deviceName: 'Gone' })).rejects.toThrow(/deviceName/);
        expect(wc.calls).toHaveLength(1);
    });
});

describe('loadHtml', () => {
    it('loads documents larger than a data: URL allows, from a temporary file removed afterwards', async () => {
        const html = `<html><body>${'<img src="data:image/png;base64,' + 'A'.repeat(1024 * 1024) + '">'.repeat(1)}${'x'.repeat(3 * 1024 * 1024)}</body></html>`;
        let loaded = null;
        const win = { loadFile: async (file) => { loaded = { file, size: fs.statSync(file).size }; } };
        await loadHtml(win, html);
        expect(loaded.file.startsWith(TEMP_DIR)).toBe(true);
        expect(loaded.size).toBe(Buffer.byteLength(html));
        await new Promise(r => setTimeout(r, 20));
        expect(fs.existsSync(loaded.file)).toBe(false);
    });
});
