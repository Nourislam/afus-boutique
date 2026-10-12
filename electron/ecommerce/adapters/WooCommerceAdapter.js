/**
 * WooCommerceAdapter - WooCommerce REST API Integration
 * 
 * Uses the WooCommerce REST API v3 for inventory management.
 * Documentation: https://woocommerce.github.io/woocommerce-rest-api-docs/
 * 
 * Authentication: Consumer Key + Consumer Secret (Basic Auth)
 * Rate Limits: Typically 25 requests per 30 seconds (configurable by server)
 */

const EcommerceAdapter = require('../EcommerceAdapter');

class WooCommerceAdapter extends EcommerceAdapter {
    constructor(connection) {
        super(connection);
        this.platform = 'woocommerce';
        this.consumerKey = connection?.api_key;
        this.consumerSecret = connection?.api_secret;
        this.apiVersion = 'wc/v3';
    }

    /**
     * Build the WooCommerce REST API URL
     */
    buildUrl(endpoint) {
        const baseUrl = this.storeUrl.replace(/\/$/, '');
        return `${baseUrl}/wp-json/${this.apiVersion}${endpoint}`;
    }

    /**
     * Get Basic Auth header value
     */
    getAuthHeader() {
        const credentials = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
        return `Basic ${credentials}`;
    }

