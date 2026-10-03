import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from '../ui/Modal';

/**
 * Lets the cashier pick the exact colour and size of a clothing product.
 * Shows a colour × size grid with price and available stock per variant, so
 * the wrong variant is not sold by accident.
 */
export function VariantPickerModal({ product, isOpen, onClose, onSelect, formatCurrency }) {
    const [variants, setVariants] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen || !product) return;
        setLoading(true);
        window.electronAPI.catalog.getVariants(product.id)
            .then(setVariants)
            .catch(() => setVariants([]))
            .finally(() => setLoading(false));
    }, [isOpen, product]);

    const { colors, sizes, byKey } = useMemo(() => {
        const colorList = [];
        const sizeList = [];
        const map = new Map();
        for (const v of variants) {
            const c = v.color || '';
            const s = v.size || '';
            if (!colorList.includes(c)) colorList.push(c);
            if (!sizeList.includes(s)) sizeList.push(s);
            map.set(`${c}|${s}`, v);
        }
        return { colors: colorList, sizes: sizeList, byKey: map };
    }, [variants]);

    if (!product) return null;

    const priceOf = (v) => (v.price !== null && v.price !== undefined ? v.price : product.price);

    const Cell = ({ variant }) => {
        if (!variant) return <div className="h-16 rounded-lg bg-dark-tertiary/40" />;
        const out = (variant.stock_quantity ?? 0) <= 0;
        const low = !out && variant.stock_quantity <= variant.min_stock_level;
        return (
            <button
                type="button"
                disabled={out}
                onClick={() => onSelect(variant)}
                className={`h-16 w-full rounded-lg border text-left px-2 py-1 transition-colors
                    ${out ? 'border-dark-border bg-dark-tertiary/40 text-zinc-600 cursor-not-allowed' : 'border-dark-border bg-dark-tertiary hover:border-accent-primary hover:bg-accent-primary/10'}`}
                title={variant.sku}
            >
                <div className="text-sm font-semibold">{formatCurrency(priceOf(variant))}</div>
                <div className={`text-xs ${out ? 'text-red-400' : low ? 'text-amber-400' : 'text-zinc-400'}`}>
                    {out ? 'Out of stock' : `${variant.stock_quantity} in stock`}
                </div>
            </button>
        );
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Choose colour / size — ${product.name}`} size="xl">
            <ModalBody>
                {loading ? (
                    <div className="py-8 text-center text-zinc-500">Loading…</div>
                ) : variants.length === 0 ? (
                    <div className="py-8 text-center text-zinc-500">This product has no active variants.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-separate" style={{ borderSpacing: 6 }}>
                            <thead>
                                <tr>
                                    <th className="text-left text-xs text-zinc-500 font-medium">Colour \ Size</th>
                                    {sizes.map(s => <th key={s} className="text-sm font-semibold min-w-[90px]">{s || '—'}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {colors.map(c => (
                                    <tr key={c}>
                                        <td className="text-sm font-semibold pr-2 whitespace-nowrap">{c || '—'}</td>
                                        {sizes.map(s => (
                                            <td key={s}><Cell variant={byKey.get(`${c}|${s}`)} /></td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="text-xs text-zinc-500 mt-3">Tip: scanning the variant&apos;s QR label adds it directly without this window.</p>
            </ModalBody>
        </Modal>
    );
}

export default VariantPickerModal;
