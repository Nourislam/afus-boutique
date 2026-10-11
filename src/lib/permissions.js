// Roles and permissions live in electron/shared/permissions.mjs, so the main
// process checks the same table as the window
import { PERMISSIONS } from '../../electron/shared/permissions.mjs';

export * from '../../electron/shared/permissions.mjs';

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
    '/website': PERMISSIONS.SETTINGS_VIEW,
    '/settings': PERMISSIONS.SETTINGS_VIEW,
};
