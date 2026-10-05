// TVA on or off for the shop (Settings › Language & tax). Off: no TVA is
// computed and no screen, ticket or report shows it. A shop that never chose
// keeps what it had: TVA on when it set a rate above 0.
export function isTaxEnabled(settings = {}) {
    if (typeof settings.taxEnabled === 'boolean') return settings.taxEnabled;
    return (parseFloat(settings.taxRate) || 0) > 0;
}
