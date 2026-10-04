const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Operating system: 'darwin' (macOS), 'win32', 'linux'
    platform: process.platform,

    // Window controls
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),

    // Shifts
    shifts: {
        start: (data) => ipcRenderer.invoke('db:shifts:start', data),
        end: (data) => ipcRenderer.invoke('db:shifts:end', data),
        getCurrent: (employeeId) => ipcRenderer.invoke('db:shifts:getCurrent', employeeId),
        getStats: (shiftId) => ipcRenderer.invoke('db:shifts:getStats', shiftId),
        getHistory: (range) => ipcRenderer.invoke('db:shifts:getHistory', range),
    },


    // Categories
    categories: {
        getAll: () => ipcRenderer.invoke('db:categories:getAll'),
        create: (category) => ipcRenderer.invoke('db:categories:create', category),
        update: (category) => ipcRenderer.invoke('db:categories:update', category),
        delete: (id) => ipcRenderer.invoke('db:categories:delete', id),
    },

    // Brands
    brands: {
        getAll: () => ipcRenderer.invoke('db:brands:getAll'),
        create: (brand) => ipcRenderer.invoke('db:brands:create', brand),
        update: (brand) => ipcRenderer.invoke('db:brands:update', brand),
        delete: (id) => ipcRenderer.invoke('db:brands:delete', id),
    },

    // Products
    products: {
        getAll: () => ipcRenderer.invoke('db:products:getAll'),
        getById: (id) => ipcRenderer.invoke('db:products:getById', id),
        search: (query) => ipcRenderer.invoke('db:products:search', query),
        getByBarcode: (barcode) => ipcRenderer.invoke('db:products:getByBarcode', barcode),
        getByCategory: (categoryId) => ipcRenderer.invoke('db:products:getByCategory', categoryId),
        create: (product) => ipcRenderer.invoke('db:products:create', product),
        update: (product) => ipcRenderer.invoke('db:products:update', product),
        delete: (id) => ipcRenderer.invoke('db:products:delete', id),
        updateStock: (data) => ipcRenderer.invoke('db:products:updateStock', data),
    },

    // Clothing catalog: variants, SKU/QR identifiers, scanner lookup
    catalog: {
        getVariants: (productId, includeInactive = false) => ipcRenderer.invoke('catalog:getVariants', { productId, includeInactive }),
        saveProduct: (data) => ipcRenderer.invoke('catalog:saveProduct', data),
        generateSkus: (product, variants, reserved = []) => ipcRenderer.invoke('catalog:generateSkus', { product, variants, reserved }),
        generateBarcodes: (count = 1, reserved = []) => ipcRenderer.invoke('catalog:generateBarcodes', { count, reserved }),
        generateFreeCodes: (type, count = 1, reserved = []) => ipcRenderer.invoke('catalog:generateFreeCodes', { type, count, reserved }),
        findUsedCodes: (codes) => ipcRenderer.invoke('catalog:findUsedCodes', codes),
        checkIdentifier: (code, { excludeVariantId = null, excludeProductId = null } = {}) =>
            ipcRenderer.invoke('catalog:checkIdentifier', { code, excludeVariantId, excludeProductId }),
        lookupCode: (code) => ipcRenderer.invoke('catalog:lookupCode', code),
        searchVariants: (query, limit = 50) => ipcRenderer.invoke('catalog:searchVariants', { query, limit }),
        regenerateQr: (variantId) => ipcRenderer.invoke('catalog:regenerateQr', variantId),
    },

    // Customers
    customers: {
        getAll: () => ipcRenderer.invoke('db:customers:getAll'),
        getById: (id) => ipcRenderer.invoke('db:customers:getById', id),
        search: (query) => ipcRenderer.invoke('db:customers:search', query),
        create: (customer) => ipcRenderer.invoke('db:customers:create', customer),
        update: (customer) => ipcRenderer.invoke('db:customers:update', customer),
        delete: (id) => ipcRenderer.invoke('db:customers:delete', id),
    },

    // Employees
    employees: {
        getAll: () => ipcRenderer.invoke('db:employees:getAll'),
        getById: (id) => ipcRenderer.invoke('db:employees:getById', id),
        verifyPin: (data) => ipcRenderer.invoke('db:employees:verifyPin', data),
        create: (employee) => ipcRenderer.invoke('db:employees:create', employee),
        update: (employee) => ipcRenderer.invoke('db:employees:update', employee),
        delete: (id) => ipcRenderer.invoke('db:employees:delete', id),
    },

    // Sales
    sales: {
        create: (sale) => ipcRenderer.invoke('db:sales:create', sale),
        getAll: (params) => ipcRenderer.invoke('db:sales:getAll', params),
        getById: (id) => ipcRenderer.invoke('db:sales:getById', id),
        getToday: (params) => ipcRenderer.invoke('db:sales:getToday', params),
        getStats: (params) => ipcRenderer.invoke('db:sales:getStats', params),
    },

    // Quotations
    quotations: {
        create: (quote) => ipcRenderer.invoke('db:quotations:create', quote),
        getAll: () => ipcRenderer.invoke('db:quotations:getAll'),
        getById: (id) => ipcRenderer.invoke('db:quotations:getById', id),
        savePdf: (quote) => ipcRenderer.invoke('quotations:savePdf', quote),
        print: (quote) => ipcRenderer.invoke('quotations:print', quote),
    },

    // Returns
    returns: {
        create: (data) => ipcRenderer.invoke('db:returns:create', data),
        getAll: () => ipcRenderer.invoke('db:returns:getAll'),
        getItems: (id) => ipcRenderer.invoke('db:returns:getItems', id),
    },

    // Held Transactions
    held: {
        getAll: () => ipcRenderer.invoke('db:held:getAll'),
        create: (held) => ipcRenderer.invoke('db:held:create', held),
        delete: (id) => ipcRenderer.invoke('db:held:delete', id),
    },

    // Settings
    settings: {
        get: (key) => ipcRenderer.invoke('db:settings:get', key),
        set: (data) => ipcRenderer.invoke('db:settings:set', data),
        delete: (key) => ipcRenderer.invoke('db:settings:delete', key),
        getAll: () => ipcRenderer.invoke('db:settings:getAll'),
    },

    // System Logs
    logs: {
        getAll: (params) => ipcRenderer.invoke('db:logs:getAll', params),
    },

    // Backup
    backup: {
        create: () => ipcRenderer.invoke('backup:create'),
        restore: () => ipcRenderer.invoke('backup:restore'),
        reset: () => ipcRenderer.invoke('backup:reset'),
    },



    // Inventory
    inventory: {
        getLogs: (productId) => ipcRenderer.invoke('db:inventory:getLogs', productId),
        getLowStock: () => ipcRenderer.invoke('db:inventory:getLowStock'),
    },

    // Reports
    reports: {
        salesByDate: (params) => ipcRenderer.invoke('db:reports:salesByDate', params),
        topProducts: (params) => ipcRenderer.invoke('db:reports:topProducts', params),
        clothingDashboard: (params) => ipcRenderer.invoke('db:reports:clothingDashboard', params),
        salesByCategory: (params) => ipcRenderer.invoke('db:reports:salesByCategory', params),
        paymentMethods: (params) => ipcRenderer.invoke('db:reports:paymentMethods', params),
        getLowStock: () => ipcRenderer.invoke('db:reports:getLowStock'),
        getSupplierStats: () => ipcRenderer.invoke('db:reports:getSupplierStats'),
    },

    // Utilities
    generateReceiptNumber: () => ipcRenderer.invoke('db:generateReceiptNumber'),

    // ================================================
    // PHASE 2: ADVANCED FEATURES
    // ================================================

    // Images
    images: {
        save: (data) => ipcRenderer.invoke('images:save', data),
        saveLogo: (data) => ipcRenderer.invoke('images:saveLogo', data),
        saveFromPath: (path) => ipcRenderer.invoke('images:saveFromPath', path),
        delete: (fileName) => ipcRenderer.invoke('images:delete', fileName),
        get: (fileName) => ipcRenderer.invoke('images:get', fileName),
    },

    // Email
    email: {
        testConnection: (settings) => ipcRenderer.invoke('email:testConnection', settings),
        sendTest: (data) => ipcRenderer.invoke('email:sendTest', data),
        sendReceipt: (sale, email) => ipcRenderer.invoke('email:sendReceipt', sale, email),
        sendQuotation: (data) => ipcRenderer.invoke('email:sendQuotation', data),
        sendPurchaseOrder: (data) => ipcRenderer.invoke('email:sendPurchaseOrder', data),
    },

    // Suppliers
    suppliers: {
        getAll: () => ipcRenderer.invoke('db:suppliers:getAll'),
        getById: (id) => ipcRenderer.invoke('db:suppliers:getById', id),
        getHistory: (id) => ipcRenderer.invoke('db:suppliers:getHistory', id),
        create: (supplier) => ipcRenderer.invoke('db:suppliers:create', supplier),
        update: (supplier) => ipcRenderer.invoke('db:suppliers:update', supplier),
        delete: (id) => ipcRenderer.invoke('db:suppliers:delete', id),
    },

    // Purchase Orders
    purchaseOrders: {
        getAll: () => ipcRenderer.invoke('db:purchaseOrders:getAll'),
        getById: (id) => ipcRenderer.invoke('db:purchaseOrders:getById', id),
        create: (po) => ipcRenderer.invoke('db:purchaseOrders:create', po),
        delete: (id) => ipcRenderer.invoke('db:purchaseOrders:delete', id),
        receiveStock: (data) => ipcRenderer.invoke('db:purchaseOrders:receiveStock', data),
        createGRN: (data) => ipcRenderer.invoke('db:receivings:create', data),
        addInvoice: (data) => ipcRenderer.invoke('db:supplierInvoices:create', data),
        getInvoices: (poId) => ipcRenderer.invoke('db:supplierInvoices:getByPoId', poId),
        recordPayment: (data) => ipcRenderer.invoke('db:supplierPayments:create', data),
        savePdf: (po) => ipcRenderer.invoke('purchaseOrders:savePdf', po),
    },

    // Purchase Returns (Return to Vendor)
    purchaseReturns: {
        create: (data) => ipcRenderer.invoke('db:purchaseReturns:create', data),
    },

    // Gift Cards
    giftCards: {
        getAll: () => ipcRenderer.invoke('db:giftCards:getAll'),
        getById: (id) => ipcRenderer.invoke('db:giftCards:getById', id),
        getByCode: (code) => ipcRenderer.invoke('db:giftCards:getByCode', code),
        create: (giftCard) => ipcRenderer.invoke('db:giftCards:create', giftCard),
        update: (giftCard) => ipcRenderer.invoke('db:giftCards:update', giftCard),
        redeem: (data) => ipcRenderer.invoke('db:giftCards:redeem', data),
        reload: (data) => ipcRenderer.invoke('db:giftCards:reload', data),
        getTransactions: (giftCardId) => ipcRenderer.invoke('db:giftCards:getTransactions', giftCardId),
        generateCode: () => ipcRenderer.invoke('db:giftCards:generateCode'),
        savePdf: (giftCard) => ipcRenderer.invoke('giftCards:savePdf', giftCard),
        sendEmail: (data) => ipcRenderer.invoke('email:sendGiftCard', data),
    },

    // Bundles
    bundles: {
        getAll: () => ipcRenderer.invoke('db:bundles:getAll'),
        getById: (id) => ipcRenderer.invoke('db:bundles:getById', id),
        getActive: () => ipcRenderer.invoke('db:bundles:getActive'),
        create: (data) => ipcRenderer.invoke('db:bundles:create', data),
        update: (data) => ipcRenderer.invoke('db:bundles:update', data),
        delete: (id) => ipcRenderer.invoke('db:bundles:delete', id),
        assemble: (data) => ipcRenderer.invoke('db:bundles:assemble', data),
        disassemble: (data) => ipcRenderer.invoke('db:bundles:disassemble', data),
    },

    // Promotions
    promotions: {
        getAll: () => ipcRenderer.invoke('db:promotions:getAll'),
        getActive: () => ipcRenderer.invoke('db:promotions:getActive'),
        getById: (id) => ipcRenderer.invoke('db:promotions:getById', id),
        getByCode: (code) => ipcRenderer.invoke('db:promotions:getByCode', code),
        create: (promo) => ipcRenderer.invoke('db:promotions:create', promo),
        update: (promo) => ipcRenderer.invoke('db:promotions:update', promo),
        delete: (id) => ipcRenderer.invoke('db:promotions:delete', id),
        incrementUse: (id) => ipcRenderer.invoke('db:promotions:incrementUse', id),
    },

    // Receipts
    receipts: {
        create: (receipt) => ipcRenderer.invoke('db:receipts:create', receipt),
        updateStatus: (data) => ipcRenderer.invoke('db:receipts:updateStatus', data),
        getBySale: (saleId) => ipcRenderer.invoke('db:receipts:getBySale', saleId),
        print: (sale, overrides) => ipcRenderer.invoke('receipts:print', sale, overrides),
        getHtml: (sale) => ipcRenderer.invoke('receipts:getHtml', sale),
        savePdf: (sale) => ipcRenderer.invoke('receipts:savePdf', sale),
    },





    // Application/version information and local data location
    app: {
        getInfo: () => ipcRenderer.invoke('app:getInfo'),
    },

    // Printers installed in the operating system
    printers: {
        list: () => ipcRenderer.invoke('printers:list'),
        getSettings: () => ipcRenderer.invoke('printers:getSettings'),
    },

    // QR labels (generated locally, printed through Electron)
    labels: {
        getTemplates: () => ipcRenderer.invoke('labels:getTemplates'),
        getSettings: () => ipcRenderer.invoke('labels:getSettings'),
        preview: (items, layout) => ipcRenderer.invoke('labels:preview', { items, layout }),
        print: (items, layout, printer) => ipcRenderer.invoke('labels:print', { items, layout, printer }),
        savePdf: (items, layout) => ipcRenderer.invoke('labels:savePdf', { items, layout }),
        qrSvg: (text) => ipcRenderer.invoke('labels:qrSvg', text),
        printHtml: (html) => ipcRenderer.invoke('print:html', { html }),
    },

    // Barcode Service
    barcode: {
        getTypes: () => ipcRenderer.invoke('barcode:getTypes'),
        getPresets: () => ipcRenderer.invoke('barcode:getPresets'),
        generate: (options) => ipcRenderer.invoke('barcode:generate', options),
        generateLabel: (options) => ipcRenderer.invoke('barcode:generateLabel', options),
        generateBatch: (products, preset, quantity) => ipcRenderer.invoke('barcode:generateBatch', { products, preset, quantity }),
        generateGS1: (components) => ipcRenderer.invoke('barcode:generateGS1', components),
        generateRandom: (type) => ipcRenderer.invoke('barcode:generateRandom', type),
        calculateCheckDigit: (data, type) => ipcRenderer.invoke('barcode:calculateCheckDigit', { data, type }),
    },

    // Excel Service
    excel: {
        parseBuffer: (buffer) => ipcRenderer.invoke('excel:parseBuffer', Array.from(buffer)),
        detectMappings: (headers, dataType) => ipcRenderer.invoke('excel:detectMappings', { headers, dataType }),
        validateAndTransform: (rows, mappings, dataType) => ipcRenderer.invoke('excel:validateAndTransform', { rows, mappings, dataType }),
        getFieldMappings: (dataType) => ipcRenderer.invoke('excel:getFieldMappings', dataType),
        generateTemplate: (dataType) => ipcRenderer.invoke('excel:generateTemplate', dataType),
        export: (data, dataType) => ipcRenderer.invoke('excel:export', { data, dataType }),
    },

    // Dialog
    dialog: {
        selectImage: () => ipcRenderer.invoke('dialog:selectImage'),
    },

    // Credit Sales
    creditSales: {
        getAll: (params) => ipcRenderer.invoke('db:creditSales:getAll', params),
        getById: (id) => ipcRenderer.invoke('db:creditSales:getById', id),
        getByCustomer: (customerId) => ipcRenderer.invoke('db:creditSales:getByCustomer', customerId),
        create: (creditSale) => ipcRenderer.invoke('db:creditSales:create', creditSale),
        update: (creditSale) => ipcRenderer.invoke('db:creditSales:update', creditSale),
        generateInvoiceNumber: () => ipcRenderer.invoke('db:creditSales:generateInvoiceNumber'),
        sendInvoice: (data) => ipcRenderer.invoke('creditInvoice:sendEmail', data),
        sendReminder: (data) => ipcRenderer.invoke('creditInvoice:sendReminder', data),
    },

    // Credit Payments
    creditPayments: {
        create: (payment) => ipcRenderer.invoke('db:creditPayments:create', payment),
        getByCreditSale: (creditSaleId) => ipcRenderer.invoke('db:creditPayments:getByCreditSale', creditSaleId),
        printReceipt: (paymentId) => ipcRenderer.invoke('creditPayments:printReceipt', paymentId),
        getById: (paymentId) => ipcRenderer.invoke('db:creditPayments:getById', paymentId),
    },

    // Customer Credit (extension of customers)
    customerCredit: {
        getCreditInfo: (customerId) => ipcRenderer.invoke('db:customers:getCreditInfo', customerId),
        updateCreditSettings: (data) => ipcRenderer.invoke('db:customers:updateCreditSettings', data),
    },

    // Cloud Sync
    sync: {
        trigger: () => ipcRenderer.invoke('sync:trigger'),
        forcePush: () => ipcRenderer.invoke('sync:force-push'),
        setToken: (token) => ipcRenderer.invoke('sync:set-token', token),
        setOnline: (isOnline) => ipcRenderer.invoke('sync:set-online', isOnline),
        getStatus: () => ipcRenderer.invoke('sync:get-status'),
        onStatusChange: (callback) => {
            const subscription = (_event, ...args) => callback(...args);
            ipcRenderer.on('sync:status-changed', subscription);
            return () => ipcRenderer.removeListener('sync:status-changed', subscription);
        },
        // Outbound: Main -> Renderer -> sync transport (single record - legacy)
        onOutbound: (callback) => {
            const subscription = (_event, ...args) => callback(...args);
            ipcRenderer.on('sync:outbound', subscription);
            return () => ipcRenderer.removeListener('sync:outbound', subscription);
        },
        // Outbound Batch: Main -> Renderer -> sync transport
        onOutboundBatch: (callback) => {
            const subscription = (_event, data) => callback(data);
            ipcRenderer.on('sync:outbound-batch', subscription);
            return () => ipcRenderer.removeListener('sync:outbound-batch', subscription);
        },
        // Inbound: Renderer -> Main (single record)
        incoming: (table, record) => ipcRenderer.invoke('sync:incoming', { table, record }),
        // Inbound Batch: Renderer -> Main (optimized)
        incomingBatch: (batch) => ipcRenderer.invoke('sync:incoming-batch', { batch }),
        // Acknowledge: Renderer -> Main (single item synced - legacy)
        ack: (table, localId, remoteId) => ipcRenderer.invoke('sync:ack', { table, localId, remoteId }),
        // Batch Acknowledge: Renderer -> Main (optimized)
        batchAck: (data) => ipcRenderer.invoke('sync:batch-ack', data),
    },

    // AI / Gemini Features
    ai: {
        getInsights: (salesData) => ipcRenderer.invoke('ai:get-insights', salesData),
        updateConfig: (config) => ipcRenderer.invoke('ai:update-config', config),
        
        // Streaming Chat
        chatStream: (history, message, model, images) => ipcRenderer.send('ai:chat-stream', { history, message, model, images }),
        onChatChunk: (callback) => {
            const subscription = (_event, chunk) => callback(chunk);
            ipcRenderer.on('ai:chat-chunk', subscription);
            return () => ipcRenderer.removeListener('ai:chat-chunk', subscription);
        },
        onChatComplete: (callback) => {
            const subscription = () => callback();
            ipcRenderer.on('ai:chat-complete', subscription);
            return () => ipcRenderer.removeListener('ai:chat-complete', subscription);
        },
        onChatError: (callback) => {
            const subscription = (_event, error) => callback(error);
            ipcRenderer.on('ai:chat-error', subscription);
            return () => ipcRenderer.removeListener('ai:chat-error', subscription);
        }
    },

    // Shell (for opening external links)
    shell: {
        openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

    },

    // E-commerce Integrations
    ecommerce: {
        // Connections
        getConnections: () => ipcRenderer.invoke('ecommerce:getConnections'),
        addConnection: (connection) => ipcRenderer.invoke('ecommerce:addConnection', connection),
        testConnection: (connectionId) => ipcRenderer.invoke('ecommerce:testConnection', connectionId),
        removeConnection: (connectionId) => ipcRenderer.invoke('ecommerce:removeConnection', connectionId),
        
        // Sync
        sync: (connectionId) => ipcRenderer.invoke('ecommerce:sync', connectionId),
        syncAll: () => ipcRenderer.invoke('ecommerce:syncAll'),
        
        // Product Mappings
        getMappings: (connectionId) => ipcRenderer.invoke('ecommerce:getMappings', connectionId),
        autoMapProducts: (connectionId) => ipcRenderer.invoke('ecommerce:autoMapProducts', connectionId),
        createMapping: (mapping) => ipcRenderer.invoke('ecommerce:createMapping', mapping),
        deleteMapping: (mappingId) => ipcRenderer.invoke('ecommerce:deleteMapping', mappingId),
        getUnmappedProducts: (connectionId) => ipcRenderer.invoke('ecommerce:getUnmappedProducts', connectionId),
        
        // Logs
        getSyncLogs: (connectionId, limit) => ipcRenderer.invoke('ecommerce:getSyncLogs', connectionId, limit),
        
        // OAuth (Etsy)
        startOAuth: (platform, apiKey) => ipcRenderer.invoke('ecommerce:oauth:start', platform, apiKey),
        completeOAuth: (code, state, codeVerifier) => ipcRenderer.invoke('ecommerce:oauth:complete', code, state, codeVerifier),
        
        // Status Events
        onSyncStatus: (callback) => {
            const subscription = (_event, ...args) => callback(...args);
            ipcRenderer.on('ecommerce:syncStatus', subscription);
            return () => ipcRenderer.removeListener('ecommerce:syncStatus', subscription);
        },
        
        // Webhook events (pushed in by a sync transport, if one is configured)
        webhookEvent: (event) => ipcRenderer.invoke('ecommerce:webhookEvent', event),

    },

});

