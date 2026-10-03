import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { QrCode, Printer, FileDown, Trash2, Search, Barcode, Save, Boxes } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { toast } from '../components/ui/Toast';
import { useSettingsStore } from '../stores/settingsStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

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
    const [templates, setTemplates] = useState({});
    const [layout, setLayout] = useState(null);
    const [printers, setPrinters] = useState([]);
    const [printerName, setPrinterName] = useState('');
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { settings } = useSettingsStore();
    const previewTimer = useRef(null);

    const formatCurrency = (amount) => {
        try {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.currency || 'USD' }).format(amount || 0);
        } catch {
            return String(amount);
        }
    };

    useEffect(() => {
        (async () => {
            try {
                const [productList, tpl, savedLayout, printerSettings, printerList] = await Promise.all([
                    window.electronAPI.products.getAll(),
                    window.electronAPI.labels.getTemplates(),
                    window.electronAPI.labels.getSettings(),
                    window.electronAPI.printers.getSettings(),
                    window.electronAPI.printers.list().catch(() => []),
                ]);
                setProducts(productList);
                setTemplates(tpl.templates);
                setLayout(savedLayout);
                setPrinterName(printerSettings.label.printerName || '');
                setPrinters(printerList);
            } catch (error) {
                toast.error(`Failed to load: ${cleanError(error)}`);
            }
        })();
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
                label: [variant.color, variant.size].filter(Boolean).join(' / '),
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
            toast.success(`${variants.length} variants of ${product.name} added`);
            return;
        }
        if (!product.sku && !product.barcode) {
            toast.error(`"${product.name}" has no SKU or barcode. Edit the product to add one first.`);
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
            toast.error(`Unknown code: ${code}`);
        } else if (result.type === 'variant') {
            addVariant(result.variant, result.product);
            toast.success(`${result.product.name} ${result.variant.label || ''} added`);
        } else {
            addProduct({ ...result.product, variant_count: result.needsVariant ? 1 : 0 });
        }
    });

    const items = queue.map(i => ({ variantId: i.variantId, productId: i.productId, quantity: i.quantity }));
    const totalLabels = queue.reduce((sum, i) => sum + (parseInt(i.quantity, 10) || 0), 0);

    // Live preview (debounced)
    useEffect(() => {
        if (!layout) return undefined;
        clearTimeout(previewTimer.current);
        if (queue.length === 0) {
            setPreview(null);
            return undefined;
        }
        previewTimer.current = setTimeout(async () => {
            try {
                // Preview only the first few labels to keep it fast
                const sample = [];
                let left = layout.mode === 'sheet' ? (layout.columns || 1) * (layout.rows || 1) : 3;
                for (const i of items) {
                    if (left <= 0) break;
                    const qty = Math.min(i.quantity, left);
                    sample.push({ ...i, quantity: qty });
                    left -= qty;
                }
                const result = await window.electronAPI.labels.preview(sample, layout);
                const sampleCount = sample.reduce((sum, i) => sum + i.quantity, 0);
                setPreview({ ...result, pages: layout.mode === 'sheet' ? 1 : Math.max(1, sampleCount) });
            } catch (error) {
                setPreview({ error: cleanError(error) });
            }
        }, 250);
        return () => clearTimeout(previewTimer.current);
    }, [queue, layout]);

    const setLayoutField = (patch) => setLayout(prev => ({ ...prev, ...patch }));

    const chooseTemplate = (id) => {
        if (id === 'custom') setLayoutField({ template: 'custom' });
        else setLayoutField({ template: id, ...(templates[id] || {}), name: undefined });
    };

    const handlePrint = async () => {
        if (totalLabels === 0) return toast.error('Add at least one label');
        setBusy(true);
        try {
            const result = await window.electronAPI.labels.print(items, layout, { printerName });
            if (result?.success) toast.success(`${totalLabels} label${totalLabels > 1 ? 's' : ''} sent to the printer`);
        } catch (error) {
            toast.error(`Printing failed: ${cleanError(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const handlePdf = async () => {
        if (totalLabels === 0) return toast.error('Add at least one label');
        setBusy(true);
        try {
            const file = await window.electronAPI.labels.savePdf(items, layout);
            if (file) toast.success(`Saved ${file}`);
        } catch (error) {
            toast.error(`PDF failed: ${cleanError(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const saveAsDefault = async () => {
        await window.electronAPI.settings.set({ key: 'label_settings', value: layout });
        toast.success('Label layout saved as default');
    };

    const templateOptions = [
        ...Object.entries(templates).map(([id, t]) => ({ value: id, label: t.name })),
        { value: 'custom', label: 'Custom size…' },
    ];

    // Scale the preview page to fit the panel (CSS mm -> px at 96 dpi)
    const previewWidthPx = preview?.page ? preview.page.width * 96 / 25.4 : 0;
    const previewHeightPx = preview?.page ? preview.page.height * 96 / 25.4 : 0;
    const scale = previewWidthPx ? Math.min(1.6, 360 / previewWidthPx) : 1;

    return (
        <div className="h-full flex flex-col overflow-hidden">
            <div className="p-6 border-b border-dark-border flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3"><QrCode className="w-7 h-7 text-accent-primary" /> QR Labels</h1>
                    <p className="text-zinc-500">Print QR labels for products and their colour/size variants. Scan an existing label to reprint it.</p>
                </div>
                <Button variant="secondary" onClick={() => navigate('/barcode-generator')}>
                    <Barcode className="w-4 h-4" /> Other barcode formats
                </Button>
            </div>

            <div className="flex-1 overflow-hidden grid grid-cols-12 gap-0">
                {/* Search & queue */}
                <div className="col-span-7 flex flex-col overflow-hidden border-r border-dark-border">
                    <div className="p-4 border-b border-dark-border relative">
                        <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                        <input
                            className="input pl-10"
                            placeholder="Search product, colour, size or SKU…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (variantResults.length > 0 || simpleMatches.length > 0) && (
                            <div className="absolute left-4 right-4 z-20 mt-1 bg-dark-secondary border border-dark-border rounded-lg shadow-xl max-h-80 overflow-y-auto">
                                {variantResults.map(v => (
                                    <button key={v.id} type="button" onClick={() => { addVariant(v); setQuery(''); }}
                                        className="w-full text-left px-4 py-2 hover:bg-dark-tertiary flex justify-between">
                                        <span>{v.product_name} <span className="text-accent-primary">{[v.color, v.size].filter(Boolean).join(' / ')}</span></span>
                                        <span className="font-mono text-xs text-zinc-500">{v.sku} · stock {v.stock_quantity}</span>
                                    </button>
                                ))}
                                {simpleMatches.map(p => (
                                    <button key={p.id} type="button" onClick={() => { addProduct(p); setQuery(''); }}
                                        className="w-full text-left px-4 py-2 hover:bg-dark-tertiary flex justify-between">
                                        <span>{p.name}</span>
                                        <span className="font-mono text-xs text-zinc-500">{p.sku || p.barcode || 'no code'} · stock {p.stock_quantity}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4">
                        {queue.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-center gap-2">
                                <QrCode className="w-12 h-12 opacity-40" />
                                <p>Search for a product above, open this page from a product, or scan a label.</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="text-xs uppercase text-zinc-500">
                                    <tr>
                                        <th className="text-left py-2">Product</th>
                                        <th className="text-left py-2">QR / SKU</th>
                                        <th className="text-left py-2">Price</th>
                                        <th className="text-left py-2">Labels</th>
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
                                                    <button type="button" className="text-xs text-zinc-400 hover:text-white" title="One label per item in stock"
                                                        onClick={() => setQueue(prev => prev.map(i => (i.key === item.key ? { ...i, quantity: Math.max(1, item.stock || 0) } : i)))}>
                                                        = stock ({item.stock ?? 0})
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="py-2 text-right">
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
                            <span>{totalLabels} label{totalLabels === 1 ? '' : 's'} in total</span>
                            <div className="flex gap-2">
                                <Button variant="ghost" size="sm" onClick={() => setQueue(prev => prev.map(i => ({ ...i, quantity: Math.max(1, i.stock || 0) })))}>
                                    <Boxes className="w-4 h-4" /> All = stock
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setQueue([])}>Clear</Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Layout, printer and preview */}
                <div className="col-span-5 overflow-y-auto p-4 space-y-4">
                    {layout && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <Select label="Label size" value={layout.template || 'roll-40x30'} onChange={chooseTemplate} options={templateOptions} />
                                <Select
                                    label="Printer"
                                    value={printerName}
                                    onChange={setPrinterName}
                                    options={[
                                        { value: '', label: 'Choose in print dialog' },
                                        ...printers.map(p => ({ value: p.name, label: `${p.displayName}${p.isDefault ? ' (default)' : ''}` })),
                                    ]}
                                />
                                {layout.template === 'custom' && (
                                    <>
                                        <Select label="Layout" value={layout.mode || 'roll'} onChange={(v) => setLayoutField({ mode: v })}
                                            options={[{ value: 'roll', label: 'Label roll' }, { value: 'sheet', label: 'Sticker sheet (A4)' }]} />
                                        <div />
                                        <Input label="Width (mm)" type="number" step="0.1" value={layout.widthMm} onChange={(e) => setLayoutField({ widthMm: parseFloat(e.target.value) || '' })} />
                                        <Input label="Height (mm)" type="number" step="0.1" value={layout.heightMm} onChange={(e) => setLayoutField({ heightMm: parseFloat(e.target.value) || '' })} />
                                        {layout.mode === 'sheet' && (
                                            <>
                                                <Input label="Per row" type="number" value={layout.columns} onChange={(e) => setLayoutField({ columns: parseInt(e.target.value, 10) || 1 })} />
                                                <Input label="Rows" type="number" value={layout.rows} onChange={(e) => setLayoutField({ rows: parseInt(e.target.value, 10) || 1 })} />
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                                {[
                                    ['showShopName', 'Shop name'], ['showLogo', 'Logo'], ['showProductName', 'Product'],
                                    ['showVariant', 'Colour / size'], ['showSku', 'SKU'], ['showPrice', 'Price'],
                                ].map(([key, text]) => (
                                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={!!layout[key]} onChange={(e) => setLayoutField({ [key]: e.target.checked })} className="w-4 h-4 rounded" />
                                        {text}
                                    </label>
                                ))}
                            </div>
                            <button type="button" onClick={saveAsDefault} className="text-xs text-zinc-400 hover:text-white flex items-center gap-1">
                                <Save className="w-3 h-3" /> Save this layout as default
                            </button>
                        </>
                    )}

                    <div className="rounded-lg bg-zinc-800 p-4 flex items-start justify-center min-h-[220px] overflow-hidden">
                        {!preview ? (
                            <span className="text-sm text-zinc-500 self-center">Preview appears here</span>
                        ) : preview.error ? (
                            <span className="text-sm text-red-400 self-center">{preview.error}</span>
                        ) : (
                            <div style={{ width: previewWidthPx * scale, height: previewHeightPx * scale * preview.pages }}>
                                <iframe
                                    title="Label preview"
                                    sandbox=""
                                    scrolling="no"
                                    src={`data:text/html;charset=utf-8,${encodeURIComponent(preview.html)}`}
                                    style={{
                                        width: previewWidthPx,
                                        height: previewHeightPx * preview.pages,
                                        transform: `scale(${scale})`,
                                        transformOrigin: 'top left',
                                        background: 'white',
                                        border: 0,
                                    }}
                                />
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-zinc-500">
                        Preview at real proportions ({preview?.page ? `${preview.page.width} × ${preview.page.height} mm page` : '—'}).
                        Test one label first: printers may need the label size set in their Windows driver as well.
                    </p>

                    <div className="flex gap-2">
                        <Button className="flex-1" onClick={handlePrint} loading={busy} disabled={totalLabels === 0}>
                            <Printer className="w-4 h-4" /> Print {totalLabels || ''} label{totalLabels === 1 ? '' : 's'}
                        </Button>
                        <Button variant="secondary" onClick={handlePdf} disabled={busy || totalLabels === 0}>
                            <FileDown className="w-4 h-4" /> PDF
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
