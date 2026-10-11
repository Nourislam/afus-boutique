/**
 * ShopifyAdapter - Shopify Admin API Integration
 * 
 * Uses the Shopify Admin REST API for inventory management.
 * Documentation: https://shopify.dev/docs/api/admin-rest
 * 
 * Authentication: Access Token (from private app or custom app)
 * Rate Limits: 2 requests/second with burst bucket of 40
 */

const EcommerceAdapter = require('../EcommerceAdapter');

class ShopifyAdapter extends EcommerceAdapter {
    constructor(connection) {
        super(connection);
        this.platform = 'shopify';
        this.accessToken = connection?.access_token;
        this.apiVersion = '2024-01';
        this.locationId = connection?.location_id; // Primary inventory location
    }

    /**
     * Build the Shopify Admin API URL
     */
    buildUrl(endpoint) {
        const baseUrl = this.storeUrl.replace(/\/$/, '');
        return `${baseUrl}/admin/api/${this.apiVersion}${endpoint}`;
    }

    /**
     * Make authenticated request to Shopify API
     */
    async makeRequest(method, endpoint, body = null) {
        const url = this.buildUrl(endpoint);
        
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': this.accessToken,
            },
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(body);
        }

        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(url, options);
            
            // Next page of a list (Shopify paginates with a Link header)
            this.lastLink = response.headers.get('link') || response.headers.get('Link') || '';
            // Track rate limits
            this.rateLimitRemaining = parseInt(response.headers.get('X-Shopify-Shop-Api-Call-Limit')?.split('/')[0] || '40');
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw { 
                    message: `Shopify API error: ${response.status}`,
                    status: response.status,
                    errors: errorData.errors 
                };
            }

            // Handle rate limiting
            if (this.rateLimitRemaining < 5) {
                await this.sleep(500); // Slow down if approaching limit
            }

            return await response.json();
        } catch (error) {
            this.log(`Request failed: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Test connection to Shopify store
     */
    async testConnection() {
        try {
            const data = await this.makeRequest('GET', '/shop.json');
            return {
                success: true,
                message: `Connected to ${data.shop.name}`,
                details: {
                    shopName: data.shop.name,
                    domain: data.shop.domain,
                    currency: data.shop.currency,
                    timezone: data.shop.timezone
                }
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to connect to Shopify',
                details: this.parseError(error)
            };
        }
    }

    /**
     * Get shop information
     */
    async getShopInfo() {
        const data = await this.makeRequest('GET', '/shop.json');
        return {
            name: data.shop.name,
            domain: data.shop.domain,
            currency: data.shop.currency
        };
    }

    /**
     * Get inventory locations (needed for inventory updates)
     */
    async getLocations() {
        const data = await this.makeRequest('GET', '/locations.json');
        return data.locations || [];
    }

    /**
     * Fetch products with pagination
     */
    async fetchProducts(cursor = null) {
        let endpoint = '/products.json?limit=50';
        if (cursor) {
            endpoint += `&page_info=${cursor}`;
        }

        const response = await this.makeRequest('GET', endpoint);
        
        // Shopify uses Link headers for pagination
        const products = response.products || [];
        
        // Map to standardized format
        const mappedProducts = [];
        for (const product of products) {
            for (const variant of (product.variants || [])) {
                mappedProducts.push({
                    remoteProductId: product.id.toString(),
                    remoteVariantId: variant.id.toString(),
                    remoteSku: variant.sku,
                    remoteInventoryItemId: variant.inventory_item_id?.toString(),
                    title: product.title,
                    variantTitle: variant.title !== 'Default Title' ? variant.title : null,
                    price: parseFloat(variant.price),
                    quantity: variant.inventory_quantity || 0
                });
            }
        }

        const nextCursor = ShopifyAdapter.nextPageInfo(this.lastLink);
        return {
            products: mappedProducts,
            nextCursor,
            hasMore: !!nextCursor
        };
    }

    /**
     * Fetch inventory levels for specific inventory items
     */
    async fetchInventory(inventoryItemIds) {
        if (!inventoryItemIds.length) return [];

        // Shopify requires location_id for inventory queries
        if (!this.locationId) {
            const locations = await this.getLocations();
            if (locations.length > 0) {
                this.locationId = locations[0].id;
            } else {
                throw new Error('No inventory locations found');
            }
        }

        // Shopify takes at most 50 items per request: every item, 50 at a time
        const levels = [];
        for (let i = 0; i < inventoryItemIds.length; i += 50) {
            const ids = inventoryItemIds.slice(i, i + 50).join(',');
            const data = await this.makeRequest('GET',
                `/inventory_levels.json?inventory_item_ids=${ids}&location_ids=${this.locationId}`
            );
            for (const level of (data.inventory_levels || [])) {
                levels.push({
                    inventoryItemId: level.inventory_item_id.toString(),
                    locationId: level.location_id.toString(),
                    quantity: level.available || 0
                });
            }
        }
        return levels;
    }

    /**
     * Update inventory levels
     */
    async updateInventory(updates) {
        if (!this.locationId) {
            const locations = await this.getLocations();
            if (locations.length > 0) {
                this.locationId = locations[0].id;
            } else {
                throw new Error('No inventory locations found');
            }
        }

        const results = { success: true, updated: 0, errors: [] };

        for (const update of updates) {
            try {
                await this.makeRequest('POST', '/inventory_levels/set.json', {
                    location_id: parseInt(this.locationId),
                    inventory_item_id: parseInt(update.inventoryItemId),
                    available: update.quantity
                });
                results.updated++;
            } catch (error) {
                results.errors.push({
                    inventoryItemId: update.inventoryItemId,
                    error: error.message
                });
            }

            // Rate limit: 2 req/sec
            await this.sleep(500);
        }

        results.success = results.errors.length === 0;
        return results;
    }

    /**
     * Find product by SKU
     */
    async findProductBySku(sku) {
        // Shopify doesn't have direct SKU search, need to search products
        const data = await this.makeRequest('GET', `/products.json?fields=id,title,variants`);
        
        for (const product of (data.products || [])) {
            for (const variant of (product.variants || [])) {
                if (variant.sku === sku) {
                    return {
                        found: true,
                        product: {
                            remoteProductId: product.id.toString(),
                            remoteVariantId: variant.id.toString(),
                            remoteSku: variant.sku,
                            remoteInventoryItemId: variant.inventory_item_id?.toString(),
                            title: product.title,
                            price: parseFloat(variant.price),
                            quantity: variant.inventory_quantity || 0
                        }
                    };
                }
            }
        }

        return { found: false };
    }

    /**
     * Sleep utility for rate limiting
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** page_info of the rel="next" link of a Shopify Link header, or null. */
    static nextPageInfo(link) {
        const next = String(link || '').split(',').find(part => /rel="?next"?/.test(part));
        const m = next && /[?&]page_info=([^&>]+)/.exec(next);
        return m ? m[1] : null;
    }
}

module.exports = ShopifyAdapter;
