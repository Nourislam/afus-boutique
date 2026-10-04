import { useEffect, useMemo, useRef, useState } from 'react';
import { X, QrCode, RotateCcw, Plus, Check, ChevronDown, Barcode, Wand2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { QrPreview } from './QrPreview';
import { t, currentLanguage } from '../../i18n';
import { COLORS, SIZE_SETS, findColor, colorName, colorHex, sizeLabel, sizeSetLabel, sortSizes } from '../../lib/clothing';
import { translateError } from '../../i18n/errors';

const normalize = (code) => String(code || '').trim().toUpperCase();

// A colour is identified by its palette code, or by its typed name
const colorKey = (c) => (c.code ? `code:${c.code}` : `name:${String(c.name || '').trim().toLowerCase()}`);
const rowColorKey = (v) => {
    const entry = findColor(v.color_code) || findColor(v.color);
    if (entry) return `code:${entry.code}`;
    return v.color ? `name:${String(v.color).trim().toLowerCase()}` : 'none';
};
const rowKey = (v) => `${rowColorKey(v)}|${String(v.size || '').toLowerCase()}`;

function Swatch({ hex, size = 14 }) {
    if (!hex) return <span className="inline-block rounded-full border border-dashed border-zinc-500 shrink-0" style={{ width: size, height: size }} />;
    const style = hex.startsWith('linear') ? { background: hex } : { backgroundColor: hex };
    return <span className="inline-block rounded-full ring-1 ring-zinc-600 shrink-0" style={{ width: size, height: size, ...style }} />;
}

function newRow(color, size, lang) {
    return {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        isNew: true,
        // The stored name is in the shop's language; the code keeps it stable
        color: color ? (color.code ? colorName(color.code, lang) : color.name) : '',
        color_code: color?.code || null,
        size: size || '',
        sku: '', qr_code: '', barcode: '',
        price: '', cost: '',
        stock_quantity: 0, min_stock_level: 1,
        is_active: true,
    };
}

/**
 * Colours and sizes of a clothing article. Choosing colours and sizes builds
 * the colour × size grid at once; the shop enters the quantity of each piece
 * in the grid. SKUs (printed in the QR label) are created automatically.
 * Prices per size, barcodes and codes are in "Codes and prices".
 *
 * `variants` rows: { key, id?, color, color_code, size, sku, qr_code, barcode,
 *   price, cost, stock_quantity, min_stock_level, is_active, isNew }
 */
export function VariantEditor({ product, variants, onChange, suggestedSizeSet }) {
    const lang = currentLanguage();
    const [colors, setColors] = useState(() => {
        const list = [];
        for (const v of variants.filter(r => r.is_active)) {
            const entry = findColor(v.color_code) || findColor(v.color);
            const c = entry ? { code: entry.code } : (v.color ? { code: null, name: v.color } : null);
            if (c && !list.some(x => colorKey(x) === colorKey(c))) list.push(c);
        }
        return list;
    });
    const [sizes, setSizes] = useState(() => sortSizes([...new Set(variants.filter(r => r.is_active).map(v => v.size).filter(Boolean))]));
    const [customColor, setCustomColor] = useState('');
    const [customSize, setCustomSize] = useState('');
    const [showAllColors, setShowAllColors] = useState(false);
    const [showCodes, setShowCodes] = useState(false);
    const [fillAll, setFillAll] = useState('');
    const [busy, setBusy] = useState(false);
    const [qrVariant, setQrVariant] = useState(null);
    const variantsRef = useRef(variants);
    variantsRef.current = variants;

    const update = (key, patch) => onChange(variantsRef.current.map(v => (v.key === key ? { ...v, ...patch } : v)));

    // Build / rebuild the grid when the user changes colours or sizes (not when
    // an existing article is opened: removed pieces must stay removed)
    const initialized = useRef(false);
    useEffect(() => {
        if (!initialized.current) {
            initialized.current = true;
            if (variantsRef.current.length > 0) return;
        }
        const current = variantsRef.current;
        const colorList = colors.length ? colors : [null];
        const sizeList = sizes.length ? sizes : [''];
        if (!colors.length && !sizes.length) {
            const next = current.filter(v => !v.isNew).map(v => ({ ...v, is_active: false }));
            if (next.length !== current.length || next.some((v, i) => v.is_active !== current[i]?.is_active)) onChange(next);
            return;
        }
        const wanted = new Set();
        const next = [];
        for (const c of colorList) {
            for (const size of sizeList) {
                const key = `${c ? colorKey(c) : 'none'}|${String(size).toLowerCase()}`;
                wanted.add(key);
                const existing = current.find(v => rowKey(v) === key);
                if (existing) next.push(existing.is_active ? existing : { ...existing, is_active: true });
                else next.push(newRow(c, size, lang));
            }
        }
        // Rows no longer wanted: new ones are dropped, saved ones kept inactive
        for (const v of current) {
            if (!wanted.has(rowKey(v)) && !v.isNew) next.push({ ...v, is_active: false });
        }
        const changed = next.length !== current.length || next.some((v, i) => v !== current[i]);
        if (changed) onChange(next);
    }, [colors, sizes]);

    // New rows get their SKU automatically
    useEffect(() => {
        const missing = variants.filter(v => v.is_active && !normalize(v.sku));
        if (missing.length === 0 || !product.name?.trim()) return undefined;
        const timer = setTimeout(() => generateSkus({ onlyMissing: true, silent: true }), 350);
        return () => clearTimeout(timer);
    }, [variants, product.name, product.sku]);

    const generateSkus = async ({ onlyMissing = false, silent = false } = {}) => {
        if (!product.name?.trim()) {
            if (!silent) toast.error(t('variants.nameFirst'));
            return;
        }
        const rows = variantsRef.current;
        // Saved variants keep their SKU (it is printed on labels); new ones can be redone
        const targets = rows.filter(v => v.is_active && (onlyMissing ? !normalize(v.sku) : (v.isNew || !normalize(v.sku))));
        if (targets.length === 0) {
            if (!silent) toast.success(t('variants.skusUpToDate'));
            return;
        }
        const targetKeys = new Set(targets.map(v => v.key));
        const reserved = rows.filter(v => !targetKeys.has(v.key)).map(v => normalize(v.sku)).filter(Boolean);
        setBusy(true);
        try {
            const skus = await window.electronAPI.catalog.generateSkus(
                { name: product.name, sku: product.sku },
                targets.map(v => ({ id: v.id || null, color: v.color, color_code: v.color_code, size: v.size })),
                reserved
            );
            const byKey = new Map(targets.map((v, i) => [v.key, skus[i]]));
            onChange(variantsRef.current.map(v => (byKey.has(v.key) ? { ...v, sku: byKey.get(v.key) } : v)));
            if (!silent) toast.success(t('variants.skusDone', { n: targets.length }));
        } catch (error) {
            if (!silent) toast.error(translateError(error));
        } finally {
            setBusy(false);
        }
    };

    const generateBarcodes = async () => {
        const rows = variantsRef.current;
        const targets = rows.filter(v => v.is_active && !normalize(v.barcode));
        if (targets.length === 0) return toast.success(t('variants.barcodesUpToDate'));
        setBusy(true);
        try {
            const codes = await window.electronAPI.catalog.generateBarcodes(targets.length, rows.map(v => normalize(v.barcode)).filter(Boolean));
            const byKey = new Map(targets.map((v, i) => [v.key, codes[i]]));
            onChange(rows.map(v => (byKey.has(v.key) ? { ...v, barcode: byKey.get(v.key) } : v)));
            toast.success(t('variants.barcodesDone', { n: targets.length }));
        } catch (error) {
            toast.error(translateError(error));
        } finally {
            setBusy(false);
        }
        return undefined;
    };

    const togglePaletteColor = (code) => setColors(prev => (prev.some(c => c.code === code) ? prev.filter(c => c.code !== code) : [...prev, { code }]));
    const addCustomColor = () => {
        const name = customColor.trim();
        if (!name) return;
        const entry = findColor(name);
        const c = entry ? { code: entry.code } : { code: null, name };
        if (!colors.some(x => colorKey(x) === colorKey(c))) setColors([...colors, c]);
        setCustomColor('');
    };
    const removeColor = (c) => setColors(colors.filter(x => colorKey(x) !== colorKey(c)));
    const toggleSize = (size) => setSizes(prev => (prev.includes(size) ? prev.filter(s => s !== size) : sortSizes([...prev, size])));
    const addSizes = (list) => setSizes(prev => sortSizes([...prev, ...list.filter(s => !prev.includes(s))]));
    const addCustomSize = () => {
        const parts = customSize.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
        if (parts.length) addSizes(parts);
        setCustomSize('');
    };

    const active = variants.filter(v => v.is_active);
    const inactive = variants.filter(v => !v.is_active && !v.isNew);
    const totalStock = active.reduce((sum, v) => sum + (parseInt(v.stock_quantity, 10) || 0), 0);
    const gridColors = colors.length ? colors : [null];
    const gridSizes = sizes.length ? sizes : [''];
    const cell = (c, size) => active.find(v => rowKey(v) === `${c ? colorKey(c) : 'none'}|${String(size).toLowerCase()}`);

    const codeCounts = useMemo(() => {
        const counts = {};
        for (const v of variants) for (const code of [v.sku, v.barcode]) {
            const c = normalize(code);
            if (c) counts[c] = (counts[c] || 0) + 1;
        }
        return counts;
    }, [variants]);
    const isDuplicate = (code) => !!normalize(code) && codeCounts[normalize(code)] > 1;
    const invalidChars = (code) => !!normalize(code) && !/^[A-Z0-9][A-Z0-9._-]*$/.test(normalize(code));
    const problems = active.filter(v => !normalize(v.sku) || isDuplicate(v.sku) || invalidChars(v.sku) || isDuplicate(v.barcode)).length;

    const palette = showAllColors ? COLORS : COLORS.slice(0, 12);
    const orderedSets = suggestedSizeSet ? [suggestedSizeSet, ...SIZE_SETS.filter(s => s.code !== suggestedSizeSet.code)] : SIZE_SETS;

    const regenerateQr = async (variant) => {
        try {
            const updated = await window.electronAPI.catalog.regenerateQr(variant.id);
            update(variant.key, { qr_code: updated.qr_code });
            setQrVariant({ ...variant, qr_code: updated.qr_code });
            toast.success(t('variants.qrRegenerated'));
        } catch (error) {
            toast.error(translateError(error));
        }
    };

    return (
        <div className="space-y-5">
            {/* Colours */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="form-label">{t('variants.colors')}</label>
                    <span className="form-hint">{t('variants.colorsHint')}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {palette.map(c => {
                        const selected = colors.some(x => x.code === c.code);
                        return (
                            <button key={c.code} type="button" onClick={() => togglePaletteColor(c.code)}
                                className={`h-8 flex items-center gap-1.5 px-2.5 rounded-full text-sm border transition-colors
                                    ${selected ? 'border-indigo-400 bg-indigo-500/15 text-white' : 'border-dark-border bg-dark-primary text-zinc-300 hover:border-zinc-500'}`}>
                                <Swatch hex={c.hex} />
                                {c[lang] || c.en}
                                {selected && <Check className="w-3.5 h-3.5 text-indigo-300" />}
                            </button>
                        );
                    })}
                    {!showAllColors && (
                        <button type="button" onClick={() => setShowAllColors(true)} className="h-8 px-3 rounded-full text-sm text-zinc-400 hover:text-white border border-dashed border-dark-border">
                            {t('variants.moreColors', { n: COLORS.length - 12 })}
                        </button>
                    )}
                    {colors.filter(c => !c.code).map(c => (
                        <span key={colorKey(c)} className="h-8 flex items-center gap-1.5 px-2.5 rounded-full text-sm border border-indigo-400 bg-indigo-500/15">
                            <Swatch hex={null} /> {c.name}
                            <button type="button" onClick={() => removeColor(c)} aria-label="remove"><X className="w-3.5 h-3.5" /></button>
                        </span>
                    ))}
                    <div className="flex items-center">
                        <input className="input input-sm w-36" value={customColor} placeholder={t('variants.otherColor')}
                            onChange={(e) => setCustomColor(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomColor(); } }} />
                        <Button type="button" variant="ghost" size="icon" onClick={addCustomColor} aria-label="add"><Plus className="w-4 h-4" /></Button>
                    </div>
                </div>
            </div>

            {/* Sizes */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="form-label">{t('variants.sizes')}</label>
                    <span className="form-hint">{t('variants.sizesHint')}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {orderedSets.map(set => (
                        <button key={set.code} type="button" onClick={() => addSizes(set.sizes)}
                            className={`h-7 px-2.5 rounded-md text-xs border ${set === suggestedSizeSet ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-100' : 'border-dark-border text-zinc-400 hover:text-white hover:border-zinc-600'}`}>
                            + {sizeSetLabel(set, lang)}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 p-2 min-h-[44px] rounded-lg bg-dark-primary border border-dark-border">
                    {sizes.map(s => (
                        <span key={s} className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-indigo-500/15 text-sm">
                            {sizeLabel(s, lang)}
                            <button type="button" onClick={() => toggleSize(s)} className="hover:text-red-300" aria-label="remove"><X className="w-3 h-3" /></button>
                        </span>
                    ))}
                    <input value={customSize} onChange={(e) => setCustomSize(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCustomSize(); }
                            else if (e.key === 'Backspace' && !customSize && sizes.length) setSizes(sizes.slice(0, -1));
                        }}
                        onBlur={addCustomSize}
                        placeholder={t('variants.typeSize')}
                        className="flex-1 min-w-[140px] bg-transparent outline-none text-sm px-1" />
                </div>
            </div>

            {/* Quantity grid */}
            {active.length === 0 ? (
                <p className="text-sm text-zinc-500 p-4 rounded-lg border border-dashed border-dark-border text-center">{t('variants.emptyHint')}</p>
            ) : (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="form-label">{t('variants.quantities')}</span>
                        <div className="flex items-center gap-2">
                            <input className="input input-sm w-24" type="number" min="0" placeholder={t('variants.qty')} value={fillAll}
                                onChange={(e) => setFillAll(e.target.value)} />
                            <Button type="button" variant="secondary" size="sm" disabled={fillAll === ''}
                                onClick={() => { onChange(variants.map(v => (v.is_active ? { ...v, stock_quantity: parseInt(fillAll, 10) || 0 } : v))); setFillAll(''); }}>
                                {t('variants.fillAll')}
                            </Button>
                        </div>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-dark-border">
                        <table className="text-sm">
                            <thead>
                                <tr className="bg-dark-tertiary/60">
                                    <th className="px-3 py-2 text-start text-xs text-zinc-500 font-medium min-w-[120px]">{t('variants.color')} \ {t('variants.size')}</th>
                                    {gridSizes.map(s => <th key={s} className="px-2 py-2 text-center font-semibold min-w-[72px]">{s ? sizeLabel(s, lang) : '—'}</th>)}
                                    <th className="px-3 py-2 text-center text-xs text-zinc-500 font-medium">{t('pos.total')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {gridColors.map(c => {
                                    const rowTotal = gridSizes.reduce((sum, s) => sum + (parseInt(cell(c, s)?.stock_quantity, 10) || 0), 0);
                                    return (
                                        <tr key={c ? colorKey(c) : 'none'} className="border-t border-dark-border">
                                            <td className="px-3 py-1.5">
                                                <span className="flex items-center gap-2 whitespace-nowrap">
                                                    <Swatch hex={c?.code ? colorHex(c.code) : null} />
                                                    {c ? (c.code ? colorName(c.code, lang) : c.name) : '—'}
                                                </span>
                                            </td>
                                            {gridSizes.map(s => {
                                                const v = cell(c, s);
                                                return (
                                                    <td key={s} className="px-1.5 py-1.5 text-center">
                                                        {!v && (
                                                            <button type="button" title={t('variants.addPiece')}
                                                                onClick={() => {
                                                                    const existing = variantsRef.current.find(r => rowKey(r) === `${c ? colorKey(c) : 'none'}|${String(s).toLowerCase()}`);
                                                                    if (existing) update(existing.key, { is_active: true });
                                                                    else onChange([...variantsRef.current, newRow(c, s, lang)]);
                                                                }}
                                                                className="w-16 h-8 rounded-md border border-dashed border-dark-border text-zinc-600 hover:text-white hover:border-zinc-500">
                                                                <Plus className="w-3.5 h-3.5 mx-auto" />
                                                            </button>
                                                        )}
                                                        {v && (
                                                            <input type="number" min="0" aria-label={`${c ? colorName(c.code || c.name, lang) : ''} ${s}`}
                                                                className={`input input-sm w-16 text-center tabular no-spinners ${(parseInt(v.stock_quantity, 10) || 0) > 0 ? 'border-emerald-500/40' : ''}`}
                                                                value={v.stock_quantity ?? 0}
                                                                onFocus={(e) => e.target.select()}
                                                                onChange={(e) => update(v.key, { stock_quantity: e.target.value })} />
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-3 py-1.5 text-center text-zinc-400 tabular">{rowTotal}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-zinc-500">{t('variants.summary', { n: active.length, stock: totalStock })}</p>

                    {/* Codes, barcodes and prices per piece */}
                    <div className="rounded-lg border border-dark-border">
                        <button type="button" onClick={() => setShowCodes(!showCodes)} className="w-full flex items-center justify-between gap-2 px-3 h-10 text-sm">
                            <span className="flex items-center gap-2 font-medium">
                                <QrCode className="w-4 h-4 text-zinc-400" /> {t('variants.codesAndPrices')}
                                {problems > 0 && <span className="badge badge-danger">{t('variants.problems', { n: problems })}</span>}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${showCodes ? 'rotate-180' : ''}`} />
                        </button>
                        {showCodes && (
                            <div className="border-t border-dark-border p-3 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button type="button" size="sm" variant="secondary" onClick={() => generateSkus()} loading={busy}><Wand2 className="w-4 h-4" /> {t('variants.regenerateSkus')}</Button>
                                    <Button type="button" size="sm" variant="secondary" onClick={generateBarcodes} disabled={busy}><Barcode className="w-4 h-4" /> {t('variants.generateBarcodes')}</Button>
                                    <span className="form-hint">{t('variants.priceHint')}</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="text-xs text-zinc-500">
                                            <tr>
                                                <th className="px-2 py-1.5 text-start font-medium">{t('variants.color')} / {t('variants.size')}</th>
                                                <th className="px-2 py-1.5 text-start font-medium">{t('variants.skuQr')}</th>
                                                <th className="px-2 py-1.5 text-start font-medium">{t('variants.barcode')}</th>
                                                <th className="px-2 py-1.5 text-start font-medium">{t('variants.sellPrice')}</th>
                                                <th className="px-2 py-1.5 text-start font-medium">{t('variants.buyPrice')}</th>
                                                <th className="px-2 py-1.5 text-start font-medium">{t('variants.min')}</th>
                                                <th />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {active.map(v => {
                                                const skuProblem = isDuplicate(v.sku) ? t('variants.duplicateSku') : invalidChars(v.sku) ? t('variants.invalidSku') : !normalize(v.sku) ? t('common.required') : '';
                                                const qrDiffers = !v.isNew && v.qr_code && normalize(v.qr_code) !== normalize(v.sku);
                                                return (
                                                    <tr key={v.key} className="border-t border-dark-border/70 align-top">
                                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                                            <span className="flex items-center gap-2 pt-1"><Swatch hex={colorHex(v)} />{[colorName(v, lang), sizeLabel(v.size, lang)].filter(Boolean).join(' / ') || '—'}</span>
                                                        </td>
                                                        <td className="px-2 py-1.5">
                                                            <input className={`input input-sm w-40 font-mono uppercase ltr ${skuProblem ? 'border-red-500' : ''}`} value={v.sku || ''}
                                                                onChange={(e) => update(v.key, { sku: e.target.value.toUpperCase() })} data-scan-passthrough />
                                                            {skuProblem && <div className="text-[11px] text-red-400 mt-0.5">{skuProblem}</div>}
                                                            {qrDiffers && <div className="text-[11px] text-amber-400 mt-0.5">{t('variants.printedQr')} <span className="ltr font-mono">{v.qr_code}</span></div>}
                                                        </td>
                                                        <td className="px-2 py-1.5">
                                                            <input className={`input input-sm w-36 font-mono ltr ${isDuplicate(v.barcode) ? 'border-red-500' : ''}`} value={v.barcode || ''}
                                                                placeholder={t('common.optional')} onChange={(e) => update(v.key, { barcode: e.target.value })} data-scan-passthrough />
                                                        </td>
                                                        <td className="px-2 py-1.5"><input className="input input-sm w-24 ltr" type="number" min="0" placeholder={String(product.price || '')} value={v.price ?? ''} onChange={(e) => update(v.key, { price: e.target.value })} /></td>
                                                        <td className="px-2 py-1.5"><input className="input input-sm w-24 ltr" type="number" min="0" placeholder={String(product.cost || '')} value={v.cost ?? ''} onChange={(e) => update(v.key, { cost: e.target.value })} /></td>
                                                        <td className="px-2 py-1.5"><input className="input input-sm w-16 ltr" type="number" min="0" value={v.min_stock_level ?? 0} onChange={(e) => update(v.key, { min_stock_level: e.target.value })} /></td>
                                                        <td className="px-2 py-1.5">
                                                            <button type="button" title={t('variants.showQr')} onClick={() => setQrVariant(v)} className="p-1.5 rounded hover:bg-dark-tertiary" disabled={!normalize(v.sku)}>
                                                                <QrCode className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {inactive.length > 0 && (
                <details className="text-sm">
                    <summary className="cursor-pointer text-zinc-400">{t('variants.inactiveCount', { n: inactive.length })}</summary>
                    <div className="mt-2 space-y-1">
                        {inactive.map(v => (
                            <div key={v.key} className="flex items-center justify-between px-3 py-1.5 rounded bg-dark-tertiary">
                                <span>{[colorName(v, lang), sizeLabel(v.size, lang)].filter(Boolean).join(' / ') || '—'} <span className="font-mono text-zinc-500 ms-2 ltr">{v.sku}</span></span>
                                <Button type="button" size="sm" variant="ghost" onClick={() => {
                                    const entry = findColor(v.color_code) || findColor(v.color);
                                    const c = entry ? { code: entry.code } : (v.color ? { code: null, name: v.color } : null);
                                    if (c && !colors.some(x => colorKey(x) === colorKey(c))) setColors([...colors, c]);
                                    if (v.size && !sizes.includes(v.size)) addSizes([v.size]);
                                    update(v.key, { is_active: true });
                                }}>
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
                                <Button type="button" variant="secondary" onClick={() => regenerateQr(qrVariant)}>{t('variants.useSkuAsQr')}</Button>
                            </ModalFooter>
                        )}
                    </>
                )}
            </Modal>
        </div>
    );
}

export default VariantEditor;
