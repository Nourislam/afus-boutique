// What the cashier is asked for an article: its colour, its size, both or
// nothing. From the article's switches (has_colors / has_sizes) and the pieces
// that really exist, so a switch on with nothing chosen asks nothing.
const used = (variants, field) => variants.some(v => String(v[field] || '').trim() !== '');

export function variantDimensions(product = {}, variants = []) {
    const pick = (flag, field) => (flag === null || flag === undefined ? used(variants, field) : !!flag && used(variants, field));
    return { colors: pick(product.has_colors, 'color'), sizes: pick(product.has_sizes, 'size') };
}

/**
 * The steps of the picker for these pieces:
 *  'color'  - choose a colour, which is the piece (colours only)
 *  'both'   - choose a colour, then a size
 *  'size'   - choose a size (sizes only)
 *  'none'   - nothing to choose (a single piece)
 */
export function pickerMode(product, variants) {
    const { colors, sizes } = variantDimensions(product, variants);
    if (colors && sizes) return 'both';
    if (colors) return 'color';
    if (sizes) return 'size';
    return 'none';
}
