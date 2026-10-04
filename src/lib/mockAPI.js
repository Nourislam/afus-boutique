// Mock API for browser testing (when not running in Electron)
// This provides fake data so the UI can be tested without Electron

const mockEmployees = [
    { id: '1', name: 'Admin', email: '', role: 'admin', is_active: 1, pin: '1234', created_at: new Date().toISOString() },
    { id: '2', name: 'Karim', email: '', role: 'cashier', is_active: 1, pin: '1111', created_at: new Date().toISOString() },
    { id: '3', name: 'Amina', email: '', role: 'manager', is_active: 1, pin: '2222', created_at: new Date().toISOString() },
];

const mockCategories = [
    { id: 'cat1', name: 'تيشيرتات', color: '#3b82f6', icon: null },
    { id: 'cat2', name: 'سراويل', color: '#22c55e', icon: null },
    { id: 'cat3', name: 'أحذية', color: '#a855f7', icon: null },
    { id: 'cat4', name: 'إكسسوارات', color: '#f59e0b', icon: null },
];

const mockProducts = [
    { id: 'p1', name: 'T-shirt basique', brand: 'Zara', sku: 'TSH-001', barcode: '', price: 1500, cost: 900, stock_quantity: 24, min_stock_level: 3, tax_rate: 0, is_active: 1, category_id: 'cat1', category_name: 'تيشيرتات', category_color: '#3b82f6' },
    { id: 'p2', name: 'Jean slim', brand: "Levi's", sku: 'JEA-001', barcode: '', price: 4500, cost: 2800, stock_quantity: 12, min_stock_level: 2, tax_rate: 0, is_active: 1, category_id: 'cat2', category_name: 'سراويل', category_color: '#22c55e' },
    { id: 'p3', name: 'Basket sport', brand: 'Nike', sku: 'SHO-001', barcode: '', price: 8500, cost: 6000, stock_quantity: 6, min_stock_level: 2, tax_rate: 0, is_active: 1, category_id: 'cat3', category_name: 'أحذية', category_color: '#a855f7' },
    { id: 'p4', name: 'Ceinture cuir', brand: '', sku: 'ACC-001', barcode: '', price: 1200, cost: 600, stock_quantity: 15, min_stock_level: 3, tax_rate: 0, is_active: 1, category_id: 'cat4', category_name: 'إكسسوارات', category_color: '#f59e0b' },
];

const mockCustomers = [
    { id: 'c1', name: 'Amina B.', email: '', phone: '0555 12 34 56', address: 'Alger', loyalty_points: 150, total_spent: 15000, notes: '', created_at: new Date().toISOString() },
];

let mockSales = [];
let mockHeld = [];
let mockGiftCards = [];
let mockBundles = [];
let mockPromotions = [];

const mockSettings = {
    businessName: 'Boutique démo',
    businessAddress: 'Rue Didouche Mourad',
    businessWilaya: '16 - Alger',
    businessPhone: '0555 00 00 00',
    businessEmail: '',
    taxRate: 0,
    currency: 'DZD',
    currencySymbol: 'DA',
    defaultLanguage: 'ar',
    receiptHeader: '',
    receiptFooter: '',
}

