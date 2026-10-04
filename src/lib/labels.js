// Printing an article's labels from anywhere (article form, products list)
// with the look saved in Settings. Missing barcodes are created when printing.
import { t } from '../i18n';

/**
 * @param {string} productId
 * @param {number|''} quantity labels per piece (colour/size) or per article;
 *        empty = one label per item in stock
 * @returns {Promise<{ printed: number, created: number }>}
 */
export async function printArticleLabels(productId, quantity = '') {
    const api = window.electronAPI;
    const [layout, printers, variants, product] = await Promise.all([
        api.labels.getSettings(),
        api.printers.getSettings(),
        api.catalog.getVariants(productId),
        api.products.getById(productId),
    ]);
    const fixed = parseInt(quantity, 10) > 0 ? parseInt(quantity, 10) : null;
    const perArticle = layout.codeScope === 'article';
    let items;
    if (perArticle || !variants.length) {
        const stock = variants.length ? variants.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0) : Number(product?.stock_quantity) || 0;
        items = [{ productId, quantity: fixed || Math.max(1, stock) }];
    } else {
        items = variants.map(v => ({ variantId: v.id, quantity: fixed || Math.max(1, Number(v.stock_quantity) || 0) }));
    }
    const printed = items.reduce((sum, i) => sum + i.quantity, 0);
    const result = await api.labels.print(items, layout, printers.label || {});
    return { printed: result?.success ? printed : 0, created: result?.created || 0, cancelled: !result?.success };
}

/** Toasts describing the result of printArticleLabels. */
export function labelResultMessages({ printed, created }) {
    const out = [];
    if (created) out.push(t('labels.codesCreated', { n: created }));
    if (printed) out.push(t('labels.sent', { n: printed }));
    return out;
}
