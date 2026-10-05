import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const backup = require('../electron/services/backupService');
const initSqlJs = require('sql.js');

let dir;
let dbFile;
beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afus-backup-'));
    dir = path.join(root, 'Backups');
    dbFile = path.join(root, 'afus-boutique.db');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE products (id TEXT, is_active INTEGER); CREATE TABLE sales (id TEXT, created_at TEXT); CREATE TABLE settings (key TEXT, value TEXT);");
    db.run("INSERT INTO products VALUES ('p1', 1), ('p2', 1); INSERT INTO sales VALUES ('s1', '2026-10-01 10:00:00');");
    db.run("INSERT INTO settings VALUES ('store_config', '{\"businessName\":\"Boutique El Bahia\"}')");
    fs.writeFileSync(dbFile, Buffer.from(db.export()));
    db.close();
});

describe('backups', () => {
    it('creates, lists (newest first) and deletes copies in the folder', () => {
        const a = backup.createBackup(dir, dbFile, { date: new Date(2026, 9, 1, 9, 0, 0) });
        const b = backup.createBackup(dir, dbFile, { date: new Date(2026, 9, 2, 9, 0, 0), kind: 'auto' });
        const list = backup.listBackups(dir);
        expect(list.map(x => x.name)).toEqual([b.name, a.name]);
        expect(list[0].kind).toBe('auto');
        expect(list[1].kind).toBe('manual');
        expect(list[1].size).toBe(fs.statSync(dbFile).size);
        backup.deleteBackup(dir, a.name);
        expect(backup.listBackups(dir).map(x => x.name)).toEqual([b.name]);
    });

    it('never gives two backups the same name', () => {
        const date = new Date(2026, 9, 1, 9, 0, 0);
        const a = backup.createBackup(dir, dbFile, { date });
        const b = backup.createBackup(dir, dbFile, { date });
        expect(a.name).not.toBe(b.name);
        expect(backup.listBackups(dir)).toHaveLength(2);
    });

    it('refuses names that leave the folder', () => {
        expect(backup.isBackupName('../afus-boutique.db')).toBe(false);
        expect(backup.isBackupName('afus-boutique-2026-10-01_09-00-00.db')).toBe(true);
        expect(() => backup.deleteBackup(dir, '../../etc/passwd')).toThrow();
    });

    it('summarises what a backup holds, and rejects other files', async () => {
        const SQL = await initSqlJs();
        const summary = backup.summarizeDatabase(SQL, fs.readFileSync(dbFile));
        expect(summary).toMatchObject({ valid: true, shopName: 'Boutique El Bahia', articles: 2, sales: 1, lastSale: '2026-10-01 10:00:00' });
        expect(backup.summarizeDatabase(SQL, Buffer.from('not a database')).valid).toBe(false);
    });

    it('makes one automatic copy a day and keeps only the newest ones', () => {
        for (let d = 1; d <= 4; d++) backup.createBackup(dir, dbFile, { date: new Date(2026, 9, d, 8, 0, 0), kind: 'auto' });
        backup.createBackup(dir, dbFile, { date: new Date(2026, 8, 1, 8, 0, 0) });
        const list = backup.listBackups(dir);
        expect(backup.autoBackupDue(list, new Date(2026, 9, 4, 18, 0, 0))).toBe(false);
        expect(backup.autoBackupDue(list, new Date(2026, 9, 5, 8, 0, 0))).toBe(true);
        const prune = backup.autoBackupsToPrune(list, 2);
        expect(prune.map(b => b.name)).toEqual(list.filter(b => b.kind === 'auto').slice(2).map(b => b.name));
        // Copies made by the shop are never pruned
        expect(prune.every(b => b.kind === 'auto')).toBe(true);
    });
});
