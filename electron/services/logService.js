/**
 * The program's own log, for support: one text file a day in
 * <data folder>/logs (afus-boutique-2026-10-10.log), the last 14 days kept.
 * Errors and warnings of the main process and of the window are written
 * there, and a crash is recorded before the program closes.
 *
 * The support file (supportBundle) gathers what a technician needs to help
 * without a visit: versions, system, the size of the data, the recent log.
 * Secrets (passwords, tokens, keys, PINs) are never written in it.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BRAND } = require('../brand');

const KEEP_DAYS = 14;
const SECRET = /pass(word)?|token|secret|api[_-]?key|private|pin\b|smtp_pass|consumer|verifier/i;
let folder = null;

const pad = (n) => String(n).padStart(2, '0');
const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fileOf = (d = new Date()) => path.join(folder, `${BRAND.fileSlug}-${day(d)}.log`);

/** Anything that looks like a secret is replaced by *** (objects, text). */
function redact(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redact);
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = SECRET.test(k) ? (v ? '***' : v) : redact(v);
        return out;
    }
    if (typeof value === 'string') {
        return value
            .replace(/("?(?:pass(?:word)?|token|secret|api[_-]?key)"?\s*[:=]\s*)"[^"]*"/gi, '$1"***"')
            .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1***')
            // GitHub keys, wherever they appear
            .replace(/\b(gh[opusr]_|github_pat_)[A-Za-z0-9_]{10,}/g, '$1***')
            // OAuth keys and one-time codes in a query or a form (Cloudflare)
            .replace(/\b((?:access|refresh|id)_token|code_verifier|code|client_secret)=[^&\s"']+/gi, '$1=***')
            .replace(/\bory_(at|rt|ac)_[A-Za-z0-9._-]{10,}/g, 'ory_$1_***');
    }
    return value;
}

function text(args) {
    return args.map(a => {
        if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
        if (typeof a === 'object') { try { return JSON.stringify(redact(a)); } catch { return String(a); } }
        return redact(String(a));
    }).join(' ');
}

function write(level, ...args) {
    if (!folder) return;
    try {
        fs.appendFileSync(fileOf(), `${new Date().toISOString()} ${level.toUpperCase()} ${text(args)}\n`);
    } catch { /* the log must never stop the program */ }
}

/** Remove log files older than KEEP_DAYS. */
function prune(now = new Date()) {
    if (!folder) return;
    const limit = day(new Date(now.getTime() - KEEP_DAYS * 86400000));
    let names = [];
    try { names = fs.readdirSync(folder); } catch { return; }
    for (const name of names) {
        const m = /(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
        if (m && m[1] < limit) { try { fs.unlinkSync(path.join(folder, name)); } catch { /* next time */ } }
    }
}

/**
 * Start logging into <dataDir>/logs: console.error / console.warn are copied
 * to the file, and crashes are recorded.
 */
function init(dataDir, { captureConsole = true } = {}) {
    folder = path.join(dataDir, 'logs');
    try { fs.mkdirSync(folder, { recursive: true }); } catch { folder = null; return; }
    prune();
    if (captureConsole && !console.__afusLogged) {
        for (const level of ['error', 'warn']) {
            const original = console[level].bind(console);
            console[level] = (...args) => { write(level, ...args); original(...args); };
        }
        console.__afusLogged = true;
        process.on('uncaughtException', (error) => write('fatal', 'Uncaught exception:', error));
        process.on('unhandledRejection', (reason) => write('error', 'Unhandled rejection:', reason));
    }
    write('info', `${BRAND.productName} started`);
}

/** The last lines of the recent log files (newest last). */
function recentLines(max = 800) {
    if (!folder) return [];
    let names = [];
    try { names = fs.readdirSync(folder).filter(n => n.endsWith('.log')).sort(); } catch { return []; }
    const lines = [];
    for (const name of names.slice(-3)) {
        try { lines.push(...fs.readFileSync(path.join(folder, name), 'utf8').split('\n').filter(Boolean)); } catch { /* unreadable */ }
    }
    return lines.slice(-max);
}

/**
 * The support file's text. info: { version, electron, dataPath, counts, migrations, settings }
 * (settings are cleaned of their secrets here).
 */
function supportBundle(info = {}) {
    const lines = [
        `${BRAND.productName} — support`,
        `Date: ${new Date().toISOString()}`,
        `Version: ${info.version || '?'} (Electron ${info.electron || process.versions.electron || '?'})`,
        `System: ${os.type()} ${os.release()} ${os.arch()} · ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB RAM · ${os.cpus().length} CPU`,
        `Data folder: ${info.dataPath || ''}`,
        '',
        '== Data',
        ...Object.entries(info.counts || {}).map(([k, v]) => `${k}: ${v}`),
        '',
        '== Database updates',
        ...(info.migrations || []).map(m => `${m.version} ${m.applied_at || ''}`),
        '',
        '== Settings (secrets removed)',
        JSON.stringify(redact(info.settings || {}), null, 1),
        '',
        '== Recent log',
        ...recentLines(),
    ];
    return lines.join('\n');
}

module.exports = { init, write, prune, redact, recentLines, supportBundle, KEEP_DAYS };
