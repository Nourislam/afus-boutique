import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';

export default function ReceiveStockModal({ isOpen, onClose, onComplete, purchaseOrder }) {
    const [items, setItems] = useState([]);
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && purchaseOrder) {
            // Initialize items with 0 quantity to receive
            // We need to fetch the latest PO state to get current received_quantity
            loadLatestPO();
        }
    }, [isOpen, purchaseOrder]);

    const loadLatestPO = async () => {
        try {
            const po = await window.electronAPI.purchaseOrders.getById(purchaseOrder.id);
            if (po && po.items) {
                setItems(po.items.map(item => ({
                    ...item,
                    receive_now: Math.max(0, item.quantity - (item.received_quantity || 0)) // Default to remaining qty
                })));
            }
        } catch (error) {
            console.error('Failed to reload PO:', error);
            toast.error('Failed to load item details');
        }
    };

    const handleQuantityChange = (itemId, value) => {
        const val = parseInt(value) || 0;
        setItems(prev => prev.map(item =>
            item.id === itemId ? { ...item, receive_now: Math.max(0, val) } : item
        ));
    };

    const handleSubmit = async () => {
        // Filter items that have quantity > 0
        const itemsToReceive = items
            .filter(item => item.receive_now > 0)
            .map(item => ({
                po_item_id: item.id,
                product_id: item.product_id,
                variant_id: item.variant_id || null,
                product_name: item.product_name,
                quantity_ordered: item.quantity,
                quantity_received: item.receive_now
            }));

        if (itemsToReceive.length === 0) {
            toast.error('Please enter quantity to receive for at least one item');
            return;
        }

        // Check for over-receiving
        const overReceived = items.find(item => (item.received_quantity || 0) + item.receive_now > item.quantity);
        if (overReceived) {
            if (!confirm(`You are receiving more than ordered for ${overReceived.product_name}. Continue?`)) {
                return;
            }
        }

        setLoading(true);
        try {
            await window.electronAPI.purchaseOrders.createGRN({
                poId: purchaseOrder.id,
                items: itemsToReceive,
                notes
            });
            toast.success('Stock Received (GRN Created)');
            onComplete();
            onClose();
        } catch (error) {
            console.error('GRN Error:', error);
            toast.error('Failed to receive stock');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Receive Stock - ${purchaseOrder?.po_number || ''}`} size="xl">
            <ModalBody>
                <div className="space-y-4">
                    <div className="bg-dark-secondary rounded-lg border border-dark-border overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-dark-tertiary text-zinc-400">
                                <tr>
                                    <th className="p-3">Product</th>
                                    <th className="p-3 text-center">Ordered</th>
                                    <th className="p-3 text-center">Received</th>
                                    <th className="p-3 text-center">Remaining</th>
                                    <th className="p-3 text-center w-32">Receive Now</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-border">
                                {items.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="p-4 text-center text-zinc-500">
                                            No items found in this Purchase Order.
                                        </td>
                                    </tr>
                                ) : (
                                    items.map(item => {
                                        const received = item.received_quantity || 0;
                                        const remaining = Math.max(0, item.quantity - received);
                                        return (
                                            <tr key={item.id} className="hover:bg-zinc-800/50">
                                                <td className="p-3 font-medium">
                                                    {item.product_name}
                                                    {item.variant_label && <div className="text-xs text-accent-primary">{item.variant_label}</div>}
                                                </td>
                                                <td className="p-3 text-center">{item.quantity}</td>
                                                <td className="p-3 text-center text-zinc-400">{received}</td>
                                                <td className="p-3 text-center text-amber-500 font-medium">{remaining}</td>
                                                <td className="p-3">
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        className="w-full text-center h-8"
                                                        value={item.receive_now}
                                                        onChange={e => handleQuantityChange(item.id, e.target.value)}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div>
                        <label className="block text-sm text-zinc-400 mb-1">GRN Notes</label>
                        <Input
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Optional notes for this delivery..."
                        />
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSubmit} loading={loading}>Confirm Receipt</Button>
            </ModalFooter>
        </Modal>
    );
}
