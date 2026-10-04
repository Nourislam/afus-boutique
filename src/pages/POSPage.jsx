import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { translateError } from '../i18n/errors';
import { useNavigate } from 'react-router-dom';
import {
    Search, ShoppingBag, Pause, Trash2, Plus, Minus, SlidersHorizontal, Shirt, ScanLine, UserRound, X,
    LayoutGrid, List, Tag, Percent, Banknote, ChevronDown, History, Check,
} from 'lucide-react';
import { useCartStore, heldLines } from '../stores/cartStore';
import { useAuthStore, PERMISSIONS } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { toast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import ReceiptPreviewModal from '../components/modals/ReceiptPreviewModal';
import CartOptionsModal from '../components/modals/CartOptionsModal';
import PaymentModal from '../components/pos/PaymentModal';
import { afterSaleMode } from '../components/settings/PrinterSettingsForm';
import CustomerPickerModal from '../components/pos/CustomerPickerModal';
import OpeningCashDialog from '../components/shifts/OpeningCashDialog';
import { VariantPickerModal } from '../components/pos/VariantPickerModal';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { colorHex, colorName, sortSizes, variantLabel } from '../lib/clothing';
import { formatMoney } from '../i18n/format';
import { formatDate as formatLocalDate } from '../i18n/format';
import { t } from '../i18n';
import { beep } from '../lib/sound';

const VIEW_KEY = 'pos_view';

function readView() {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}

/** Colour dots and available sizes shown on a product card. */
function VariantHints({ product }) {
    const colors = (product.variant_colors || '').split(',').filter(Boolean);
    const sizes = sortSizes((product.sizes_in_stock || '').split(',').filter(Boolean));
    if (!colors.length && !sizes.length) return null;
    return (
        <div className="flex items-center justify-between gap-2 mt-1.5 min-h-[14px]">
            <div className="flex items-center -space-x-1 rtl:space-x-reverse">
                {colors.slice(0, 5).map(c => (
                    <span key={c} title={colorName(c)} className="w-3.5 h-3.5 rounded-full border border-dark-secondary ring-1 ring-zinc-700"
                        style={{ background: colorHex(c) || '#52525b' }} />
                ))}
                {colors.length > 5 && <span className="text-[10px] text-zinc-500 ps-1.5">+{colors.length - 5}</span>}
            </div>
            {sizes.length > 0 && (
                <span className="text-[10px] text-zinc-400 truncate ltr">
                    {sizes.length > 4 ? `${sizes[0]}–${sizes[sizes.length - 1]}` : sizes.join(' ')}
                </span>
            )}
        </div>
    );
}

function ProductImage({ product, className = '' }) {
    return (
        <div className={`bg-dark-tertiary rounded-lg flex items-center justify-center overflow-hidden ${className}`}>
            {product.image_path
                ? <img src={`app://${product.image_path}`} alt="" className="w-full h-full object-cover" loading="lazy" />
                : <Shirt className="w-8 h-8 text-zinc-600" />}
        </div>
    );
}

export default function POSPage() {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedBrand, setSelectedBrand] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [view, setView] = useState(readView);
    const [heldTransactions, setHeldTransactions] = useState([]);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showHeldModal, setShowHeldModal] = useState(false);
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [showOptionsModal, setShowOptionsModal] = useState(false);
    const [showCustomerModal, setShowCustomerModal] = useState(false);
    const [receiptData, setReceiptData] = useState(null);
    const [variantProduct, setVariantProduct] = useState(null);
    const [unknownCode, setUnknownCode] = useState(null);
    const [editingLine, setEditingLine] = useState(null);
    const [shift, setShift] = useState(undefined); // undefined = loading, null = no open drawer
    const [showOpenDrawer, setShowOpenDrawer] = useState(false);
    const [lastSale, setLastSale] = useState(null);
    const searchRef = useRef(null);
    const navigate = useNavigate();

    const cart = useCartStore();
    const { currentEmployee, hasPermission } = useAuthStore();
    const features = useSettingsStore(state => state.settings.features);
    const money = (amount) => formatMoney(amount);
    const canDiscount = hasPermission(PERMISSIONS.POS_APPLY_DISCOUNT);

    const anyModalOpen = showPaymentModal || showHeldModal || showReceiptModal || showOptionsModal || showCustomerModal
        || !!unknownCode || !!variantProduct || showOpenDrawer;

    const loadShift = useCallback(async () => {
        if (!currentEmployee) return;
        try { setShift(await window.electronAPI.shifts.getCurrent(currentEmployee.id) || null); } catch { setShift(null); }
    }, [currentEmployee]);

    useEffect(() => {
        loadData();
        loadShift();
        cart.loadSettings();
        cart.loadPromotions();
        searchRef.current?.focus();
    }, []);

    useEffect(() => {
        try { localStorage.setItem(VIEW_KEY, view); } catch { /* per-computer preference only */ }
    }, [view]);

    // USB barcode/QR scanner: works wherever the focus is on this screen
    useBarcodeScanner((code) => handleCode(code, { fromScanner: true }), { isActive: () => !anyModalOpen });

    const loadData = async () => {
        try {
            const [productsData, categoriesData, heldData, bundlesData] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.categories.getAll(),
                window.electronAPI.held.getAll(),
                window.electronAPI.bundles.getActive(),
            ]);
            const normalizedBundles = bundlesData.map(b => ({
                ...b,
                price: b.bundle_price,
                category_id: 'bundles',
                stock_quantity: b.deduct_component_stock ? 999 : (b.stock_quantity || 0),
                is_bundle: true,
            }));
            const showBundles = features?.bundles !== false && normalizedBundles.length > 0;
            setProducts([...productsData.filter(p => p.is_active), ...(showBundles ? normalizedBundles : [])]);
            setCategories([...categoriesData, ...(showBundles ? [{ id: 'bundles', name: t('pos.bundles'), color: '#8b5cf6' }] : [])]);
            setHeldTransactions(heldData);
        } catch (error) {
            console.error('Failed to load data:', error);
            toast.error(t('pos.loadFailed'));
        }
    };

    const addToCart = (product, variant = null, { fromScanner = false } = {}) => {
        const result = cart.addItem(product, 1, variant);
        if (!result.success) {
            beep('error');
            toast.error(result.message);
            return false;
        }
        if (fromScanner) beep('ok');
        return true;
    };

    // Resolve a scanned or typed code (variant QR/SKU/barcode, product SKU/barcode)
    const handleCode = async (rawCode, { fromScanner = false } = {}) => {
        const code = String(rawCode || '').trim();
        if (!code) return;
        try {
            const result = await window.electronAPI.catalog.lookupCode(code);
            if (!result) {
                if (fromScanner) {
                    beep('error');
                    setUnknownCode(code);
                } else if (filteredProducts.length === 1) {
                    setSearchQuery('');
                    handleProductClick(filteredProducts[0]);
                } else if (filteredProducts.length === 0) {
                    toast.error(t('pos.noMatch', { code }));
                }
                return;
            }
            setSearchQuery('');
            if (result.type === 'variant') {
                setVariantProduct(null);
                addToCart(result.product, result.variant, { fromScanner });
            } else if (result.needsVariant) {
                setVariantProduct(result.product);
            } else {
                addToCart(result.product, null, { fromScanner });
            }
        } catch (error) {
            console.error('Code lookup failed:', error);
            toast.error(t('pos.lookupFailed'));
        }
    };

    const handleProductClick = (product) => {
        if (product.is_bundle) addToCart(product);
        else if (product.variant_count > 0) setVariantProduct(product);
        else addToCart(product);
    };

    const brands = useMemo(() => [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [products]);

    const filteredProducts = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return products.filter(product => {
            if (selectedCategory !== 'all' && product.category_id !== selectedCategory) return false;
            if (selectedBrand && product.brand !== selectedBrand) return false;
            if (!q) return true;
            return product.name.toLowerCase().includes(q)
                || product.brand?.toLowerCase().includes(q)
                || product.sku?.toLowerCase().includes(q)
                || product.barcode?.toLowerCase().includes(q);
        });
    }, [products, selectedCategory, selectedBrand, searchQuery]);

    const countByCategory = useMemo(() => {
        const counts = {};
        for (const p of products) counts[p.category_id] = (counts[p.category_id] || 0) + 1;
        return counts;
    }, [products]);

    const handleHoldTransaction = async () => {
        if (cart.items.length === 0) return;
        try {
            await cart.holdTransaction(currentEmployee?.id);
            setHeldTransactions(await window.electronAPI.held.getAll());
            toast.success(t('pos.held'));
            searchRef.current?.focus();
        } catch {
            toast.error(t('pos.holdFailed'));
        }
    };

    const handleRecallTransaction = async (held) => {
        if (cart.items.length > 0) await cart.holdTransaction(currentEmployee?.id);
        cart.recallTransaction(held);
        await window.electronAPI.held.delete(held.id);
        setHeldTransactions(await window.electronAPI.held.getAll());
        setShowHeldModal(false);
        toast.success(t('pos.recalled'));
    };

    const startPayment = () => {
        if (cart.items.length === 0) return;
        // Every sale belongs to an open cash drawer, so the closing totals are right
        if (!shift) {
            setShowOpenDrawer(true);
            return;
        }
        setShowPaymentModal(true);
    };

    // Keyboard shortcuts of the sales screen
    useEffect(() => {
        const onKey = (e) => {
            if (anyModalOpen) return;
            if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
            else if (e.key === 'F4') { e.preventDefault(); startPayment(); }
            else if (e.key === 'F8') { e.preventDefault(); handleHoldTransaction(); }
            else if (e.key === 'F9') { e.preventDefault(); setShowHeldModal(true); }
            else if (e.key === 'Escape' && document.activeElement === searchRef.current) setSearchQuery('');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const handlePaymentComplete = async (payments, creditCustomer = null, dueDate = null) => {
        try {
            const sale = await cart.processPayment(payments, currentEmployee.id, currentEmployee.name);

            if (payments[0]?.method === 'credit' && creditCustomer) {
                try {
                    const creditSale = await window.electronAPI.creditSales.create({
                        sale_id: sale.id,
                        customer_id: creditCustomer.id,
                        amount_due: sale.total,
                        amount_paid: 0,
                        status: 'pending',
                        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
                        notes: t('pos.creditNote', { n: sale.receipt_number }),
                    });
                    sale.due_date = dueDate ? new Date(dueDate).toISOString() : undefined;
                    sale.customer_name = creditCustomer.name;
                    toast.success(t('pos.creditCreated', { n: creditSale.invoice_number }));
                } catch (creditError) {
                    console.error('Failed to create credit sale:', creditError);
                    toast.error(t('pos.creditFailed'));
                }
            } else {
                toast.success(t('pos.saleCompleted', { n: sale.receipt_number }));
            }

            const cashPayment = payments.find(p => p.method === 'cash');
            let tendered = 0;
            try { tendered = cashPayment?.reference ? JSON.parse(cashPayment.reference).tendered || 0 : 0; } catch { tendered = 0; }
            setLastSale({ ...sale, change: tendered > 0 ? tendered - (cashPayment?.amount || 0) : 0 });

            // After the sale: print the ticket, show it, or nothing (Settings › ticket printer)
            try {
                const printerSettings = await window.electronAPI.printers.getSettings();
                const mode = afterSaleMode(printerSettings?.receipt);
                if (mode === 'print') {
                    window.electronAPI.receipts.print(sale)
                        .then((ok) => ok && toast.success(t('pos.printed')))
                        .catch((printError) => toast.error(t('pos.notPrinted', { error: translateError(printError) })));
                } else if (mode === 'preview') {
                    setReceiptData(sale);
                    setShowReceiptModal(true);
                }
            } catch (printError) {
                console.error('Receipt handling failed:', printError);
            }

            setShowPaymentModal(false);
            loadData();
            cart.loadPromotions();
        } catch (error) {
            toast.error(translateError(error));
        }
    };

    const promo = cart.getPromotion();
    const manualDiscount = cart.getManualDiscount();
    const taxAmount = cart.getTaxAmount();
    const total = cart.getTotal();
    const itemCount = cart.getItemCount();

    return (
        <div className="h-full flex overflow-hidden">
            {/* ---------------- Articles */}
            <section className="flex-1 min-w-0 flex flex-col">
                <div className="flex-none px-5 pt-4 pb-3 space-y-3 border-b border-dark-border">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 pointer-events-none" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && searchQuery.trim()) {
                                        e.preventDefault();
                                        handleCode(searchQuery);
                                    }
                                }}
                                placeholder={t('pos.searchPlaceholder')}
                                className="input h-11 ps-10 pe-24 text-base"
                            />
                            <span className="absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[11px] text-emerald-300 bg-emerald-500/10 rounded-md px-2 py-1 pointer-events-none">
                                <ScanLine className="w-3.5 h-3.5" /> {t('pos.scannerReady')}
                            </span>
                        </div>
                        {brands.length > 0 && (
                            <div className="relative">
                                <Tag className="absolute start-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                <select
                                    value={selectedBrand}
                                    onChange={(e) => setSelectedBrand(e.target.value)}
                                    className="input h-11 w-44 ps-8 pe-7 appearance-none cursor-pointer"
                                    aria-label={t('brands.title')}
                                >
                                    <option value="">{t('pos.allBrands')}</option>
                                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                                <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                            </div>
                        )}
                        <div className="segmented h-11">
                            <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title={t('pos.viewGrid')}><LayoutGrid className="w-4 h-4" /></button>
                            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title={t('pos.viewList')}><List className="w-4 h-4" /></button>
                        </div>
                    </div>

                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                        {[{ id: 'all', name: t('pos.allProducts'), color: null }, ...categories].map(cat => {
                            const active = selectedCategory === cat.id;
                            const count = cat.id === 'all' ? products.length : (countByCategory[cat.id] || 0);
                            if (cat.id !== 'all' && count === 0) return null;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => setSelectedCategory(cat.id)}
                                    className={`h-8 px-3 rounded-full text-sm font-medium whitespace-nowrap flex items-center gap-2 border transition-colors
                                        ${active ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-dark-secondary border-dark-border text-zinc-300 hover:border-zinc-600'}`}
                                >
                                    {cat.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />}
                                    {cat.name}
                                    <span className={`text-xs ${active ? 'text-indigo-100' : 'text-zinc-500'}`}>{count}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {!shift && shift !== undefined && (
                    <div className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm">
                        <span className="text-amber-200">{t('pos.drawerClosed')}</span>
                        <Button size="sm" variant="warning" onClick={() => setShowOpenDrawer(true)}><Banknote className="w-4 h-4" /> {t('pos.openDrawer')}</Button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-5">
                    {filteredProducts.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
                            <ShoppingBag className="w-12 h-12 opacity-40" />
                            <p>{t('pos.noProducts')}</p>
                            <p className="text-sm text-zinc-600">{t('pos.scanHint')}</p>
                        </div>
                    ) : view === 'grid' ? (
                        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(156px, 1fr))' }}>
                            {filteredProducts.map(product => {
                                const out = product.stock_quantity <= 0;
                                const low = !out && product.stock_quantity <= product.min_stock_level;
                                const price = product.variant_count > 0 ? product.min_variant_price : product.price;
                                return (
                                    <button
                                        key={product.id}
                                        onClick={() => handleProductClick(product)}
                                        className={`product-card text-start flex flex-col ${out ? 'opacity-45' : ''}`}
                                        disabled={out}
                                    >
                                        <div className="relative">
                                            <ProductImage product={product} className="aspect-[4/5] w-full" />
                                            <span className={`absolute top-1.5 end-1.5 badge ${out ? 'badge-danger' : low ? 'badge-warning' : 'bg-black/60 text-zinc-200'}`}>
                                                {out ? t('variants.outOfStock') : product.stock_quantity}
                                            </span>
                                        </div>
                                        <p className="mt-2 font-medium text-sm leading-tight line-clamp-2 min-h-[2.5em]">{product.name}</p>
                                        {product.brand && <p className="text-[11px] text-zinc-500 truncate">{product.brand}</p>}
                                        <p className="mt-1 text-indigo-300 font-bold tabular">
                                            {money(price)}{product.variant_count > 0 && product.min_variant_price !== product.max_variant_price ? '+' : ''}
                                        </p>
                                        <VariantHints product={product} />
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="table-container">
                            <table className="table">
                                <tbody>
                                    {filteredProducts.map(product => {
                                        const out = product.stock_quantity <= 0;
                                        const price = product.variant_count > 0 ? product.min_variant_price : product.price;
                                        return (
                                            <tr key={product.id} className={`cursor-pointer ${out ? 'opacity-45' : ''}`} onClick={() => !out && handleProductClick(product)}>
                                                <td className="w-14"><ProductImage product={product} className="w-10 h-12" /></td>
                                                <td>
                                                    <p className="font-medium">{product.name}</p>
                                                    <p className="text-xs text-zinc-500">{[product.brand, product.category_name].filter(Boolean).join(' · ')}</p>
                                                </td>
                                                <td className="w-48"><VariantHints product={product} /></td>
                                                <td className="w-20 text-zinc-400 tabular">{product.stock_quantity}</td>
                                                <td className="w-32 text-end font-semibold text-indigo-300 tabular">{money(price)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>

            {/* ---------------- Ticket */}
            <aside className="w-[380px] xl:w-[420px] flex-none flex flex-col bg-dark-secondary border-s border-dark-border min-h-0">
                <div className="flex-none px-4 pt-4 pb-3 border-b border-dark-border space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="font-semibold flex items-center gap-2">
                            <ShoppingBag className="w-5 h-5 text-indigo-400" />
                            {t('pos.ticket')}
                            {itemCount > 0 && <span className="badge badge-primary">{t('pos.pieces', { n: itemCount })}</span>}
                        </h2>
                        <Button variant="secondary" size="sm" onClick={() => setShowHeldModal(true)} title="F9">
                            <History className="w-4 h-4" /> {t('pos.fittingRoom')}
                            {heldTransactions.length > 0 && <span className="badge bg-amber-500/20 text-amber-300">{heldTransactions.length}</span>}
                        </Button>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowCustomerModal(true)}
                        className="w-full h-10 px-3 rounded-lg border border-dashed border-dark-border hover:border-zinc-600 flex items-center gap-2 text-sm text-start"
                    >
                        <UserRound className="w-4 h-4 text-zinc-500" />
                        {cart.customer ? (
                            <>
                                <span className="font-medium truncate">{cart.customer.name}</span>
                                {cart.customer.phone && <span className="text-zinc-500 ltr truncate">{cart.customer.phone}</span>}
                                <span className="flex-1" />
                                <X className="w-4 h-4 text-zinc-500 hover:text-white" onClick={(e) => { e.stopPropagation(); cart.setCustomer(null); }} />
                            </>
                        ) : (
                            <span className="text-zinc-500">{t('pos.addCustomer')}</span>
                        )}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {cart.items.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 gap-2 px-6">
                            <ScanLine className="w-12 h-12 opacity-40" />
                            <p className="font-medium text-zinc-400">{t('pos.cartEmpty')}</p>
                            <p className="text-sm">{t('pos.cartEmptyHint')}</p>
                            {lastSale && (
                                <div className="mt-4 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                                    <p className="font-semibold flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> {t('pos.lastSale', { n: lastSale.receipt_number })}</p>
                                    <p className="tabular mt-1">{money(lastSale.total)}{lastSale.change > 0 ? ` · ${t('pos.changeGiven', { amount: money(lastSale.change) })}` : ''}</p>
                                </div>
                            )}
                        </div>
                    ) : cart.items.map(item => {
                        const isEditing = editingLine === item.id;
                        const bargained = item.original_price && item.unit_price < item.original_price;
                        const hex = colorHex(item);
                        return (
                            <div key={item.id} className={`rounded-xl border transition-colors ${item.id === cart.lastAddedId ? 'border-indigo-500/60 bg-indigo-500/5 animate-fade-in' : 'border-dark-border bg-dark-tertiary/40'}`}>
                                <div className="flex items-start gap-3 p-2.5">
                                    <ProductImage product={item} className="w-11 h-14 flex-none" />
                                    <button type="button" className="flex-1 min-w-0 text-start" onClick={() => setEditingLine(isEditing ? null : item.id)}>
                                        <p className="font-medium text-sm truncate">{item.product_name}</p>
                                        {(item.color || item.size || item.variant_label) && (
                                            <p className="text-xs text-zinc-300 flex items-center gap-1.5 mt-0.5">
                                                {hex && <span className="w-2.5 h-2.5 rounded-full ring-1 ring-zinc-600" style={{ background: hex }} />}
                                                {(item.color || item.size) ? variantLabel(item) : item.variant_label}
                                            </p>
                                        )}
                                        <p className="text-xs text-zinc-500 mt-0.5 tabular">
                                            {bargained && <span className="line-through me-1.5">{money(item.original_price)}</span>}
                                            <span className={bargained ? 'text-emerald-300' : ''}>{money(item.unit_price)}</span>
                                            {item.sku && <span className="ms-2 font-mono ltr inline-block">{item.sku}</span>}
                                        </p>
                                    </button>
                                    <div className="flex flex-col items-end gap-1.5">
                                        <span className="font-semibold tabular text-sm">{money(item.total)}</span>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => cart.updateItemQuantity(item.id, item.quantity - 1)} className="w-7 h-7 rounded-md bg-dark-secondary hover:bg-zinc-700 flex items-center justify-center" aria-label="-"><Minus className="w-3.5 h-3.5" /></button>
                                            <span className="w-7 text-center text-sm font-semibold tabular">{item.quantity}</span>
                                            <button
                                                onClick={() => { const r = cart.updateItemQuantity(item.id, item.quantity + 1); if (r && !r.success) toast.error(r.message); }}
                                                className="w-7 h-7 rounded-md bg-dark-secondary hover:bg-zinc-700 flex items-center justify-center" aria-label="+"
                                            ><Plus className="w-3.5 h-3.5" /></button>
                                        </div>
                                    </div>
                                </div>
                                {isEditing && (
                                    <LineEditor
                                        item={item}
                                        canDiscount={canDiscount}
                                        onPrice={(price) => cart.setLinePrice(item.id, price)}
                                        onRemove={() => { cart.removeItem(item.id); setEditingLine(null); }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="flex-none p-4 border-t border-dark-border space-y-3">
                    <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between text-zinc-400"><span>{t('pos.subtotal')}</span><span className="tabular">{money(cart.getSubtotal())}</span></div>
                        {promo && (
                            <div className="flex justify-between text-emerald-300">
                                <span className="flex items-center gap-1.5 truncate"><Percent className="w-3.5 h-3.5" /> {promo.promotion.name}</span>
                                <span className="tabular">-{money(promo.amount)}</span>
                            </div>
                        )}
                        {manualDiscount > 0 && (
                            <div className="flex justify-between text-emerald-300"><span>{t('pos.discount')}</span><span className="tabular">-{money(manualDiscount)}</span></div>
                        )}
                        {cart.serviceCharge > 0 && (
                            <div className="flex justify-between text-zinc-400"><span>{t('pos.serviceFee')}</span><span className="tabular">{money(cart.serviceCharge)}</span></div>
                        )}
                        {taxAmount > 0 && (
                            <div className="flex justify-between text-zinc-500"><span>{t('pos.tax')}</span><span className="tabular">{money(taxAmount)}</span></div>
                        )}
                        <div className="flex justify-between items-baseline pt-2 border-t border-dark-border">
                            <span className="font-semibold">{t('pos.total')}</span>
                            <span className="text-2xl font-bold tabular">{money(total)}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <Button variant="secondary" onClick={() => setShowOptionsModal(true)} disabled={cart.items.length === 0 || !canDiscount} title={t('pos.options')}>
                            <SlidersHorizontal className="w-4 h-4" /> {t('pos.discountShort')}
                        </Button>
                        <Button variant="secondary" onClick={handleHoldTransaction} disabled={cart.items.length === 0} title="F8">
                            <Pause className="w-4 h-4" /> {t('pos.hold')}
                        </Button>
                        <Button variant="secondary" onClick={() => { if (confirm(t('pos.clearConfirm'))) cart.clearCart(); }} disabled={cart.items.length === 0} className="hover:!bg-red-500/15 hover:!text-red-300">
                            <Trash2 className="w-4 h-4" /> {t('pos.clear')}
                        </Button>
                    </div>
                    <Button variant="success" size="lg" className="w-full h-14 text-lg" onClick={startPayment} disabled={cart.items.length === 0}>
                        <Banknote className="w-5 h-5" />
                        {t('pos.pay', { amount: money(total) })}
                        <kbd className="ms-auto text-xs font-normal opacity-70 border border-white/30 rounded px-1.5">F4</kbd>
                    </Button>
                    <p className="text-[11px] text-zinc-600 text-center">{t('pos.shortcuts')}</p>
                </div>
            </aside>

            <PaymentModal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} total={total} onComplete={handlePaymentComplete} />

            <VariantPickerModal
                isOpen={!!variantProduct}
                product={variantProduct}
                onClose={() => setVariantProduct(null)}
                formatCurrency={money}
                onSelect={(variant) => { if (addToCart(variantProduct, variant)) setVariantProduct(null); }}
            />

            <CustomerPickerModal
                isOpen={showCustomerModal}
                onClose={() => setShowCustomerModal(false)}
                onSelect={(customer) => { cart.setCustomer(customer); setShowCustomerModal(false); }}
            />

            {/* Unknown scanned code */}
            <Modal isOpen={!!unknownCode} onClose={() => setUnknownCode(null)} title={t('pos.codeNotFound')} size="sm">
                <ModalBody>
                    <p className="text-zinc-300">{t('pos.codeNotFoundText')}</p>
                    <p className="font-mono text-lg mt-2 break-all text-amber-400 ltr">{unknownCode}</p>
                    <p className="text-sm text-zinc-500 mt-3">{t('pos.codeNotFoundHint')}</p>
                </ModalBody>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => { setSearchQuery(unknownCode); setUnknownCode(null); searchRef.current?.focus(); }}>
                        {t('pos.searchInstead')}
                    </Button>
                    {hasPermission('products.create') && (
                        <Button onClick={() => { const code = unknownCode; setUnknownCode(null); navigate(`/products?newCode=${encodeURIComponent(code)}`); }}>
                            {t('pos.createWithCode')}
                        </Button>
                    )}
                </ModalFooter>
            </Modal>

            {/* Parked tickets (customer in the fitting room) */}
            <Modal isOpen={showHeldModal} onClose={() => setShowHeldModal(false)} title={t('pos.heldTitle')} size="md">
                <ModalBody>
                    {heldTransactions.length === 0 ? (
                        <p className="text-center text-zinc-500 py-8">{t('pos.noHeld')}</p>
                    ) : (
                        <div className="space-y-2">
                            {heldTransactions.map(held => {
                                const lines = heldLines(held);
                                return (
                                    <button key={held.id} onClick={() => handleRecallTransaction(held)}
                                        className="w-full p-4 rounded-xl bg-dark-tertiary hover:bg-zinc-700/70 text-start transition-colors">
                                        <div className="flex justify-between items-start gap-3">
                                            <div className="min-w-0">
                                                <p className="font-medium">{held.customer_name || t('pos.walkIn')}</p>
                                                <p className="text-sm text-zinc-400 truncate">{lines.map(l => l.product_name).join('، ')}</p>
                                                <p className="text-xs text-zinc-500 mt-1">{t('pos.itemCount', { n: lines.length })} • {held.employee_name} • {formatLocalDate(held.created_at, 'time')}</p>
                                            </div>
                                            <p className="font-semibold text-indigo-300 tabular">{money(held.subtotal)}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </ModalBody>
            </Modal>

            <ReceiptPreviewModal
                isOpen={showReceiptModal}
                onClose={() => { setShowReceiptModal(false); setReceiptData(null); searchRef.current?.focus(); }}
                sale={receiptData}
            />
            <CartOptionsModal isOpen={showOptionsModal} onClose={() => setShowOptionsModal(false)} />

            {showOpenDrawer && (
                <OpeningCashDialog
                    employee={currentEmployee}
                    onSuccess={(newShift) => {
                        setShift(newShift);
                        setShowOpenDrawer(false);
                        window.dispatchEvent(new Event('pos:shift-changed'));
                        if (cart.items.length > 0) setShowPaymentModal(true);
                    }}
                    onCancel={() => setShowOpenDrawer(false)}
                />
            )}
        </div>
    );
}

/** Price of one line: bargaining with quick percentages, or remove the line. */
function LineEditor({ item, canDiscount, onPrice, onRemove }) {
    const [value, setValue] = useState(String(item.unit_price));
    const base = item.original_price || item.unit_price;
    const apply = (price) => { onPrice(price); setValue(String(Math.round(price * 100) / 100)); };
    return (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-dark-border/70 flex flex-wrap items-center gap-2">
            {canDiscount && (
                <>
                    <input
                        type="number"
                        min="0"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') apply(parseFloat(value) || 0); }}
                        onBlur={() => { const v = parseFloat(value); if (Number.isFinite(v) && v !== item.unit_price) apply(v); }}
                        className="input input-sm w-28 tabular no-spinners"
                        aria-label={t('pos.linePrice')}
                    />
                    {[5, 10, 20].map(p => (
                        <button key={p} type="button" onClick={() => apply(Math.round(base * (100 - p) / 100))}
                            className="h-8 px-2.5 rounded-md bg-dark-secondary hover:bg-zinc-700 text-xs font-semibold">-{p}%</button>
                    ))}
                    {item.unit_price !== base && (
                        <button type="button" onClick={() => apply(base)} className="h-8 px-2.5 rounded-md text-xs text-zinc-400 hover:text-white">{t('pos.resetPrice')}</button>
                    )}
                </>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onRemove} className="h-8 px-2.5 rounded-md text-xs text-red-300 hover:bg-red-500/15 flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> {t('common.delete')}
            </button>
        </div>
    );
}
