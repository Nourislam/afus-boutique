import { t } from '../../i18n';
import { formatMoney } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { toast } from '../ui/Toast';
import { translateError } from '../../i18n/errors';
import { useAuthStore } from '../../stores/authStore';
import { withManagerApproval } from '../../lib/approval';

export default function ReturnModal({ isOpen, onClose, sale, onReturnSuccess }) {
    const { user } = useAuthStore();
    const [items, setItems] = useState([]);
    const [returnReason, setReturnReason] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (sale && isOpen) {
            // Always read the sale again: it gives what was already returned
            fetchSaleDetails();
        }
    }, [sale, isOpen]);

    const fetchSaleDetails = async () => {
        try {
            const fullSale = await window.electronAPI.sales.getById(sale.id);
            setItems(fullSale.items.map(item => ({
                ...item,
                // Pieces that can still come back on this line
                maxReturn: Math.max(0, (Number(item.quantity) || 0) - (Number(item.returned_quantity) || 0)),
                returnQty: 0,
                condition: 'sellable'
            })));
        } catch (error) {
            console.error('Failed to fetch sale details:', error);
            toast.error(t('return.loadFailed'));
        }
    };

    const handleQtyChange = (itemId, qty) => {
        setItems(items.map(item => {
            if (item.id === itemId) {
                const val = parseInt(qty) || 0;
                // Between 0 and what was sold minus earlier returns
                const clamped = Math.min(Math.max(0, val), item.maxReturn ?? item.quantity);
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
            toast.error(t('return.noneSelected'));
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

            // A cashier may need a manager's PIN (checked by the main process)
            await withManagerApproval((approval) => window.electronAPI.returns.create({ ...returnData, approval }));
            toast.success(t('return.done'));
            if (onReturnSuccess) onReturnSuccess();
            onClose();
        } catch (error) {
            console.error('Return failed:', error);
            // The reason (e.g. more pieces than can still be returned)
            toast.error(`${t('return.failed')} — ${translateError(error)}`);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val) => formatMoney(val);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('return.titleFor', { receipt: sale?.receipt_number || '' })} size="lg">
            <ModalBody>
                <div className="space-y-4">
                    <div className="border border-dark-border rounded-lg">
                        <table className="w-full text-start text-sm">
                            <thead className="bg-dark-tertiary text-zinc-400 sticky top-0">
                                <tr>
                                    <th className="p-3">{t('inventory.product')}</th>
                                    <th className="p-3">{t('return.soldQty')}</th>
                                    <th className="p-3">{t('qr.price')}</th>
                                    <th className="p-3">{t('return.qty')}</th>
                                    <th className="p-3">{t('return.condition')}</th>
                                    <th className="p-3 text-end">{t('return.refund')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-border">
                                {items.map(item => (
                                    <tr key={item.id} className={item.returnQty > 0 ? 'bg-blue-500/10' : ''}>
                                        <td className="p-3 text-white font-medium">
                                            {item.product_name}
                                            {item.variant_label && <div className="text-xs text-accent-primary">{item.variant_label}{item.sku ? ` · ${item.sku}` : ''}</div>}
                                        </td>
                                        <td className="p-3 text-zinc-300">
                                            {item.quantity}
                                            {item.returned_quantity > 0 && <div className="text-xs text-amber-400">{t('return.alreadyReturned', { n: item.returned_quantity })}</div>}
                                        </td>
                                        <td className="p-3 text-zinc-300">{formatCurrency(item.unit_price)}</td>
                                        <td className="p-3">
                                            <input
                                                type="number"
                                                min="0"
                                                max={item.maxReturn ?? item.quantity}
                                                disabled={item.maxReturn === 0}
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
                                                        { value: 'sellable', label: t('return.sellable') },
                                                        { value: 'damaged', label: t('return.damaged') }
                                                    ]}
                                                    className="w-32"
                                                />
                                            )}
                                        </td>
                                        <td className="p-3 text-end font-medium text-accent-primary">
                                            {item.returnQty > 0 ? formatCurrency(item.returnQty * item.unit_price) : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex gap-4 items-end">
                        <div className="flex-1">
                            <label className="text-sm text-zinc-400 mb-1 block">{t('return.reason')}</label>
                            <Input
                                value={returnReason}
                                onChange={(e) => setReturnReason(e.target.value)}
                                placeholder={t('return.reasonPlaceholder')}
                            />
                        </div>
                        <div className="text-end p-4 bg-dark-tertiary rounded-lg min-w-[200px]">
                            <p className="text-sm text-zinc-400">{t('return.total')}</p>
                            <p className="text-2xl font-bold text-accent-primary">{formatCurrency(calculateTotalRefund())}</p>
                        </div>
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                <Button variant="danger" loading={loading} onClick={handleSubmit} disabled={calculateTotalRefund() <= 0}>
                    {t('return.confirm')}
                </Button>
            </ModalFooter>
        </Modal>
    );
}
