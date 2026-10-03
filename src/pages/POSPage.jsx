import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShoppingCart, Pause, Trash2, Plus, Minus, CreditCard, Banknote, Wallet, Printer, Mail, Check, Download, FileText, Gift, SlidersHorizontal } from 'lucide-react';
import { useCartStore } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import ReceiptPreviewModal from '../components/modals/ReceiptPreviewModal';
import { NumPad } from '../components/ui/NumPad';
import { DatePicker } from '../components/ui/DatePicker';
import CartOptionsModal from '../components/modals/CartOptionsModal';
import { VariantPickerModal } from '../components/pos/VariantPickerModal';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

export default function POSPage() {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [heldTransactions, setHeldTransactions] = useState([]);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showHeldModal, setShowHeldModal] = useState(false);
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [showOptionsModal, setShowOptionsModal] = useState(false);
    const [receiptData, setReceiptData] = useState(null);
    const [activeMobileTab, setActiveMobileTab] = useState('products'); // 'products' or 'cart'
    const searchRef = useRef(null);
    const [variantProduct, setVariantProduct] = useState(null); // product whose colour/size is being chosen
    const [unknownCode, setUnknownCode] = useState(null);
    const navigate = useNavigate();

    const cart = useCartStore();
    const { currentEmployee, hasPermission } = useAuthStore();

    useEffect(() => {
        loadData();
        cart.loadSettings(); // Load tax settings
        // Focus search on mount
        searchRef.current?.focus();
    }, []);

    // USB barcode/QR scanner: works wherever the focus is on this screen, as
    // long as no dialog that has its own input is open.
    useBarcodeScanner((code) => handleCode(code, { fromScanner: true }), {
        isActive: () => !showPaymentModal && !showHeldModal && !showReceiptModal && !showOptionsModal && !unknownCode,
    });

    const loadData = async () => {
        try {
            const [productsData, categoriesData, heldData, bundlesData] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.categories.getAll(),
                window.electronAPI.held.getAll(),
                window.electronAPI.bundles.getActive()
            ]);

            // Normalize bundles to match product structure for the grid
            const normalizedBundles = bundlesData.map(b => ({
                ...b,
                price: b.bundle_price,
                category_id: 'bundles',
                stock_quantity: b.deduct_component_stock ? 999 : (b.stock_quantity || 0), // Use 999 for virtual bundles
                is_bundle: true,
                image_path: b.image_path
            }));

            setProducts([...productsData.filter(p => p.is_active), ...normalizedBundles]);
            setCategories([...categoriesData, { id: 'bundles', name: 'Bundles', color: '#8b5cf6' }]); // Add virtual Bundles category
            setHeldTransactions(heldData);
        } catch (error) {
            console.error('Failed to load data:', error);
            toast.error('Failed to load products');
        }
    };

    const addToCart = (product, variant = null) => {
        const result = cart.addItem(product, 1, variant);
        if (!result.success) {
            toast.error(result.message);
            return false;
        }
        const label = variant ? ` (${[variant.color, variant.size].filter(Boolean).join(' / ')})` : '';
        toast.success(`${product.name}${label}${result.quantity > 1 ? ` × ${result.quantity}` : ''}`);
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
                    setUnknownCode(code);
                } else if (filteredProducts.length === 1) {
                    // Typed a name that matches exactly one product: take it
                    setSearchQuery('');
                    handleProductClick(filteredProducts[0]);
                } else if (filteredProducts.length === 0) {
                    toast.error(`No product matches "${code}"`);
                }
                return;
            }
            setSearchQuery('');
            if (result.type === 'variant') {
                setVariantProduct(null);
                addToCart(result.product, result.variant);
            } else if (result.needsVariant) {
                setVariantProduct(result.product);
            } else {
                addToCart(result.product);
            }
        } catch (error) {
            console.error('Code lookup failed:', error);
            toast.error('Lookup failed');
        }
    };

    const handleProductClick = (product) => {
        if (product.is_bundle) {
            addToCart(product);
        } else if (product.variant_count > 0) {
            setVariantProduct(product);
        } else {
            addToCart(product);
        }
    };

    const filteredProducts = products.filter(product => {
        const matchesCategory = selectedCategory === 'all' || product.category_id === selectedCategory;
        const matchesSearch = !searchQuery ||
            product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.barcode?.includes(searchQuery);
        return matchesCategory && matchesSearch;
    });

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: cart.currency || 'USD',
        }).format(amount);
    };

    const handleHoldTransaction = async () => {
        try {
            await cart.holdTransaction(currentEmployee?.id);
            const heldData = await window.electronAPI.held.getAll();
            setHeldTransactions(heldData);
            toast.success('Transaction held');
        } catch (error) {
            toast.error('Failed to hold transaction');
        }
    };



    const handleRecallTransaction = async (held) => {
        cart.recallTransaction(held);
        await window.electronAPI.held.delete(held.id);
        const heldData = await window.electronAPI.held.getAll();
        setHeldTransactions(heldData);
        setShowHeldModal(false);
        toast.success('Transaction recalled');
    };

    return (
        <div className="h-full flex flex-col lg:flex-row overflow-hidden relative">
            {/* Mobile Tab Bar */}
            <div className="lg:hidden flex bg-dark-secondary border-b border-dark-border">
                <button
                    onClick={() => setActiveMobileTab('products')}
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors
                        ${activeMobileTab === 'products'
                            ? 'border-accent-primary text-accent-primary'
                            : 'border-transparent text-zinc-400 hover:text-white'}`}
                >
                    Products
                </button>
                <button
                    onClick={() => setActiveMobileTab('cart')}
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2
                        ${activeMobileTab === 'cart'
                            ? 'border-accent-primary text-accent-primary'
                            : 'border-transparent text-zinc-400 hover:text-white'}`}
                >
                    <span>Cart</span>
                    {cart.items.length > 0 && (
                        <span className="bg-accent-primary text-white text-xs px-1.5 py-0.5 rounded-full">
                            {cart.getItemCount()}
                        </span>
                    )}
                </button>
            </div>

            {/* Products Section */}
            <div className={`flex-1 flex flex-col border-r border-dark-border min-h-0 min-w-0
                ${activeMobileTab === 'products' ? 'flex' : 'hidden lg:flex'}`}>
                {/* Search Bar */}
                <div className="p-4 border-b border-dark-border">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                        <input
                            ref={searchRef}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                // Enter on a typed code (SKU, barcode) adds it directly
                                if (e.key === 'Enter' && searchQuery.trim()) {
                                    e.preventDefault();
                                    handleCode(searchQuery);
                                }
                            }}
                            placeholder="Search by name, or type/scan a SKU, barcode or QR code…"
                            className="input pl-10"
                        />
                    </div>
                </div>

                {/* Categories */}
                <div className="px-4 py-3 border-b border-dark-border overflow-x-auto">
                    <div className="flex gap-2">
                        <button
                            onClick={() => setSelectedCategory('all')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all
                ${selectedCategory === 'all'
                                    ? 'bg-accent-primary text-white'
                                    : 'bg-dark-tertiary text-zinc-400 hover:text-white'
                                }`}
                        >
                            All Products
                        </button>
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2
                  ${selectedCategory === cat.id
                                        ? 'text-white'
                                        : 'bg-dark-tertiary text-zinc-400 hover:text-white'
                                    }`}
                                style={selectedCategory === cat.id ? { backgroundColor: cat.color } : {}}
                            >
                                <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: cat.color }}
                                />
                                {cat.name}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Products Grid */}
                <div className="flex-1 overflow-y-auto p-4">
                    {filteredProducts.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-zinc-500">
                            <div className="text-center">
                                <ShoppingCart className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>No products found</p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                            {filteredProducts.map(product => (
                                <button
                                    key={product.id}
                                    onClick={() => handleProductClick(product)}
                                    className="product-card text-left"
                                    disabled={product.stock_quantity <= 0}
                                >
                                    <div className="aspect-square bg-dark-tertiary rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                                        {product.image_path ? (
                                            <img
                                                src={`app://${product.image_path}`}
                                                alt={product.name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <span className="text-3xl">📦</span>
                                        )}
                                    </div>
                                    <p className="font-medium text-sm truncate">{product.name}</p>
                                    {product.variant_count > 0 && (
                                        <p className="text-[11px] text-zinc-500">{product.variant_count} colours/sizes</p>
                                    )}
                                    <div className="flex items-center justify-between mt-1">
                                        <p className="text-accent-primary font-semibold truncate">
                                            {product.variant_count > 0 && product.min_variant_price !== product.max_variant_price
                                                ? `${formatCurrency(product.min_variant_price)}+`
                                                : formatCurrency(product.variant_count > 0 ? product.min_variant_price : product.price)}
                                        </p>
                                        <span className={`text-xs ${product.stock_quantity <= product.min_stock_level ? 'text-amber-400' : 'text-zinc-500'}`}>
                                            {product.stock_quantity} left
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Cart Section */}
            <div className={`w-full lg:w-96 lg:flex-none lg:shrink-0 flex-1 flex-col bg-dark-secondary border-t lg:border-t-0 lg:border-l border-dark-border min-h-0
                ${activeMobileTab === 'cart' ? 'flex' : 'hidden lg:flex'}`}>
                {/* Cart Header */}
                <div className="p-4 border-b border-dark-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ShoppingCart className="w-5 h-5 text-accent-primary" />
                        <h2 className="font-semibold">Cart</h2>
                        {cart.items.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-accent-primary text-xs">
                                {cart.getItemCount()}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {heldTransactions.length > 0 && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setShowHeldModal(true)}
                            >
                                <Pause className="w-4 h-4" />
                                {heldTransactions.length}
                            </Button>
                        )}
                    </div>
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {cart.items.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-zinc-500">
                            <div className="text-center">
                                <ShoppingCart className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>Cart is empty</p>
                                <p className="text-sm">Add products to get started</p>
                            </div>
                        </div>
                    ) : (
                        cart.items.map(item => (
                            <div key={item.id} className="cart-item">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{item.product_name}</p>
                                    {(item.variant_label || item.sku) && (
                                        <p className="text-xs text-accent-primary truncate">
                                            {item.variant_label}{item.variant_label && item.sku ? ' · ' : ''}<span className="font-mono text-zinc-500">{item.sku}</span>
                                        </p>
                                    )}
                                    <p className="text-sm text-zinc-400">
                                        {formatCurrency(item.unit_price)} × {item.quantity}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => cart.updateItemQuantity(item.id, item.quantity - 1)}
                                        className="p-1 rounded bg-dark-tertiary hover:bg-zinc-700"
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                    <span className="w-8 text-center font-medium">{item.quantity}</span>
                                    <button
                                        onClick={() => {
                                            const result = cart.updateItemQuantity(item.id, item.quantity + 1);
                                            if (result && !result.success) {
                                                toast.error(result.message);
                                            }
                                        }}
                                        className="p-1 rounded bg-dark-tertiary hover:bg-zinc-700"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => cart.removeItem(item.id)}
                                        className="p-1 rounded hover:bg-red-500/20 text-red-400"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Cart Summary */}
                <div className="p-4 border-t border-dark-border space-y-3">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-zinc-400">Subtotal</span>
                            <span>{formatCurrency(cart.getSubtotal())}</span>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-zinc-400">Tax</span>
                            <div className="flex items-center gap-2">
                                {cart.taxExempt && (
                                    <span className="text-xs text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">Exempt</span>
                                )}
                                <span>{formatCurrency(cart.getTaxAmount())}</span>
                            </div>
                        </div>
                        {cart.serviceCharge > 0 && (
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Service Fee</span>
                                <span>{formatCurrency(cart.serviceCharge)}</span>
                            </div>
                        )}
                        {cart.discount > 0 && (
                            <div className="flex justify-between text-green-400">
                                <span>Discount</span>
                                <span>-{formatCurrency(cart.getDiscountAmount())}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-lg font-bold pt-2 border-t border-dark-border">
                            <span>Total</span>
                            <span className="text-accent-primary">{formatCurrency(cart.getTotal())}</span>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-4 gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => setShowOptionsModal(true)}
                            className="col-span-1"
                            title="Options"
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={handleHoldTransaction}
                            disabled={cart.items.length === 0}
                            className="col-span-2" // Span 2 wide
                        >
                            <Pause className="w-4 h-4" />
                            Hold
                        </Button>
                        <Button
                            variant="danger"
                            onClick={() => cart.clearCart()}
                            disabled={cart.items.length === 0}
                            className="col-span-1"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                    <Button
                        variant="success"
                        size="lg"
                        className="w-full"
                        onClick={() => setShowPaymentModal(true)}
                        disabled={cart.items.length === 0}
                    >
                        <CreditCard className="w-5 h-5" />
                        Pay {formatCurrency(cart.getTotal())}
                    </Button>
                </div>
            </div>

            {/* Payment Modal */}
            <PaymentModal
                isOpen={showPaymentModal}
                onClose={() => setShowPaymentModal(false)}
                total={cart.getTotal()}
                onComplete={async (payments, creditCustomer = null, dueDate = null) => {
                    try {
                        const sale = await cart.processPayment(payments, currentEmployee.id, currentEmployee.name);

                        // If this is a credit sale, create the credit sale record
                        if (payments[0]?.method === 'credit' && creditCustomer) {
                            try {
                                const creditSale = await window.electronAPI.creditSales.create({
                                    sale_id: sale.id,
                                    customer_id: creditCustomer.id,
                                    amount_due: sale.total,
                                    amount_paid: 0,
                                    status: 'pending',
                                    due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
                                    notes: `Credit sale for receipt ${sale.receipt_number}`
                                });

                                // UPDATE: Attach credit info to sale object for receipt generation
                                sale.due_date = dueDate ? new Date(dueDate).toISOString() : undefined;
                                sale.customer_name = creditCustomer.name;

                                toast.success(`Credit sale created! Invoice #${creditSale.invoice_number}`);
                            } catch (creditError) {
                                console.error('Failed to create credit sale:', creditError);
                                toast.error('Sale completed but credit record failed');
                            }
                        } else {
                            toast.success(`Sale completed! Receipt #${sale.receipt_number}`);
                        }

                        try {
                            const printerSettings = await window.electronAPI.printers.getSettings();
                            if (printerSettings?.receipt?.autoPrint) {
                                // Print straight away on the configured receipt printer
                                window.electronAPI.receipts.print(sale)
                                    .then((ok) => ok && toast.success('Receipt sent to printer'))
                                    .catch((printError) => toast.error(`Receipt not printed: ${printError.message}`));
                            } else {
                                setReceiptData(sale);
                                setShowReceiptModal(true);
                            }
                        } catch (printError) {
                            console.error('Receipt handling failed:', printError);
                        }

                        setShowPaymentModal(false);
                        loadData(); // Refresh data
                    } catch (error) {
                        toast.error(error.message);
                    }
                }}
            />

            {/* Colour / size picker for clothing products */}
            <VariantPickerModal
                isOpen={!!variantProduct}
                product={variantProduct}
                onClose={() => setVariantProduct(null)}
                formatCurrency={formatCurrency}
                onSelect={(variant) => {
                    if (addToCart(variantProduct, variant)) setVariantProduct(null);
                }}
            />

            {/* Unknown scanned code */}
            <Modal isOpen={!!unknownCode} onClose={() => setUnknownCode(null)} title="Code not found" size="sm">
                <ModalBody>
                    <p className="text-zinc-300">No product or variant uses this code:</p>
                    <p className="font-mono text-lg mt-2 break-all text-amber-400">{unknownCode}</p>
                    <p className="text-sm text-zinc-500 mt-3">
                        Check that the label belongs to this shop. If it is a new item, create it and assign this code.
                    </p>
                </ModalBody>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => { setSearchQuery(unknownCode); setUnknownCode(null); searchRef.current?.focus(); }}>
                        Search instead
                    </Button>
                    {hasPermission('products.create') && (
                        <Button onClick={() => { const code = unknownCode; setUnknownCode(null); navigate(`/products?newCode=${encodeURIComponent(code)}`); }}>
                            Create product with this code
                        </Button>
                    )}
                </ModalFooter>
            </Modal>

            {/* Held Transactions Modal */}
            <Modal
                isOpen={showHeldModal}
                onClose={() => setShowHeldModal(false)}
                title="Held Transactions"
                size="md"
            >
                <ModalBody>
                    {heldTransactions.length === 0 ? (
                        <p className="text-center text-zinc-500 py-8">No held transactions</p>
                    ) : (
                        <div className="space-y-2">
                            {heldTransactions.map(held => (
                                <button
                                    key={held.id}
                                    onClick={() => handleRecallTransaction(held)}
                                    className="w-full p-4 rounded-lg bg-dark-tertiary hover:bg-zinc-700 text-left transition-colors"
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-medium">
                                                {held.customer_name || 'Walk-in Customer'}
                                            </p>
                                            <p className="text-sm text-zinc-400">
                                                {JSON.parse(held.items_json).length} items • {held.employee_name}
                                            </p>
                                        </div>
                                        <p className="font-semibold text-accent-primary">
                                            {formatCurrency(held.subtotal)}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </ModalBody>
            </Modal>
            {/* Receipt Preview Modal */}
            <ReceiptPreviewModal
                isOpen={showReceiptModal}
                onClose={() => {
                    setShowReceiptModal(false);
                    setReceiptData(null);
                }}
                sale={receiptData}
            />
            {/* Options Modal */}
            <CartOptionsModal
                isOpen={showOptionsModal}
                onClose={() => setShowOptionsModal(false)}
            />
        </div>
    );
}

function PaymentModal({ isOpen, onClose, total, onComplete }) {
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [cashAmount, setCashAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [creditInfo, setCreditInfo] = useState(null);
    const [loadingCredit, setLoadingCredit] = useState(false);
    const [dueDate, setDueDate] = useState('');

    // Gift Card States
    const [giftCardCode, setGiftCardCode] = useState('');
    const [giftCardBalance, setGiftCardBalance] = useState(null);
    const [giftCardError, setGiftCardError] = useState(null);
    const [checkingGiftCard, setCheckingGiftCard] = useState(false);

    // Split Payments
    const [splitPayments, setSplitPayments] = useState([]);

    const paidAmount = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    const remainingDue = total - paidAmount;

    // Auto-complete if fully paid (handled in render/effect, or check in addPayment)

    const cart = useCartStore();

    useEffect(() => {
        if (isOpen) {
            loadCustomers();
            // If cart already has a customer selected, use that
            if (cart.customer) {
                setSelectedCustomer(cart.customer);
                if (paymentMethod === 'credit') {
                    loadCreditInfo(cart.customer.id);
                }
            }
        }
    }, [isOpen]);

    useEffect(() => {
        if (selectedCustomer && paymentMethod === 'credit') {
            loadCreditInfo(selectedCustomer.id);
            // Default due date: 30 days from now
            const date = new Date();
            date.setDate(date.getDate() + 30);
            setDueDate(date.toISOString().split('T')[0]);
        } else {
            setCreditInfo(null);
        }
    }, [selectedCustomer, paymentMethod]);

    const loadCustomers = async () => {
        try {
            const data = await window.electronAPI.customers.getAll();
            setCustomers(data);
        } catch (error) {
            console.error('Failed to load customers:', error);
        }
    };

    const loadCreditInfo = async (customerId) => {
        setLoadingCredit(true);
        try {
            const info = await window.electronAPI.customerCredit.getCreditInfo(customerId);
            setCreditInfo(info);
        } catch (error) {
            console.error('Failed to load credit info:', error);
            setCreditInfo(null);
        } finally {
            setLoadingCredit(false);
        }
    };

    const checkGiftCardBalance = async () => {
        if (!giftCardCode) return;
        setCheckingGiftCard(true);
        setGiftCardError(null);
        try {
            const card = await window.electronAPI.giftCards.getByCode(giftCardCode);
            if (card && card.is_active) {
                setGiftCardBalance(card.current_balance);
                if (card.current_balance < remainingDue) {
                    // Just informational, allowing partial payment now
                }
            } else {
                setGiftCardError('Invalid or inactive Gift Card');
                setGiftCardBalance(null);
            }
        } catch (err) {
            setGiftCardError('Error checking balance');
        } finally {
            setCheckingGiftCard(false);
        }
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: cart.currency || 'USD',
        }).format(amount);
    };

    const cashValue = parseFloat(cashAmount) || 0;
    const change = cashValue - remainingDue;

    const filteredCustomers = customers.filter(c =>
        c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.phone?.includes(customerSearch) ||
        c.email?.toLowerCase().includes(customerSearch.toLowerCase())
    ).slice(0, 5);

    const canProcessCredit = () => {
        if (!selectedCustomer) return false;
        if (!creditInfo) return false;
        if (!creditInfo.credit_enabled) return false;
        if (creditInfo.available_credit < remainingDue) return false;
        return true;
    };

    const handlePayment = async () => {
        // Handle Partial Gift Card
        if (paymentMethod === 'gift_card') {
            if (!giftCardBalance) return;

            const amountToPay = Math.min(giftCardBalance, remainingDue);

            // Add to split payments
            const newPayment = {
                method: 'gift_card',
                amount: amountToPay,
                reference: giftCardCode
            };

            const newSplit = [...splitPayments, newPayment];
            setSplitPayments(newSplit);

            // Check if fully paid
            if (amountToPay >= remainingDue - 0.01) { // float tolerance
                // Fully paid
                await onComplete(newSplit, null, null);
            } else {
                // Partially paid
                setGiftCardCode('');
                setGiftCardBalance(null);
                setPaymentMethod('cash');
                toast.success(`Applied ${formatCurrency(amountToPay)} from Gift Card`);
            }
            return;
        }

        if (paymentMethod === 'cash' && cashValue < remainingDue) {
            toast.error('Insufficient cash amount');
            return;
        }

        if (paymentMethod === 'credit') {
            if (!selectedCustomer) {
                toast.error('Please select a customer for credit sale');
                return;
            }
            if (!creditInfo?.credit_enabled) {
                toast.error('Customer does not have credit enabled');
                return;
            }
            if (creditInfo.available_credit < remainingDue) {
                toast.error('Insufficient credit limit');
                return;
            }
        }

        setLoading(true);
        try {
            const finalPayment = {
                method: paymentMethod,
                // For cash: record the SALE amount (what stays in drawer), not the tendered amount
                amount: remainingDue,
                reference: paymentMethod === 'card' ? 'Card Payment' :
                    paymentMethod === 'credit' ? 'Credit Sale' : null
            };

            const allPayments = [...splitPayments, finalPayment];

            // For credit sales, set the customer on cart before processing
            if (paymentMethod === 'credit' && selectedCustomer) {
                cart.setCustomer(selectedCustomer);
            }

            await onComplete(allPayments, paymentMethod === 'credit' ? selectedCustomer : null, dueDate);
            resetForm();
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setCashAmount('');
        setPaymentMethod('cash');
        setSelectedCustomer(null);
        setCreditInfo(null);
        setGiftCardCode('');
        setGiftCardBalance(null);
        setGiftCardError(null);
        setSplitPayments([]);
    };

    const quickCashValues = [20, 50, 100];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Payment" size="lg">
            <ModalBody>
                <div className="grid grid-cols-2 gap-6">
                    {/* Payment Method Selection */}
                    <div className="space-y-4">
                        <p className="text-sm text-zinc-400">Payment Method</p>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            <button
                                onClick={() => setPaymentMethod('cash')}
                                className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2
                                    ${paymentMethod === 'cash'
                                        ? 'border-accent-primary bg-accent-primary/10'
                                        : 'border-dark-border hover:border-zinc-600'
                                    }`}
                            >
                                <Banknote className="w-5 h-5" />
                                <span className="text-xs font-medium">Cash</span>
                            </button>
                            <button
                                onClick={() => setPaymentMethod('card')}
                                className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2
                                    ${paymentMethod === 'card'
                                        ? 'border-accent-primary bg-accent-primary/10'
                                        : 'border-dark-border hover:border-zinc-600'
                                    }`}
                            >
                                <CreditCard className="w-5 h-5" />
                                <span className="text-xs font-medium">Card</span>
                            </button>
                            <button
                                onClick={() => setPaymentMethod('credit')}
                                className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2
                                    ${paymentMethod === 'credit'
                                        ? 'border-amber-500 bg-amber-500/10'
                                        : 'border-dark-border hover:border-zinc-600'
                                    }`}
                            >
                                <FileText className="w-5 h-5" />
                                <span className="text-xs font-medium">Credit</span>
                            </button>
                            <button
                                onClick={() => setPaymentMethod('gift_card')}
                                className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2
                                    ${paymentMethod === 'gift_card'
                                        ? 'border-purple-500 bg-purple-500/10'
                                        : 'border-dark-border hover:border-zinc-600'
                                    }`}
                            >
                                <Gift className="w-5 h-5" />
                                <span className="text-xs font-medium">Gift Card</span>
                            </button>
                        </div>

                        {/* Total Display */}
                        <div className="p-6 rounded-xl bg-dark-tertiary text-center">
                            {splitPayments.length > 0 && (
                                <div className="mb-4 space-y-2">
                                    <p className="text-sm text-zinc-400">Payments Applied</p>
                                    {splitPayments.map((p, i) => (
                                        <div key={i} className="flex justify-between text-sm px-4 py-2 bg-dark-secondary rounded-lg">
                                            <span className="capitalize">{p.method.replace('_', ' ')}</span>
                                            <span className="font-medium text-green-400">{formatCurrency(p.amount)}</span>
                                        </div>
                                    ))}
                                    <div className="h-px bg-dark-border my-2" />
                                </div>
                            )}
                            <p className="text-sm text-zinc-400 mb-1">
                                {splitPayments.length > 0 ? 'Remaining Due' : 'Total Amount'}
                            </p>
                            <p className="text-4xl font-bold text-accent-primary">
                                {formatCurrency(remainingDue)}
                            </p>
                        </div>

                        {/* Gift Card Input */}
                        {paymentMethod === 'gift_card' && (
                            <div className="space-y-3">
                                <p className="text-sm text-zinc-400">Scan Gift Card</p>
                                <div className="flex gap-2">
                                    <Input
                                        value={giftCardCode}
                                        onChange={(e) => setGiftCardCode(e.target.value)}
                                        placeholder="Scan or enter code..."
                                        className="flex-1"
                                        data-scan-passthrough
                                        autoFocus
                                    />
                                    <Button onClick={checkGiftCardBalance} disabled={!giftCardCode || checkingGiftCard}>
                                        {checkingGiftCard ? 'Checking...' : 'Check'}
                                    </Button>
                                </div>
                                {giftCardError && (
                                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                                        {giftCardError}
                                    </div>
                                )}
                                {giftCardBalance !== null && !giftCardError && (
                                    <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                                        <p className="text-sm text-purple-300">Available Balance</p>
                                        <p className="text-2xl font-bold text-purple-400">{formatCurrency(giftCardBalance)}</p>
                                        {giftCardBalance < total && (
                                            <p className="text-xs text-red-400 mt-2">Insufficient to cover total</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Credit Sale - Customer Selection */}
                        {paymentMethod === 'credit' && (
                            <div className="space-y-3">
                                <p className="text-sm text-zinc-400">Select Customer *</p>
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Search customer..."
                                        value={selectedCustomer ? selectedCustomer.name : customerSearch}
                                        onChange={(e) => {
                                            setCustomerSearch(e.target.value);
                                            setSelectedCustomer(null);
                                            setShowCustomerDropdown(true);
                                        }}
                                        onFocus={() => setShowCustomerDropdown(true)}
                                        className="input w-full"
                                    />
                                    {showCustomerDropdown && customerSearch && filteredCustomers.length > 0 && (
                                        <div className="absolute z-10 w-full mt-1 bg-dark-secondary border border-dark-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                            {filteredCustomers.map(customer => (
                                                <button
                                                    key={customer.id}
                                                    onClick={() => {
                                                        setSelectedCustomer(customer);
                                                        setCustomerSearch('');
                                                        setShowCustomerDropdown(false);
                                                    }}
                                                    className="w-full px-4 py-3 text-left hover:bg-dark-tertiary flex items-center justify-between"
                                                >
                                                    <div>
                                                        <p className="font-medium">{customer.name}</p>
                                                        <p className="text-xs text-zinc-500">{customer.phone || customer.email}</p>
                                                    </div>
                                                    {customer.credit_enabled ? (
                                                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">Credit OK</span>
                                                    ) : null}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Credit Info Display */}
                                {selectedCustomer && (
                                    <div className={`p-4 rounded-xl ${creditInfo?.credit_enabled ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                                        {loadingCredit ? (
                                            <p className="text-center text-zinc-400">Loading credit info...</p>
                                        ) : creditInfo ? (
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-zinc-400">Credit Status</span>
                                                    <span className={`text-sm font-medium ${creditInfo.credit_enabled ? 'text-green-400' : 'text-red-400'}`}>
                                                        {creditInfo.credit_enabled ? 'Enabled' : 'Not Enabled'}
                                                    </span>
                                                </div>
                                                {creditInfo.credit_enabled && (
                                                    <>
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-sm text-zinc-400">Credit Limit</span>
                                                            <span className="font-medium">{formatCurrency(creditInfo.credit_limit)}</span>
                                                        </div>
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-sm text-zinc-400">Current Balance</span>
                                                            <span className="font-medium text-amber-400">{formatCurrency(creditInfo.credit_balance)}</span>
                                                        </div>
                                                        <div className="flex justify-between items-center pt-2 border-t border-dark-border">
                                                            <span className="text-sm font-medium">Available Credit</span>
                                                            <span className={`font-bold ${creditInfo.available_credit >= total ? 'text-green-400' : 'text-red-400'}`}>
                                                                {formatCurrency(creditInfo.available_credit)}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between items-center pt-2">
                                                            <span className="text-sm text-zinc-400">Due Date</span>
                                                            <div className="w-40">
                                                                <DatePicker
                                                                    value={dueDate}
                                                                    onChange={setDueDate}
                                                                    className="w-full"
                                                                />
                                                            </div>
                                                        </div>
                                                        {creditInfo.available_credit < total && (
                                                            <p className="text-xs text-red-400 mt-2">
                                                                ⚠️ Insufficient credit for this sale
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-center text-zinc-400">No credit info available</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {paymentMethod === 'cash' && (
                            <>
                                {/* Quick Cash Buttons */}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setCashAmount(total.toFixed(2))}
                                        className="flex-1 py-2 rounded-lg bg-accent-primary/20 text-accent-primary font-medium hover:bg-accent-primary/30 transition-colors"
                                    >
                                        Exact
                                    </button>
                                    {quickCashValues.map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setCashAmount(val.toString())}
                                            className="flex-1 py-2 rounded-lg bg-dark-tertiary hover:bg-zinc-700 font-medium transition-colors"
                                        >
                                            {formatCurrency(val)}
                                        </button>
                                    ))}
                                </div>

                                {/* Change Display */}
                                {cashValue > 0 && (
                                    <div className={`p-4 rounded-xl text-center ${change >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                                        <p className="text-sm text-zinc-400 mb-1">
                                            {change >= 0 ? 'Change Due' : 'Amount Due'}
                                        </p>
                                        <p className={`text-2xl font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {formatCurrency(Math.abs(change))}
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Numpad / Right Side */}
                    {paymentMethod === 'cash' && (
                        <div>
                            <p className="text-sm text-zinc-400 mb-4">Cash Received</p>
                            <div className="p-4 rounded-xl bg-dark-tertiary mb-4">
                                <p className="text-3xl font-bold text-right font-mono">
                                    {formatCurrency(parseFloat(cashAmount) || 0)}
                                </p>
                            </div>
                            <NumPad
                                value={cashAmount}
                                onChange={setCashAmount}
                                onEnter={handlePayment}
                            />
                        </div>
                    )}

                    {paymentMethod === 'card' && (
                        <div className="flex items-center justify-center">
                            <div className="text-center">
                                <CreditCard className="w-20 h-20 mx-auto mb-4 text-zinc-600" />
                                <p className="text-zinc-400">Ready for card payment</p>
                            </div>
                        </div>
                    )}

                    {paymentMethod === 'credit' && (
                        <div className="flex items-center justify-center">
                            <div className="text-center">
                                <FileText className="w-20 h-20 mx-auto mb-4 text-amber-500/50" />
                                <p className="text-zinc-400">
                                    {selectedCustomer
                                        ? canProcessCredit()
                                            ? 'Ready to create credit sale'
                                            : 'Cannot process credit sale'
                                        : 'Select a customer to continue'}
                                </p>
                                {selectedCustomer && canProcessCredit() && (
                                    <p className="text-sm text-amber-400 mt-2">
                                        Invoice will be generated automatically
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {paymentMethod === 'gift_card' && (
                        <div className="flex items-center justify-center">
                            <div className="text-center">
                                <Gift className="w-20 h-20 mx-auto mb-4 text-purple-500/50" />
                                <p className="text-zinc-400">
                                    {giftCardBalance !== null
                                        ? `Balance: ${formatCurrency(giftCardBalance)}`
                                        : 'Scan card to check balance'}
                                </p>
                                {giftCardBalance !== null && giftCardBalance < remainingDue && (
                                    <p className="text-sm text-amber-400 mt-2">
                                        Partial payment available
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    variant={paymentMethod === 'credit' ? 'primary' : paymentMethod === 'gift_card' ? 'primary' : 'success'}
                    loading={loading}
                    onClick={handlePayment}
                    disabled={
                        (paymentMethod === 'cash' && cashValue < remainingDue) ||
                        (paymentMethod === 'credit' && !canProcessCredit()) ||
                        (paymentMethod === 'gift_card' && !giftCardBalance)
                    }
                >
                    {paymentMethod === 'credit' ? 'Create Credit Sale' :
                        paymentMethod === 'gift_card' ? (giftCardBalance < remainingDue ? 'Apply Partial Payment' : 'Redeem Gift Card') :
                            'Complete Payment'}
                </Button>
            </ModalFooter>
        </Modal>
    );
}


