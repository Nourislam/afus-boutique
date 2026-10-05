// Which tabs each module adds to the Offers screen, for the menu and the
// page itself. One place, so a hidden module leaves no tab or link behind.
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
