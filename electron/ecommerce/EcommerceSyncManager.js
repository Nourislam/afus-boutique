/**
 * EcommerceSyncManager - Central orchestrator for e-commerce inventory sync
 * 
 * Manages connections to Shopify, WooCommerce, and Etsy.
 * Coordinates two-way inventory synchronization.
 * Handles conflict resolution (newest wins by default).
 */

const { v4: uuid } = require('uuid');

// Adapters
const ShopifyAdapter = require('./adapters/ShopifyAdapter');
const WooCommerceAdapter = require('./adapters/WooCommerceAdapter');

/**
 * What went wrong with the online store, said so the shop can act on it
 * ("CODE|{}", shown in the screen's language). The detail stays in the log.
 */
function friendlyError(message) {
    const text = String(message || '');
    if (/^[A-Z][A-Z0-9_]+\|/.test(text)) return text;
    if (/invalid url|ERR_INVALID_URL/i.test(text)) return 'ECOM_BAD_URL|{}';
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket/i.test(text)) return 'ECOM_OFFLINE|{}';
    if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid api key|access token/i.test(text)) return 'ECOM_AUTH|{}';
    console.error('Online store error:', text);
    return 'ECOM_FAILED|{}';
}

const DEFAULT_ADAPTERS = { shopify: ShopifyAdapter, woocommerce: WooCommerceAdapter };

class EcommerceSyncManager {
    /**
     * deps (all optional, for tests): store { runQuery, runInsert }, ipcMain,
     * adapters { platform: AdapterClass }, isEnabled () => boolean.
     */
    constructor(deps = {}) {
        this.deps = deps;
        this.adapters = new Map(); // connection_id -> adapter instance
        this.syncInterval = null;
        this.isSyncing = false;
        this.ready = false; // true once init() ran, i.e. after the database is open
        this.ipcRegistered = false;
        this.mainWindow = null;
    }

    /** Database helpers (the shared local database unless a test gives its own). */
    store() {
        return this.deps.store || require('../database/init');
    }

    ipc() {
        return this.deps.ipcMain || require('electron').ipcMain;
    }

    /** Is the online store module turned on in Settings › Modules? */
    isEnabled() {
        return this.deps.isEnabled ? !!this.deps.isEnabled() : true;
    }

    /**
     * Start the manager. Must be called once the database is open (it reads
     * the saved connections). The window comes later through setWindow().
     */
    init({ mainWindow = null, isEnabled } = {}) {
        this.mainWindow = mainWindow;
        if (isEnabled) this.deps = { ...this.deps, isEnabled };
        this.ready = true;
        this.registerIpcHandlers();
        this.startWebhookListener();
        this.loadConnections();
        this.refreshSchedule();
        console.log('[ECOMMERCE] Sync Manager initialized');
    }

