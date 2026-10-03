import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

const schemaPath = path.resolve(__dirname, '../../electron/database/schema.sql');

let SQL = null;

/**
 * A database shaped like a pre-variant installation: the original schema plus
 * the sync columns the legacy migrations in init.js add.
 */
export async function createLegacyDb() {
    SQL = SQL || await initSqlJs();
    const db = new SQL.Database();
    db.exec(fs.readFileSync(schemaPath, 'utf8'));
    for (const table of ['products', 'sale_items', 'inventory_logs', 'return_items']) {
        db.run(`ALTER TABLE ${table} ADD COLUMN is_synced INTEGER DEFAULT 0`);
        db.run(`ALTER TABLE ${table} ADD COLUMN remote_id TEXT`);
    }
    db.run('ALTER TABLE sale_items ADD COLUMN unit_cost REAL DEFAULT 0');
    return db;
}

/** The adapter interface catalogService expects, on top of a raw sql.js db. */
export function createApi(db) {
    let depth = 0;
    return {
        all(sql, params = []) {
            const stmt = db.prepare(sql);
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free();
            return rows;
        },
        get(sql, params = []) {
            return this.all(sql, params)[0] || null;
        },
        run(sql, params = []) {
            db.run(sql, params);
        },
        transaction(fn) {
            if (depth > 0) return fn();
            db.run('BEGIN');
            depth++;
            try {
                const result = fn();
                db.run('COMMIT');
                return result;
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            } finally {
                depth--;
            }
        },
        uuid: () => randomUUID(),
    };
}
