import { t } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';
import { formatMoney } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FileText, Mail } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../ui/Toast';

export default function PurchaseOrderDetailsModal({ isOpen, onClose, purchaseOrder }) {
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const emailOn = useSettingsStore(state => !!state.settings.features?.email);

    useEffect(() => {
        if (purchaseOrder && isOpen) {
            fetchDetails();
        }
    }, [purchaseOrder, isOpen]);

    const fetchDetails = async () => {
        setLoading(true);
        try {
            const data = await window.electronAPI.purchaseOrders.getById(purchaseOrder.id);
            setDetails(data);
        } catch (error) {
            console.error('Failed to load PO details:', error);
            toast.error(t('po.detailsFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handleSendEmail = async () => {
        if (!details?.supplier_email) {
            toast.error(t('po.noSupplierEmail'));
            return;
        }

        setSending(true);
        try {
            await window.electronAPI.email.sendPurchaseOrder({
                to: details.supplier_email,
                po: details
            });
            toast.success(t('po.emailed'));
        } catch (error) {
            console.error('Email failed:', error);
            toast.error(t('receipt.emailFailed'));
        } finally {
            setSending(false);
        }
    };

    const formatCurrency = (val) => formatMoney(val);
    const formatDate = (dateString) => formatLocalDate(dateString, 'datetime');

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Purchase Order #${purchaseOrder?.po_number}`} size="lg">
            <ModalBody>
                {loading ? (
                    <div className="p-8 text-center text-zinc-500">{t('po.loadingDetails')}</div>
                ) : details ? (
                    <div className="space-y-6">
                        {/* Header */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('po.supplier')}</p>
                                <p className="font-medium">{details.supplier_name || t('tx.unknown')}</p>
                                {details.supplier_email && <p className="text-xs text-zinc-500">{details.supplier_email}</p>}
                                {details.supplier_phone && <p className="text-xs text-zinc-500">{details.supplier_phone}</p>}
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('inventory.status')}</p>
                                <div className="flex gap-2 mt-1">
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${details.status === 'received' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'
                                        }`}>
                                        {details.status}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase border ${details.payment_status === 'paid' ? 'border-green-500/30 text-green-500' :
                                            details.payment_status === 'partial' ? 'border-amber-500/30 text-amber-500' :
                                                'border-red-500/30 text-red-500'
                                        }`}>
                                        {details.payment_status}
                                    </span>
                                </div>
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('po.dateCreated')}</p>
                                <p className="font-medium">{formatDate(details.created_at)}</p>
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('po.expected')}</p>
                                <p className="font-medium">{details.expected_date ? formatLocalDate(details.expected_date, 'date') : t('po.na')}</p>
                            </div>
                        </div>

                        {/* Items */}
                        <div className="border border-dark-border rounded-lg overflow-hidden">
                            <table className="w-full text-start text-sm">
                                <thead className="bg-dark-tertiary text-zinc-400">
                                    <tr>
                                        <th className="p-3">{t('inventory.product')}</th>
                                        <th className="p-3 text-center">{t('credit.qty')}</th>
                                        <th className="p-3 text-end">{t('po.unitCost')}</th>
                                        <th className="p-3 text-end">{t('pos.total')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-dark-border">
                                    {details.items?.map((item, idx) => (
                                        <tr key={idx}>
                                            <td className="p-3 font-medium">
                                                {item.product_name}
                                                <div className="text-xs text-zinc-500">{item.sku}</div>
                                            </td>
                                            <td className="p-3 text-center">{item.quantity}</td>
                                            <td className="p-3 text-end">{formatCurrency(item.unit_cost)}</td>
                                            <td className="p-3 text-end">{formatCurrency(item.total_cost)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-dark-tertiary font-bold">
                                    <tr>
                                        <td colSpan="3" className="p-3 text-end font-normal text-zinc-400">{t('pos.subtotal')}</td>
                                        <td className="p-3 text-end">{formatCurrency(details.subtotal)}</td>
                                    </tr>
                                    {details.tax_amount > 0 && (
                                        <tr>
                                            <td colSpan="3" className="p-3 text-end font-normal text-zinc-400">{t('pos.tax')}</td>
                                            <td className="p-3 text-end">{formatCurrency(details.tax_amount)}</td>
                                        </tr>
                                    )}
                                    {details.shipping_cost > 0 && (
                                        <tr>
                                            <td colSpan="3" className="p-3 text-end font-normal text-zinc-400">{t('po.shipping')}</td>
                                            <td className="p-3 text-end">{formatCurrency(details.shipping_cost)}</td>
                                        </tr>
                                    )}
                                    <tr>
                                        <td colSpan="3" className="p-3 text-end">{t('pos.total')}</td>
                                        <td className="p-3 text-end text-accent-primary">{formatCurrency(details.total)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {details.notes && (
                            <div className="p-3 bg-dark-tertiary rounded-lg text-sm">
                                <p className="text-zinc-400 mb-1">{t('customers.notes')}</p>
                                <p>{details.notes}</p>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex justify-end gap-3 mt-4">
                            {emailOn && details.supplier_email && (
                                <Button size="sm" variant="outline" onClick={handleSendEmail} loading={sending}>
                                    <Mail className="w-4 h-4 me-2" />
                                    {t('po.emailSupplier')}
                                </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => window.electronAPI.purchaseOrders.savePdf(details)}>
                                <FileText className="w-4 h-4 me-2" />
                                {t('po.downloadPdf')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="p-8 text-center text-zinc-500">{t('po.detailsError')}</div>
                )}
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
            </ModalFooter>
        </Modal>
    );
}
