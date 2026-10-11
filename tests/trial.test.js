import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createShop } from './helpers/shop';

const require = createRequire(import.meta.url);
const trial = require('../electron/services/trialService');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
let dir, api;
beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-trial-'));
    ({ api } = await createShop());
    // A brand-new shop: its data is from today
    for (const table of ['products', 'product_variants', 'employees', 'sales']) {
        try { api.run(`UPDATE ${table} SET created_at = ?`, ['2026-10-01 09:00:00']); } catch { /* no column */ }
    }
});

describe('training 7 days, demo shop 3 months, from the install date', () => {
    it('counts from the first start', () => {
        const day0 = trial.status(trial.refresh(dir, api, T0));
        expect(day0.training).toMatchObject({ available: true, daysLeft: 7 });
        expect(day0.demo.available).toBe(true);
        const day6 = trial.status(trial.refresh(dir, api, T0 + 6.5 * DAY));
        expect(day6.training).toMatchObject({ available: true, daysLeft: 1 });
        const day8 = trial.status(trial.refresh(dir, api, T0 + 8 * DAY));
        expect(day8.training.available).toBe(false);
        expect(day8.demo.available).toBe(true);
        const month4 = trial.status(trial.refresh(dir, api, T0 + 95 * DAY));
        expect(month4.demo.available).toBe(false);
        // The date is kept with the shop's data too
        expect(api.get("SELECT value FROM settings WHERE key = 'installed_at'")).toBeTruthy();
    });

    it('putting the clock back does not give the time again', () => {
        trial.refresh(dir, api, T0);
        trial.refresh(dir, api, T0 + 10 * DAY);
        const back = trial.refresh(dir, api, T0 + 1 * DAY);
        expect(back.clockBack).toBe(true);
        expect(trial.status(back).training.available).toBe(false);
    });

    it('deleting install.json does not reset it: the shop\'s data and settings keep the date', () => {
        trial.refresh(dir, api, T0);
        fs.rmSync(path.join(dir, trial.FILE));
        expect(trial.status(trial.refresh(dir, api, T0 + 10 * DAY)).training.available).toBe(false);
        // An older shop upgraded: its oldest sale counts
        const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-trial-'));
        api.run("DELETE FROM settings WHERE key = 'installed_at'");
        api.run("UPDATE products SET created_at = '2025-01-15 10:00:00'");
        const old = trial.status(trial.refresh(fresh, api, T0));
        expect(old.installedAt.slice(0, 10)).toBe('2025-01-15');
        expect(old.demo.available).toBe(false);
    });

    it('exact edges: 7 days, 3 calendar months; a restart or an update does not move the date', () => {
        const start = Date.parse('2026-10-01T09:00:00Z');
        const first = trial.refresh(dir, api, start);
        // A restart (refresh again) and a new version (same data folder) keep the date
        const again = trial.refresh(dir, api, start + 2 * DAY);
        expect(again.installedAt).toBe(first.installedAt);
        expect(trial.status({ installedAt: first.installedAt, now: start + 7 * DAY - 1000 }).training.available).toBe(true);
        expect(trial.status({ installedAt: first.installedAt, now: start + 7 * DAY }).training.available).toBe(false);
        const demoEnd = Date.parse(trial.status({ installedAt: first.installedAt, now: start }).demo.endsAt);
        expect(new Date(demoEnd).toISOString().slice(0, 10)).toBe('2027-01-01');
        expect(trial.status({ installedAt: first.installedAt, now: demoEnd - 1000 }).demo.available).toBe(true);
        expect(trial.status({ installedAt: first.installedAt, now: demoEnd }).demo.available).toBe(false);
    });

    it('the end of training or of the demo changes nothing in the shop\'s data', () => {
        const before = api.all('SELECT * FROM products ORDER BY id').length + api.all('SELECT * FROM sales').length;
        trial.refresh(dir, api, T0 + 200 * DAY);
        const after = api.all('SELECT * FROM products ORDER BY id').length + api.all('SELECT * FROM sales').length;
        expect(after).toBe(before);
        // Only the date is written (once), as a setting
        expect(api.all("SELECT key FROM settings WHERE key = 'installed_at'")).toHaveLength(1);
    });
});