// Create mock API
export const mockElectronAPI = {
    minimize: () => console.log('Minimize'),
    maximize: () => console.log('Maximize'),
    close: () => console.log('Close'),

    categories: {
        getAll: async () => mockCategories,
        create: async (cat) => { mockCategories.push(cat); return cat; },
        update: async (cat) => { const idx = mockCategories.findIndex(c => c.id === cat.id); if (idx >= 0) mockCategories[idx] = cat; return cat; },
        delete: async (id) => { const idx = mockCategories.findIndex(c => c.id === id); if (idx >= 0) mockCategories.splice(idx, 1); return true; },
    },

    products: {
        getAll: async () => mockProducts,
        getById: async (id) => mockProducts.find(p => p.id === id),
        search: async (query) => mockProducts.filter(p => p.name.toLowerCase().includes(query.toLowerCase())),
        getByBarcode: async (barcode) => mockProducts.find(p => p.barcode === barcode),
        getByCategory: async (categoryId) => mockProducts.filter(p => p.category_id === categoryId),
        create: async (product) => { mockProducts.push(product); return product; },
        update: async (product) => { const idx = mockProducts.findIndex(p => p.id === product.id); if (idx >= 0) mockProducts[idx] = product; return product; },
        delete: async (id) => { const idx = mockProducts.findIndex(p => p.id === id); if (idx >= 0) mockProducts.splice(idx, 1); return true; },
        updateStock: async ({ id, quantity, type }) => {
            const product = mockProducts.find(p => p.id === id);
            if (product) {
                product.stock_quantity = type === 'add' ? product.stock_quantity + quantity : product.stock_quantity - quantity;
            }
            return product;
        },
    },

    customers: {
        getAll: async () => mockCustomers,
        getById: async (id) => mockCustomers.find(c => c.id === id),
        search: async (query) => mockCustomers.filter(c => c.name.toLowerCase().includes(query.toLowerCase())),
        create: async (customer) => { mockCustomers.push(customer); return customer; },
        update: async (customer) => { const idx = mockCustomers.findIndex(c => c.id === customer.id); if (idx >= 0) mockCustomers[idx] = customer; return customer; },
        delete: async (id) => { const idx = mockCustomers.findIndex(c => c.id === id); if (idx >= 0) mockCustomers.splice(idx, 1); return true; },
    },

    employees: {
        getAll: async () => mockEmployees.map(e => ({ ...e, pin: undefined })),
        getById: async (id) => { const e = mockEmployees.find(e => e.id === id); return e ? { ...e, pin: undefined } : null; },
        verifyPin: async ({ id, pin }) => {
            const employee = mockEmployees.find(e => e.id === id && e.pin === pin);
            return employee ? { id: employee.id, name: employee.name, role: employee.role } : null;
        },
        create: async (employee) => { mockEmployees.push(employee); return { ...employee, pin: undefined }; },
        update: async (employee) => { const idx = mockEmployees.findIndex(e => e.id === employee.id); if (idx >= 0) Object.assign(mockEmployees[idx], employee); return { ...employee, pin: undefined }; },
        delete: async (id) => { const idx = mockEmployees.findIndex(e => e.id === id); if (idx >= 0) mockEmployees.splice(idx, 1); return true; },
    },

    sales: {
        create: async (sale) => { mockSales.push(sale); return sale; },
        getAll: async () => mockSales,
        getById: async (id) => mockSales.find(s => s.id === id),
        getToday: async () => mockSales.filter(s => new Date(s.created_at).toDateString() === new Date().toDateString()),
        getStats: async () => ({
            total_transactions: mockSales.length,
            total_revenue: mockSales.reduce((sum, s) => sum + s.total, 0),
            average_sale: mockSales.length ? mockSales.reduce((sum, s) => sum + s.total, 0) / mockSales.length : 0,
            total_tax: mockSales.reduce((sum, s) => sum + (s.tax_amount || 0), 0),
        }),
    },

    held: {
        getAll: async () => mockHeld,
        create: async (held) => { mockHeld.push(held); return held; },
        delete: async (id) => { const idx = mockHeld.findIndex(h => h.id === id); if (idx >= 0) mockHeld.splice(idx, 1); return true; },
    },

    settings: {
        get: async (key) => mockSettings[key],
        set: async ({ key, value }) => { mockSettings[key] = value; return true; },
        getAll: async () => mockSettings,
    },

    inventory: {
        getLogs: async () => [],
        getLowStock: async () => mockProducts.filter(p => p.stock_quantity <= p.min_stock_level),
    },

    reports: {
        salesByDate: async () => [],
        topProducts: async () => mockProducts.slice(0, 5).map(p => ({ product_id: p.id, product_name: p.name, total_quantity: Math.floor(Math.random() * 100), total_revenue: Math.random() * 500 })),
        salesByCategory: async () => mockCategories.map(c => ({ category_name: c.name, category_color: c.color, total_quantity: Math.floor(Math.random() * 50), total_revenue: Math.random() * 300 })),
        paymentMethods: async () => [{ method: 'cash', count: 10, total: 250 }, { method: 'card', count: 5, total: 180 }],
    },

    generateReceiptNumber: async () => {
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        return `${today}${String(mockSales.length + 1).padStart(4, '0')}`;
    },

    // Phase 2: Advanced Features

    images: {
        save: async () => ({ success: true, fileName: 'mock-image.jpg' }),
        saveFromPath: async () => ({ success: true, fileName: 'mock-image.jpg' }),
        delete: async () => ({ success: true }),
        get: async () => null,
    },

    email: {
        testConnection: async () => ({ success: true, message: 'Mock SMTP connected' }),
        sendTest: async () => ({ success: true, message: 'Mock email sent' }),
        sendReceipt: async () => ({ success: true }),
    },

    giftCards: {
        getAll: async () => mockGiftCards,
        getById: async (id) => mockGiftCards.find(gc => gc.id === id),
        getByCode: async (code) => mockGiftCards.find(gc => gc.code === code),
        create: async (gc) => { mockGiftCards.push(gc); return gc; },
        update: async (gc) => { const idx = mockGiftCards.findIndex(g => g.id === gc.id); if (idx >= 0) mockGiftCards[idx] = gc; return gc; },
        redeem: async ({ giftCardId, amount }) => {
            const gc = mockGiftCards.find(g => g.id === giftCardId);
            if (gc) gc.current_balance -= amount;
            return gc;
        },
        reload: async ({ giftCardId, amount }) => {
            const gc = mockGiftCards.find(g => g.id === giftCardId);
            if (gc) gc.current_balance += amount;
            return gc;
        },
        getTransactions: async () => [],
        generateCode: async () => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let code = '';
            for (let i = 0; i < 16; i++) {
                if (i > 0 && i % 4 === 0) code += '-';
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        },
    },

    bundles: {
        getAll: async () => mockBundles,
        getById: async (id) => mockBundles.find(b => b.id === id),
        getActive: async () => mockBundles.filter(b => b.is_active),
        create: async ({ bundle, items }) => { bundle.items = items; mockBundles.push(bundle); return bundle; },
        update: async ({ bundle, items }) => { const idx = mockBundles.findIndex(b => b.id === bundle.id); if (idx >= 0) { bundle.items = items; mockBundles[idx] = bundle; } return bundle; },
        delete: async (id) => { const idx = mockBundles.findIndex(b => b.id === id); if (idx >= 0) mockBundles.splice(idx, 1); return true; },
    },

    promotions: {
        getAll: async () => mockPromotions,
        getActive: async () => mockPromotions.filter(p => p.is_active),
        getById: async (id) => mockPromotions.find(p => p.id === id),
        getByCode: async (code) => mockPromotions.find(p => p.coupon_code === code),
        create: async (promo) => { mockPromotions.push(promo); return promo; },
        update: async (promo) => { const idx = mockPromotions.findIndex(p => p.id === promo.id); if (idx >= 0) mockPromotions[idx] = promo; return promo; },
        delete: async (id) => { const idx = mockPromotions.findIndex(p => p.id === id); if (idx >= 0) mockPromotions.splice(idx, 1); return true; },
        incrementUse: async (id) => { const p = mockPromotions.find(p => p.id === id); if (p) p.current_uses = (p.current_uses || 0) + 1; return true; },
    },

    receipts: {
        create: async (receipt) => receipt,
        updateStatus: async () => true,
        getBySale: async () => [],
    },
};

// Initialize mock API if not in Electron
export function initMockAPI() {
    if (!window.electronAPI) {
        console.log('🔧 Running in browser mode - using mock API');
        window.electronAPI = mockElectronAPI;
    }
}
