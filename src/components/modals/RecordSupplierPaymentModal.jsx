import { t } from '../../i18n';
import React, { useState, useEffect } from 'react';
import { Banknote, CreditCard, FileText } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { toast } from '../ui/Toast';

export default function RecordSupplierPaymentModal({ isOpen, onClose, onComplete, purchaseOrder }) {
    const [amount, setAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen && purchaseOrder) {
            // Calculate remaining balance
            const total = purchaseOrder.total || 0;
            const paid = purchaseOrder.amount_paid || 0;
            const remaining = Math.max(0, total - paid);
            setAmount(remaining.toString());
            setReference('');
            setNotes('');
        }
    }, [isOpen, purchaseOrder]);

    const handleSubmit = async () => {
        if (!amount || parseFloat(amount) <= 0) {
            toast.error(t('credit.validAmount'));
            return;
        }

        setIsSubmitting(true);
        try {
            await window.electronAPI.purchaseOrders.recordPayment({
                purchase_order_id: purchaseOrder.id,
                supplier_id: purchaseOrder.supplier_id,
                amount: parseFloat(amount),
                payment_method: paymentMethod,
                reference,
                notes
            });
            toast.success(t('credit.recorded'));
            onComplete();
        } catch (error) {
            console.error('Payment error:', error);
            toast.error(t('credit.recordFailed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!purchaseOrder) return null;

    const total = purchaseOrder.total || 0;
    const paid = purchaseOrder.amount_paid || 0;
    const remaining = total - paid;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Record Payment for PO #${purchaseOrder.po_number || t('supplierPay.draft')}`}>
            <ModalBody>
                <div className="space-y-4">
                    <div className="bg-dark-tertiary p-4 rounded-lg flex justify-between items-center mb-4">
                        <div>
                            <p className="text-zinc-400 text-sm">{t('pos.amountDue')}</p>
                            <p className="text-xl font-bold text-white">${remaining.toFixed(2)}</p>
                        </div>
                        <div className="text-end">
                            <p className="text-zinc-400 text-sm">{t('supplierPay.poValue')}</p>
                            <p className="font-medium text-white">${total.toFixed(2)}</p>
                        </div>
                    </div>

                    <Input
                        label={t('supplierPay.amount')}
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        icon={Banknote}
                        step="0.01"
                    />

                    <Select
                        label={t('pos.paymentMethod')}
                        value={paymentMethod}
                        onChange={setPaymentMethod}
                        options={[
                            { value: 'cash', label: t('pay.cash') },
                            { value: 'bank_transfer', label: t('supplierPay.bankTransfer') },
                            { value: 'check', label: t('supplierPay.check') },
                            { value: 'transfer', label: t('pay.transferShort') },
                            { value: 'card', label: t('pay.cardCib') },
                            { value: 'other', label: t('stock.reason.other') }
                        ]}
                        icon={CreditCard}
                    />

                    <Input
                        label={t('supplierPay.reference')}
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder={t('supplierPay.referencePlaceholder')}
                        icon={FileText}
                    />

                    <div className="space-y-1">
                        <label className="text-sm text-zinc-400">{t('customers.notes')}</label>
                        <textarea
                            className="w-full bg-dark-tertiary border border-dark-border rounded-lg p-3 text-white focus:outline-none focus:border-accent-primary min-h-[80px]"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={t('po.notesPlaceholder')}
                        />
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>{t('common.cancel')}</Button>
                <Button onClick={handleSubmit} loading={isSubmitting}>
                    {t('credit.recordPayment')}
                </Button>
            </ModalFooter>
        </Modal>
    );
}
