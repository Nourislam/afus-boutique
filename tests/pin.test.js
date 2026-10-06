import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { applyMigrations } = require('../electron/database/migrations');
const pins = require('../electron/services/pinService');
const session = require('../electron/services/session');

const stored = (api, id) => api.get('SELECT pin FROM employees WHERE id = ?', [id]).pin;

describe('PIN security', () => {
    it('hashes a PIN (never in clear, a new salt each time) and checks it', () => {
        const a = pins.hashPin('1234');
        const b = pins.hashPin('1234');
        expect(a).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
        expect(a).not.toContain('1234');
        expect(a).not.toBe(b);
        expect(pins.verifyPin(a, '1234')).toBe(true);
        expect(pins.verifyPin(a, '1235')).toBe(false);
        expect(pins.verifyPin(a, '')).toBe(false);
        expect(pins.verifyPin(null, '1234')).toBe(false);
        expect(() => pins.hashPin('')).toThrow(/PIN_REQUIRED/);
    });

    it('the migration hashes the old PINs once, and they keep working', async () => {
        const db = await createLegacyDb();
        // An installation of the previous version: PINs in clear
        db.run("INSERT INTO employees (id, name, pin, role) VALUES ('a', 'Nadia', '0000', 'admin'), ('c', 'Amina', '1111', 'cashier')");
        const applied = applyMigrations(db);
        expect(applied).toContain('2026_10_hash_pins');
        const api = createApi(db);
        const hashA = stored(api, 'a');
        expect(pins.isHashed(hashA)).toBe(true);
        expect(pins.isHashed(stored(api, 'c'))).toBe(true);
        // Runs only once
        expect(applyMigrations(db)).toEqual([]);
        expect(stored(api, 'a')).toBe(hashA);
        // Same PINs, nothing to change for the employees
        expect(pins.checkEmployeePin(api, 'a', '0000')).toEqual({ id: 'a', name: 'Nadia', role: 'admin' });
        expect(pins.checkEmployeePin(api, 'c', '1111')).toMatchObject({ role: 'cashier' });
        expect(pins.checkEmployeePin(api, 'c', '0000')).toBeNull();
    });

    it('an old user still in clear (e.g. a restored backup) is upgraded at the first right login', async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        const api = createApi(db);
        api.run("INSERT INTO employees (id, name, pin, role) VALUES ('old', 'Karim', '4321', 'manager')");
        expect(pins.checkEmployeePin(api, 'old', '9999')).toBeNull();
        expect(stored(api, 'old')).toBe('4321'); // a wrong PIN changes nothing
        expect(pins.checkEmployeePin(api, 'old', '4321')).toMatchObject({ id: 'old' });
        expect(pins.isHashed(stored(api, 'old'))).toBe(true);
        expect(pins.checkEmployeePin(api, 'old', '4321')).toMatchObject({ id: 'old' });
    });

    it('a new user, a PIN change and an inactive employee', async () => {
        const db = await createLegacyDb();
        applyMigrations(db);
        const api = createApi(db);
        api.run("INSERT INTO employees (id, name, pin, role) VALUES ('n', 'Sara', ?, 'cashier')", [pins.hashPin('2468')]);
        expect(pins.checkEmployeePin(api, 'n', '2468')).toMatchObject({ id: 'n' });
        expect(pins.checkEmployeePin(api, 'n', '2469')).toBeNull();
        // Changed by the owner
        api.run('UPDATE employees SET pin = ? WHERE id = ?', [pins.hashPin('1357'), 'n']);
        expect(pins.checkEmployeePin(api, 'n', '2468')).toBeNull();
        expect(pins.checkEmployeePin(api, 'n', '1357')).toMatchObject({ id: 'n' });
        api.run('UPDATE employees SET is_active = 0 WHERE id = ?', ['n']);
        expect(pins.checkEmployeePin(api, 'n', '1357')).toBeNull();
        expect(pins.checkEmployeePin(api, 'nobody', '1357')).toBeNull();
    });

    it('the main process session: set by a right PIN, cleared at logout', () => {
        session.clear();
        expect(session.getEmployee()).toBeNull();
        session.setEmployee({ id: 'x', name: 'X', role: 'Manager' });
        expect(session.getEmployee()).toEqual({ id: 'x', name: 'X', role: 'manager' });
        expect(session.isManager()).toBe(true);
        expect(session.isManager({ role: 'cashier' })).toBe(false);
        session.clear();
        expect(session.isManager()).toBe(false);
    });
});
