const { getDatabase, runQuery, runInsert, getTableColumns, saveDatabase } = require('../database/init');

/**
 * SyncManager - optional cloud synchronization boundary.
 *
 * The local SQLite database is always the source of truth and the POS works
 * fully offline. This class only tracks pending local changes (is_synced = 0)
 * and hands them, in batches, to a sync transport; no transport is bundled at
 * the moment, so sync stays disabled ("local mode"). A future online store must
 * talk to a secure cloud API fed through this layer - never to the local
 * database file directly.
 *
 * To add a transport: implement it, add its id to SUPPORTED_PROVIDERS and
 * select it in the sync_settings setting.
 * 
 * Industry best practices implemented:
 * - Debounced sync (2s delay to batch changes)
 * - Delta sync (only sync since last timestamp)
 * - Batch operations (group records)
 * - Offline queue with retry
 * - Conflict resolution
 */
// Sync transports that can be enabled. None is bundled: nothing leaves the
// computer and sync stays off.
const SUPPORTED_PROVIDERS = [];

class SyncManager {
    constructor() {
        this.mainWindow = null;
        this.isSyncing = false;
        this.syncInterval = null;
        this.enabled = false; // Disabled unless a supported provider is configured
        
        // Debouncing
        this.pendingSync = null;
        this.debounceMs = 2000; // Wait 2s after last change
        
        // Offline queue
        this.offlineQueue = [];
        this.isOnline = true;
        this.retryCount = 0;
        this.maxRetries = 5;
        
        // Delta sync tracking
        this.lastSyncTimestamp = null;
        
        // Tables to sync
        this.syncTables = [
            'products', 'product_variants', 'customers', 'sales', 'employees', 'inventory_logs',
            'gift_cards', 'bundles', 'promotions',
            'categories', 'suppliers', 'purchase_orders', 'receivings', 'supplier_invoices',
            'sale_items', 'purchase_order_items', 'receiving_items',
            'credit_sales', 'credit_payments',
            'quotations', 'quotation_items',
            'returns', 'return_items', 'supplier_payments'
        ];
    }

    async init() {
        console.log('[SyncManager] Initializing...');

        // Check if sync is enabled (provider must be a supported transport)
        try {
            const providerResult = getDatabase().exec("SELECT value FROM settings WHERE key = 'sync_settings'");
            if (providerResult.length > 0) {
                const config = JSON.parse(providerResult[0].values[0][0]);
                this.enabled = SUPPORTED_PROVIDERS.includes(config.provider);
                
                if (config.interval && this.enabled) {
                    this.startAutoSync(parseInt(config.interval));
                }
                if (config.lastSyncTimestamp) {
                    this.lastSyncTimestamp = config.lastSyncTimestamp;
                }
            }
        } catch {
            console.log('[SyncManager] No sync config found, defaulting to disabled');
            this.enabled = false;
        }

        console.log(`[SyncManager] Sync ${this.enabled ? 'ENABLED' : 'DISABLED (local mode)'}`);

        // Load offline queue from database
        this.loadOfflineQueue();
    }

    setWindow(window) {
        this.mainWindow = window;
    }

    // ==========================================
    // AUTO SYNC (Interval-based)
    // ==========================================
    