    /** The window that receives the sync status messages (null when it closes). */
    setWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }

    /**
     * Load active connections from database and create adapters. A connection
     * that cannot be loaded is skipped: the others keep working.
     * @returns {{ loaded: number, failed: string[] }}
     */
    loadConnections() {
        const result = { loaded: 0, failed: [] };
        if (!this.ready) return result;

        let connections = [];
        try {
            const { runQuery } = this.store();
            connections = runQuery('SELECT * FROM ecommerce_connections WHERE is_active = 1');
        } catch (error) {
            console.error('[ECOMMERCE] Failed to load connections:', error.message);
            return result;
        }

        this.adapters.clear();
        for (const conn of connections) {
            try {
                if (this.createAdapter(conn)) result.loaded++;
                else result.failed.push(conn.id);
            } catch (error) {
                result.failed.push(conn.id);
                console.error(`[ECOMMERCE] Connection ${conn.id} could not be loaded:`, error.message);
            }
        }

        console.log(`[ECOMMERCE] Loaded ${result.loaded} active connections${result.failed.length ? `, ${result.failed.length} skipped` : ''}`);
        return result;
    }

    /**
     * Create an adapter instance for a connection
     */
    createAdapter(connection) {
        const Adapter = (this.deps.adapters || DEFAULT_ADAPTERS)[connection.platform];
        if (!Adapter) {
            console.warn(`[ECOMMERCE] Unknown platform: ${connection.platform}`);
            return null;
        }
        const adapter = new Adapter(connection);
        this.adapters.set(connection.id, adapter);
        return adapter;
    }

    /**
     * Scheduled sync: only once the manager is ready, the module is on and at
     * least one connection has sync turned on (shortest interval of them).
     */
    refreshSchedule() {
        this.stopScheduledSync();
        if (!this.ready || !this.isEnabled()) return false;
        let connections = [];
        try {
            connections = this.getConnections().filter(c => c.is_active && c.sync_enabled && this.adapters.has(c.id));
        } catch {
            return false;
        }
        if (connections.length === 0) return false;
        const minutes = Math.min(...connections.map(c => Number(c.sync_interval_minutes) || 15));
        return this.startScheduledSync(Math.max(1, minutes));
    }

    /**
     * Register IPC handlers for renderer communication
     */
    registerIpcHandlers() {
        if (this.ipcRegistered) return;
        this.ipcRegistered = true;
        const ipcMain = this.ipc();
        // Get all connections
        ipcMain.handle('ecommerce:getConnections', async () => {
            return this.getConnections();
        });

        // Add new connection
        ipcMain.handle('ecommerce:addConnection', async (_, connection) => {
            return this.addConnection(connection);
        });

        // Test connection
        ipcMain.handle('ecommerce:testConnection', async (_, connectionId) => {
            return this.testConnection(connectionId);
        });

        // Remove connection
        ipcMain.handle('ecommerce:removeConnection', async (_, connectionId) => {
            return this.removeConnection(connectionId);
        });

        // Trigger manual sync
        ipcMain.handle('ecommerce:sync', async (_, connectionId) => {
            return this.syncConnection(connectionId);
        });

        // Sync all connections
        ipcMain.handle('ecommerce:syncAll', async () => {
            return this.syncAll();
        });

        // Get product mappings
        ipcMain.handle('ecommerce:getMappings', async (_, connectionId) => {
            return this.getMappings(connectionId);
        });

        // Auto-map products by SKU
        ipcMain.handle('ecommerce:autoMapProducts', async (_, connectionId) => {
            return this.autoMapProducts(connectionId);
        });

        // Create manual mapping
        ipcMain.handle('ecommerce:createMapping', async (_, mapping) => {
            return this.createMapping(mapping);
        });

        // Delete mapping
        ipcMain.handle('ecommerce:deleteMapping', async (_, mappingId) => {
            return this.deleteMapping(mappingId);
        });

        // Get sync logs
        ipcMain.handle('ecommerce:getSyncLogs', async (_, connectionId, limit = 50) => {
            return this.getSyncLogs(connectionId, limit);
        });

        // Get unmapped products
        ipcMain.handle('ecommerce:getUnmappedProducts', async (_, connectionId) => {
            return this.getUnmappedProducts(connectionId);
        });

        // Start OAuth flow for Etsy
        ipcMain.handle('ecommerce:oauth:start', async (_, platform, apiKey) => {
            if (platform === 'etsy') {
                return this.startEtsyOAuth(apiKey);
            }
            throw new Error('OAuth not required for this platform');
        });

        // Complete OAuth flow
        ipcMain.handle('ecommerce:oauth:complete', async (_, code, state, codeVerifier) => {
            return this.completeEtsyOAuth(code, state, codeVerifier);
        });

        console.log('[ECOMMERCE] IPC handlers registered');
    }

    // ==========================================
    // Connection Management
    // ==========================================

    /**
     * Get all connections
     */
    getConnections() {
        const { runQuery } = this.store();
        return runQuery('SELECT * FROM ecommerce_connections ORDER BY created_at DESC');
    }

    /**
     * Add a new connection
     */
    async addConnection(connectionData) {
        const { runInsert, runQuery } = this.store();
        
        const id = uuid();
        const connection = {
            id,
            platform: connectionData.platform,
            store_name: connectionData.storeName || null,
            store_url: connectionData.storeUrl,
            api_key: connectionData.apiKey || null,
            api_secret: connectionData.apiSecret || null,
            access_token: connectionData.accessToken || null,
            refresh_token: connectionData.refreshToken || null,
            token_expires_at: connectionData.tokenExpiresAt || null,
            shop_id: connectionData.shopId || null,
            location_id: connectionData.locationId || null,
            is_active: 1,
            sync_enabled: 1,
            sync_interval_minutes: connectionData.syncInterval || 15
        };

        runInsert(`
            INSERT INTO ecommerce_connections 
            (id, platform, store_name, store_url, api_key, api_secret, access_token, 
             refresh_token, token_expires_at, shop_id, location_id, is_active, 
             sync_enabled, sync_interval_minutes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            connection.id, connection.platform, connection.store_name, connection.store_url,
            connection.api_key, connection.api_secret, connection.access_token,
            connection.refresh_token, connection.token_expires_at, connection.shop_id,
            connection.location_id, connection.is_active, connection.sync_enabled,
            connection.sync_interval_minutes
        ]);

        // Create adapter
        const fullConnection = runQuery('SELECT * FROM ecommerce_connections WHERE id = ?', [id])[0];
        this.createAdapter(fullConnection);

        // Test the connection
        const testResult = await this.testConnection(id);
        
        // Update store name if we got it from the test
        if (testResult.success && testResult.details?.shopName) {
            runInsert('UPDATE ecommerce_connections SET store_name = ? WHERE id = ?', 
                [testResult.details.shopName, id]);
        }

        this.refreshSchedule();
        return { success: true, connectionId: id, testResult };
    }

    /**
     * Test a connection
     */
    async testConnection(connectionId) {
        const adapter = this.adapters.get(connectionId);
        if (!adapter) {
            return { success: false, message: 'Connection not found' };
        }

        try {
            const result = await adapter.testConnection();
            return result && result.success === false ? { ...result, message: friendlyError(result.message) } : result;
        } catch (error) {
            return { success: false, message: friendlyError(error.message) };
        }
    }

    /**
     * Remove a connection
     */
    removeConnection(connectionId) {
        const { runInsert } = this.store();
        
        // Remove mappings first
        runInsert('DELETE FROM ecommerce_product_mappings WHERE connection_id = ?', [connectionId]);
        
        // Remove sync logs
        runInsert('DELETE FROM ecommerce_sync_logs WHERE connection_id = ?', [connectionId]);
        
        // Remove connection
        runInsert('DELETE FROM ecommerce_connections WHERE id = ?', [connectionId]);
        
        // Remove adapter
        this.adapters.delete(connectionId);
        this.refreshSchedule();

        return { success: true };
    }

    // ==========================================
    // Product Mapping
    // ==========================================

    /**
     * Get mappings for a connection
     */
    getMappings(connectionId) {
        const { runQuery } = this.store();
        return runQuery(`
            SELECT m.*, p.name as product_name, p.sku as local_sku, p.stock_quantity as local_quantity
            FROM ecommerce_product_mappings m
            JOIN products p ON m.product_id = p.id
            WHERE m.connection_id = ?
            ORDER BY p.name
        `, [connectionId]);
    }

    /**
     * Auto-map products by matching SKUs
     */
    async autoMapProducts(connectionId) {
        const adapter = this.adapters.get(connectionId);
        if (!adapter) {
            return { success: false, message: 'Connection not found' };
        }

        const { runQuery, runInsert } = this.store();
        
        // Get all local products with SKUs
        const localProducts = runQuery('SELECT id, sku, name FROM products WHERE sku IS NOT NULL AND sku != ""');
        
        // Get existing mappings for this connection
        const existingMappings = runQuery(
            'SELECT product_id FROM ecommerce_product_mappings WHERE connection_id = ?',
            [connectionId]
        );
        const mappedProductIds = new Set(existingMappings.map(m => m.product_id));

        const results = { mapped: 0, skipped: 0, notFound: 0, errors: [] };

        for (const product of localProducts) {
            // Skip if already mapped
            if (mappedProductIds.has(product.id)) {
                results.skipped++;
                continue;
            }

            try {
                const found = await adapter.findProductBySku(product.sku);
                
                if (found.found) {
                    // Create mapping
                    const mappingId = uuid();
                    runInsert(`
                        INSERT INTO ecommerce_product_mappings 
                        (id, product_id, connection_id, remote_product_id, remote_variant_id, 
                         remote_sku, remote_inventory_item_id, sync_status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')
                    `, [
                        mappingId, product.id, connectionId,
                        found.product.remoteProductId,
                        found.product.remoteVariantId || null,
                        found.product.remoteSku,
                        found.product.remoteInventoryItemId || null
                    ]);
                    results.mapped++;
                } else {
                    results.notFound++;
                }
            } catch (error) {
                results.errors.push({ sku: product.sku, error: error.message });
            }
        }

        return { success: true, results };
    }

    /**
     * Create a manual mapping
     */
    createMapping(mapping) {
        const { runInsert } = this.store();
        
        const id = uuid();
        runInsert(`
            INSERT INTO ecommerce_product_mappings 
            (id, product_id, connection_id, remote_product_id, remote_variant_id, 
             remote_sku, remote_inventory_item_id, sync_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_push')
        `, [
            id, mapping.productId, mapping.connectionId,
            mapping.remoteProductId, mapping.remoteVariantId || null,
            mapping.remoteSku || null, mapping.remoteInventoryItemId || null
        ]);

        return { success: true, mappingId: id };
    }

    /**
     * Delete a mapping
     */
    deleteMapping(mappingId) {
        const { runInsert } = this.store();
        runInsert('DELETE FROM ecommerce_product_mappings WHERE id = ?', [mappingId]);
        return { success: true };
    }

    /**
     * Get products that aren't mapped yet
     */
    getUnmappedProducts(connectionId) {
        const { runQuery } = this.store();
        return runQuery(`
            SELECT p.id, p.sku, p.name, p.stock_quantity
            FROM products p
            WHERE p.is_active = 1
            AND p.id NOT IN (
                SELECT product_id FROM ecommerce_product_mappings WHERE connection_id = ?
            )
            ORDER BY p.name
        `, [connectionId]);
    }

    // ==========================================
    // Synchronization
    // ==========================================

    /**
     * Sync a specific connection
     */
    async syncConnection(connectionId) {
        if (this.isSyncing) {
            return { success: false, message: 'Sync already in progress' };
        }

        const adapter = this.adapters.get(connectionId);
        if (!adapter) {
            return { success: false, message: 'Connection not found' };
        }

        this.isSyncing = true;
        const { runQuery, runInsert } = this.store();

        // Log sync start
        const logId = uuid();
        runInsert(`
            INSERT INTO ecommerce_sync_logs (id, connection_id, sync_type, trigger_type, status)
            VALUES (?, ?, 'full', 'manual', 'started')
        `, [logId, connectionId]);

        const results = {
            pulled: 0,
            pushed: 0,
            errors: [],
            conflicts: []
        };

        try {
            // Get all mappings for this connection
            const mappings = runQuery(`
                SELECT m.*, p.stock_quantity as local_quantity, p.updated_at as local_updated_at
                FROM ecommerce_product_mappings m
                JOIN products p ON m.product_id = p.id
                WHERE m.connection_id = ?
            `, [connectionId]);

            // Phase 1: Pull remote inventory
            this.broadcastStatus('Fetching remote inventory...');
            const remoteInventory = await this.fetchRemoteInventory(adapter, mappings);

            // Phase 2: Compare and resolve conflicts
            for (const mapping of mappings) {
                const remote = remoteInventory.get(mapping.remote_product_id);
                if (!remote) continue;

                const localQty = mapping.local_quantity;
                const remoteQty = remote.quantity;
                const lastLocalQty = mapping.last_local_quantity;
                const lastRemoteQty = mapping.last_remote_quantity;

                // Skip if no changes
                if (localQty === remoteQty) continue;

                // Detect conflict: both have changed since last sync
                const localChanged = lastLocalQty !== null && localQty !== lastLocalQty;
                const remoteChanged = lastRemoteQty !== null && remoteQty !== lastRemoteQty;

                if (localChanged && remoteChanged) {
                    // Conflict! Use newest wins strategy
                    results.conflicts.push({
                        productId: mapping.product_id,
                        localQty,
                        remoteQty,
                        resolution: 'newest_wins'
                    });
                    
                    // For now, prefer local changes (POS is source of truth for sales)
                    await this.pushInventoryUpdate(adapter, mapping, localQty);
                    results.pushed++;
                } else if (localChanged) {
                    // Local changed, push to remote
                    await this.pushInventoryUpdate(adapter, mapping, localQty);
                    results.pushed++;
                } else if (remoteChanged) {
                    // Remote changed, pull to local
                    this.updateLocalInventory(mapping.product_id, remoteQty);
                    results.pulled++;
                }

                // Update mapping with current quantities
                runInsert(`
                    UPDATE ecommerce_product_mappings 
                    SET last_local_quantity = ?, last_remote_quantity = ?, 
                        last_synced_at = CURRENT_TIMESTAMP, sync_status = 'synced'
                    WHERE id = ?
                `, [localQty, remoteQty, mapping.id]);
            }

            // Log success
            runInsert(`
                UPDATE ecommerce_sync_logs 
                SET status = 'completed', products_pushed = ?, products_pulled = ?, 
                    errors_count = ?, completed_at = CURRENT_TIMESTAMP,
                    details = ?
                WHERE id = ?
            `, [results.pushed, results.pulled, results.errors.length, JSON.stringify(results), logId]);

            // Update connection last sync time
            runInsert(`
                UPDATE ecommerce_connections 
                SET last_sync_at = CURRENT_TIMESTAMP, last_sync_status = 'success'
                WHERE id = ?
            `, [connectionId]);

            this.broadcastStatus('Sync completed successfully');

        } catch (error) {
            results.errors.push({ phase: 'sync', error: error.message });
            
            runInsert(`
                UPDATE ecommerce_sync_logs 
                SET status = 'failed', errors_count = ?, completed_at = CURRENT_TIMESTAMP,
                    details = ?
                WHERE id = ?
            `, [1, JSON.stringify({ error: error.message }), logId]);

            runInsert(`
                UPDATE ecommerce_connections SET last_sync_status = 'error' WHERE id = ?
            `, [connectionId]);
        }

        this.isSyncing = false;
        return { success: results.errors.length === 0, results };
    }

    /**
     * Sync all active connections
     */
    async syncAll() {
        const connections = this.getConnections().filter(c => c.sync_enabled);
        const results = [];

        for (const conn of connections) {
            try {
                const result = await this.syncConnection(conn.id);
                results.push({ connectionId: conn.id, platform: conn.platform, ...result });
            } catch (error) {
                this.isSyncing = false;
                results.push({ connectionId: conn.id, platform: conn.platform, success: false, message: error.message });
            }
        }

        return results;
    }

    /**
     * Fetch remote inventory for all mapped products
     */
    async fetchRemoteInventory(adapter, mappings) {
        const inventory = new Map();
        
        // Collect inventory item IDs
        const inventoryItemIds = mappings
            .filter(m => m.remote_inventory_item_id)
            .map(m => m.remote_inventory_item_id);

        if (adapter.platform === 'shopify' && inventoryItemIds.length > 0) {
            const levels = await adapter.fetchInventory(inventoryItemIds);
            levels.forEach(level => {
                inventory.set(level.inventoryItemId, { quantity: level.quantity });
            });
        } else {
            // For WooCommerce/Etsy, fetch individually or use cached product data
            for (const mapping of mappings) {
                try {
                    const result = await adapter.fetchInventory([
                        mapping.remote_variant_id 
                            ? `${mapping.remote_product_id}:${mapping.remote_variant_id}`
                            : mapping.remote_product_id
                    ]);
                    if (result.length > 0) {
                        inventory.set(mapping.remote_product_id, { quantity: result[0].quantity });
                    }
                } catch (error) {
                    console.error(`[ECOMMERCE] Failed to fetch inventory for ${mapping.remote_product_id}:`, error.message);
                }
            }
        }

        return inventory;
    }

    /**
     * Push inventory update to remote platform
     */
    async pushInventoryUpdate(adapter, mapping, quantity) {
        const update = {
            productId: mapping.remote_product_id,
            variantId: mapping.remote_variant_id,
            inventoryItemId: mapping.remote_inventory_item_id,
            listingId: mapping.remote_product_id, // For Etsy
            offeringId: mapping.remote_variant_id, // For Etsy
            quantity
        };

        return adapter.updateInventory([update]);
    }

    /**
     * Update local inventory
     */
    updateLocalInventory(productId, newQuantity) {
        const { runQuery, runInsert } = this.store();
        
        // Get current quantity
        const product = runQuery('SELECT stock_quantity, name FROM products WHERE id = ?', [productId])[0];
        if (!product) return;

        const oldQuantity = product.stock_quantity;
        const difference = newQuantity - oldQuantity;

        // Update product
        runInsert('UPDATE products SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newQuantity, productId]);

        // Log inventory change
        const logId = uuid();
        runInsert(`
            INSERT INTO inventory_logs 
            (id, product_id, type, quantity_change, quantity_before, quantity_after, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            logId, productId, 
            difference > 0 ? 'adjustment_in' : 'adjustment_out',
            Math.abs(difference), oldQuantity, newQuantity,
            'E-commerce sync'
        ]);
    }

    /**
     * Get sync logs for a connection
     */
    getSyncLogs(connectionId, limit = 50) {
        const { runQuery } = this.store();
        return runQuery(`
            SELECT * FROM ecommerce_sync_logs 
            WHERE connection_id = ? 
            ORDER BY started_at DESC 
            LIMIT ?
        `, [connectionId, limit]);
    }

    // ==========================================
    // OAuth (Etsy)
    // ==========================================

    /**
     * Start Etsy OAuth flow
     * TODO: Implement when EtsyAdapter is ready
     */
    startEtsyOAuth(/* apiKey */) {
        throw new Error('Etsy integration is not yet implemented');
    }

    /**
     * Complete Etsy OAuth flow
     * TODO: Implement when EtsyAdapter is ready
     */
    async completeEtsyOAuth(/* code, state */) {
        throw new Error('Etsy integration is not yet implemented');
    }



    // ==========================================
    // Scheduled Sync
    // ==========================================

    /**
     * Start scheduled sync
     */
    startScheduledSync(intervalMinutes = 15) {
        // Never before the saved connections are loaded
        if (!this.ready) return false;
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        this.syncInterval = setInterval(() => {
            if (!this.isEnabled()) return;
            console.log('[ECOMMERCE] Running scheduled sync...');
            this.syncAll().catch(error => console.error('[ECOMMERCE] Scheduled sync failed:', error.message));
        }, intervalMinutes * 60 * 1000);

        console.log(`[ECOMMERCE] Scheduled sync started (every ${intervalMinutes} minutes)`);
        return true;
    }

    /**
     * Stop scheduled sync
     */
    stopScheduledSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('[ECOMMERCE] Scheduled sync stopped');
        }
    }

    /**
     * Broadcast sync status to renderer
     */
    broadcastStatus(message) {
        if (this.mainWindow && !this.mainWindow.isDestroyed?.()) {
            this.mainWindow.webContents.send('ecommerce:syncStatus', message);
        }
    }

    /**
     * Handle local stock change - trigger push to connected platforms
     */
    async onLocalStockChange(productId, newQuantity) {
        const { runQuery } = this.store();
        
        // Get all mappings for this product
        const mappings = runQuery(`
            SELECT m.*, c.platform 
            FROM ecommerce_product_mappings m
            JOIN ecommerce_connections c ON m.connection_id = c.id
            WHERE m.product_id = ? AND c.sync_enabled = 1
        `, [productId]);

        for (const mapping of mappings) {
            const adapter = this.adapters.get(mapping.connection_id);
            if (adapter) {
                try {
                    await this.pushInventoryUpdate(adapter, mapping, newQuantity);
                    console.log(`[ECOMMERCE] Pushed stock update for ${productId} to ${mapping.platform}`);
                } catch (error) {
                    console.error(`[ECOMMERCE] Failed to push to ${mapping.platform}:`, error.message);
                }
            }
        }
    }

    // ==========================================
    // Webhook Event Listener
    // ==========================================

    /**
     * Accept webhook events from the connected online store (passed in through IPC)
     * These events are pushed by the website API routes when e-commerce
     * platforms send inventory update webhooks
     */
    startWebhookListener() {
        // The listener runs in the renderer and calls back to main via IPC
        if (this.webhookRegistered) return;
        this.webhookRegistered = true;
        this.ipc().handle('ecommerce:webhookEvent', async (_, event) => {
            return this.processWebhookEvent(event);
        });

        console.log('[ECOMMERCE] Webhook event handler registered');
    }

    /**
     * Process an incoming webhook event from the connected online store
     */
    async processWebhookEvent(event) {
        const { runQuery, runInsert } = this.store();

        console.log(`[ECOMMERCE] Processing webhook event: ${event.platform} ${event.type}`);

        try {
            // Find the connection for this platform
            let mapping = null;

            if (event.platform === 'shopify' && event.inventoryItemId) {
                // Find mapping by inventory item ID
                mapping = runQuery(`
                    SELECT m.*, c.id as connection_id 
                    FROM ecommerce_product_mappings m
                    JOIN ecommerce_connections c ON m.connection_id = c.id
                    WHERE c.platform = 'shopify' AND m.remote_inventory_item_id = ?
                `, [event.inventoryItemId])[0];
            } else if (event.platform === 'woocommerce' && event.productId) {
                // Find mapping by product ID
                mapping = runQuery(`
                    SELECT m.*, c.id as connection_id 
                    FROM ecommerce_product_mappings m
                    JOIN ecommerce_connections c ON m.connection_id = c.id
                    WHERE c.platform = 'woocommerce' AND m.remote_product_id = ?
                `, [event.productId])[0];
            } else if (event.platform === 'etsy' && event.listingId) {
                // Find mapping by listing ID
                mapping = runQuery(`
                    SELECT m.*, c.id as connection_id 
                    FROM ecommerce_product_mappings m
                    JOIN ecommerce_connections c ON m.connection_id = c.id
                    WHERE c.platform = 'etsy' AND m.remote_product_id = ?
                `, [event.listingId])[0];
            }

            if (!mapping) {
                console.log('[ECOMMERCE] No mapping found for webhook event, skipping');
                return { processed: false, reason: 'no_mapping' };
            }

            // Get the new quantity from the event
            let newQuantity = null;
            if (event.platform === 'shopify') {
                newQuantity = event.available;
            } else if (event.platform === 'woocommerce') {
                newQuantity = event.stockQuantity;
            }

            if (newQuantity === null || newQuantity === undefined) {
                // For events without quantity, trigger a full sync
                console.log('[ECOMMERCE] No quantity in event, triggering sync...');
                this.syncConnection(mapping.connection_id);
                return { processed: true, action: 'triggered_sync' };
            }

            // Update local inventory
            this.updateLocalInventory(mapping.product_id, newQuantity);

            // Update mapping tracking
            runInsert(`
                UPDATE ecommerce_product_mappings 
                SET last_remote_quantity = ?, last_synced_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [newQuantity, mapping.id]);

            // Log the webhook sync
            const logId = uuid();
            runInsert(`
                INSERT INTO ecommerce_sync_logs 
                (id, connection_id, sync_type, trigger_type, status, products_pulled, completed_at, details)
                VALUES (?, ?, 'incremental', 'webhook', 'completed', 1, CURRENT_TIMESTAMP, ?)
            `, [logId, mapping.connection_id, JSON.stringify(event)]);

            console.log(`[ECOMMERCE] Webhook: Updated ${mapping.product_id} to quantity ${newQuantity}`);
            this.broadcastStatus(`Received inventory update from ${event.platform}`);

            return { processed: true, newQuantity };
        } catch (error) {
            console.error('[ECOMMERCE] Webhook processing error:', error);
            return { processed: false, error: error.message };
        }
    }
}

// Export singleton instance (the class too, for tests)
module.exports = new EcommerceSyncManager();
module.exports.EcommerceSyncManager = EcommerceSyncManager;
module.exports.friendlyError = friendlyError;
