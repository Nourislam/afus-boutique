import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ipcGuard = require('../electron/services/ipcGuard');
const session = require('../electron/services/session');

const CASHIER = { id: 'c', name: 'Samir', role: 'cashier' };
const MANAGER = { id: 'm', name: 'Karim', role: 'manager' };
const ADMIN = { id: 'a', name: 'Amina', role: 'admin' };

/** A stand-in for Electron's ipcMain: handlers are called directly. */
function fakeIpc() {
    const handlers = {};
    return { handlers, handle: (channel, fn) => { handlers[channel] = fn; } };
}
const code = async (fn) => { try { await fn(); } catch (e) { return e.message.split('|')[0]; } return null; };

/** Every channel registered with ipcMain.handle in the main process. */
function registeredChannels() {
    const files = ['electron/main.js', 'electron/ecommerce/EcommerceSyncManager.js'];
    const text = files.map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
    return new Set([...text.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(m => m[1]));
}

describe('role checks on the main process channels', () => {
    afterEach(() => session.clear());

    it('refuses a role without the permission, allows the right one', async () => {
        const ipc = fakeIpc();
        ipcGuard.install(ipc);
        ipc.handle('db:employees:create', () => 'created');
        ipc.handle('db:products:delete', () => 'deleted');
        ipc.handle('db:sales:create', () => 'sold');
        ipc.handle('db:products:getAll', () => 'list');
        ipc.handle('db:settings:set', () => true);

        expect(await code(() => ipc.handlers['db:employees:create']({}, {}))).toBe('LOGIN_REQUIRED');
        session.setEmployee(CASHIER);
        expect(await code(() => ipc.handlers['db:employees:create']({}, {}))).toBe('NO_PERMISSION');
        expect(await code(() => ipc.handlers['db:products:delete']({}, 'p1'))).toBe('NO_PERMISSION');
        expect(await ipc.handlers['db:sales:create']({}, {})).toBe('sold');
        expect(await code(() => ipc.handlers['db:settings:set']({}, { key: 'security', value: {} }))).toBe('ADMIN_REQUIRED');
        session.setEmployee(MANAGER);
        expect(await code(() => ipc.handlers['db:employees:create']({}, {}))).toBe('NO_PERMISSION');
        session.setEmployee(ADMIN);
        expect(await ipc.handlers['db:employees:create']({}, {})).toBe('created');
        expect(await ipc.handlers['db:products:delete']({}, 'p1')).toBe('deleted');
        // Reading is not checked
        session.clear();
        expect(await ipc.handlers['db:products:getAll']({})).toBe('list');
    });

    it('lets the setup wizard do everything before the shop is set up', async () => {
        const ipc = fakeIpc();
        ipcGuard.install(ipc, { isFirstSetup: () => true });
        ipc.handle('db:employees:create', () => 'created');
        expect(await ipc.handlers['db:employees:create']({}, {})).toBe('created');
    });

    it('settings: the owner\'s, except colours/sizes for a manager', () => {
        const rule = ipcGuard.RULES['db:settings:set'];
        expect(ipcGuard.allows(rule, MANAGER, { key: 'catalog_custom' })).toBe(true);
        expect(ipcGuard.allows(rule, CASHIER, { key: 'catalog_custom' })).toBe(false);
        expect(ipcGuard.allows(rule, MANAGER, { key: 'store_config' })).toBe(false);
        expect(ipcGuard.allows(rule, MANAGER, { key: 'security' })).toBe(false);
        expect(ipcGuard.allows(rule, ADMIN, { key: 'security' })).toBe(true);
        expect(ipcGuard.allows(ipcGuard.RULES['db:settings:delete'], MANAGER, 'catalog_custom')).toBe(true);
        // What a loyalty point is worth: the owner's; turning points into a voucher: a gift-card right
        expect(ipcGuard.allows(rule, MANAGER, { key: 'loyalty' })).toBe(false);
        expect(ipcGuard.allows(rule, ADMIN, { key: 'loyalty' })).toBe(true);
        expect(ipcGuard.allows(ipcGuard.RULES['loyalty:redeem'], null)).toBe(false);
    });

    it('backups are the owner\'s; stock changes need a manager', () => {
        expect(ipcGuard.allows(ipcGuard.RULES['backup:restore'], MANAGER)).toBe(false);
        expect(ipcGuard.allows(ipcGuard.RULES['backup:restore'], ADMIN)).toBe(true);
        expect(ipcGuard.allows(ipcGuard.RULES['db:products:updateStock'], CASHIER)).toBe(false);
        expect(ipcGuard.allows(ipcGuard.RULES['db:products:updateStock'], MANAGER)).toBe(true);
        expect(ipcGuard.allows(ipcGuard.RULES['db:customers:create'], CASHIER)).toBe(true);
        expect(ipcGuard.allows(ipcGuard.RULES['db:customers:updateCreditSettings'], CASHIER)).toBe(false);
    });

    it('every rule names a real channel, and every channel that writes has a rule', () => {
        const channels = registeredChannels();
        for (const channel of Object.keys(ipcGuard.RULES)) expect(channels, channel).toContain(channel);
        // Writes left open on purpose: login, the trial modes and the
        // window's own state (no shop data is changed by them)
        const open = new Set([
            'auth:logout', 'auth:approve', 'db:employees:verifyPin', 'training:start', 'training:stop',
            'demo:enter', 'demo:reset', 'demo:exit', 'app:setTheme', 'sync:set-online', 'sync:ack',
            'sync:batch-ack', 'sync:incoming', 'sync:incoming-batch', 'sync:trigger',
        ]);
        const WRITE = /^(create|update|delete|set|save|saveLogo|saveFromPath|saveProduct|remove|add|start|end|confirm|cancel|import|importProducts|restore|reset|redeem|reload|assemble|disassemble|receiveStock|updateStock|updateStatus|updateCreditSettings|incrementUse|scan|setCounted|removeLine|addExpense|regenerateQr)/;
        const writes = [...channels].filter(c => WRITE.test(c.split(':').pop()) && !c.endsWith('Pdf'));
        const missing = writes.filter(c => !ipcGuard.RULES[c] && !open.has(c));
        expect(missing).toEqual([]);
    });
});
