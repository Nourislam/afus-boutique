/**
 * Backups of the shop's database, kept in a "Backups" folder next to it
 * (%APPDATA%\AfusBoutique\Backups). Every backup is a full copy of the
 * SQLite file; nothing leaves the computer unless the shop exports a copy.
 *
 * File names say when and why the copy was made:
 *   afus-boutique-2026-10-05_14-30-12.db                 made by the shop
 *   afus-boutique-2026-10-05_08-00-03-auto.db            daily automatic copy
 *   afus-boutique-2026-10-05_14-31-40-before-restore.db  taken just before a restore
 *   afus-boutique-2026-10-05_14-29-00-imported.db        copied in from a USB key…
 *
 * Article pictures are kept beside them in Backups/images (each picture once,
 * whatever the number of backups), and come back with a restore. A second
 * copy can go to another folder (USB key, other disk, a synced folder):
 * <folder>/afus-boutique-backups, with its own images folder.
 */
const fs = require('fs');
const path = require('path');
const { BRAND } = require('../brand');

const KINDS = ['auto', 'before-restore', 'imported'];
const NAME_RE = new RegExp(`^${BRAND.fileSlug}-(\\d{4}-\\d{2}-\\d{2})_(\\d{2})-(\\d{2})-(\\d{2})(?:-(${KINDS.join('|')}))?(?:-\\d+)?\\.db$`);

// Daily automatic backup: on unless the shop turns it off in Settings.
// version 2: settings saved before (when it was off by default) are turned on.
const SETTINGS_VERSION = 2;
const DEFAULT_BACKUP_SETTINGS = { autoDaily: true, keepAuto: 7, externalFolder: '', version: SETTINGS_VERSION };

/** The backup settings to use, from what is saved (or nothing). */
function resolveSettings(saved) {
    const value = saved && typeof saved === 'object' ? saved : {};
    if (value.version !== SETTINGS_VERSION) return { ...DEFAULT_BACKUP_SETTINGS, ...value, autoDaily: true, version: SETTINGS_VERSION };
    return { ...DEFAULT_BACKUP_SETTINGS, ...value };
}

const IMAGES = 'images';
const EXTERNAL_FOLDER = `${BRAND.fileSlug}-backups`;

function backupDir(userDataPath) {
    return path.join(userDataPath, 'Backups');
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/** Name for a new backup; never the name of a file already there. */
function backupName(date = new Date(), kind = '', existing = []) {
    const base = `${BRAND.fileSlug}-${stamp(date)}${kind ? `-${kind}` : ''}`;
    let name = `${base}.db`;
    for (let i = 2; existing.includes(name); i++) name = `${base}-${i}.db`;
    return name;
}

/** Only a plain file name made by this service: no folders, no "..". */
function isBackupName(name) {
    return typeof name === 'string' && name === path.basename(name) && NAME_RE.test(name);
}

function parseName(name) {
    const m = NAME_RE.exec(name);
    if (!m) return null;
    const [, day, hh, mm, ss, kind] = m;
    const [y, mo, d] = day.split('-').map(Number);
    return { createdAt: new Date(y, mo - 1, d, Number(hh), Number(mm), Number(ss)), kind: kind || 'manual' };
}

/** Backups in the folder, newest first: [{ name, kind, createdAt, size }] */
function listBackups(dir) {
    let names = [];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return [];
    }
    return names
        .filter(isBackupName)
        .map((name) => {
            const info = parseName(name);
            let size = 0;
            try { size = fs.statSync(path.join(dir, name)).size; } catch { /* listed anyway */ }
            return { name, kind: info.kind, createdAt: info.createdAt.toISOString(), size };
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.name.localeCompare(a.name)));
}

/** Copy the database file into the folder. */
function createBackup(dir, dbPath, { kind = '', date = new Date() } = {}) {
    if (!fs.existsSync(dbPath)) throw new Error('Database file not found');
    fs.mkdirSync(dir, { recursive: true });
    const name = backupName(date, kind, fs.readdirSync(dir));
    const target = path.join(dir, name);
    // Written next to the target first: a full copy or nothing
    fs.copyFileSync(dbPath, `${target}.tmp`);
    fs.renameSync(`${target}.tmp`, target);
    return listBackups(dir).find(b => b.name === name);
}

function backupPath(dir, name) {
    if (!isBackupName(name)) throw new Error('Invalid backup name');
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error('Backup not found');
    return file;
}

function deleteBackup(dir, name) {
    fs.unlinkSync(backupPath(dir, name));
    return true;
}

const count = (db, sql) => {
    try {
        const res = db.exec(sql);
        return res.length ? Number(res[0].values[0][0]) || 0 : 0;
    } catch {
        return null;
    }
};
const text = (db, sql) => {
    try {
        const res = db.exec(sql);
        return res.length ? res[0].values[0][0] : null;
    } catch {
        return null;
    }
};

/**
 * What a database file holds, to compare before restoring it.
 * @param {object} SQL the sql.js module (initSqlJs())
 * @returns {{ valid, shopName, articles, pieces, sales, customers, employees, lastSale }}
 */
