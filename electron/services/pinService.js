/**
 * Employee PINs are stored hashed (scrypt, from Node's crypto: no network,
 * no extra package): "scrypt$<salt>$<hash>". PINs saved by older versions in
 * clear still work: they are checked once, then replaced by their hash.
 */
const crypto = require('crypto');

const PREFIX = 'scrypt$';
const KEY_LENGTH = 32;
// N = 2^14: about 30 ms per check on a shop computer, slow enough for guessing
const OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const isHashed = (stored) => typeof stored === 'string' && stored.startsWith(PREFIX);

function hashPin(pin) {
    const text = String(pin ?? '');
    if (!text) throw new Error('PIN_REQUIRED|{}');
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(text, salt, KEY_LENGTH, OPTIONS);
    return `${PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

function sameBytes(a, b) {
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Does the PIN typed match what is stored (hashed, or in clear for older rows)? */
function verifyPin(stored, pin) {
    if (stored === null || stored === undefined || pin === null || pin === undefined || pin === '') return false;
    if (!isHashed(stored)) return sameBytes(Buffer.from(String(stored)), Buffer.from(String(pin)));
    const [, saltHex, hashHex] = String(stored).split('$');
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), expected.length, OPTIONS);
    return sameBytes(actual, expected);
}

/**
 * The active employee whose PIN this is, or null. A PIN still stored in clear
 * is replaced by its hash on the first right login.
 */
// Wrong PINs: after 5 in a row an account waits 60 seconds (a 4-digit PIN
// cannot be tried 10 000 times in a few seconds)
const MAX_TRIES = 5;
const LOCK_MS = 60 * 1000;
const tries = new Map();

function checkEmployeePin(api, employeeId, pin, now = Date.now()) {
    const state = tries.get(employeeId);
    if (state && state.until > now) {
        const error = new Error(`PIN_LOCKED|${JSON.stringify({ seconds: Math.ceil((state.until - now) / 1000) })}`);
        throw error;
    }
    const employee = api.get('SELECT * FROM employees WHERE id = ? AND is_active = 1', [employeeId]);
    if (!employee || !verifyPin(employee.pin, pin)) {
        const count = (state && state.until <= now && state.until ? 0 : (state?.count || 0)) + 1;
        tries.set(employeeId, { count: count >= MAX_TRIES ? 0 : count, until: count >= MAX_TRIES ? now + LOCK_MS : 0 });
        return null;
    }
    tries.delete(employeeId);
    if (!isHashed(employee.pin)) {
        api.run('UPDATE employees SET pin = ? WHERE id = ?', [hashPin(pin), employee.id]);
    }
    return { id: employee.id, name: employee.name, role: employee.role };
}

const resetPinTries = () => tries.clear();

module.exports = { hashPin, verifyPin, isHashed, checkEmployeePin, resetPinTries, MAX_TRIES };
