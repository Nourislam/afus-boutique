/**
 * Keys of the shop's accounts (GitHub now, Cloudflare later), kept by the
 * main process only, encrypted with the system's own key store (Electron
 * safeStorage: Keychain on macOS, DPAPI on Windows, the desktop's secret
 * service on Linux).
 *
 * One file per account in <userData>/secure (never in the database, so never
 * in a backup, an exported copy or the support file; never sent to the
 * window). On Linux without a secret service Electron would fall back to a
 * fixed key ("basic_text"), which is no protection: nothing is kept then, and
 * the shop is told the connection cannot be saved on this computer.
 *
 * deps: { dir, safeStorage, allowWeak (development only), fs, platform }
 */
const path = require('path');

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const WEAK_BACKENDS = ['basic_text', 'unknown'];

function storageError() {
    const error = new Error('secure storage unavailable');
    error.reason = 'secure_storage';
    return error;
}

function createSecureStore({ dir, safeStorage, allowWeak = false, fs = require('fs'), platform = process.platform }) {
    const fileOf = (name) => {
        if (!NAME.test(String(name))) throw new Error('bad secure item name');
        return path.join(dir, `${name}.bin`);
    };

    function weakBackend() {
        if (platform !== 'linux' || typeof safeStorage?.getSelectedStorageBackend !== 'function') return false;
        try { return WEAK_BACKENDS.includes(safeStorage.getSelectedStorageBackend()); } catch { return true; }
    }

    // Development tests on a Linux without a secret service: Electron's
    // fixed-key mode must be asked for explicitly (never in the packaged program)
    let weakAsked = false;
    function askWeak() {
        if (weakAsked || !allowWeak || platform !== 'linux' || typeof safeStorage?.setUsePlainTextEncryption !== 'function') return;
        weakAsked = true;
        try { if (!safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true); } catch { /* stays unavailable */ }
    }

    /** True when a key can be kept encrypted on this computer. */
    function available() {
        askWeak();
        try {
            return !!safeStorage && safeStorage.isEncryptionAvailable() && (allowWeak || !weakBackend());
        } catch {
            return false;
        }
    }

    function set(name, text) {
        const file = fileOf(name);
        if (!available()) throw storageError();
        const encrypted = safeStorage.encryptString(String(text));
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        // Written beside, then renamed: never half a file
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, encrypted, { mode: 0o600 });
        fs.renameSync(temp, file);
    }

    /** The text kept for this account, or null (none, or no longer readable). */
    function get(name) {
        const file = fileOf(name);
        let data;
        try { data = fs.readFileSync(file); } catch { return null; }
        if (!available()) return null;
        try { return safeStorage.decryptString(data); } catch { return null; }
    }

    const has = (name) => get(name) !== null;

    function remove(name) {
        try { fs.rmSync(fileOf(name), { force: true }); } catch { /* already gone */ }
    }

    return { available, set, get, has, remove };
}

module.exports = { createSecureStore };
