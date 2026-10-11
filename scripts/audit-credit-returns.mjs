// Returns on kridi sales saved before returns lowered the debt: a report for
// the owner, READ ONLY. The database file is read into memory and never
// written; its SHA-256 is printed before and after to prove it.
//   npx vite-node scripts/audit-credit-returns.mjs <copy of afus-boutique.db> [report.csv]
// Run it on a COPY. The CSV holds customer names: keep it on this computer.
// Development: --settle --out <new file> writes, to a NEW file, the copy with
// only the proven cases settled (settleProvenLegacyReturns); the input file
// is never written.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const { auditLegacyCreditReturns, settleProvenLegacyReturns, toCsv } = require('../electron/services/creditReturnsAudit');
const { applyMigrations } = require('../electron/database/migrations');

const args = process.argv.slice(2);
const settle = args.includes('--settle');
const outIndex = args.indexOf('--out');
const settledOut = outIndex >= 0 ? args[outIndex + 1] : null;
const [file, csvOut] = args.filter((a, i) => !a.startsWith('--') && i !== outIndex + 1);
if (settle && (!settledOut || path.resolve(settledOut) === path.resolve(file || ''))) {
    console.error('--settle needs --out <new file>, different from the input'); process.exit(2);
}
if (!file) { console.error('usage: audit-credit-returns.mjs <database copy> [report.csv]'); process.exit(2); }
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Queries only: any write refused. */
function readOnlyApi(db) {
    const all = (sql, params = []) => {
        if (!/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) throw new Error(`Refused (read-only audit): ${sql.slice(0, 60)}`);
        const stmt = db.prepare(sql); stmt.bind(params);
        const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free();
        return rows;
    };
    return { all, get: (sql, params) => all(sql, params)[0] || null, run: () => { throw new Error('Refused: read-only audit'); } };
}

const before = sha(file);
const SQL = await initSqlJs();
const bytes = fs.readFileSync(file);
const db = new SQL.Database(new Uint8Array(bytes));
// The drawer's own figures (shiftService) read from a second copy in memory,
// brought to the current columns; nothing of it is saved anywhere
const drawerDb = new SQL.Database(new Uint8Array(bytes));
applyMigrations(drawerDb, { log: () => {} });
const drawerApi = readOnlyApi(drawerDb);
const initPath = path.resolve('electron/database/init.js');
require.cache[initPath] = { id: initPath, filename: initPath, loaded: true, exports: {
    runQuery: (s, p) => drawerApi.all(s, p), getOne: (s, p) => drawerApi.get(s, p), runInsert: () => { throw new Error('Refused: read-only audit'); },
} };
const ShiftService = require('../electron/services/shiftService.js');
const shifts = new ShiftService();
const shiftStats = (id) => { try { return shifts.getShiftStats(id); } catch { return null; } };

const report = auditLegacyCreditReturns(readOnlyApi(db), { shiftStats });
let settledSummary = null;
if (settle) {
    // On the second copy in memory (current columns), then saved to the new file
    let depth = 0;
    const writable = {
        all: (s, p) => drawerApi.all(s, p), get: (s, p) => drawerApi.get(s, p), run: (s, p = []) => drawerDb.run(s, p),
        uuid: () => crypto.randomUUID(),
        transaction(fn) {
            if (depth > 0) return fn();
            drawerDb.run('BEGIN'); depth++;
            try { const r = fn(); drawerDb.run('COMMIT'); return r; } catch (e) { drawerDb.run('ROLLBACK'); throw e; } finally { depth--; }
        },
    };
    const result = settleProvenLegacyReturns(writable, { shiftStats });
    fs.writeFileSync(settledOut, Buffer.from(drawerDb.export()));
    settledSummary = { settled: result.settled.length, settled_total: result.total, left: result.left.length, out: settledOut };
}
db.close(); drawerDb.close();
const after = sha(file);

const { cases, ...summary } = report;
console.log(JSON.stringify({ file, sha256_before: before, sha256_after: after, unchanged: before === after, ...summary, ...(settledSummary ? { settle: settledSummary } : {}) }, null, 1));
for (const c of cases.filter(x => x.status !== 'ALREADY_SETTLED').slice(0, 5)) console.log('EXAMPLE', JSON.stringify(c));
if (csvOut) { fs.writeFileSync(csvOut, toCsv(report)); console.log(`CSV: ${csvOut} (${cases.length} lines)`); }
if (before !== after) process.exit(1);
