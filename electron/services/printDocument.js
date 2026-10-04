/**
 * Loading and printing generated HTML documents (receipts, labels, invoices).
 *
 * Documents are written to a temporary file and loaded with loadFile():
 * a data: URL is limited to about 2 MB by Chromium, so a batch of labels or
 * a receipt carrying the shop logo failed with ERR_INVALID_URL (-300).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TEMP_DIR = path.join(os.tmpdir(), 'afus-boutique-print');

function tempFile() {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    return path.join(TEMP_DIR, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.html`);
}

/** Load an HTML string into a window (any size). Resolves once images are loaded. */
async function loadHtml(win, html) {
    const file = tempFile();
    await fs.promises.writeFile(file, String(html), 'utf8');
    try {
        await win.loadFile(file);
    } finally {
        // The page is in memory once loaded
        fs.promises.unlink(file).catch(() => { });
    }
}

/** A hidden, sandboxed window with scripts allowed or not. */
function hiddenWindow(BrowserWindow, { javascript = true } = {}) {
    return new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript },
    });
}

/**
 * Print with webContents.print. Some printer drivers (thermal roll printers
 * on Windows in particular) refuse a custom page size: the job is then sent
 * again with the paper size set in the driver, instead of failing.
 * @returns {Promise<{ success: boolean, cancelled?: boolean, fallback?: boolean }>}
 */
function printContents(webContents, options) {
    const once = (opts) => new Promise((resolve) => {
        try {
            webContents.print(opts, (success, failureReason) => resolve({ success, failureReason }));
        } catch (error) {
            resolve({ success: false, failureReason: error.message, thrown: true });
        }
    });
    const cancelled = (reason) => /cancel/i.test(String(reason || ''));
    return once(options).then(async (first) => {
        if (first.success) return { success: true };
        if (cancelled(first.failureReason)) return { success: false, cancelled: true };
        if (/deviceName/i.test(String(first.failureReason))) throw new Error(first.failureReason);
        // Only without the dialog: with it, the user would see it twice
        if (options.pageSize && options.silent) {
            const { pageSize, ...withoutSize } = options;
            const second = await once(withoutSize);
            if (second.success) return { success: true, fallback: true };
            if (cancelled(second.failureReason)) return { success: false, cancelled: true };
            throw new Error(second.failureReason || first.failureReason || 'Printing failed');
        }
        throw new Error(first.failureReason || 'Printing failed');
    });
}

/**
 * The system name of the chosen printer. A printer saved under its display
 * name (macOS shows "EPSON TM-T20" for the queue "EPSON_TM_T20") or with a
 * different case still prints. Returns null when it is not installed.
 * @param {Array<{name: string, displayName?: string}>} installed
 */
function matchPrinter(installed, wanted) {
    if (!wanted) return '';
    const list = Array.isArray(installed) ? installed : [];
    const exact = list.find(p => p.name === wanted);
    if (exact) return exact.name;
    const norm = (v) => String(v || '').trim().toLowerCase();
    const loose = list.find(p => norm(p.name) === norm(wanted) || norm(p.displayName) === norm(wanted));
    return loose ? loose.name : null;
}

/** Remove documents left behind by a crash (called at start-up). */
function cleanTempFiles() {
    fs.promises.readdir(TEMP_DIR)
        .then(files => Promise.all(files.map(f => fs.promises.unlink(path.join(TEMP_DIR, f)).catch(() => { }))))
        .catch(() => { });
}

module.exports = { loadHtml, hiddenWindow, printContents, matchPrinter, cleanTempFiles, TEMP_DIR };
