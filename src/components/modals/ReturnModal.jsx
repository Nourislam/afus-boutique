import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { toast } from '../ui/Toast';
import { useAuthStore } from '../../stores/authStore';

export default function ReturnModal({ isOpen, onClose, sale, onReturnSuccess }) {
    const { user } = useAuthStore();
    const [items, setItems] = useState([]);
    const [returnReason, setReturnReason] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (sale && isOpen) {
            // Initialize items with 0 return quantity
            if (sale.items) {
                setItems(sale.items.map(item => ({
                    ...item,
                    returnQty: 0,
                    condition: 'sellable'
                })));
            } else {
                // Fetch items if missing?
                // TransactionsPage usually fetches full sale for receipt, 
                // but if passing row object, it might be partial.
                // We'll rely on TransactionsPage to pass full object or we fetch here.
                fetchSaleDetails();
            }
        }
    }, [sale, isOpen]);

    const fetchSaleDetails = async () => {
        try {
            const fullSale = await window.electronAPI.sales.getById(sale.id);
            setItems(fullSale.items.map(item => ({
                ...item,
                returnQty: 0,
                condition: 'sellable'
            })));
        } catch (error) {
            console.error('Failed to fetch sale details:', error);
            toast.error('Failed to load items');
        }
    };

    const handleQtyChange = (itemId, qty) => {
        setItems(items.map(item => {
            if (item.id === itemId) {
                const val = parseInt(qty) || 0;
                // Clamp between 0 and original quantity
                const clamped = Math.min(Math.max(0, val), item.quantity);
                return { ...item, returnQty: clamped };
            }
            return item;
        }));
    };

    const handleConditionChange = (itemId, condition) => {
        setItems(items.map(item =>
            item.id === itemId ? { ...item, condition } : item
        ));
    };

    const calculateTotalRefund = () => {
        return items.reduce((sum, item) => sum + (item.returnQty * item.unit_price), 0);
    };

    const handleSubmit = async () => {
        const itemsToReturn = items.filter(i => i.returnQty > 0);

        if (itemsToReturn.length === 0) {
            toast.error('No items selected for return');
            return;
        }

        setLoading(true);
        try {
            const returnData = {
                id: crypto.randomUUID(),
                sale_id: sale.id,
                return_number: 'RET-' + Date.now().toString().slice(-6),
                total_refund: calculateTotalRefund(),
                reason: returnReason,
                employee_id: user?.id || null,
                items: itemsToReturn.map(item => ({
                    sale_item_id: item.id,
                    product_id: item.product_id,
                    quantity: item.returnQty,
                    refund_amount: item.returnQty * item.unit_price,
                    condition: item.condition
                }))
            };

            await window.electronAPI.returns.create(returnData);
            toast.success('Return processed successfully');
            if (onReturnSuccess) onReturnSuccess();
            onClose();
        } catch (error) {
            console.error('Return failed:', error);
            toast.error('Failed to process return');
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Return for Receipt #${sale?.receipt_number}`} size="lg">
            <ModalBody>
                <div className="space-y-4">
                    <div className="border border-dark-border rounded-lg">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-dark-tertiary text-zinc-400 sticky top-0">
                                <tr>
                                    <th className="p-3">Product</th>
                                    <th className="p-3">Sold Qty</th>
                                    <th className="p-3">Price</th>
                                    <th className="p-3">Return Qty</th>
                                    <th className="p-3">Condition</th>
                                    <th className="p-3 text-right">Refund</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-border">
                                {items.map(item => (
                                    <tr key={item.id} className={item.returnQty > 0 ? 'bg-blue-500/10' : ''}>
                                        <td className="p-3 text-white font-medium">
                                            {item.product_name}
                                            {item.variant_label && <div className="text-xs text-accent-primary">{item.variant_label}{item.sku ? ` · ${item.sku}` : ''}</div>}
                                        </td>
                                        <td className="p-3 text-zinc-300">{item.quantity}</td>
                                        <td className="p-3 text-zinc-300">{formatCurrency(item.unit_price)}</td>
                                        <td className="p-3">
                                            <input
                                                type="number"
                                                min="0"
                                                max={item.quantity}
                                                value={item.returnQty}
                                                onChange={(e) => handleQtyChange(item.id, e.target.value)}
                                                className="w-16 bg-zinc-900 border border-dark-border rounded px-2 py-1 text-white text-center focus:outline-none focus:border-accent-primary"
                                            />
                                        </td>
                                        <td className="p-3">
                                            {item.returnQty > 0 && (
                                                <Select
                                                    value={item.condition}
                                                    onChange={(val) => handleConditionChange(item.id, val)}
                                                    options={[
                                                        { value: 'sellable', label: 'Sellable (Restock)' },
                                                        { value: 'damaged', label: 'Damaged' }
                                                    ]}
                                                    className="w-32"
                                                />
                                            )}
                                        </td>
                                        <td className="p-3 text-right font-medium text-accent-primary">
                                            {item.returnQty > 0 ? formatCurrency(item.returnQty * item.unit_price) : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex gap-4 items-end">
                        <div className="flex-1">
                            <label className="text-sm text-zinc-400 mb-1 block">Reason for Return</label>
                            <Input
                                value={returnReason}
                                onChange={(e) => setReturnReason(e.target.value)}
                                placeholder="Defective, Wrong item, etc."
                            />
                        </div>
                        <div className="text-right p-4 bg-dark-tertiary rounded-lg min-w-[200px]">
                            <p className="text-sm text-zinc-400">Total Refund</p>
                            <p className="text-2xl font-bold text-accent-primary">{formatCurrency(calculateTotalRefund())}</p>
                        </div>
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="danger" loading={loading} onClick={handleSubmit} disabled={calculateTotalRefund() <= 0}>
                    Confirm Return
                </Button>
            </ModalFooter>
        </Modal>
    );
}
