import { useState } from 'react';
import { X, Wand2, QrCode, Trash2, RotateCcw, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { QrPreview } from './QrPreview';

const COLOR_SUGGESTIONS = ['Black', 'White', 'Grey', 'Navy', 'Blue', 'Red', 'Green', 'Beige', 'Brown', 'Pink'];
const SIZE_PRESETS = [
    { label: 'XS–XXL', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
    { label: 'S–XL', sizes: ['S', 'M', 'L', 'XL'] },
    { label: 'EU 36–46', sizes: ['36', '38', '40', '42', '44', '46'] },
    { label: 'Jeans 28–38', sizes: ['28', '30', '32', '34', '36', '38'] },
    { label: 'Shoes 38–45', sizes: ['38', '39', '40', '41', '42', '43', '44', '45'] },
    { label: 'Kids 2–14', sizes: ['2Y', '4Y', '6Y', '8Y', '10Y', '12Y', '14Y'] },
    { label: 'One size', sizes: ['TU'] },
];

const normalize = (code) => String(code || '').trim().toUpperCase();

function ChipInput({ label, values, onChange, suggestions = [], placeholder }) {
    const [text, setText] = useState('');

    const add = (raw) => {
        const parts = String(raw).split(',').map(v => v.trim()).filter(Boolean);
        const next = [...values];
        for (const p of parts) {
            if (!next.some(v => v.toLowerCase() === p.toLowerCase())) next.push(p);
        }
        onChange(next);
        setText('');
    };

    return (
        <div>
            <label className="form-label">{label}</label>
            <div className="flex flex-wrap gap-2 p-2 min-h-[44px] rounded-lg bg-dark-tertiary border border-dark-border">
                {values.map(v => (
                    <span key={v} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent-primary/20 text-sm">
                        {v}
                        <button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="hover:text-red-400">
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                ))}
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            if (text.trim()) add(text);
                        } else if (e.key === 'Backspace' && !text && values.length) {
                            onChange(values.slice(0, -1));
                        }
                    }}
                    onBlur={() => text.trim() && add(text)}
                    placeholder={placeholder}
                    className="flex-1 min-w-[120px] bg-transparent outline-none text-sm px-1"
                />
            </div>
            {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {suggestions.filter(s => !values.some(v => v.toLowerCase() === s.toLowerCase())).map(s => (
                        <button key={s} type="button" onClick={() => add(s)}
                            className="px-2 py-0.5 rounded bg-dark-tertiary hover:bg-zinc-700 text-xs text-zinc-400">
                            + {s}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * Colour × size variant builder. `variants` rows:
 * { key, id?, color, size, sku, qr_code, barcode, price, cost, stock_quantity, min_stock_level, is_active, isNew }
 * Price/cost left empty fall back to the product's base price/cost.
 */
export function VariantEditor({ product, variants, onChange }) {
    const [colors, setColors] = useState(() => [...new Set(variants.map(v => v.color).filter(Boolean))]);
    const [sizes, setSizes] = useState(() => [...new Set(variants.map(v => v.size).filter(Boolean))]);
    const [generating, setGenerating] = useState(false);
    const [qrVariant, setQrVariant] = useState(null);
    const [bulk, setBulk] = useState({ price: '', stock: '' });

    const update = (key, patch) => onChange(variants.map(v => (v.key === key ? { ...v, ...patch } : v)));

    const remove = (variant) => {
        if (variant.isNew) onChange(variants.filter(v => v.key !== variant.key));
        // Saved variants are deactivated (kept for sales history and printed labels)
        else update(variant.key, { is_active: false });
    };

    const fillSkus = async (rows) => {
        const missing = rows.filter(v => !normalize(v.sku));
        if (missing.length === 0) return rows;
        const reserved = rows.map(v => normalize(v.sku)).filter(Boolean);
        const skus = await window.electronAPI.catalog.generateSkus(
            { name: product.name, sku: product.sku },
            missing.map(v => ({ id: v.id || null, color: v.color, size: v.size })),
            reserved
        );
        let i = 0;
        return rows.map(v => (normalize(v.sku) ? v : { ...v, sku: skus[i++] }));
    };

    const generateCombinations = async () => {
        if (!product.name?.trim()) {
            toast.error('Enter the product name first (it is used for the SKUs)');
            return;
        }
        const colorList = colors.length ? colors : [''];
        const sizeList = sizes.length ? sizes : [''];
        if (!colors.length && !sizes.length) {
            toast.error('Add at least one colour or size');
            return;
        }
        const next = [...variants];
        let added = 0;
        for (const color of colorList) {
            for (const size of sizeList) {
                const existing = next.find(v =>
                    (v.color || '').toLowerCase() === color.toLowerCase() && (v.size || '').toLowerCase() === size.toLowerCase());
                if (existing) {
                    if (!existing.is_active) {
                        next[next.indexOf(existing)] = { ...existing, is_active: true };
                        added++;
                    }
                    continue;
                }
                next.push({
                    key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    isNew: true,
                    color, size,
                    sku: '', qr_code: '', barcode: '',
                    price: '', cost: '',
                    stock_quantity: 0, min_stock_level: 2,
                    is_active: true,
                });
                added++;
            }
        }
        setGenerating(true);
        try {
            onChange(await fillSkus(next));
            toast.success(added ? `${added} variant${added > 1 ? 's' : ''} added` : 'All combinations already exist');
        } catch (error) {
            toast.error(error.message);
            onChange(next);
        } finally {
            setGenerating(false);
        }
    };

    const regenerateMissingSkus = async () => {
        setGenerating(true);
        try {
            onChange(await fillSkus(variants));
        } catch (error) {
            toast.error(error.message);
        } finally {
            setGenerating(false);
        }
    };

    const applyBulk = () => {
        onChange(variants.map(v => (v.is_active ? {
            ...v,
            ...(bulk.price !== '' ? { price: bulk.price } : {}),
            ...(bulk.stock !== '' ? { stock_quantity: parseInt(bulk.stock, 10) || 0 } : {}),
        } : v)));
        setBulk({ price: '', stock: '' });
    };

    // Duplicate SKU / barcode detection inside the form (the database is
    // checked again when saving)
    const counts = {};
    for (const v of variants) {
        for (const code of [v.sku, v.barcode]) {
            const c = normalize(code);
            if (c) counts[c] = (counts[c] || 0) + 1;
        }
    }
    const isDuplicate = (code) => !!normalize(code) && counts[normalize(code)] > 1;
    const invalidChars = (code) => !!normalize(code) && !/^[A-Z0-9][A-Z0-9._-]*$/.test(normalize(code));

    const active = variants.filter(v => v.is_active);
    const inactive = variants.filter(v => !v.is_active);
    const totalStock = active.reduce((sum, v) => sum + (parseInt(v.stock_quantity, 10) || 0), 0);

    const regenerateQr = async (variant) => {
        try {
            const updated = await window.electronAPI.catalog.regenerateQr(variant.id);
            update(variant.key, { qr_code: updated.qr_code });
            setQrVariant({ ...variant, qr_code: updated.qr_code });
            toast.success('QR code now matches the SKU. Reprint the labels for this variant.');
        } catch (error) {
            toast.error(error.message);
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <ChipInput label="Colours" values={colors} onChange={setColors} suggestions={COLOR_SUGGESTIONS} placeholder="Type a colour and press Enter" />
                <div>
                    <ChipInput label="Sizes" values={sizes} onChange={setSizes} placeholder="Type a size and press Enter" />
                    <div className="flex flex-wrap gap-1 mt-2">
                        {SIZE_PRESETS.map(p => (
                            <button key={p.label} type="button" onClick={() => setSizes([...new Set([...sizes, ...p.sizes])])}
                                className="px-2 py-0.5 rounded bg-dark-tertiary hover:bg-zinc-700 text-xs text-zinc-400">
                                + {p.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={generateCombinations} loading={generating}>
                    <Wand2 className="w-4 h-4" /> Generate variants
                </Button>
                <Button type="button" variant="secondary" onClick={regenerateMissingSkus} disabled={generating}>
                    <RefreshCw className="w-4 h-4" /> Fill empty SKUs
                </Button>
                <div className="flex items-center gap-2 ml-auto text-sm">
                    <input className="input w-28 py-1.5" placeholder="Price" type="number" step="0.01"
                        value={bulk.price} onChange={(e) => setBulk({ ...bulk, price: e.target.value })} />
                    <input className="input w-24 py-1.5" placeholder="Stock" type="number"
                        value={bulk.stock} onChange={(e) => setBulk({ ...bulk, stock: e.target.value })} />
                    <Button type="button" variant="secondary" size="sm" onClick={applyBulk} disabled={bulk.price === '' && bulk.stock === ''}>
                        Apply to all
                    </Button>
                </div>
            </div>

            {active.length === 0 ? (
                <p className="text-sm text-zinc-500 p-4 bg-dark-tertiary rounded-lg">
                    Add colours and/or sizes, then click “Generate variants”. Remove any combination you do not sell.
                </p>
            ) : (
                <div className="overflow-x-auto border border-dark-border rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="bg-dark-tertiary text-zinc-400 text-xs uppercase">
                            <tr>
                                <th className="px-2 py-2 text-left">Colour</th>
                                <th className="px-2 py-2 text-left">Size</th>
                                <th className="px-2 py-2 text-left">SKU / QR *</th>
                                <th className="px-2 py-2 text-left">Barcode</th>
                                <th className="px-2 py-2 text-left">Price</th>
                                <th className="px-2 py-2 text-left">Cost</th>
                                <th className="px-2 py-2 text-left">Stock</th>
                                <th className="px-2 py-2 text-left">Min</th>
                                <th className="px-2 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {active.map(v => {
                                const skuProblem = isDuplicate(v.sku) ? 'Duplicate SKU' : invalidChars(v.sku) ? 'Use only A-Z, 0-9, - _ .' : !normalize(v.sku) ? 'Required' : '';
                                const qrDiffers = !v.isNew && v.qr_code && normalize(v.qr_code) !== normalize(v.sku);
                                return (
                                    <tr key={v.key} className="border-t border-dark-border align-top">
                                        <td className="px-2 py-1.5"><input className="input py-1 w-24" value={v.color || ''} onChange={(e) => update(v.key, { color: e.target.value })} /></td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-16" value={v.size || ''} onChange={(e) => update(v.key, { size: e.target.value })} /></td>
                                        <td className="px-2 py-1.5">
                                            <input
                                                className={`input py-1 w-40 font-mono uppercase ${skuProblem ? 'border-red-500' : ''}`}
                                                value={v.sku || ''}
                                                onChange={(e) => update(v.key, { sku: e.target.value.toUpperCase() })}
                                                data-scan-passthrough
                                            />
                                            {skuProblem && <div className="text-[11px] text-red-400 mt-0.5">{skuProblem}</div>}
                                            {qrDiffers && <div className="text-[11px] text-amber-400 mt-0.5">Printed QR: {v.qr_code}</div>}
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <input
                                                className={`input py-1 w-32 font-mono ${isDuplicate(v.barcode) ? 'border-red-500' : ''}`}
                                                value={v.barcode || ''}
                                                placeholder="optional"
                                                onChange={(e) => update(v.key, { barcode: e.target.value })}
                                                data-scan-passthrough
                                            />
                                        </td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-24" type="number" step="0.01" placeholder={String(product.price || '')} value={v.price ?? ''} onChange={(e) => update(v.key, { price: e.target.value })} /></td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-24" type="number" step="0.01" placeholder={String(product.cost || '')} value={v.cost ?? ''} onChange={(e) => update(v.key, { cost: e.target.value })} /></td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-20" type="number" value={v.stock_quantity ?? 0} onChange={(e) => update(v.key, { stock_quantity: e.target.value })} /></td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-16" type="number" value={v.min_stock_level ?? 0} onChange={(e) => update(v.key, { min_stock_level: e.target.value })} /></td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                            <button type="button" title="Show QR code" onClick={() => setQrVariant(v)} className="p-1.5 rounded hover:bg-zinc-700" disabled={!normalize(v.sku)}>
                                                <QrCode className="w-4 h-4" />
                                            </button>
                                            <button type="button" title={v.isNew ? 'Remove' : 'Deactivate (kept for history)'} onClick={() => remove(v)} className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>{active.length} active variant{active.length === 1 ? '' : 's'} · total stock {totalStock}</span>
                <span>Empty price/cost uses the base price/cost. SKUs are stored in capitals.</span>
            </div>

            {inactive.length > 0 && (
                <details className="text-sm">
                    <summary className="cursor-pointer text-zinc-400">{inactive.length} inactive variant{inactive.length === 1 ? '' : 's'}</summary>
                    <div className="mt-2 space-y-1">
                        {inactive.map(v => (
                            <div key={v.key} className="flex items-center justify-between px-3 py-1.5 rounded bg-dark-tertiary">
                                <span>{[v.color, v.size].filter(Boolean).join(' / ') || '—'} <span className="font-mono text-zinc-500 ml-2">{v.sku}</span></span>
                                <Button type="button" size="sm" variant="ghost" onClick={() => update(v.key, { is_active: true })}>
                                    <RotateCcw className="w-3 h-3" /> Reactivate
                                </Button>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            <Modal isOpen={!!qrVariant} onClose={() => setQrVariant(null)} title="Variant QR code" size="sm">
                {qrVariant && (
                    <>
                        <ModalBody>
                            <div className="flex flex-col items-center gap-3">
                                <QrPreview value={normalize(qrVariant.isNew ? qrVariant.sku : (qrVariant.qr_code || qrVariant.sku))} size={180} />
                                <div className="text-center">
                                    <div className="font-semibold">{product.name}</div>
                                    <div className="text-zinc-400">{[qrVariant.color, qrVariant.size].filter(Boolean).join(' / ')}</div>
                                    <div className="font-mono text-sm mt-1">{normalize(qrVariant.isNew ? qrVariant.sku : (qrVariant.qr_code || qrVariant.sku))}</div>
                                </div>
                                <p className="text-xs text-zinc-500 text-center">
                                    The QR contains only this identifier — never the price or stock — so it stays valid when prices change.
                                </p>
                            </div>
                        </ModalBody>
                        {!qrVariant.isNew && qrVariant.qr_code && normalize(qrVariant.qr_code) !== normalize(qrVariant.sku) && normalize(qrVariant.sku) === normalize(qrVariant.savedSku) && (
                            <ModalFooter>
                                <p className="text-xs text-amber-400 mr-auto">Labels already printed use the old code and keep working.</p>
                                <Button type="button" variant="secondary" onClick={() => regenerateQr(qrVariant)}>
                                    Use current SKU as QR
                                </Button>
                            </ModalFooter>
                        )}
                    </>
                )}
            </Modal>
        </div>
    );
}

export default VariantEditor;
