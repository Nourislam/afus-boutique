import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { applyMigrations } = require('../electron/database/migrations');

const root = path.resolve(__dirname, '..');
const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(js|jsx|sql)$/.test(entry.name) ? [full] : [];
});

describe('status of goods sent back to a supplier', () => {
    it('new returns are written "completed": the misspelling is gone from the code', () => {
        const misspelt = [...sources(path.join(root, 'electron')), ...sources(path.join(root, 'src'))]
            .filter(file => fs.readFileSync(file, 'utf8').includes('complated'))
            .map(file => path.relative(root, file));
        // only the migration that repairs old rows may still name it
        expect(misspelt).toEqual([path.join('electron', 'database', 'migrations.js')]);
        expect(fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')).toMatch(/INSERT INTO purchase_returns[\s\S]{0,200}notes, 'completed'\]/);
    });

    it('old misspelt rows are repaired once, nothing else changes', async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        const api = createApi(db);
        api.run("INSERT INTO suppliers (id, name) VALUES ('f1', 'Oran')");
        api.run(`INSERT INTO purchase_returns (id, return_number, supplier_id, total_amount, status, created_at) VALUES
            ('old', 'RET-1', 'f1', 5000, 'complated', '2026-01-02 10:00:00'),
            ('new', 'RET-2', 'f1', 700, 'completed', '2026-01-03 10:00:00'),
            ('draft', 'RET-3', 'f1', 300, 'draft', '2026-01-04 10:00:00')`);
        const before = api.all('SELECT id, return_number, supplier_id, total_amount, created_at FROM purchase_returns ORDER BY id');

        api.run("DELETE FROM schema_migrations WHERE version = '2026_10_purchase_return_status'");
        expect(applyMigrations(db)).toEqual(['2026_10_purchase_return_status']);
        expect(applyMigrations(db)).toEqual([]);

        const status = Object.fromEntries(api.all('SELECT id, status FROM purchase_returns').map(r => [r.id, r.status]));
        expect(status).toEqual({ old: 'completed', new: 'completed', draft: 'draft' });
        expect(api.all('SELECT id, return_number, supplier_id, total_amount, created_at FROM purchase_returns ORDER BY id')).toEqual(before);
    });
});
