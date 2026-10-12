import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// The real database module on a temporary data folder (as demo.test.js)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-demo-dates-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app: { getPath: () => dir } } };
const init = require('../electron/database/init');
const api = require('../electron/database/api');
const { seedDemoShop } = require('../electron/services/demoData');
const ShiftService = require('../electron/services/shiftService');

describe('demo shop built on any day', () => {
    it('never has a drawer below 0 nor a counted cash far from the expected', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        init.setProfile('demo');
        for (const [i, day] of ['2026-10-11', '2026-11-03', '2027-01-01', '2027-02-14', '2026-12-25'].entries()) {
            init.closeDatabase();
            try { fs.rmSync(init.getDbPath()); } catch { /* first one */ }
            await init.initDatabase();
            api.transaction(() => seedDemoShop(api, { lang: 'fr', imagesDir: path.join(dir, `img${i}`), now: new Date(`${day}T18:00:00`) }));
            const shifts = new ShiftService();
            for (const s of api.all('SELECT id FROM shifts WHERE end_time IS NOT NULL')) {
                const st = shifts.getShiftStats(s.id);
                expect(st.expected_cash, `${day} ${s.id}`).toBeGreaterThanOrEqual(0);
                expect(st.cash_difference, `${day} ${s.id}`).toBeGreaterThanOrEqual(-100);
                expect(st.cash_difference, `${day} ${s.id}`).toBeLessThanOrEqual(50);
            }
        }
        init.closeDatabase();
        init.setProfile('real');
    }, 120000);
});
