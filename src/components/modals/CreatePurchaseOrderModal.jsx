import { useState, useEffect, useRef } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Search, Plus, Trash2, Trash } from 'lucide-react';
import { toast } from '../ui/Toast';

export default function CreatePurchaseOrderModal({ isOpen, onClose, onComplete }) {
    const [suppliers, setSuppliers] = useState([]);
    const [products, setProducts] = useState([]);
    const [formData, setFormData] = useState({
        supplier_id: '',
        expected_date: '',
        notes: '',
        items: []
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [variantResults, setVariantResults] = useState([]);
    const [loading, setLoading] = useState(false);

    // Clothing products are ordered per colour/size so received stock goes to the right variant
    useEffect(() => {
        let cancelled = false;
        if (!searchQuery.trim()) {
            setVariantResults([]);
            return undefined;
        }
        window.electronAPI.catalog.searchVariants(searchQuery, 20)
            .then(rows => { if (!cancelled) setVariantResults(rows); })
            .catch(() => { if (!cancelled) setVariantResults([]); });
        return () => { cancelled = true; };
    }, [searchQuery]);



    useEffect(() => {
        if (isOpen) {
            loadData();
            setFormData({
                supplier_id: '',
                expected_date: '',
                notes: '',
                items: [],
                tax_rate: 0,
                discount_type: 'fixed',
                discount_value: 0,
                shipping_cost: 0
            });
        }
    }, [isOpen]);

    const loadData = async () => {
        try {
            const [suppliersData, productsData, settings] = await Promise.all([
                window.electronAPI.suppliers.getAll(),
                window.electronAPI.products.getAll(),
                window.electronAPI.settings.getAll()
            ]);
            setSuppliers(suppliersData);
            setProducts(productsData.filter(p => p.is_active));
            // Set default tax rate from settings if available
            /* if (settings.taxRate) ... setFormData tax_rate */
        } catch (error) {
            console.error('Failed to load data:', error);
            toast.error('Failed to load suppliers/products');
        }
    };

    const addLine = (line) => {
        const existing = formData.items.find(i => i.key === line.key);
        if (existing) {
            updateItem(line.key, 'quantity', existing.quantity + 1);
        } else {
            setFormData(prev => ({ ...prev, items: [...prev.items, line] }));
        }
        setSearchQuery('');
    };

    const handleAddItem = (product) => {
        addLine({
            key: product.id,
            product_id: product.id,
            variant_id: null,
            product_name: product.name,
            quantity: 1,
            unit_cost: product.cost || 0,
            total_cost: product.cost || 0,
            tax_rate: 0 // Optional: inherit from product if desired
        });
    };

    const handleAddVariant = (variant) => {
        const product = products.find(p => p.id === variant.product_id);
        const cost = variant.cost ?? product?.cost ?? 0;
        addLine({
            key: variant.id,
            product_id: variant.product_id,
            variant_id: variant.id,
            variant_label: [variant.color, variant.size].filter(Boolean).join(' / '),
            sku: variant.sku,
            product_name: variant.product_name,
            quantity: 1,
            unit_cost: cost,
            total_cost: cost,
            tax_rate: 0
        });
    };

    const updateItem = (key, field, value) => {
        setFormData(prev => ({
            ...prev,
            items: prev.items.map(item => {
                if (item.key === key) {
                    const updates = { [field]: parseFloat(value) || 0 };
                    if (field === 'quantity' || field === 'unit_cost') {
                        const qty = field === 'quantity' ? parseFloat(value) : item.quantity;
                        const cost = field === 'unit_cost' ? parseFloat(value) : item.unit_cost;
                        updates.total_cost = qty * cost;
                    }
                    return { ...item, ...updates };
                }
                return item;
            })
        }));
    };

    const removeItem = (key) => {
        setFormData(prev => ({
            ...prev,
            items: prev.items.filter(i => i.key !== key)
        }));
    };

    const handleSubmit = async () => {
        if (!formData.supplier_id) return toast.error('Please select a supplier');
        if (formData.items.length === 0) return toast.error('Please add at least one item');

        setLoading(true);
        try {
            const supplier = suppliers.find(s => s.id === formData.supplier_id);

            // Calculate totals
            const subtotal = formData.items.reduce((sum, item) => sum + item.total_cost, 0);
            let discount = 0;
            if (formData.discount_type === 'percentage') {
                discount = subtotal * (formData.discount_value / 100);
            } else {
                discount = formData.discount_value;
            }
            const taxable = Math.max(0, subtotal - discount);
            const tax_amount = taxable * (formData.tax_rate / 100);
            const total = taxable + tax_amount + formData.shipping_cost;

            const poData = {
                ...formData,
                po_number: 'PO-' + Date.now().toString().slice(-6),
                supplier_name: supplier?.name,
                subtotal,
                tax_amount,
                total,
                status: 'draft',
                created_by: 'system'
            };

            await window.electronAPI.purchaseOrders.create(poData);
            toast.success('Purchase Order created');
            onComplete();
            onClose();
        } catch (error) {
            console.error('Failed to create PO:', error);
            toast.error('Failed to create Purchase Order');
        } finally {
            setLoading(false);
        }
    };

    // Products with variants are listed through their variants instead
    const filteredProducts = products.filter(p => !(p.variant_count > 0) && (
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku?.toLowerCase().includes(searchQuery.toLowerCase())
    )).slice(0, 5);

    const selectedSupplier = suppliers.find(s => s.id === formData.supplier_id);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="New Purchase Order" size="xl">
            <ModalBody>
                <div className="space-y-6">
                    {/* Header Fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Select
                                label="Supplier"
                                value={formData.supplier_id}
                                onChange={(val) => setFormData({ ...formData, supplier_id: val })}
                                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                                placeholder="Select Supplier"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Expected Date</label>
                            <Input
                                type="date"
                                value={formData.expected_date}
                                onChange={e => setFormData({ ...formData, expected_date: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* Product Search */}
                    <div className="relative">
                        <label className="block text-sm text-zinc-400 mb-1">Add Products</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            <Input
                                placeholder="Search products..."
                                className="pl-9"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>
                        {searchQuery && (
                            <div className="absolute z-10 w-full mt-1 bg-dark-tertiary border border-dark-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                {filteredProducts.map(product => (
                                    <button
                                        key={product.id}
                                        className="w-full text-left p-3 hover:bg-zinc-700 transition-colors flex justify-between items-center"
                                        onClick={() => handleAddItem(product)}
                                    >
                                        <div>
                                            <p className="font-medium">{product.name}</p>
                                            <p className="text-xs text-zinc-500">Stock: {product.stock_quantity}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-accent-primary font-medium">Cost: {product.cost || 0}</p>
                                        </div>
                                    </button>
                                ))}
                                {variantResults.map(variant => (
                                    <button
                                        key={variant.id}
                                        className="w-full text-left p-3 hover:bg-zinc-700 transition-colors flex justify-between items-center"
                                        onClick={() => handleAddVariant(variant)}
                                    >
                                        <div>
                                            <p className="font-medium">{variant.product_name} <span className="text-accent-primary">{[variant.color, variant.size].filter(Boolean).join(' / ')}</span></p>
                                            <p className="text-xs text-zinc-500"><span className="font-mono">{variant.sku}</span> · Stock: {variant.stock_quantity}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-accent-primary font-medium">Cost: {variant.cost ?? '-'}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Items Table */}
                    <div className="border border-dark-border rounded-lg overflow-hidden bg-dark-secondary">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-dark-tertiary text-zinc-400">
                                <tr>
                                    <th className="p-3">Product</th>
                                    <th className="p-3 w-24">Qty</th>
                                    <th className="p-3 w-32">Unit Cost</th>
                                    <th className="p-3 w-32 text-right">Total</th>
                                    <th className="p-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-border">
                                {formData.items.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="p-8 text-center text-zinc-500">
                                            No items added. Search products above.
                                        </td>
                                    </tr>
                                ) : (
                                    formData.items.map(item => (
                                        <tr key={item.key} className="hover:bg-zinc-800/50">
                                            <td className="p-3 font-medium">
                                                {item.product_name}
                                                {item.variant_label && <div className="text-xs text-accent-primary">{item.variant_label} <span className="font-mono text-zinc-500">{item.sku}</span></div>}
                                            </td>
                                            <td className="p-3">
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    value={item.quantity}
                                                    onChange={e => updateItem(item.key, 'quantity', e.target.value)}
                                                    className="h-8 w-full text-center"
                                                />
                                            </td>
                                            <td className="p-3">
                                                <div className="relative">
                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500">$</span>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.unit_cost}
                                                        onChange={e => updateItem(item.key, 'unit_cost', e.target.value)}
                                                        className="h-8 w-full pl-6"
                                                    />
                                                </div>
                                            </td>
                                            <td className="p-3 text-right font-medium text-white">
                                                ${item.total_cost.toFixed(2)}
                                            </td>
                                            <td className="p-3">
                                                <button
                                                    onClick={() => removeItem(item.key)}
                                                    className="text-red-400 hover:text-red-300 p-1 hover:bg-red-400/10 rounded"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                            <tfoot className="bg-dark-tertiary font-bold border-t border-dark-border">
                                <tr>
                                    <td colSpan="3" className="p-3 text-right">Total Amount</td>
                                    <td className="p-3 text-right text-accent-primary text-lg">
                                        ${formData.items.reduce((sum, i) => sum + i.total_cost, 0).toFixed(2)}
                                    </td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Financial Summary & Notes */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Notes</label>
                                <textarea
                                    className="w-full bg-dark-secondary border border-dark-border rounded-lg p-2 text-white h-24 resize-none focus:outline-none focus:border-accent-primary"
                                    value={formData.notes}
                                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                    placeholder="Optional notes..."
                                />
                            </div>
                        </div>

                        <div className="bg-dark-secondary p-4 rounded-lg space-y-3">
                            <h3 className="font-semibold text-zinc-300 border-b border-dark-border pb-2">Order Summary</h3>

                            <div className="flex justify-between items-center text-sm">
                                <span className="text-zinc-400">Subtotal</span>
                                <span>${formData.items.reduce((sum, i) => sum + i.total_cost, 0).toFixed(2)}</span>
                            </div>

                            <div className="flex justify-between items-center text-sm">
                                <span className="text-zinc-400">Discount</span>
                                <div className="flex gap-2">
                                    <Select
                                        value={formData.discount_type}
                                        onChange={(val) => setFormData({ ...formData, discount_type: val })}
                                        options={[
                                            { value: 'fixed', label: 'Fixed ($)' },
                                            { value: 'percentage', label: '%' }
                                        ]}
                                        className="w-32"
                                    />
                                    <Input
                                        type="number"
                                        min="0"
                                        className="w-20 h-7 text-right"
                                        value={formData.discount_value}
                                        onChange={e => setFormData({ ...formData, discount_value: parseFloat(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>

                            <div className="flex justify-between items-center text-sm">
                                <span className="text-zinc-400">Tax Rate (%)</span>
                                <Input
                                    type="number"
                                    min="0"
                                    className="w-20 h-7 text-right"
                                    value={formData.tax_rate}
                                    onChange={e => setFormData({ ...formData, tax_rate: parseFloat(e.target.value) || 0 })}
                                />
                            </div>

                            <div className="flex justify-between items-center text-sm">
                                <span className="text-zinc-400">Shipping</span>
                                <Input
                                    type="number"
                                    min="0"
                                    className="w-20 h-7 text-right"
                                    value={formData.shipping_cost}
                                    onChange={e => setFormData({ ...formData, shipping_cost: parseFloat(e.target.value) || 0 })}
                                />
                            </div>

                            <div className="border-t border-dark-border pt-3 flex justify-between items-center font-bold text-lg text-accent-primary">
                                <span>Total</span>
                                <span>${(() => {
                                    const subtotal = formData.items.reduce((sum, i) => sum + i.total_cost, 0);
                                    let discount = 0;
                                    if (formData.discount_type === 'percentage') {
                                        discount = subtotal * (formData.discount_value / 100);
                                    } else {
                                        discount = formData.discount_value;
                                    }
                                    const taxable = Math.max(0, subtotal - discount);
                                    const tax = taxable * (formData.tax_rate / 100);
                                    return (taxable + tax + formData.shipping_cost).toFixed(2);
                                })()}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={handleSubmit} loading={loading}>Create Order</Button>
            </ModalFooter>
        </Modal>
    );
}
