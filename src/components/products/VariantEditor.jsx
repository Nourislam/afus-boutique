import { useState } from 'react';
import { X, Wand2, QrCode, Trash2, RotateCcw, RefreshCw, Plus, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { QrPreview } from './QrPreview';
import { t, currentLanguage } from '../../i18n';
import { COLORS, SIZE_SETS, findColor, colorName, colorHex, sizeLabel, sizeSetLabel } from '../../lib/clothing';

const normalize = (code) => String(code || '').trim().toUpperCase();
const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// A colour in the editor: palette colours are identified by their code, custom
// colours by their typed name.
const colorKey = (c) => (c.code ? `code:${c.code}` : `name:${String(c.name || '').trim().toLowerCase()}`);
const rowColorKey = (v) => {
    const entry = findColor(v.color_code) || findColor(v.color);
    return entry ? `code:${entry.code}` : `name:${String(v.color || '').trim().toLowerCase()}`;
};

function Swatch({ hex, size = 16 }) {
    if (!hex) return <span className="inline-block rounded-full border border-zinc-500" style={{ width: size, height: size }} />;
    const style = hex.startsWith('linear') ? { background: hex } : { backgroundColor: hex };
    return <span className="inline-block rounded-full border border-zinc-600 shrink-0" style={{ width: size, height: size, ...style }} />;
}

/**
 * Colour × size variant builder. `variants` rows:
 * { key, id?, color, color_code, size, sku, qr_code, barcode, price, cost,
 *   stock_quantity, min_stock_level, is_active, isNew }
 * Price/cost left empty fall back to the product's base price/cost.
 */
export function VariantEditor({ product, variants, onChange, suggestedSizeSet }) {
    const lang = currentLanguage();
    const [colors, setColors] = useState(() => {
        const list = [];
        for (const v of variants) {
            const entry = findColor(v.color_code) || findColor(v.color);
            const c = entry ? { code: entry.code } : (v.color ? { code: null, name: v.color } : null);
            if (c && !list.some(x => colorKey(x) === colorKey(c))) list.push(c);
        }
        return list;
    });
    const [customColor, setCustomColor] = useState('');
    const [sizes, setSizes] = useState(() => [...new Set(variants.map(v => v.size).filter(Boolean))]);
    const [customSize, setCustomSize] = useState('');
    const [generating, setGenerating] = useState(false);
    const [qrVariant, setQrVariant] = useState(null);
    const [bulk, setBulk] = useState({ price: '', stock: '' });

    const update = (key, patch) => onChange(variants.map(v => (v.key === key ? { ...v, ...patch } : v)));

    const togglePaletteColor = (code) => {
        setColors(prev => (prev.some(c => c.code === code) ? prev.filter(c => c.code !== code) : [...prev, { code }]));
    };
    const addCustomColor = () => {
        const name = customColor.trim();
        if (!name) return;
        const entry = findColor(name);
        const c = entry ? { code: entry.code } : { code: null, name };
        if (!colors.some(x => colorKey(x) === colorKey(c))) setColors([...colors, c]);
        setCustomColor('');
    };
    const toggleSize = (size) => setSizes(prev => (prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]));
    const addSizes = (list) => setSizes(prev => [...prev, ...list.filter(s => !prev.includes(s))]);
    const addCustomSize = () => {
        const parts = customSize.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (parts.length) addSizes(parts);
        setCustomSize('');
    };

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
            missing.map(v => ({ id: v.id || null, color: v.color, color_code: v.color_code, size: v.size })),
            reserved
        );
        let i = 0;
        return rows.map(v => (normalize(v.sku) ? v : { ...v, sku: skus[i++] }));
    };

    const generateCombinations = async () => {
        if (!product.name?.trim()) {
            toast.error(t('variants.nameFirst'));
            return;
        }
        if (!colors.length && !sizes.length) {
            toast.error(t('variants.addColorOrSize'));
            return;
        }
        const colorList = colors.length ? colors : [null];
        const sizeList = sizes.length ? sizes : [''];
        const next = [...variants];
        let added = 0;
        for (const c of colorList) {
            for (const size of sizeList) {
                const key = c ? colorKey(c) : 'name:';
                const existing = next.find(v => rowColorKey(v) === key && (v.size || '').toLowerCase() === size.toLowerCase());
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
                    // The stored name is in the shop's language; the code keeps it stable
                    color: c ? (c.code ? colorName(c.code, lang) : c.name) : '',
                    color_code: c?.code || null,
                    size,
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
            toast.success(added ? t('variants.added', { n: added }) : t('variants.allExist'));
        } catch (error) {
            toast.error(cleanError(error));
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
            toast.error(cleanError(error));
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
            toast.success(t('variants.qrRegenerated'));
        } catch (error) {
            toast.error(cleanError(error));
        }
    };

    const customColors = colors.filter(c => !c.code);
    const orderedSets = suggestedSizeSet
        ? [suggestedSizeSet, ...SIZE_SETS.filter(s => s.code !== suggestedSizeSet.code)]
        : SIZE_SETS;

    return (
        <div className="space-y-5">
            {/* Colours */}
            <div>
                <label className="form-label">{t('variants.colors')}</label>
                <div className="flex flex-wrap gap-2">
                    {COLORS.map(c => {
                        const selected = colors.some(x => x.code === c.code);
                        return (
                            <button
                                key={c.code}
                                type="button"
                                onClick={() => togglePaletteColor(c.code)}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full text-sm border transition-colors
                                    ${selected ? 'border-accent-primary bg-accent-primary/20 text-white' : 'border-dark-border bg-dark-tertiary text-zinc-300 hover:border-zinc-500'}`}
                            >
                                <Swatch hex={c.hex} />
                                {c[lang] || c.en}
                                {selected && <Check className="w-3 h-3" />}
                            </button>
                        );
                    })}
                    {customColors.map(c => (
                        <span key={colorKey(c)} className="flex items-center gap-2 px-2.5 py-1.5 rounded-full text-sm border border-accent-primary bg-accent-primary/20">
                            <Swatch hex={null} /> {c.name}
                            <button type="button" onClick={() => setColors(colors.filter(x => colorKey(x) !== colorKey(c)))}><X className="w-3 h-3" /></button>
                        </span>
                    ))}
                    <div className="flex items-center gap-1">
                        <input
                            className="input py-1.5 w-40 text-sm"
                            value={customColor}
                            placeholder={t('variants.otherColor')}
                            onChange={(e) => setCustomColor(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomColor(); } }}
                        />
                        <Button type="button" variant="ghost" size="icon" onClick={addCustomColor}><Plus className="w-4 h-4" /></Button>
                    </div>
                </div>
            </div>

            {/* Sizes */}
            <div>
                <label className="form-label">{t('variants.sizes')}</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {orderedSets.map(set => (
                        <button key={set.code} type="button" onClick={() => addSizes(set.sizes)}
                            className={`px-2.5 py-1 rounded text-xs ${set === suggestedSizeSet ? 'bg-accent-primary/30 text-white' : 'bg-dark-tertiary text-zinc-400 hover:bg-zinc-700'}`}>
                            + {sizeSetLabel(set, lang)}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 p-2 min-h-[44px] rounded-lg bg-dark-tertiary border border-dark-border">
                    {sizes.map(s => (
                        <span key={s} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent-primary/20 text-sm">
                            <span className="ltr">{sizeLabel(s, lang)}</span>
                            <button type="button" onClick={() => toggleSize(s)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                        </span>
                    ))}
                    <input
                        value={customSize}
                        onChange={(e) => setCustomSize(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCustomSize(); }
                            else if (e.key === 'Backspace' && !customSize && sizes.length) setSizes(sizes.slice(0, -1));
                        }}
                        onBlur={addCustomSize}
                        placeholder={t('variants.typeSize')}
                        className="flex-1 min-w-[140px] bg-transparent outline-none text-sm px-1"
                    />
                </div>
                <p className="text-xs text-zinc-500 mt-1">{t('variants.sizesHint')}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={generateCombinations} loading={generating}>
                    <Wand2 className="w-4 h-4" /> {t('variants.generate')}
                </Button>
                <Button type="button" variant="secondary" onClick={regenerateMissingSkus} disabled={generating}>
                    <RefreshCw className="w-4 h-4" /> {t('variants.fillSkus')}
                </Button>
                <div className="flex items-center gap-2 ms-auto text-sm">
                    <input className="input w-28 py-1.5" placeholder={t('common.price')} type="number" step="0.01"
                        value={bulk.price} onChange={(e) => setBulk({ ...bulk, price: e.target.value })} />
                    <input className="input w-24 py-1.5" placeholder={t('variants.stock')} type="number"
                        value={bulk.stock} onChange={(e) => setBulk({ ...bulk, stock: e.target.value })} />
                    <Button type="button" variant="secondary" size="sm" onClick={applyBulk} disabled={bulk.price === '' && bulk.stock === ''}>
                        {t('variants.applyAll')}
                    </Button>
                </div>
            </div>

            {active.length === 0 ? (
                <p className="text-sm text-zinc-500 p-4 bg-dark-tertiary rounded-lg">{t('variants.emptyHint')}</p>
            ) : (
                <div className="overflow-x-auto border border-dark-border rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="bg-dark-tertiary text-zinc-400 text-xs">
                            <tr>
                                <th className="px-2 py-2 text-start">{t('variants.color')}</th>
                                <th className="px-2 py-2 text-start">{t('variants.size')}</th>
                                <th className="px-2 py-2 text-start">{t('variants.skuQr')} *</th>
                                <th className="px-2 py-2 text-start">{t('variants.barcode')}</th>
                                <th className="px-2 py-2 text-start">{t('variants.sellPrice')}</th>
                                <th className="px-2 py-2 text-start">{t('variants.buyPrice')}</th>
                                <th className="px-2 py-2 text-start">{t('variants.stock')}</th>
                                <th className="px-2 py-2 text-start">{t('variants.min')}</th>
                                <th className="px-2 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {active.map(v => {
                                const skuProblem = isDuplicate(v.sku) ? t('variants.duplicateSku') : invalidChars(v.sku) ? t('variants.invalidSku') : !normalize(v.sku) ? t('common.required') : '';
                                const qrDiffers = !v.isNew && v.qr_code && normalize(v.qr_code) !== normalize(v.sku);
                                return (
                                    <tr key={v.key} className="border-t border-dark-border align-top">
                                        <td className="px-2 py-1.5">
                                            <div className="flex items-center gap-2 min-w-[110px] pt-1.5">
                                                <Swatch hex={colorHex(v)} />
                                                <span>{colorName(v, lang) || '—'}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <input className="input py-1 w-20 ltr" value={v.size || ''} onChange={(e) => update(v.key, { size: e.target.value.toUpperCase() })} />
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <input
                                                className={`input py-1 w-40 font-mono uppercase ltr ${skuProblem ? 'border-red-500' : ''}`}
                                                value={v.sku || ''}
                                                onChange={(e) => update(v.key, { sku: e.target.value.toUpperCase() })}
                                                data-scan-passthrough
                                            />
                                            {skuProblem && <div className="text-[11px] text-red-400 mt-0.5">{skuProblem}</div>}
                                            {qrDiffers && <div className="text-[11px] text-amber-400 mt-0.5">{t('variants.printedQr')} <span className="ltr font-mono">{v.qr_code}</span></div>}
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <input
                                                className={`input py-1 w-32 font-mono ltr ${isDuplicate(v.barcode) ? 'border-red-500' : ''}`}
                                                value={v.barcode || ''}
                                                placeholder={t('common.optional')}
                                                onChange={(e) => update(v.key, { barcode: e.target.value })}
                                                data-scan-passthrough
                                            />
                                        </td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-24 ltr" type="number" step="0.01" placeholder={String(product.price || '')} value={v.price ?? ''} onChange={(e) => update(v.key, { price: e.target.value })} /></td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-24 ltr" type="number" step="0.01" placeholder={String(product.cost || '')} value={v.cost ?? ''} onChange={(e) => update(v.key, { cost: e.target.value })} /></td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-20 ltr" type="number" value={v.stock_quantity ?? 0} onChange={(e) => update(v.key, { stock_quantity: e.target.value })} /></td>
                                        <td className="px-2 py-1.5"><input className="input py-1 w-16 ltr" type="number" value={v.min_stock_level ?? 0} onChange={(e) => update(v.key, { min_stock_level: e.target.value })} /></td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                            <button type="button" title={t('variants.showQr')} onClick={() => setQrVariant(v)} className="p-1.5 rounded hover:bg-zinc-700" disabled={!normalize(v.sku)}>
                                                <QrCode className="w-4 h-4" />
                                            </button>
                                            <button type="button" title={v.isNew ? t('common.delete') : t('variants.deactivate')} onClick={() => remove(v)} className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
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
            <div className="flex items-center justify-between text-xs text-zinc-500 gap-4">
                <span>{t('variants.summary', { n: active.length, stock: totalStock })}</span>
                <span>{t('variants.priceHint')}</span>
            </div>

            {inactive.length > 0 && (
                <details className="text-sm">
                    <summary className="cursor-pointer text-zinc-400">{t('variants.inactiveCount', { n: inactive.length })}</summary>
                    <div className="mt-2 space-y-1">
                        {inactive.map(v => (
                            <div key={v.key} className="flex items-center justify-between px-3 py-1.5 rounded bg-dark-tertiary">
                                <span>{[colorName(v, lang), sizeLabel(v.size, lang)].filter(Boolean).join(' / ') || '—'} <span className="font-mono text-zinc-500 ms-2 ltr">{v.sku}</span></span>
                                <Button type="button" size="sm" variant="ghost" onClick={() => update(v.key, { is_active: true })}>
                                    <RotateCcw className="w-3 h-3" /> {t('variants.reactivate')}
                                </Button>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            <Modal isOpen={!!qrVariant} onClose={() => setQrVariant(null)} title={t('variants.qrTitle')} size="sm">
                {qrVariant && (
                    <>
                        <ModalBody>
                            <div className="flex flex-col items-center gap-3">
                                <QrPreview value={normalize(qrVariant.isNew ? qrVariant.sku : (qrVariant.qr_code || qrVariant.sku))} size={180} />
                                <div className="text-center">
                                    <div className="font-semibold">{product.name}</div>
                                    <div className="text-zinc-400">{[colorName(qrVariant, lang), sizeLabel(qrVariant.size, lang)].filter(Boolean).join(' / ')}</div>
                                    <div className="font-mono text-sm mt-1 ltr">{normalize(qrVariant.isNew ? qrVariant.sku : (qrVariant.qr_code || qrVariant.sku))}</div>
                                </div>
                                <p className="text-xs text-zinc-500 text-center">{t('variants.qrHint')}</p>
                            </div>
                        </ModalBody>
                        {!qrVariant.isNew && qrVariant.qr_code && normalize(qrVariant.qr_code) !== normalize(qrVariant.sku) && normalize(qrVariant.sku) === normalize(qrVariant.savedSku) && (
                            <ModalFooter>
                                <p className="text-xs text-amber-400 me-auto">{t('variants.oldLabelsWork')}</p>
                                <Button type="button" variant="secondary" onClick={() => regenerateQr(qrVariant)}>
                                    {t('variants.useSkuAsQr')}
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