    /**
     * Make authenticated request to WooCommerce API
     */
    async makeRequest(method, endpoint, body = null) {
        const url = this.buildUrl(endpoint);
        
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this.getAuthHeader(),
            },
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(body);
        }

        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(url, options);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw { 
                    message: `WooCommerce API error: ${response.status}`,
                    status: response.status,
                    errors: errorData.message || errorData.code
                };
            }

            // Get pagination info from headers
            this.totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '1');
            this.totalItems = parseInt(response.headers.get('X-WP-Total') || '0');

            return await response.json();
        } catch (error) {
            this.log(`Request failed: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Test connection to WooCommerce store
     */
    async testConnection() {
        try {
            // Use system status endpoint to verify connection
            const data = await this.makeRequest('GET', '/system_status');
            return {
                success: true,
                message: `Connected to WooCommerce store`,
                details: {
                    wcVersion: data.environment?.version,
                    wpVersion: data.environment?.wp_version,
                    currency: data.settings?.currency,
                    storeUrl: this.storeUrl
                }
            };
        } catch (error) {
            // Fallback: try products endpoint
            try {
                await this.makeRequest('GET', '/products?per_page=1');
                return {
                    success: true,
                    message: 'Connected to WooCommerce store',
                    details: { storeUrl: this.storeUrl }
                };
            } catch {
                return {
                    success: false,
                    message: error.message || 'Failed to connect to WooCommerce',
                    details: this.parseError(error)
                };
            }
        }
    }

    /**
     * Get shop information
     */
    async getShopInfo() {
        try {
            const data = await this.makeRequest('GET', '/system_status');
            return {
                name: data.settings?.store_name || 'WooCommerce Store',
                domain: this.storeUrl,
                currency: data.settings?.currency || 'USD'
            };
        } catch {
            return {
                name: 'WooCommerce Store',
                domain: this.storeUrl,
                currency: 'USD'
            };
        }
    }

    /**
     * Fetch products with pagination
     */
    async fetchProducts(cursor = null) {
        const page = cursor ? parseInt(cursor) : 1;
        const perPage = 50;
        
        const products = await this.makeRequest('GET', `/products?page=${page}&per_page=${perPage}&status=publish`);
        
        // Map to standardized format
        const mappedProducts = [];
        for (const product of products) {
            if (product.type === 'simple') {
                // Simple product
                mappedProducts.push({
                    remoteProductId: product.id.toString(),
                    remoteVariantId: null,
                    remoteSku: product.sku,
                    title: product.name,
                    variantTitle: null,
                    price: parseFloat(product.price) || 0,
                    quantity: product.manage_stock ? (product.stock_quantity || 0) : null,
                    manageStock: product.manage_stock
                });
            } else if (product.type === 'variable') {
                // Variable product - need to fetch variations
                const variations = await this.makeRequest('GET', `/products/${product.id}/variations?per_page=100`);
                for (const variant of variations) {
                    mappedProducts.push({
                        remoteProductId: product.id.toString(),
                        remoteVariantId: variant.id.toString(),
                        remoteSku: variant.sku,
                        title: product.name,
                        variantTitle: variant.attributes?.map(a => a.option).join(' / '),
                        price: parseFloat(variant.price) || 0,
                        quantity: variant.manage_stock ? (variant.stock_quantity || 0) : null,
                        manageStock: variant.manage_stock
                    });
                }
            }
        }

        return {
            products: mappedProducts,
            nextCursor: page < this.totalPages ? (page + 1).toString() : null,
            hasMore: page < this.totalPages
        };
    }

    /**
     * Fetch inventory levels for products
     */
    async fetchInventory(productIds) {
        const results = [];
        
        // Every product asked (one request each)
        for (const id of productIds) {
            try {
                const [productId, variantId] = id.split(':');
                
                let product;
                if (variantId) {
                    product = await this.makeRequest('GET', `/products/${productId}/variations/${variantId}`);
                } else {
                    product = await this.makeRequest('GET', `/products/${productId}`);
                }

                results.push({
                    productId: productId,
                    variantId: variantId || null,
                    quantity: product.stock_quantity || 0,
                    manageStock: product.manage_stock
                });
            } catch (error) {
                this.log(`Failed to fetch inventory for ${id}: ${error.message}`, 'error');
            }
        }

        return results;
    }

    /**
     * Update inventory levels
     */
    async updateInventory(updates) {
        const results = { success: true, updated: 0, errors: [] };

        // Group updates by product for batch processing
        const simpleUpdates = updates.filter(u => !u.variantId);
        const variationUpdates = updates.filter(u => u.variantId);

        // Batch update simple products
        if (simpleUpdates.length > 0) {
            try {
                const batchPayload = {
                    update: simpleUpdates.map(u => ({
                        id: parseInt(u.productId),
                        stock_quantity: u.quantity,
                        manage_stock: true
                    }))
                };
                
                const response = await this.makeRequest('POST', '/products/batch', batchPayload);
                results.updated += (response.update || []).length;
            } catch (error) {
                results.errors.push({
                    type: 'batch',
                    error: error.message
                });
            }
        }

        // Update variations individually (WooCommerce batch API for variations is per-product)
        for (const update of variationUpdates) {
            try {
                await this.makeRequest('PUT', `/products/${update.productId}/variations/${update.variantId}`, {
                    stock_quantity: update.quantity,
                    manage_stock: true
                });
                results.updated++;
            } catch (error) {
                results.errors.push({
                    productId: update.productId,
                    variantId: update.variantId,
                    error: error.message
                });
            }
        }

        results.success = results.errors.length === 0;
        return results;
    }

    /**
     * Find product by SKU
     */
    async findProductBySku(sku) {
        try {
            const products = await this.makeRequest('GET', `/products?sku=${encodeURIComponent(sku)}`);
            
            if (products.length > 0) {
                const product = products[0];
                return {
                    found: true,
                    product: {
                        remoteProductId: product.id.toString(),
                        remoteVariantId: null,
                        remoteSku: product.sku,
                        title: product.name,
                        price: parseFloat(product.price) || 0,
                        quantity: product.stock_quantity || 0,
                        manageStock: product.manage_stock
                    }
                };
            }

            // Also search in variations
            const allProducts = await this.makeRequest('GET', '/products?type=variable&per_page=100');
            for (const product of allProducts) {
                const variations = await this.makeRequest('GET', `/products/${product.id}/variations?per_page=100`);
                for (const variant of variations) {
                    if (variant.sku === sku) {
                        return {
                            found: true,
                            product: {
                                remoteProductId: product.id.toString(),
                                remoteVariantId: variant.id.toString(),
                                remoteSku: variant.sku,
                                title: product.name,
                                variantTitle: variant.attributes?.map(a => a.option).join(' / '),
                                price: parseFloat(variant.price) || 0,
                                quantity: variant.stock_quantity || 0,
                                manageStock: variant.manage_stock
                            }
                        };
                    }
                }
            }

            return { found: false };
        } catch (error) {
            this.log(`SKU search failed: ${error.message}`, 'error');
            return { found: false };
        }
    }
}

module.exports = WooCommerceAdapter;