    startAutoSync(minutes) {
        this.stopAutoSync();
        if (!minutes || minutes <= 0) return;

        console.log(`[SyncManager] Starting auto-sync every ${minutes} minutes`);
        this.syncInterval = setInterval(() => {
            console.log('[SyncManager] Auto-sync trigger');
            this.triggerSync();
        }, minutes * 60 * 1000);
    }

    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    async updateConfig(config) {
        // Update enabled state based on provider
        if (config.provider !== undefined) {
            this.enabled = SUPPORTED_PROVIDERS.includes(config.provider);
            console.log(`[SyncManager] Sync ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
            
            if (!this.enabled) {
                this.stopAutoSync();
            }
        }
        
        if (config.interval !== undefined && this.enabled) {
            this.startAutoSync(parseInt(config.interval));
        }
    }

    // ==========================================
    // DEBOUNCED SYNC TRIGGER
    // ==========================================

    triggerSync() {
        // Skip if sync is disabled (local mode)
        if (!this.enabled) {
            return;
        }
        
        // Debounce: Clear any pending sync and set new timer
        if (this.pendingSync) {
            clearTimeout(this.pendingSync);
        }

        this.pendingSync = setTimeout(() => {
            this.pendingSync = null;
            this.pushLocalChanges();
        }, this.debounceMs);

        console.log('[SyncManager] Sync scheduled (debounced)');
    }

    // Force immediate sync (bypass debounce)
    async forceSyncNow() {
        if (this.pendingSync) {
            clearTimeout(this.pendingSync);
            this.pendingSync = null;
        }
        return this.pushLocalChanges();
    }

    // ==========================================
    // OUTBOUND: Batched push to the sync transport
    // ==========================================

    async pushLocalChanges() {
        if (!this.mainWindow || this.isSyncing) {
            console.log('[SyncManager] Skip push: busy or no window');
            return;
        }

        this.isSyncing = true;
        this.broadcastStatus('syncing');

        const db = getDatabase();
        const batch = []; // Collect all changes into a batch

        try {
            for (const table of this.syncTables) {
                try {
                    // Delta sync: Only get unsynced records
                    const result = db.exec(`SELECT * FROM ${table} WHERE is_synced = 0`);
                    
                    if (result.length > 0) {
                        const columns = result[0].columns;
                        const rows = result[0].values;

                        for (const rowVal of rows) {
                            const record = {};
                            columns.forEach((col, i) => record[col] = rowVal[i]);
                            
                            batch.push({ table, record });
                        }
                    }
                } catch (e) {
                    // Table might not exist or have is_synced column
                    if (!e.message.includes('no such column')) {
                        console.error(`[SyncManager] Error reading ${table}:`, e.message);
                    }
                }
            }

            if (batch.length === 0) {
                console.log('[SyncManager] No pending changes');
                this.isSyncing = false;
                this.broadcastStatus('idle', { lastSync: Date.now() });
                return;
            }

            console.log(`[SyncManager] Pushing ${batch.length} records in batch`);

            // If offline, queue for later
            if (!this.isOnline) {
                this.addToOfflineQueue(batch);
                this.isSyncing = false;
                this.broadcastStatus('offline', { queued: batch.length });
                return;
            }

            // Send batch to the sync transport
            this.mainWindow.webContents.send('sync:outbound-batch', { 
                batch,
                timestamp: Date.now()
            });

            // Update last sync timestamp
            this.lastSyncTimestamp = Date.now();
            this.saveSyncConfig();

        } catch (e) {
            console.error('[SyncManager] Push error:', e);
            this.broadcastStatus('error', { error: e.message });
        } finally {
            // Don't set isSyncing to false here - wait for ACK
            setTimeout(() => {
                if (this.isSyncing) {
                    this.isSyncing = false;
                    this.broadcastStatus('idle');
                }
            }, 10000); // Timeout after 10s
        }
    }

    // ==========================================
    // INBOUND: sync transport -> SQLite
    // ==========================================

    async handleIncoming({ table, record }) {
        this.broadcastStatus('syncing', { message: 'Receiving data...' });
        console.log(`[SyncManager] Incoming ${table}: ${record.id}`);

        try {
            const tableColumns = getTableColumns(table);
            if (!tableColumns || tableColumns.length === 0) {
                console.error(`[SyncManager] Unknown table: ${table}`);
                return;
            }

            // Clean record to only valid columns
            const cleanRecord = {};
            Object.keys(record).forEach(key => {
                if (tableColumns.includes(key)) {
                    cleanRecord[key] = record[key];
                }
            });

            cleanRecord.is_synced = 1;

            if (tableColumns.includes('remote_id') && !cleanRecord.remote_id) {
                cleanRecord.remote_id = cleanRecord.id;
            }

            // Check if exists
            let existing = runQuery(`SELECT id, is_synced, updated_at FROM ${table} WHERE id = ?`, [cleanRecord.id]);

            // Smart deduplication
            if (existing.length === 0) {
                existing = this.findDuplicate(table, cleanRecord);
                if (existing.length > 0) {
                    cleanRecord.remote_id = record.id;
                    cleanRecord.id = existing[0].id;
                    console.log(`[SyncManager] Dedupe: Using local ID ${cleanRecord.id}`);
                }
            }

            if (existing.length === 0) {
                // INSERT
                const keys = Object.keys(cleanRecord);
                const placeholders = keys.map(() => '?').join(',');
                const values = keys.map(k => cleanRecord[k]);
                const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
                
                if (runInsert(sql, values)) {
                    console.log(`[SyncManager] Inserted ${table}/${cleanRecord.id}`);
                }
            } else {
                // Conflict check
                if (existing[0].is_synced === 0) {
                    console.log(`[SyncManager] CONFLICT: Skipping ${table}/${cleanRecord.id} (local pending)`);
                    return;
                }

                // UPDATE
                const keys = Object.keys(cleanRecord).filter(k => k !== 'id');
                const setClause = keys.map(k => `${k} = ?`).join(',');
                const values = keys.map(k => cleanRecord[k]);
                values.push(cleanRecord.id);
                
                const sql = `UPDATE ${table} SET ${setClause} WHERE id = ?`;
                if (runInsert(sql, values)) {
                    console.log(`[SyncManager] Updated ${table}/${cleanRecord.id}`);
                }
            }

            this.broadcastStatus('idle');

        } catch (e) {
            console.error('[SyncManager] Inbound error:', e);
            this.broadcastStatus('error', { error: e.message });
        }
    }

    // Handle batch incoming (optimized)
    async handleIncomingBatch({ batch }) {
        this.broadcastStatus('syncing', { message: `Receiving ${batch.length} records...` });
        
        for (const { table, record } of batch) {
            await this.handleIncoming({ table, record });
        }
        
        this.broadcastStatus('idle', { received: batch.length });
    }

    findDuplicate(table, record) {
        if (table === 'employees' && record.email) {
            return runQuery(`SELECT id, is_synced FROM employees WHERE email = ?`, [record.email]);
        } else if (table === 'customers' && (record.email || record.phone)) {
            return runQuery(`SELECT id, is_synced FROM customers WHERE email = ? OR phone = ?`, [record.email, record.phone]);
        } else if (table === 'products' && (record.sku || record.barcode)) {
            return runQuery(`SELECT id, is_synced FROM products WHERE sku = ? OR barcode = ?`, [record.sku, record.barcode]);
        } else if (table === 'categories' && record.name) {
            return runQuery(`SELECT id, is_synced FROM categories WHERE name = ?`, [record.name]);
        }
        return [];
    }

    // ==========================================
    // BATCH ACK: Renderer confirms batch write
    // ==========================================

    async handleBatchAck({ successful, failed, timestamp }) {
        console.log(`[SyncManager] Batch ACK: ${successful.length} ok, ${failed.length} failed`);

        // Mark successful records as synced
        for (const { table, localId, remoteId } of successful) {
            try {
                runInsert(`UPDATE ${table} SET is_synced = 1, remote_id = ? WHERE id = ?`, [remoteId, localId]);
            } catch (e) {
                console.error(`[SyncManager] ACK error for ${table}/${localId}:`, e.message);
            }
        }

        // Add failed to retry queue
        if (failed.length > 0) {
            this.addToOfflineQueue(failed.map(f => ({ table: f.table, record: f.record })));
        }

        this.isSyncing = false;
        this.retryCount = 0;
        this.broadcastStatus('idle', { 
            lastSync: timestamp,
            synced: successful.length,
            failed: failed.length
        });

        // Save database after sync
        saveDatabase();
    }

    // Legacy single ACK (backwards compatibility)
    async handleAck({ table, localId, remoteId }) {
        console.log(`[SyncManager] ACK ${table}: ${localId}`);
        runInsert(`UPDATE ${table} SET is_synced = 1, remote_id = ? WHERE id = ?`, [remoteId, localId]);
        this.broadcastStatus('idle');
    }

    // ==========================================
    // OFFLINE QUEUE
    // ==========================================

    addToOfflineQueue(items) {
        this.offlineQueue.push(...items);
        this.saveOfflineQueue();
        console.log(`[SyncManager] Queued ${items.length} items for offline retry`);
    }

    loadOfflineQueue() {
        try {
            const result = getDatabase().exec("SELECT value FROM settings WHERE key = 'sync_offline_queue'");
            if (result.length > 0 && result[0].values[0][0]) {
                this.offlineQueue = JSON.parse(result[0].values[0][0]);
                console.log(`[SyncManager] Loaded ${this.offlineQueue.length} offline items`);
            }
        } catch {
            this.offlineQueue = [];
        }
    }

    saveOfflineQueue() {
        try {
            const json = JSON.stringify(this.offlineQueue);
            runInsert(
                `INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_offline_queue', ?)`,
                [json]
            );
        } catch (e) {
            console.error('[SyncManager] Failed to save offline queue:', e);
        }
    }

