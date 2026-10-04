import { t } from '../i18n';
import { formatMoney } from '../i18n/format';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QrCode, Trash2, Search, Boxes } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { toast } from '../components/ui/Toast';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { variantLabel } from '../lib/clothing';
import { LabelLayoutPanel, useLabelSetup, cleanError } from '../components/labels/LabelLayoutPanel';

/**
 * QR label printing for clothing variants (and simple products).
 * Select what to label, how many of each, the label size and the printer.
 * The QR encodes only the variant's identifier; price/name are printed as text.
 */
export default function QrLabelsPage() {
    const [products, setProducts] = useState([]);
    const [query, setQuery] = useState('');
    const [variantResults, setVariantResults] = useState([]);
    const [queue, setQueue] = useState([]); // { key, variantId?, productId?, name, label, sku, price, stock, quantity }
    const [searchParams, setSearchParams] = useSearchParams();
    const setup = useLabelSetup();

    const formatCurrency = (amount) => {
        try {
            return formatMoney(amount || 0);
        } catch {
            return String(amount);
        }
    };

    useEffect(() => {
        window.electronAPI.products.getAll()
            .then(setProducts)
            .catch(error => toast.error(`${t('common.loadFailed')}: ${cleanError(error)}`));
    }, []);

    // Search variants as the user types
    useEffect(() => {
        let cancelled = false;
        if (!query.trim()) {
            setVariantResults([]);
            return undefined;
        }
        window.electronAPI.catalog.searchVariants(query, 30).then((rows) => {
            if (!cancelled) setVariantResults(rows);
        });
        return () => { cancelled = true; };
    }, [query]);

    const simpleMatches = useMemo(() => {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        return products.filter(p => !(p.variant_count > 0) && (
            p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q)
        )).slice(0, 10);
    }, [query, products]);

    const addVariant = (variant, product, quantity = 1) => {
        setQueue(prev => {
            const existing = prev.find(i => i.key === variant.id);
            if (existing) return prev.map(i => (i.key === variant.id ? { ...i, quantity: i.quantity + quantity } : i));
            const price = variant.price ?? product?.price ?? variant.product_price;
            return [...prev, {
                key: variant.id,
                variantId: variant.id,
                name: product?.name || variant.product_name,
                label: variantLabel(variant),
                sku: variant.qr_code || variant.sku,
                price,
                stock: variant.stock_quantity,
                quantity,
            }];
        });
    };

    const addProduct = async (product, { quantityFromStock = false } = {}) => {
        if (product.variant_count > 0) {
            const variants = await window.electronAPI.catalog.getVariants(product.id);
            variants.forEach(v => addVariant(v, product, quantityFromStock ? Math.max(1, v.stock_quantity || 0) : 1));
            toast.success(t('labels.variantsAdded', { n: variants.length, name: product.name }));
            return;
        }
        if (!product.sku && !product.barcode) {
            toast.error(t('labels.noCode', { name: product.name }));
            return;
        }
        setQueue(prev => {
            if (prev.some(i => i.key === product.id)) {
                return prev.map(i => (i.key === product.id ? { ...i, quantity: i.quantity + 1 } : i));
            }
            return [...prev, {
                key: product.id,
                productId: product.id,
                name: product.name,
                label: '',
                sku: product.sku || product.barcode,
                price: product.price,
                stock: product.stock_quantity,
                quantity: quantityFromStock ? Math.max(1, product.stock_quantity || 0) : 1,
            }];
        });
    };

    // Opened from the products page: label every variant of that product
    useEffect(() => {
        const productId = searchParams.get('product');
        if (!productId || products.length === 0) return;
        const product = products.find(p => p.id === productId);
        if (product) addProduct(product, { quantityFromStock: true });
        setSearchParams({}, { replace: true });
    }, [searchParams, products]);

    // Scanning an existing label adds it to the queue (handy for reprints)
    useBarcodeScanner(async (code) => {
        const result = await window.electronAPI.catalog.lookupCode(code);
        if (!result) {
            toast.error(t('qr.unknownCode', { code }));
        } else if (result.type === 'variant') {
            addVariant(result.variant, result.product);
            toast.success(t('labels.added', { name: `${result.product.name} ${result.variant.label || ''}`.trim() }));
        } else {
            addProduct({ ...result.product, variant_count: result.needsVariant ? 1 : 0 });
        }
    });

    const items = useMemo(() => queue.map(i => ({ variantId: i.variantId, productId: i.productId, quantity: i.quantity })), [queue]);
    const totalLabels = queue.reduce((sum, i) => sum + (parseInt(i.quantity, 10) || 0), 0);

    const codeType = setup.layout?.codeType || 'qr';
    const fields = [
        ['showShopName', t('labels.showShopName')],
        ...(codeType === 'qr' ? [['showLogo', t('labels.showLogo')]] : []),
        ['showProductName', t('labels.showProductName')],
        ['showVariant', t('labels.showVariant')],
        ...(codeType === 'qr' ? [['showSku', 'SKU'], ['showBarcode', t('labels.showBarcodeShort')]] : []),
        ['showPrice', t('labels.showPrice')],
    ];

    return (
        <div className="h-full grid grid-cols-1 xl:grid-cols-12 content-start xl:content-stretch overflow-y-auto xl:overflow-hidden">
            {/* Search & queue */}
            <div className="xl:col-span-7 flex flex-col min-h-[360px] xl:overflow-hidden xl:border-e border-dark-border">
                    <div className="p-4 border-b border-dark-border relative">
                        <Search className="absolute start-7 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                        <input
                            className="input ps-10"
                            placeholder={t('qr.search')}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (variantResults.length > 0 || simpleMatches.length > 0) && (
                            <div className="absolute start-4 end-4 z-20 mt-1 bg-dark-secondary border border-dark-border rounded-lg shadow-xl max-h-80 overflow-y-auto">
                                {variantResults.map(v => (
                                    <button key={v.id} type="button" onClick={() => { addVariant(v); setQuery(''); }}
                                        className="w-full text-start px-4 py-2 hover:bg-dark-tertiary flex justify-between">
                                        <span>{v.product_name} <span className="text-accent-primary">{variantLabel(v)}</span></span>
                                        <span className="font-mono text-xs text-zinc-500">{v.sku} · {t('labels.stockN', { n: v.stock_quantity })}</span>
                                    </button>
                                ))}
                                {simpleMatches.map(p => (
                                    <button key={p.id} type="button" onClick={() => { addProduct(p); setQuery(''); }}
                                        className="w-full text-start px-4 py-2 hover:bg-dark-tertiary flex justify-between">
                                        <span>{p.name}</span>
                                        <span className="font-mono text-xs text-zinc-500">{p.sku || p.barcode || t('barcode.noBarcode')} · {t('labels.stockN', { n: p.stock_quantity })}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4">
                        {queue.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-center gap-2">
                                <QrCode className="w-12 h-12 opacity-40" />
                                <p>{t('qr.empty')}</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="text-xs uppercase text-zinc-500">
                                    <tr>
                                        <th className="text-start py-2">{t('inventory.product')}</th>
                                        <th className="text-start py-2">{t('qr.code')}</th>
                                        <th className="text-start py-2">{t('qr.price')}</th>
                                        <th className="text-start py-2">{t('qr.labels')}</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {queue.map(item => (
                                        <tr key={item.key} className="border-t border-dark-border">
                                            <td className="py-2">
                                                <div className="font-medium">{item.name}</div>
                                                {item.label && <div className="text-xs text-accent-primary">{item.label}</div>}
                                            </td>
                                            <td className="py-2 font-mono text-xs">{item.sku}</td>
                                            <td className="py-2">{formatCurrency(item.price)}</td>
                                            <td className="py-2">
                                                <div className="flex items-center gap-2">
                                                    <input type="number" min="1" max="1000" className="input py-1 w-20"
                                                        value={item.quantity}
                                                        onChange={(e) => setQueue(prev => prev.map(i => (i.key === item.key ? { ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) } : i)))} />
                                                    <button type="button" className="text-xs text-zinc-400 hover:text-white" title={t('qr.onePerItem')}
                                                        onClick={() => setQueue(prev => prev.map(i => (i.key === item.key ? { ...i, quantity: Math.max(1, item.stock || 0) } : i)))}>
                                                        {t('labels.eqStock', { n: item.stock ?? 0 })}
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="py-2 text-end">
                                                <button type="button" onClick={() => setQueue(prev => prev.filter(i => i.key !== item.key))}
                                                    className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
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
                        <div className="p-4 border-t border-dark-border flex items-center justify-between text-sm">
                            <span>{t('labels.total', { n: totalLabels })}</span>
                            <div className="flex gap-2">
                                <Button variant="ghost" size="sm" onClick={() => setQueue(prev => prev.map(i => ({ ...i, quantity: Math.max(1, i.stock || 0) })))}>
                                    <Boxes className="w-4 h-4" /> {t('labels.allEqStock')}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setQueue([])}>{t('qr.clear')}</Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Layout, printer and preview */}
                <div className="xl:col-span-5 xl:overflow-y-auto p-4">
                    <LabelLayoutPanel setup={setup} items={items} totalLabels={totalLabels} fields={fields}>
                        <div>
                            <span className="form-label">{t('labels.codeOnLabel')}</span>
                            <div className="segmented w-full">
                                {[['qr', t('labels.codeQr')], ['ean13', 'EAN-13'], ['code128', 'Code 128']].map(([id, text]) => (
                                    <button key={id} type="button" className={`flex-1 ${codeType === id ? 'active' : ''}`}
                                        onClick={() => setup.setLayout(prev => ({ ...prev, codeType: id }))}>{text}</button>
                                ))}
                            </div>
                            {codeType === 'ean13' && <p className="form-hint">{t('labels.ean13Fallback')}</p>}
                        </div>
                    </LabelLayoutPanel>
                </div>
        </div>
    );
}