function summarizeDatabase(SQL, buffer) {
    let db;
    try {
        db = new SQL.Database(buffer);
        db.exec('SELECT count(*) FROM sqlite_master');
    } catch {
        if (db) db.close();
        return { valid: false };
    }
    try {
        const tables = (db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values || []).map(r => r[0]);
        // A database of this program has its products, sales and settings
        const valid = ['products', 'sales', 'settings'].every(tbl => tables.includes(tbl));
        if (!valid) return { valid: false };
        let shopName = '';
        try {
            const raw = text(db, "SELECT value FROM settings WHERE key = 'store_config'");
            shopName = raw ? (JSON.parse(raw) || {}).businessName || '' : '';
        } catch { /* older file */ }
        return {
            valid: true,
            shopName,
            articles: count(db, 'SELECT COUNT(*) FROM products WHERE is_active = 1'),
            pieces: tables.includes('product_variants') ? count(db, 'SELECT COUNT(*) FROM product_variants WHERE is_active = 1') : 0,
            sales: count(db, 'SELECT COUNT(*) FROM sales'),
            customers: tables.includes('customers') ? count(db, 'SELECT COUNT(*) FROM customers') : 0,
            employees: tables.includes('employees') ? count(db, 'SELECT COUNT(*) FROM employees') : 0,
            lastSale: text(db, 'SELECT MAX(created_at) FROM sales'),
        };
    } finally {
        db.close();
    }
}

/** Is a daily automatic backup due? (none made yet on that calendar day) */
function autoBackupDue(backups, now = new Date()) {
    const today = stamp(now).slice(0, 10);
    return !backups.some(b => b.kind === 'auto' && b.name.includes(`-${today}_`));
}

/** Automatic copies beyond the newest `keep` (copies made by the shop are never removed). */
function autoBackupsToPrune(backups, keep = DEFAULT_BACKUP_SETTINGS.keepAuto) {
    const auto = backups.filter(b => b.kind === 'auto');
    return auto.slice(Math.max(1, parseInt(keep, 10) || DEFAULT_BACKUP_SETTINGS.keepAuto));
}

/**
 * Copy the pictures of `from` that `to` does not have yet (or has with
 * another size). Nothing is deleted. Returns the number of files copied.
 */
function mirrorFiles(from, to) {
    let names;
    try { names = fs.readdirSync(from); } catch { return 0; }
    let copied = 0;
    for (const name of names) {
        const source = path.join(from, name);
        let stat;
        try { stat = fs.statSync(source); } catch { continue; }
        if (!stat.isFile()) continue;
        const target = path.join(to, name);
        try { if (fs.statSync(target).size === stat.size) continue; } catch { /* not there yet */ }
        fs.mkdirSync(to, { recursive: true });
        fs.copyFileSync(source, `${target}.tmp`);
        fs.renameSync(`${target}.tmp`, target);
        copied++;
    }
    return copied;
}

/** The pictures kept with the backups (Backups/images). */
const imagesBackupDir = (dir) => path.join(dir, IMAGES);

/** Keep the article pictures with the backups. */
function backupImages(dir, imagesDir) {
    return mirrorFiles(imagesDir, imagesBackupDir(dir));
}

/** After a restore: the pictures the restored data uses, put back (none removed). */
function restoreImages(dir, imagesDir) {
    return mirrorFiles(imagesBackupDir(dir), imagesDir);
}

/**
 * The second copy, in another folder: <folder>/afus-boutique-backups gets the
 * backup file and the pictures; the oldest automatic copies there are removed
 * as in the main folder. Throws when the folder cannot be reached (USB key
 * not plugged in…), so the shop can be told.
 */
function copyToExternal(dir, name, externalFolder, imagesDir, keep) {
    if (!externalFolder) return null;
    if (!fs.existsSync(externalFolder)) {
        const error = new Error('External folder not found');
        error.code = 'EXTERNAL_MISSING';
        throw error;
    }
    const target = path.join(externalFolder, EXTERNAL_FOLDER);
    fs.mkdirSync(target, { recursive: true });
    const file = path.join(target, name);
    fs.copyFileSync(backupPath(dir, name), `${file}.tmp`);
    fs.renameSync(`${file}.tmp`, file);
    mirrorFiles(imagesDir, path.join(target, IMAGES));
    for (const old of autoBackupsToPrune(listBackups(target), keep)) deleteBackup(target, old.name);
    return { folder: target, name };
}

/** Pictures brought with an imported file (an export or an external copy). */
function importImages(file, dir) {
    const near = path.dirname(file);
    let copied = 0;
    for (const folder of [path.join(near, IMAGES), path.join(near, `${BRAND.fileSlug}-${IMAGES}`)]) {
        copied += mirrorFiles(folder, imagesBackupDir(dir));
    }
    return copied;
}

/** An exported copy takes its pictures with it, in <folder>/afus-boutique-images. */
function exportImages(dir, targetFile) {
    return mirrorFiles(imagesBackupDir(dir), path.join(path.dirname(targetFile), `${BRAND.fileSlug}-${IMAGES}`));
}

module.exports = {
    DEFAULT_BACKUP_SETTINGS,
    EXTERNAL_FOLDER,
    resolveSettings,
    mirrorFiles,
    imagesBackupDir,
    backupImages,
    restoreImages,
    copyToExternal,
    importImages,
    exportImages,
    backupDir,
    backupName,
    isBackupName,
    listBackups,
    createBackup,
    backupPath,
    deleteBackup,
    summarizeDatabase,
    autoBackupDue,
    autoBackupsToPrune,
};
