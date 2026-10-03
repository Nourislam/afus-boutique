/**
 * Role-Based Permissions Configuration
 * 
 * Defines roles and their permissions across the POS system.
 */

// Available roles
export const ROLES = {
    ADMIN: 'admin',
    MANAGER: 'manager',
    CASHIER: 'cashier',
};

// Permission definitions
export const PERMISSIONS = {
    // Dashboard
    DASHBOARD_VIEW: 'dashboard.view',

    // POS
    POS_VIEW: 'pos.view',
    POS_VOID_SALE: 'pos.void_sale',
    POS_APPLY_DISCOUNT: 'pos.apply_discount',

    // Products
    PRODUCTS_VIEW: 'products.view',
    PRODUCTS_CREATE: 'products.create',
    PRODUCTS_EDIT: 'products.edit',
    PRODUCTS_DELETE: 'products.delete',

    // Inventory
    INVENTORY_VIEW: 'inventory.view',
    INVENTORY_ADJUST: 'inventory.adjust',

    // Customers
    CUSTOMERS_VIEW: 'customers.view',
    CUSTOMERS_CREATE: 'customers.create',
    CUSTOMERS_EDIT: 'customers.edit',
    CUSTOMERS_DELETE: 'customers.delete',

    // Gift Cards
    GIFT_CARDS_VIEW: 'gift_cards.view',
    GIFT_CARDS_CREATE: 'gift_cards.create',
    GIFT_CARDS_RELOAD: 'gift_cards.reload',

    // Bundles
    BUNDLES_VIEW: 'bundles.view',
    BUNDLES_MANAGE: 'bundles.manage',

    // Promotions
    PROMOTIONS_VIEW: 'promotions.view',
    PROMOTIONS_MANAGE: 'promotions.manage',

    // Employees
    EMPLOYEES_VIEW: 'employees.view',
    EMPLOYEES_MANAGE: 'employees.manage',

    // Reports
    REPORTS_VIEW: 'reports.view',

    // Settings
    SETTINGS_VIEW: 'settings.view',
};

// Role-Permission mapping
const ROLE_PERMISSIONS = {
    [ROLES.ADMIN]: [
        // All permissions
        ...Object.values(PERMISSIONS),
    ],

    [ROLES.MANAGER]: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.POS_VIEW,
        PERMISSIONS.POS_VOID_SALE,
        PERMISSIONS.POS_APPLY_DISCOUNT,
        PERMISSIONS.PRODUCTS_VIEW,
        PERMISSIONS.PRODUCTS_CREATE,
        PERMISSIONS.PRODUCTS_EDIT,
        PERMISSIONS.INVENTORY_VIEW,
        PERMISSIONS.INVENTORY_ADJUST,
        PERMISSIONS.CUSTOMERS_VIEW,
        PERMISSIONS.CUSTOMERS_CREATE,
        PERMISSIONS.CUSTOMERS_EDIT,
        PERMISSIONS.CUSTOMERS_DELETE,
        PERMISSIONS.GIFT_CARDS_VIEW,
        PERMISSIONS.GIFT_CARDS_CREATE,
        PERMISSIONS.GIFT_CARDS_RELOAD,
        PERMISSIONS.BUNDLES_VIEW,
        PERMISSIONS.BUNDLES_MANAGE,
        PERMISSIONS.PROMOTIONS_VIEW,
        PERMISSIONS.PROMOTIONS_MANAGE,
        PERMISSIONS.REPORTS_VIEW,
    ],

    [ROLES.CASHIER]: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.POS_VIEW,
        PERMISSIONS.PRODUCTS_VIEW,
        PERMISSIONS.INVENTORY_VIEW,
        PERMISSIONS.CUSTOMERS_VIEW,
        PERMISSIONS.CUSTOMERS_CREATE,
        PERMISSIONS.CUSTOMERS_EDIT,
        PERMISSIONS.GIFT_CARDS_VIEW,
    ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role, permission) {
    if (!role || !permission) return false;
    const rolePerms = ROLE_PERMISSIONS[role.toLowerCase()];
    if (!rolePerms) return false;
    return rolePerms.includes(permission);
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role) {
    if (!role) return [];
    return ROLE_PERMISSIONS[role.toLowerCase()] || [];
}

/**
 * Navigation items with required permissions
 */
export const NAV_PERMISSIONS = {
    '/': PERMISSIONS.DASHBOARD_VIEW,
    '/pos': PERMISSIONS.POS_VIEW,
    '/products': PERMISSIONS.PRODUCTS_VIEW,
    '/inventory': PERMISSIONS.INVENTORY_VIEW,
    '/customers': PERMISSIONS.CUSTOMERS_VIEW,
    '/gift-cards': PERMISSIONS.GIFT_CARDS_VIEW,
    '/bundles': PERMISSIONS.BUNDLES_VIEW,
    '/promotions': PERMISSIONS.PROMOTIONS_VIEW,
    '/employees': PERMISSIONS.EMPLOYEES_VIEW,
    '/reports': PERMISSIONS.REPORTS_VIEW,
    '/settings': PERMISSIONS.SETTINGS_VIEW,
};
