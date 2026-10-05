import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Modal, ModalBody } from '../ui/Modal';
import { t } from '../../i18n';
import { colorHex, colorName, sizeLabel } from '../../lib/clothing';
import { pickerMode } from '../../lib/variantRules';

/**
 * Lets the cashier pick the exact colour, then the size, of a clothing
 * product. Each choice shows the available stock (and the price when it
 * differs), so the wrong variant is not sold by accident.
 */
export function VariantPickerModal({ product, isOpen, onClose, onSelect, formatCurrency }) {
    const [variants, setVariants] = useState([]);
    const [loading, setLoading] = useState(false);
    const [color, setColor] = useState(null);

    useEffect(() => {
        if (!isOpen || !product) return;
        setColor(null);
        setLoading(true);
        window.electronAPI.catalog.getVariants(product.id)
            .then(setVariants)
            .catch(() => setVariants([]))
            .finally(() => setLoading(false));
    }, [isOpen, product]);

    const colors = useMemo(() => {
        const list = new Map();
        for (const v of variants) {
            const key = v.color || '';
            const entry = list.get(key) || { key, sample: v, stock: 0 };
            entry.stock += Math.max(0, v.stock_quantity ?? 0);
            list.set(key, entry);
        }
        return [...list.values()];
    }, [variants]);

    // Colours only: the colour is the piece. Sizes only (or a single colour):
    // straight to the sizes. Colours and sizes: colour, then size.
    const mode = pickerMode(product || {}, variants);
    const activeColor = mode === 'size' || mode === 'none' ? '' : (color ?? (mode === 'both' && colors.length === 1 ? colors[0].key : null));
    const sizes = activeColor === null ? [] : (mode === 'size' || mode === 'none' ? variants : variants.filter(v => (v.color || '') === activeColor));
    const chooseColor = (key) => {
        if (mode === 'color') {
            const piece = variants.find(v => (v.color || '') === key && (v.stock_quantity ?? 0) > 0) || variants.find(v => (v.color || '') === key);
            if (piece) onSelect(piece);
            return;
        }
        setColor(key);
    };

    if (!product) return null;

    const priceOf = (v) => (v.price !== null && v.price !== undefined ? v.price : product.price);
    const prices = new Set(variants.map(priceOf));

    const stockText = (qty, min) => {
        if (qty <= 0) return <span className="text-red-400">{t('variants.outOfStock')}</span>;
        return <span className={qty <= min ? 'text-amber-400' : 'text-zinc-400'}>{t('variants.inStock', { n: qty })}</span>;
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={product.name} size="lg">
            <ModalBody>
                {loading ? (
                    <div className="py-8 text-center text-zinc-500">{t('common.loading')}</div>
                ) : variants.length === 0 ? (
                    <div className="py-8 text-center text-zinc-500">{t('variants.noneActive')}</div>
                ) : activeColor === null ? (
                    <>
                        <p className="text-sm text-zinc-400 mb-3">{t('variants.chooseColor')}</p>
                        <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                            {colors.map(c => (
                                <button
                                    key={c.key}
                                    type="button"
                                    disabled={c.stock <= 0}
                                    onClick={() => chooseColor(c.key)}
                                    className={`rounded-xl border-2 p-3 flex flex-col items-center gap-2 transition-colors
                                        ${c.stock <= 0 ? 'border-dark-border opacity-40 cursor-not-allowed' : 'border-dark-border hover:border-accent-primary hover:bg-accent-primary/10'}`}
                                >
                                    <span className="w-10 h-10 rounded-full border-2 border-zinc-600" style={{ background: colorHex(c.sample) || '#3f3f46' }} />
                                    <span className="font-semibold text-sm">{colorName(c.sample) || '—'}</span>
                                    <span className="text-xs">{stockText(c.stock, 0)}</span>
                                </button>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-3 mb-3">
                            {mode === 'both' && colors.length > 1 && (
                                <button type="button" onClick={() => setColor(null)} className="p-1.5 rounded-lg bg-dark-tertiary hover:bg-zinc-700" title={t('common.back')}>
                                    <ChevronLeft className="w-4 h-4 flip-rtl" />
                                </button>
                            )}
                            {activeColor && (
                                <span className="inline-flex items-center gap-2 font-semibold">
                                    <span className="w-4 h-4 rounded-full border border-zinc-600" style={{ background: colorHex(sizes[0]) || '#3f3f46' }} />
                                    {colorName(sizes[0])}
                                </span>
                            )}
                            <span className="text-sm text-zinc-400">{t('variants.chooseSize')}</span>
                        </div>
                        <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
                            {sizes.map(v => {
                                const out = (v.stock_quantity ?? 0) <= 0;
                                return (
                                    <button
                                        key={v.id}
                                        type="button"
                                        disabled={out}
                                        onClick={() => onSelect(v)}
                                        title={v.sku}
                                        className={`rounded-xl border-2 py-3 px-2 flex flex-col items-center gap-1 transition-colors
                                            ${out ? 'border-dark-border opacity-40 cursor-not-allowed' : 'border-dark-border hover:border-accent-primary hover:bg-accent-primary/10'}`}
                                    >
                                        <span className="text-xl font-bold">{sizeLabel(v.size) || '—'}</span>
                                        <span className="text-xs">{stockText(v.stock_quantity ?? 0, v.min_stock_level ?? 0)}</span>
                                        {prices.size > 1 && <span className="text-xs text-accent-primary">{formatCurrency(priceOf(v))}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
                <p className="text-xs text-zinc-500 mt-4">{t('variants.scanTip')}</p>
            </ModalBody>
        </Modal>
    );
}

export default VariantPickerModal;