    async retryOfflineQueue() {
        if (this.offlineQueue.length === 0 || !this.isOnline) return;

        console.log(`[SyncManager] Retrying ${this.offlineQueue.length} offline items`);
        const batch = [...this.offlineQueue];
        this.offlineQueue = [];
        this.saveOfflineQueue();

        this.mainWindow?.webContents.send('sync:outbound-batch', {
            batch,
            timestamp: Date.now(),
            isRetry: true
        });
    }

    setOnlineStatus(isOnline) {
        const wasOffline = !this.isOnline;
        this.isOnline = isOnline;
        
        if (isOnline && wasOffline) {
            console.log('[SyncManager] Back online - retrying queue');
            this.retryOfflineQueue();
        }
    }

    // ==========================================
    // CONFIG & STATUS
    // ==========================================

    saveSyncConfig() {
        try {
            // Read existing config first to preserve other settings (like provider, interval)
            const db = getDatabase();
            let currentConfig = {};
            const result = db.exec("SELECT value FROM settings WHERE key = 'sync_settings'");
            
            if (result.length > 0 && result[0].values[0][0]) {
                try {
                    currentConfig = JSON.parse(result[0].values[0][0]);
                } catch (e) {
                    console.error('[SyncManager] Failed to parse existing config:', e);
                }
            }

            const config = {
                ...currentConfig,
                lastSyncTimestamp: this.lastSyncTimestamp,
                provider: this.enabled ? (currentConfig.provider || 'none') : currentConfig.provider,
                interval: currentConfig.interval // Ensure interval is preserved
            };
            
            runInsert(
                `INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_settings', ?)`,
                [JSON.stringify(config)]
            );
        } catch (e) {
            console.error('[SyncManager] Failed to save config:', e);
        }
    }

    broadcastStatus(status, details = null) {
        // Throttle status updates to max once per 500ms (unless status changed)
        const now = Date.now();
        if (this.lastBroadcastStatus === status && 
            this.lastBroadcastTime && 
            now - this.lastBroadcastTime < 500) {
            return; // Skip duplicate status within 500ms
        }
        
        this.lastBroadcastStatus = status;
        this.lastBroadcastTime = now;
        
        if (this.mainWindow?.webContents) {
            this.mainWindow.webContents.send('sync:status-changed', { 
                status, 
                details, 
                enabled: this.enabled,
                timestamp: now,
                queuedItems: this.offlineQueue.length
            });
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            isSyncing: this.isSyncing,
            isOnline: this.isOnline,
            lastSync: this.lastSyncTimestamp,
            queuedItems: this.offlineQueue.length
        };
    }
}

module.exports = new SyncManager();
