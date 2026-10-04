import { t } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';
import { formatMoney } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';

export default function ReturnDetailsModal({ isOpen, onClose, returnData }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (returnData && isOpen) {
            fetchReturnItems();
        }
    }, [returnData, isOpen]);

    const fetchReturnItems = async () => {
        setLoading(true);
        try {
            // We need a new API to get items for a return
            // window.electronAPI.returns.getItems(returnData.id) ?
            // Or if getAll returns items? No it doesn't.
            // I'll need to add db:returns:getItems handler in main.js
            // For now I'll assume I will add it.
            const data = await window.electronAPI.returns.getItems(returnData.id);
            setItems(data);
        } catch (error) {
            console.error('Failed to load return items:', error);
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val) => formatMoney(val);
    const formatDate = (dateString) => formatLocalDate(dateString, 'datetime');

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Return Details #${returnData?.return_number}`} size="lg">
            <ModalBody>
                {returnData && (
                    <div className="space-y-6">
                        {/* Header Info */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('return.originalReceipt')}</p>
                                <p className="font-mono font-medium">{returnData.receipt_number}</p>
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('return.processedBy')}</p>
                                <p className="font-medium">{returnData.employee_name || t('tx.unknown')}</p>
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('tx.date')}</p>
                                <p className="font-medium">{formatDate(returnData.created_at)}</p>
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('inventory.reason')}</p>
                                <p className="font-medium italic">{returnData.reason || t('return.noReason')}</p>
                            </div>
                        </div>

                        {/* Items Table */}
                        <div className="border border-dark-border rounded-lg overflow-hidden">
                            <table className="w-full text-start text-sm">
                                <thead className="bg-dark-tertiary text-zinc-400">
                                    <tr>
                                        <th className="p-3">{t('inventory.product')}</th>
                                        <th className="p-3 text-center">{t('return.condition')}</th>
                                        <th className="p-3 text-center">{t('credit.qty')}</th>
                                        <th className="p-3 text-end">{t('return.refund')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-dark-border">
                                    {loading ? (
                                        <tr><td colSpan="4" className="p-4 text-center text-zinc-500">{t('po.loadingDetails')}</td></tr>
                                    ) : items.length === 0 ? (
                                        <tr><td colSpan="4" className="p-4 text-center text-zinc-500">{t('return.noItems')}</td></tr>
                                    ) : (
                                        items.map((item, idx) => (
                                            <tr key={idx}>
                                                <td className="p-3 font-medium">{item.product_name}</td>
                                                <td className="p-3 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-xs ${item.condition === 'sellable' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                                        }`}>
                                                        {item.condition === 'sellable' ? t('return.sellable') : item.condition === 'damaged' ? t('return.damaged') : item.condition}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-center">{item.quantity}</td>
                                                <td className="p-3 text-end">{formatCurrency(item.refund_amount)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                                <tfoot className="bg-dark-tertiary font-bold">
                                    <tr>
                                        <td colSpan="3" className="p-3 text-end">{t('return.total')}</td>
                                        <td className="p-3 text-end text-accent-primary">{formatCurrency(returnData.total_refund)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
            </ModalFooter>
        </Modal>
    );
}
