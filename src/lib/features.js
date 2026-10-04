// Optional modules. Hidden by default because they are rarely used by
// Algerian clothing shops or need an internet connection; the shop owner can
// enable them in Settings. The code stays in place either way.
export const DEFAULT_FEATURES = {
    ai: false,          // AI assistant (needs internet and an API key)
    ecommerce: false,   // Shopify / WooCommerce connection
    giftCards: false,
    quotations: false,
    bundles: true,
    promotions: true,
    credit: true,
    email: false,       // send receipts by e-mail (needs internet)
};

export function resolveFeatures(saved) {
    return { ...DEFAULT_FEATURES, ...(saved && typeof saved === 'object' ? saved : {}) };
}
