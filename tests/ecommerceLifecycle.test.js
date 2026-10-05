import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { createLegacyDb, createApi } from './helpers/testDb';

const require = createRequire(import.meta.url);
const { EcommerceSyncManager } = require('../electron/ecommerce/EcommerceSyncManager');
const ECOMMERCE_SCHEMA = fs.readFileSync(path.resolve(__dirname, '../electron/database/ecommerce_schema.sql'), 'utf8');

// A store that answers, one whose credentials are rejected when the adapter is built
class WorkingAdapter {
    constructor(connection) { this.connection = connection; }
    async testConnection() { return { success: true, message: 'ok', details: { shopName: 'Boutique en ligne' } }; }
    async fetchInventory() { return []; }
}
class BrokenAdapter {
    constructor() { throw new Error('bad credentials'); }
}

/** A fresh manager on the same database: what the program does after a restart. */
function startManager(store, { isEnabled = () => true, adapters = { shopify: WorkingAdapter, woocommerce: WorkingAdapter } } = {}) {
    const handlers = {};
    const manager = new EcommerceSyncManager({
        store, adapters, isEnabled, ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    });
    return { manager, call: (channel, ...args) => handlers[channel](null, ...args), handlers };
}

describe('online store connections across restarts', () => {
    let store;
    let running = [];
    const start = (options) => { const started = startManager(store, options); running.push(started.manager); return started; };
    const saveConnection = (id, platform, extra = {}) => store.runInsert(
        'INSERT INTO ecommerce_connections (id, platform, store_url, access_token, is_active, sync_enabled, sync_interval_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, platform, `https://${id}.example`, 'token', extra.is_active ?? 1, extra.sync_enabled ?? 1, extra.sync_interval_minutes ?? 15],
    );

    beforeEach(async () => {
        const db = await createLegacyDb();
        db.exec(ECOMMERCE_SCHEMA);
        const api = createApi(db);
        store = { runQuery: (sql, params) => api.all(sql, params), runInsert: (sql, params) => api.run(sql, params) };
        running = [];
    });
    afterEach(() => { running.forEach(m => m.stopScheduledSync()); vi.useRealTimers(); });

    it('starts without any connection: nothing loaded, no scheduled sync, the screen still answers', async () => {
        const { manager, call } = start();
        manager.init();
        expect(manager.adapters.size).toBe(0);
        expect(manager.syncInterval).toBeNull();
        expect(await call('ecommerce:getConnections')).toEqual([]);
    });

    it('loads a saved connection at start and can test it (no more "Connection not found")', async () => {
        saveConnection('shop-1', 'shopify');
        const { manager, call } = start();
        manager.init();
        expect([...manager.adapters.keys()]).toEqual(['shop-1']);
        expect(await call('ecommerce:testConnection', 'shop-1')).toMatchObject({ success: true });
    });

    it('rebuilds the adapter after a restart for a connection added in the previous session', async () => {
        const first = start();
        first.manager.init();
        const added = await first.call('ecommerce:addConnection', { platform: 'woocommerce', storeUrl: 'https://store.example', apiKey: 'k', apiSecret: 's' });
        expect(added.testResult).toMatchObject({ success: true });
        first.manager.stopScheduledSync();

        const second = start(); // the program is restarted: a new manager, the same database
        second.manager.init();
        expect(second.manager.adapters.has(added.connectionId)).toBe(true);
        expect(await second.call('ecommerce:testConnection', added.connectionId)).toMatchObject({ success: true });
        // mappings and sync reach the adapter too
        expect(await second.call('ecommerce:getMappings', added.connectionId)).toEqual([]);
        expect(await second.call('ecommerce:sync', added.connectionId)).not.toMatchObject({ message: 'Connection not found' });
    });

    it('one connection that fails to load does not stop the others', async () => {
        saveConnection('good', 'shopify');
        saveConnection('broken', 'woocommerce');
        const { manager, call } = start({ adapters: { shopify: WorkingAdapter, woocommerce: BrokenAdapter } });
        manager.init();
        expect(manager.loadConnections()).toEqual({ loaded: 1, failed: ['broken'] });
        expect(await call('ecommerce:testConnection', 'good')).toMatchObject({ success: true });
        expect(await call('ecommerce:testConnection', 'broken')).toMatchObject({ success: false });
        const all = await call('ecommerce:syncAll');
        expect(all.map(r => [r.connectionId, r.success])).toEqual(expect.arrayContaining([['good', true], ['broken', false]]));
        expect(manager.isSyncing).toBe(false);
    });

    it('never starts the scheduled sync before the manager is ready, then starts it with the shortest interval', () => {
        vi.useFakeTimers();
        saveConnection('a', 'shopify', { sync_interval_minutes: 30 });
        saveConnection('b', 'shopify', { sync_interval_minutes: 10 });
        const { manager } = start();
        expect(manager.startScheduledSync(5)).toBe(false); // database not loaded yet
        expect(manager.syncInterval).toBeNull();

        const syncAll = vi.spyOn(manager, 'syncAll').mockResolvedValue([]);
        manager.init();
        expect(manager.syncInterval).not.toBeNull();
        vi.advanceTimersByTime(9 * 60 * 1000);
        expect(syncAll).not.toHaveBeenCalled();
        vi.advanceTimersByTime(60 * 1000);
        expect(syncAll).toHaveBeenCalledTimes(1);
    });

    it('keeps the scheduled sync off while the online store module is off, or when no connection syncs', () => {
        saveConnection('a', 'shopify');
        const off = start({ isEnabled: () => false });
        off.manager.init();
        expect(off.manager.syncInterval).toBeNull();
        expect(off.manager.adapters.has('a')).toBe(true); // still usable from its screen

        store.runInsert("UPDATE ecommerce_connections SET sync_enabled = 0 WHERE id = 'a'");
        const noSync = start();
        noSync.manager.init();
        expect(noSync.manager.syncInterval).toBeNull();
    });

    it('stops the scheduled sync when the last connection is removed', async () => {
        saveConnection('a', 'shopify');
        const { manager, call } = start();
        manager.init();
        expect(manager.syncInterval).not.toBeNull();
        await call('ecommerce:removeConnection', 'a');
        expect(manager.syncInterval).toBeNull();
        expect(manager.adapters.size).toBe(0);
    });
});
