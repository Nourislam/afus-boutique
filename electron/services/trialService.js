/**
 * How long the demo shop is offered, counted from the day the program was
 * installed: 3 months. After that its button leaves the screens, the main
 * process refuses it, and the demo shop's folder is removed (the shop's own
 * data is never touched).
 *
 * Install date = the earliest of: the date kept in <data folder>/install.json
 * (written at the first start), the date kept in the shop's settings
 * (installed_at, travels with a backup), and the shop's oldest data (an older
 * shop upgraded to this version). Putting the computer's clock back does not
 * give the time again: the latest date the program has seen is kept too.
 */
const fs = require('fs');
const path = require('path');

const DAY = 24 * 60 * 60 * 1000;
const DEMO_MONTHS = 3;
const FILE = 'install.json';

const asTime = (value) => {
    if (!value) return null;
    const s = String(value);
    // SQLite dates are UTC without a zone
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
};

function readFile(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')) || {}; } catch { return {}; }
}
function writeFile(dir, data) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, FILE), JSON.stringify(data)); } catch { /* read-only folder: dates from the data */ }
}

/** The oldest date found in the shop's data (or null for a new shop). */
function oldestData(api) {
    let oldest = null;
    for (const sql of [
        "SELECT value AS d FROM settings WHERE key = 'installed_at'",
        'SELECT MIN(created_at) AS d FROM sales',
        'SELECT MIN(created_at) AS d FROM products',
        'SELECT MIN(created_at) AS d FROM employees',
    ]) {
        let raw = null;
        try { raw = api.get(sql)?.d; } catch { raw = null; }
        if (typeof raw === 'string' && raw.startsWith('"')) { try { raw = JSON.parse(raw); } catch { /* as is */ } }
        const time = asTime(raw);
        if (time !== null && (oldest === null || time < oldest)) oldest = time;
    }
    return oldest;
}

function addMonths(time, months) {
    const d = new Date(time);
    d.setMonth(d.getMonth() + months);
    return d.getTime();
}

/**
 * Work out the install date and the clock (pure apart from install.json).
 * @param {string} dir data folder
 * @param {object} api the shop's own database (never the demo's)
 * @returns {{ installedAt: number, now: number, clockBack: boolean }}
 */
function refresh(dir, api, now = Date.now()) {
    const saved = readFile(dir);
    const candidates = [asTime(saved.installedAt), oldestData(api), now].filter(t => t !== null);
    const installedAt = Math.min(...candidates);
    const lastSeen = asTime(saved.lastSeen) || now;
    // Clock put back more than a day: use the latest date seen
    const clockBack = now < lastSeen - DAY;
    const effective = Math.max(now, lastSeen);
    writeFile(dir, { installedAt: new Date(installedAt).toISOString(), lastSeen: new Date(effective).toISOString() });
    // Kept with the shop's data too (so a restored backup keeps it)
    try {
        if (!api.get("SELECT 1 AS ok FROM settings WHERE key = 'installed_at'")) {
            api.run("INSERT INTO settings (key, value) VALUES ('installed_at', ?)", [JSON.stringify(new Date(installedAt).toISOString())]);
        }
    } catch { /* settings table missing: file only */ }
    return { installedAt, now: effective, clockBack };
}

/** What is still offered, for the screens and the checks. */
function status({ installedAt, now }) {
    const demoEnds = addMonths(installedAt, DEMO_MONTHS);
    const left = (end) => Math.max(0, Math.ceil((end - now) / DAY));
    return {
        installedAt: new Date(installedAt).toISOString(),
        demo: { available: now < demoEnds, endsAt: new Date(demoEnds).toISOString(), daysLeft: left(demoEnds) },
    };
}

module.exports = { refresh, status, oldestData, DEMO_MONTHS, FILE };
