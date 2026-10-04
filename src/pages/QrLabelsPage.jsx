import { t } from '../i18n';
import { formatMoney } from '../i18n/format';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QrCode, Trash2, Search, Boxes, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { toast } from '../components/ui/Toast';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { variantLabel } from '../lib/clothing';
import { LabelPrintPanel, useLabelSetup, cleanError } from '../components/labels/LabelLayoutPanel';

/**
 * Labels for the shop's articles. The look (size, shape, code type, what is
 * printed) comes from Settings; here you only choose what to print and how
 * many. With "one code per article" colour and size are not counted: every
 * piece of the article gets the same code. Pieces or articles without a code
 * get a new unique barcode when printing.
 */
export default function QrLabelsPage() {
    const [products, setProducts] = useState([]);
    const [query, setQuery] = useState('');
    const [variantResults, setVariantResults] = useState([]);
    const [queue, setQueue] = useState([]); // { key, variantId?, productId?, name, label, code, price, stock, quantity }
    const [searchParams, setSearchParams] = useSearchParams();
    const setup = useLabelSetup();
    const perArticle = setup.layout?.codeScope === 'article';
    const codeType = setup.layout?.codeType || 'qr';

    const loadProducts = () => window.electronAPI.products.getAll()
        .then(setProducts)
        .catch(error => toast.error(`${t('common.loadFailed')}: ${cleanError(error)}`));
    useEffect(() => { loadProducts(); }, []);

    // The queue is per piece or per article: start again when the setting changes
    useEffect(() => { setQueue([]); }, [perArticle]);

    // Search pieces (colour/size) as the user types
    useEffect(() => {
        let cancelled = false;
        if (!query.trim() || perArticle) {
            setVariantResults([]);
            return undefined;
        }
        window.electronAPI.catalog.searchVariants(query, 30).then((rows) => {
            if (!cancelled) setVariantResults(rows);
        });
        return () => { cancelled = true; };
    }, [query, perArticle]);

    const productMatches = useMemo(() => {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        return products.filter(p => (perArticle || !(p.variant_count > 0)) && (
            p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q)
        )).slice(0, 12);
    }, [query, products, perArticle]);

    const pushLine = (line) => setQueue(prev => {
        const existing = prev.find(i => i.key === line.key);
        if (existing) return prev.map(i => (i.key === line.key ? { ...i, quantity: i.quantity + line.quantity } : i));
        return [...prev, line];
    });

    const articleLine = (product, quantity) => ({
        key: product.id,
        productId: product.id,
        name: product.name,
        label: '',
        code: product.barcode || '',
        price: product.variant_count > 0 && !(Number(product.price) > 0) ? product.min_variant_price : product.price,
        stock: product.stock_quantity,
        quantity,
    });

    const addVariant = (variant, product, quantity = 1) => {
        if (perArticle) {
            const p = product || products.find(x => x.id === variant.product_id);
            if (p) pushLine(articleLine(p, quantity));
            return;
        }
        pushLine({
            key: variant.id,
            variantId: variant.id,
            name: product?.name || variant.product_name,
            label: variantLabel(variant),
            code: codeType === 'ean13' ? (variant.barcode || '') : (variant.qr_code || variant.sku),
            price: variant.price ?? product?.price ?? variant.product_price,
            stock: variant.stock_quantity,
            quantity,
        });
    };

    const addProduct = async (product, { quantityFromStock = false } = {}) => {
        const qty = quantityFromStock ? Math.max(1, product.stock_quantity || 0) : 1;
        if (perArticle) {
            pushLine(articleLine(product, qty));
            return;
        }
        if (product.variant_count > 0) {
            const variants = await window.electronAPI.catalog.getVariants(product.id);
            variants.forEach(v => addVariant(v, product, quantityFromStock ? Math.max(1, v.stock_quantity || 0) : 1));
            toast.success(t('labels.variantsAdded', { n: variants.length, name: product.name }));
            return;
        }
        pushLine({
            key: product.id,
            productId: product.id,
            name: product.name,
            label: '',
            code: codeType === 'ean13' ? (product.barcode || '') : (product.sku || product.barcode || ''),
            price: product.price,
            stock: product.stock_quantity,
            quantity: qty,
        });
    };

    // Everything that still has no barcode, one label per piece in stock
    const addMissing = async () => {
        try {
            const rows = await window.electronAPI.catalog.missingCodes();
            if (!rows.length) return toast.success(t('labels.noneMissing'));
            rows.forEach(r => pushLine({
                key: r.variantId || r.productId,
                variantId: r.variantId,
                productId: r.variantId ? undefined : r.productId,
                name: r.name,
                label: r.variantId ? variantLabel(r) : '',
                code: '',
                price: r.price,
                stock: r.stock,
                quantity: Math.max(1, r.stock || 0),
            }));
            toast.success(t('labels.missingAdded', { n: rows.length }));
        } catch (error) {
            toast.error(cleanError(error));
        }
        return undefined;
    };

    // Opened from the products page: label that article (every piece in stock)
    useEffect(() => {
        const productId = searchParams.get('product');
        if (!productId || products.length === 0 || !setup.layout) return;
        const product = products.find(p => p.id === productId);
        if (product) addProduct(product, { quantityFromStock: true });
        setSearchParams({}, { replace: true });
    }, [searchParams, products, setup.layout]);

    // Scanning an existing label adds it again (handy for reprints)
    useBarcodeScanner(async (code) => {
        const result = await window.electronAPI.catalog.lookupCode(code);
        if (!result) {
            toast.error(t('qr.unknownCode', { code }));
        } else if (result.type === 'variant') {
            addVariant(result.variant, result.product);
            toast.success(t('labels.added', { name: `${result.product.name} ${perArticle ? '' : result.variant.label || ''}`.trim() }));
        } else {
            addProduct({ ...result.product, variant_count: result.needsVariant ? 1 : 0 });
        }
    });

    const items = useMemo(() => queue.map(i => ({ variantId: i.variantId, productId: i.productId, quantity: i.quantity })), [queue]);
    const totalLabels = queue.reduce((sum, i) => sum + (parseInt(i.quantity, 10) || 0), 0);
    const newCodes = queue.filter(i => !i.code).length;

    return (
        <div className="h-full grid grid-cols-1 xl:grid-cols-12 content-start xl:content-stretch overflow-y-auto xl:overflow-hidden">
            {/* Search & queue */}
            <div className="xl:col-span-7 flex flex-col min-h-[360px] xl:overflow-hidden xl:border-e border-dark-border">
                <div className="p-4 border-b border-dark-border flex flex-wrap gap-2 items-start">
                    <div className="relative flex-1 min-w-[240px]">
                        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 pointer-events-none" />
                        <input
                            className="input ps-10"
                            placeholder={perArticle ? t('labels.searchArticle') : t('qr.search')}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (variantResults.length > 0 || productMatches.length > 0) && (
                            <div className="absolute start-0 end-0 z-20 mt-1 bg-dark-secondary border border-dark-border rounded-lg shadow-xl max-h-80 overflow-y-auto">
                                {variantResults.map(v => (
                                    <button key={v.id} type="button" onClick={() => { addVariant(v); setQuery(''); }}
                                        className="w-full text-start px-4 py-2 hover:bg-dark-tertiary flex justify-between gap-3">
                                        <span className="min-w-0 truncate">{v.product_name} <span className="text-accent-primary">{variantLabel(v)}</span></span>
                                        <span className="font-mono text-xs text-zinc-500 flex-none">{t('labels.stockN', { n: v.stock_quantity })}</span>
                                    </button>
                                ))}
                                {productMatches.map(p => (
                                    <button key={p.id} type="button" onClick={() => { addProduct(p, { quantityFromStock: perArticle }); setQuery(''); }}
                                        className="w-full text-start px-4 py-2 hover:bg-dark-tertiary flex justify-between gap-3">
                                        <span className="min-w-0 truncate">{p.name}{p.brand ? <span className="text-zinc-500"> · {p.brand}</span> : null}</span>
                                        <span className="font-mono text-xs text-zinc-500 flex-none">{p.barcode || t('barcode.noBarcode')} · {t('labels.stockN', { n: p.stock_quantity })}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <Button variant="secondary" onClick={addMissing} title={t('labels.addMissingHint')}>
                        <Wand2 className="w-4 h-4" /> {t('labels.addMissing')}
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {queue.length === 0 ? (
                        <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-zinc-500 text-center gap-2 max-w-md mx-auto">
                            <QrCode className="w-12 h-12 opacity-40" />
                            <p>{perArticle ? t('labels.emptyArticle') : t('qr.empty')}</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="text-xs text-zinc-500">
                                <tr>
                                    <th className="text-start py-2 font-medium">{t('inventory.product')}</th>
                                    <th className="text-start py-2 font-medium">{t('labels.codeCol')}</th>
                                    <th className="text-start py-2 font-medium">{t('qr.price')}</th>
                                    <th className="text-start py-2 font-medium">{t('qr.labels')}</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {queue.map(item => (
                                    <tr key={item.key} className="border-t border-dark-border">
                                        <td className="py-2 pe-2">
                                            <div className="font-medium truncate max-w-[220px]">{item.name}</div>
                                            {item.label && <div className="text-xs text-accent-primary">{item.label}</div>}
                                        </td>
                                        <td className="py-2 pe-2">
                                            {item.code
                                                ? <span className="font-mono text-xs ltr">{item.code}</span>
                                                : <span className="badge badge-primary"><Sparkles className="w-3 h-3" /> {t('labels.newCode')}</span>}
                                        </td>
                                        <td className="py-2 pe-2 whitespace-nowrap tabular">{formatMoney(item.price || 0)}</td>
                                        <td className="py-2">
                                            <div className="flex items-center gap-2">
                                                <input type="number" min="1" max="1000" className="input input-sm w-20 tabular"
                                                    value={item.quantity}
                                                    onChange={(e) => setQueue(prev => prev.map(i => (i.key === item.key ? { ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) } : i)))} />
                                                <button type="button" className="text-xs text-zinc-400 hover:text-white whitespace-nowrap" title={t('qr.onePerItem')}
                                                    onClick={() => setQueue(prev => prev.map(i => (i.key === item.key ? { ...i, quantity: Math.max(1, item.stock || 0) } : i)))}>
                                                    {t('labels.eqStock', { n: item.stock ?? 0 })}
                                                </button>
                                            </div>
                                        </td>
                                        <td className="py-2 text-end">
                                            <button type="button" onClick={() => setQueue(prev => prev.filter(i => i.key !== item.key))}
                                                className="p-1.5 rounded hover:bg-red-500/20 text-red-400" aria-label={t('common.delete')}>
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {queue.length > 0 && (
                    <div className="p-4 border-t border-dark-border flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                            {t('labels.total', { n: totalLabels })}
                            {newCodes > 0 && <span className="text-indigo-300"> · {t('labels.willCreate', { n: newCodes })}</span>}
                        </span>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setQueue(prev => prev.map(i => ({ ...i, quantity: Math.max(1, i.stock || 0) })))}>
                                <Boxes className="w-4 h-4" /> {t('labels.allEqStock')}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setQueue([])}>{t('qr.clear')}</Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Preview and printing (the look is set in Settings) */}
            <div className="xl:col-span-5 xl:overflow-y-auto p-4">
                <LabelPrintPanel setup={setup} items={items} totalLabels={totalLabels}
                    onPrinted={(result) => { if (result?.created) { loadProducts(); setQueue([]); } }} />
            </div>
        </div>
    );
}
