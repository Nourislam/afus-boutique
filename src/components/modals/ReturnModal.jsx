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
import { useSettingsStore } from '../../stores/settingsStore';
import { lineRefund } from '../../../electron/shared/refund.mjs';

export default function ReturnModal({ isOpen, onClose, sale, onReturnSuccess }) {
    const { user } = useAuthStore();
    const [items, setItems] = useState([]);
    const [returnReason, setReturnReason] = useState('');
    const [loading, setLoading] = useState(false);
    // Money back, or a store credit (avoir) spent later like a gift card
    const giftCardsOn = useSettingsStore(state => state.settings.features?.giftCards);
    const [refundMethod, setRefundMethod] = useState('cash');
    const [credit, setCredit] = useState(null);

    useEffect(() => {
        if (sale && isOpen) {
            // Always read the sale again: it gives what was already returned
            fetchSaleDetails();
        }
    }, [sale, isOpen]);

    const fetchSaleDetails = async () => {
        try {
            const fullSale = await window.electronAPI.sales.getById(sale.id);
            setFullSale(fullSale);
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

    // What the pieces were really paid (discounts taken off), as the main process counts it
    const [fullSale, setFullSale] = useState(null);
    const refundOf = (item, qty = item.returnQty) => lineRefund(fullSale || sale, item, qty);
    const calculateTotalRefund = () => {
        return Math.round(items.reduce((sum, item) => sum + refundOf(item), 0) * 100) / 100;
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
                refund_method: giftCardsOn && refundMethod === 'store_credit' ? 'store_credit' : 'cash',
                items: itemsToReturn.map(item => ({
                    sale_item_id: item.id,
                    product_id: item.product_id,
                    quantity: item.returnQty,
                    refund_amount: refundOf(item),
                    condition: item.condition
                }))
            };

            // A cashier may need a manager's PIN (checked by the main process)
            const saved = await withManagerApproval((approval) => window.electronAPI.returns.create({ ...returnData, approval }));
            toast.success(t('return.done'));
            // Kridi sale: the pieces lowered what the customer owes first
            if (saved?.credit_reduced > 0) toast.success(t('return.debtLowered', { amount: formatMoney(saved.credit_reduced), back: formatMoney(saved.hand_back || 0) }));
            if (onReturnSuccess) onReturnSuccess();
            // An avoir: its code is shown (and can be saved as PDF) before closing
            if (saved?.store_credit) setCredit(saved.store_credit);
            else onClose();
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
                                        <td className="p-3 text-zinc-300">{formatCurrency(refundOf(item, 1))}</td>
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
                                            {item.returnQty > 0 ? formatCurrency(refundOf(item)) : '-'}
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
                    {/* Kridi ticket: the main process lowers the debt first, then gives back the rest */}
                    {fullSale?.payments?.some(p => String(p.method).toLowerCase() === 'credit') && (
                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200" data-testid="return-kridi-note">{t('return.kridiNote')}</p>
                    )}
                    {giftCardsOn && (
                        <div role="radiogroup" aria-label={t('avoir.refundAs')} className="grid grid-cols-2 gap-2">
                            {['cash', 'store_credit'].map(method => (
                                <button key={method} type="button" role="radio" aria-checked={refundMethod === method} onClick={() => setRefundMethod(method)}
                                    data-testid={`refund-${method}`}
                                    className={`rounded-lg border-2 px-3 py-2 text-start text-sm ${refundMethod === method ? 'border-accent-primary bg-accent-primary/10' : 'border-dark-border hover:border-zinc-600'}`}>
                                    <span className="block font-semibold">{t(`avoir.${method}`)}</span>
                                    <span className="block text-xs text-zinc-500">{t(`avoir.${method}Hint`)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                <Button variant="danger" loading={loading} onClick={handleSubmit} disabled={calculateTotalRefund() <= 0}>
                    {t('return.confirm')}
                </Button>
            </ModalFooter>
            {credit && (
                <Modal isOpen onClose={() => { setCredit(null); onClose(); }} title={t('avoir.title')} size="sm">
                    <ModalBody className="space-y-3 text-center">
                        <span data-testid="avoir-issued" className="sr-only">{credit.code}</span>
                        <p className="text-sm text-zinc-400">{t('avoir.issuedText')}</p>
                        <p className="text-2xl font-bold tabular ltr select-all" dir="ltr">{credit.code}</p>
                        <p className="text-lg font-semibold text-accent-primary">{formatCurrency(credit.amount)}</p>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => window.electronAPI.giftCards.savePdf({ code: credit.code, initial_balance: credit.amount, current_balance: credit.amount }).catch(e => toast.error(translateError(e)))}>
                            {t('common.savePdf')}
                        </Button>
                        <Button onClick={() => { setCredit(null); onClose(); }}>{t('common.close')}</Button>
                    </ModalFooter>
                </Modal>
            )}
        </Modal>
    );
}
