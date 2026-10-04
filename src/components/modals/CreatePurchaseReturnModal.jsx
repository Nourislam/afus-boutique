import { t } from '../../i18n';
import React, { useState, useEffect } from 'react';
import { Package, X, Trash2 } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { toast } from '../ui/Toast';

export default function CreatePurchaseReturnModal({ isOpen, onClose, onComplete, purchaseOrder }) {
    const [returnItems, setReturnItems] = useState([]);
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen && purchaseOrder) {
            // Fetch full PO details if items are missing
            if (!purchaseOrder.items) {
                window.electronAPI.purchaseOrders.getById(purchaseOrder.id).then(fullPO => {
                    const items = fullPO?.items || [];
                    setReturnItems(items.map(item => ({
                        ...item,
                        returnQuantity: 0,
                        reason: 'damaged'
                    })));
                });
            } else {
                setReturnItems(purchaseOrder.items.map(item => ({
                    ...item,
                    returnQuantity: 0,
                    reason: 'damaged'
                })));
            }
            setNotes('');
        }
    }, [isOpen, purchaseOrder]);

    const handleQuantityChange = (index, value) => {
        const newItems = [...returnItems];
        newItems[index].returnQuantity = Math.min(Math.max(0, parseInt(value) || 0), newItems[index].quantity);
        setReturnItems(newItems);
    };

    const handleReasonChange = (index, value) => {
        const newItems = [...returnItems];
        newItems[index].reason = value;
        setReturnItems(newItems);
    };

    const handleSubmit = async () => {
        const itemsToReturn = returnItems.filter(item => item.returnQuantity > 0);

        if (itemsToReturn.length === 0) {
            toast.error(t('purchaseReturn.selectItem'));
            return;
        }

        setIsSubmitting(true);
        try {
            await window.electronAPI.purchaseReturns.create({
                purchase_order_id: purchaseOrder.id,
                supplier_id: purchaseOrder.supplier_id,
                items: itemsToReturn.map(item => ({
                    product_id: item.product_id,
                    product_name: item.product_name || item.name, // Handle potentially different field names
                    quantity: item.returnQuantity,
                    unit_cost: item.unit_cost,
                    reason: item.reason
                })),
                notes
            });
            toast.success(t('purchaseReturn.created'));
            onComplete();
        } catch (error) {
            console.error('Return error:', error);
            toast.error(t('purchaseReturn.failed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!purchaseOrder) return null;

    const totalReturnAmount = returnItems.reduce((sum, item) => sum + (item.returnQuantity * item.unit_cost), 0);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Create Return for PO #${purchaseOrder.po_number || t('supplierPay.draft')}`}>
            <ModalBody>
                <div className="flex flex-col h-full">
                    {/* Item List Header */}
                    <div className="grid grid-cols-12 gap-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-3">
                        <div className="col-span-5">{t('purchaseReturn.item')}</div>
                        <div className="col-span-2">{t('return.qty')}</div>
                        <div className="col-span-3">{t('inventory.reason')}</div>
                        <div className="col-span-2 text-end">{t('return.refund')}</div>
                    </div>

                    {/* Scrollable Items */}
                    <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[40vh] space-y-1 mb-4 pe-1">
                        {returnItems.map((item, index) => (
                            <div key={item.id || index} className="grid grid-cols-12 gap-3 items-center p-3 bg-dark-tertiary/50 hover:bg-dark-tertiary rounded-lg border border-dark-border transition-colors">
                                
                                {/* Item Name & Purchase Info */}
                                <div className="col-span-5 min-w-0">
                                    <p className="font-medium text-sm truncate" title={item.product_name || item.name}>
                                        {item.product_name || item.name}
                                    </p>
                                    <p className="text-xs text-zinc-500 mt-0.5">
                                        Purchased: <span className="text-zinc-300">{item.quantity}</span> @ ${item.unit_cost?.toFixed(2)}
                                    </p>
                                </div>

                                {/* Return Qty Input */}
                                <div className="col-span-2">
                                    <Input
                                        type="number"
                                        value={item.returnQuantity}
                                        onChange={(e) => handleQuantityChange(index, e.target.value)}
                                        min="0"
                                        max={item.quantity}
                                        className="h-9 text-sm text-center"
                                        placeholder="0"
                                    />
                                </div>

                                {/* Reason Select */}
                                <div className="col-span-3">
                                    <Select
                                        className="w-full text-xs h-9"
                                        value={item.reason}
                                        onChange={(val) => handleReasonChange(index, val)}
                                        options={[
                                            { value: 'damaged', label: t('return.damaged') },
                                            { value: 'wrong_item', label: t('purchaseReturn.wrongItem') },
                                            { value: 'wrong_size', label: t('purchaseReturn.wrongSize') },
                                            { value: 'other', label: t('stock.reason.other') }
                                        ]}
                                    />
                                </div>

                                {/* Line Total */}
                                <div className="col-span-2 text-end">
                                    <p className={`font-semibold text-sm ${item.returnQuantity > 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                                        ${(item.returnQuantity * item.unit_cost).toFixed(2)}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Footer Section: Notes & Total */}
                    <div className="space-y-4 pt-4 border-t border-dark-border">
                        <div className="flex justify-between items-start gap-4">
                            <div className="flex-1">
                                <label className="text-sm font-medium text-zinc-400 mb-1.5 block">{t('purchaseReturn.notes')}</label>
                                <textarea
                                    className="w-full bg-dark-tertiary border border-dark-border rounded-lg p-3 text-sm text-white focus:outline-none focus:border-accent-primary min-h-[80px] resize-none"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder={t('purchaseReturn.notesPlaceholder')}
                                />
                            </div>
                            
                            <div className="w-48 flex flex-col items-end pt-7">
                                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">{t('return.total')}</p>
                                <p className="text-3xl font-bold text-red-400">${totalReturnAmount.toFixed(2)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>{t('common.cancel')}</Button>
                <Button onClick={handleSubmit} loading={isSubmitting} variant="destructive">
                    {t('purchaseReturn.create')}
                </Button>
            </ModalFooter>
        </Modal>
    );
}
