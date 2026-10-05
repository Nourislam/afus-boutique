import { t } from '../../i18n';
import { formatMoney } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { CheckCircle, XCircle } from 'lucide-react';
import { useTaxEnabled } from '../../lib/useTaxEnabled';

export default function AddSupplierInvoiceModal({ isOpen, onClose, onComplete, purchaseOrder }) {
    const taxOn = useTaxEnabled();
    const [formData, setFormData] = useState({
        invoice_number: '',
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: '',
        subtotal: 0,
        tax_amount: 0,
        total_amount: 0,
        notes: ''
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && purchaseOrder) {
            // Auto-populate with expected amounts from PO
            setFormData({
                invoice_number: '',
                invoice_date: new Date().toISOString().split('T')[0],
                due_date: purchaseOrder.expected_date ? purchaseOrder.expected_date.split('T')[0] : '',
                subtotal: purchaseOrder.subtotal || 0,
                tax_amount: purchaseOrder.tax_amount || 0,
                total_amount: purchaseOrder.total || 0,
                notes: ''
            });
        }
    }, [isOpen, purchaseOrder]);

    const handleSubmit = async () => {
        if (!formData.invoice_number) return toast.error(t('invoice.numberRequired'));

        setLoading(true);
        try {
            const result = await window.electronAPI.purchaseOrders.addInvoice({
                purchase_order_id: purchaseOrder.id,
                ...formData
            });

            if (result.match_status === 'matched') {
                toast.success(t('invoice.matched'));
            } else {
                toast.error(t('invoice.mismatch'));
            }
            onComplete();
            onClose();
        } catch (error) {
            console.error('Invoice Error:', error);
            toast.error(t('invoice.failed'));
        } finally {
            setLoading(false);
        }
    };

    // Calculate match status on the fly for UI feedback
    const getMatchStatus = () => {
        if (!purchaseOrder) return 'neutral';
        const diff = Math.abs(formData.total_amount - purchaseOrder.total);
        return diff < 0.05 ? 'match' : 'mismatch';
    };

    const matchStatus = getMatchStatus();

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('invoice.title')} size="lg">
            <ModalBody>
                <div className="space-y-6">
                    {/* Header Inputs */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">{t('invoice.number')}</label>
                            <Input
                                value={formData.invoice_number}
                                onChange={e => setFormData({ ...formData, invoice_number: e.target.value })}
                                placeholder="INV-001"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">{t('invoice.date')}</label>
                            <Input
                                type="date"
                                value={formData.invoice_date}
                                onChange={e => setFormData({ ...formData, invoice_date: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* Amount Inputs with Match Indicator */}
                    <div className="bg-dark-secondary p-4 rounded-lg border border-dark-border space-y-4">
                        <div className="flex justify-between items-center pb-2 border-b border-dark-border">
                            <h3 className="font-semibold text-zinc-300">{t('invoice.financials')}</h3>
                            <div className={`flex items-center gap-2 text-sm font-medium ${matchStatus === 'match' ? 'text-green-400' : 'text-red-400'
                                }`}>
                                {matchStatus === 'match' ? (
                                    <><CheckCircle className="w-4 h-4" /> {t('invoice.ok')}</>
                                ) : (
                                    <><XCircle className="w-4 h-4" /> {t('invoice.mismatch')} {formatMoney(purchaseOrder?.total || 0)}</>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">{t('pos.subtotal')}</label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formData.subtotal}
                                    onChange={e => setFormData({ ...formData, subtotal: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            {taxOn && (
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">{t('pos.tax')}</label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formData.tax_amount}
                                    onChange={e => setFormData({ ...formData, tax_amount: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            )}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1 font-bold text-accent-primary">{t('pos.total')}</label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="border-accent-primary"
                                    value={formData.total_amount}
                                    onChange={e => setFormData({ ...formData, total_amount: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-zinc-400 mb-1">{t('customers.notes')}</label>
                        <textarea
                            className="w-full bg-dark-secondary border border-dark-border rounded-lg p-2 text-white h-20 resize-none focus:outline-none focus:border-accent-primary"
                            value={formData.notes}
                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                            placeholder={t('invoice.notesPlaceholder')}
                        />
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <div className="flex-1 text-xs text-zinc-500">
                    {t('invoice.expectedTotal')} {formatMoney(purchaseOrder?.total || 0)}
                </div>
                <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                <Button onClick={handleSubmit} loading={loading}>{t('invoice.save')}</Button>
            </ModalFooter>
        </Modal>
    );
}
