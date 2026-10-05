/**
 * EcommerceAdapter - Base class for all e-commerce platform integrations
 * 
 * Each platform adapter (Shopify, WooCommerce, Etsy) extends this class
 * and implements the required methods for inventory synchronization.
 */

class EcommerceAdapter {
    constructor(connection) {
        this.connection = connection;
        this.platform = connection?.platform || 'unknown';
        this.storeUrl = connection?.store_url || '';
        this.rateLimitRemaining = null;
        this.rateLimitReset = null;
    }

    /**
     * Test the connection to the platform
     * @returns {Promise<{success: boolean, message: string, details?: object}>}
     */
    async testConnection() {
        throw new Error('testConnection() must be implemented by subclass');
    }

    /**
     * Fetch all products from the platform (paginated)
     * @param {string|null} cursor - Pagination cursor for next page
     * @returns {Promise<{products: Array, nextCursor: string|null, hasMore: boolean}>}
     */
    async fetchProducts(_cursor = null) {
        throw new Error('fetchProducts() must be implemented by subclass');
    }

    /**
     * Fetch inventory levels for specific products
     * @param {Array<string>} productIds - Remote product IDs
     * @returns {Promise<Array<{productId: string, variantId?: string, quantity: number}>>}
     */
    async fetchInventory(_productIds) {
        throw new Error('fetchInventory() must be implemented by subclass');
    }

    /**
     * Update inventory levels on the platform
     * @param {Array<{productId: string, variantId?: string, quantity: number, inventoryItemId?: string}>} updates
     * @returns {Promise<{success: boolean, updated: number, errors: Array}>}
     */
    async updateInventory(_updates) {
        throw new Error('updateInventory() must be implemented by subclass');
    }

    /**
     * Search for a product by SKU
     * @param {string} sku - Product SKU to search for
     * @returns {Promise<{found: boolean, product?: object}>}
     */
    async findProductBySku(_sku) {
        throw new Error('findProductBySku() must be implemented by subclass');
    }

    /**
     * Get shop/store information
     * @returns {Promise<{name: string, domain: string, currency: string}>}
     */
    async getShopInfo() {
        throw new Error('getShopInfo() must be implemented by subclass');
    }

    /**
     * Refresh OAuth token if needed (for platforms using OAuth)
     * @returns {Promise<{refreshed: boolean, accessToken?: string, expiresAt?: Date}>}
     */
    async refreshToken() {
        // Default: no-op for platforms using API keys
        return { refreshed: false };
    }

    // ==========================================
    // Utility Methods
    // ==========================================

    /**
     * Make an authenticated HTTP request to the platform API
     * @protected
     */
    async makeRequest(_method, _endpoint, _body = null, _options = {}) {
        throw new Error('makeRequest() must be implemented by subclass');
    }

    /**
     * Handle rate limiting - wait if necessary
     * @protected
     */
    async handleRateLimit(_response) {
        // Override in subclass with platform-specific rate limit handling
    }

    /**
     * Build the full API URL
     * @protected
     */
    buildUrl(endpoint) {
        return `${this.storeUrl.replace(/\/$/, '')}${endpoint}`;
    }

    /**
     * Parse API error responses
     * @protected
     */
    parseError(error, response = null) {
        return {
            message: error?.message || 'Unknown error',
            status: response?.status,
            details: error?.errors || error?.detail || null
        };
    }

    /**
     * Log a message with platform context
     * @protected
     */
    log(message, level = 'info') {
        const prefix = `[${this.platform.toUpperCase()}]`;
        if (level === 'error') {
            console.error(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }
}

module.exports = EcommerceAdapter;
