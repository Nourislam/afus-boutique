// Which tabs and screens each module adds, for the menu, the hub pages and
// the routes. One place, so a hidden module leaves no tab or link behind.
import { PERMISSIONS } from './permissions';
import { offersEnabled } from './features';

/** Offers tabs the user may see: promotions, packs, gift cards. */
export function offerTabs(features = {}, can = () => true) {
    if (!offersEnabled(features)) return [];
    return [
        features.promotions && can(PERMISSIONS.PROMOTIONS_VIEW) ? 'promotions' : null,
        features.bundles && can(PERMISSIONS.PROMOTIONS_VIEW) ? 'packs' : null,
        features.giftCards && can(PERMISSIONS.GIFT_CARDS_VIEW) ? 'giftCards' : null,
    ].filter(Boolean);
}

/** Catalogue tabs that belong to a module (the others are always there). */
export function catalogModuleTabs(features = {}, can = () => true) {
    return [
        features.suppliers !== false && can(PERMISSIONS.INVENTORY_VIEW) ? 'suppliers' : null,
        features.customers !== false && can(PERMISSIONS.CUSTOMERS_VIEW) ? 'customers' : null,
    ].filter(Boolean);
}
