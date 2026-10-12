import { t } from '../../i18n';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Tag, PackageCheck, PackageMinus, PackagePlus } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { lineStatus, receivingSummary, groupByArticle, arrivedLabelsLink } from '../../lib/receiving';

const STATUS_STYLE = {
    short: 'bg-amber-500/15 text-amber-300',
    full: 'bg-emerald-500/15 text-emerald-300',
    over: 'bg-sky-500/15 text-sky-300',
};

/**
 * Receiving a purchase order: for each colour / size, ordered against
 * arrived (short, full or over), then the labels of the pieces that arrived
 * only. Typing the pieces counted in the boxes is enough; nothing missing is
 * filled in for the supplier.
 */
export default function ReceiveStockModal({ isOpen, onClose, onComplete, purchaseOrder }) {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(null); // { number, received: [{ product_id, variant_id, quantity }] }

    useEffect(() => {
        if (isOpen && purchaseOrder) {
            setDone(null);
            setNotes('');
            loadLatestPO();
        }
    }, [isOpen, purchaseOrder]);

    const loadLatestPO = async () => {
        try {
            // The latest state of the order: what already arrived in earlier deliveries
            const po = await window.electronAPI.purchaseOrders.getById(purchaseOrder.id);
            if (po && po.items) {
                setItems(po.items.map(item => ({
                    ...item,
                    receive_now: Math.max(0, item.quantity - (item.received_quantity || 0)) // Default to remaining qty
                })));
            }
        } catch (error) {
            console.error('Failed to reload PO:', error);
            toast.error(t('receive.itemsFailed'));
        }
    };

    const setQuantity = (itemId, value) => {
        const val = parseInt(value, 10) || 0;
        setItems(prev => prev.map(item => (item.id === itemId ? { ...item, receive_now: Math.max(0, val) } : item)));
    };
    const fillAll = (remaining) => setItems(prev => prev.map(item => ({ ...item, receive_now: remaining ? Math.max(0, item.quantity - (item.received_quantity || 0)) : 0 })));

    const summary = useMemo(() => receivingSummary(items), [items]);
    const groups = useMemo(() => groupByArticle(items), [items]);

    const handleSubmit = async () => {
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
            toast.error(t('receive.enterQty'));
            return;
        }

        // More than ordered: the shop confirms it keeps the extra pieces
        const overReceived = items.find(item => lineStatus(item, item.receive_now).status === 'over' && item.receive_now > 0);
        if (overReceived && !confirm(t('receive.overConfirm', { name: overReceived.product_name }))) return;

        setLoading(true);
        try {
            const result = await window.electronAPI.purchaseOrders.createGRN({
                poId: purchaseOrder.id,
                items: itemsToReceive,
                notes
            });
            toast.success(t('receive.done'));
            setDone({
                number: result?.receive_number,
                summary,
                received: itemsToReceive.map(i => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity_received })),
            });
        } catch (error) {
            console.error('GRN Error:', error);
            toast.error(t('receive.failed'));
        } finally {
            setLoading(false);
        }
    };

    // After saving, closing refreshes the orders list
    const finish = () => {
        if (done) onComplete();
        onClose();
    };
    const printArrived = () => {
        const link = arrivedLabelsLink(done?.received);
        finish();
        if (link) navigate(link);
    };

    return (
        <Modal isOpen={isOpen} onClose={finish} title={t('receive.title', { number: purchaseOrder?.po_number || '' })} size="xl">
            <ModalBody>
                {done ? (
                    <div className="space-y-4 text-center py-4" data-testid="receive-done">
                        <PackageCheck className="w-12 h-12 mx-auto text-emerald-300" />
                        <p className="text-lg font-semibold">{t('receive.savedTitle', { number: done.number || '' })}</p>
                        <p className="text-sm text-zinc-400">{t('receive.savedText', { n: done.summary.pieces })}</p>
                        <SummaryBadges summary={done.summary} />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <SummaryBadges summary={summary} />
                            <div className="flex gap-2">
                                <Button size="sm" variant="secondary" onClick={() => fillAll(true)} data-testid="receive-all">{t('receive.allArrived')}</Button>
                                <Button size="sm" variant="ghost" onClick={() => fillAll(false)} data-testid="receive-none">{t('receive.noneArrived')}</Button>
                            </div>
                        </div>
                        <div className="bg-dark-secondary rounded-lg border border-dark-border overflow-x-auto">
                            <table className="w-full text-start text-sm" data-testid="receive-lines">
                                <thead className="bg-dark-tertiary text-zinc-400">
                                    <tr>
                                        <th className="p-3 text-start">{t('receive.colorSize')}</th>
                                        <th className="p-3 text-center">{t('receive.ordered')}</th>
                                        <th className="p-3 text-center">{t('receive.received')}</th>
                                        <th className="p-3 text-center w-28">{t('receive.now')}</th>
                                        <th className="p-3 text-center">{t('receive.state')}</th>
                                    </tr>
                                </thead>
                                {items.length === 0 ? (
                                    <tbody>
                                        <tr><td colSpan="5" className="p-4 text-center text-zinc-500">{t('receive.noItems')}</td></tr>
                                    </tbody>
                                ) : groups.map(group => (
                                    <tbody key={group.key} className="divide-y divide-dark-border border-t border-dark-border">
                                        <tr className="bg-dark-tertiary/40">
                                            <td colSpan="5" className="px-3 py-2 font-semibold">{group.name}</td>
                                        </tr>
                                        {group.items.map(item => {
                                            const s = lineStatus(item, item.receive_now);
                                            return (
                                                <tr key={item.id} data-testid={`receive-line-${item.id}`}>
                                                    <td className="p-3 ps-6">{item.variant_label || <span className="text-zinc-500">{t('receive.noVariant')}</span>}</td>
                                                    <td className="p-3 text-center tabular">{item.quantity}</td>
                                                    <td className="p-3 text-center text-zinc-400 tabular">{item.received_quantity || 0}</td>
                                                    <td className="p-3">
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            className="w-full text-center h-8"
                                                            value={item.receive_now}
                                                            onChange={e => setQuantity(item.id, e.target.value)}
                                                            aria-label={t('receive.now')}
                                                        />
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`badge whitespace-nowrap ${STATUS_STYLE[s.status]}`} data-testid={`receive-state-${item.id}`} data-state={s.status}>
                                                            {t(`receive.state.${s.status}`, { n: Math.abs(s.diff) })}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                ))}
                            </table>
                        </div>

                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">{t('receive.notes')}</label>
                            <Input
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder={t('receive.notesPlaceholder')}
                            />
                        </div>
                    </div>
                )}
            </ModalBody>
            <ModalFooter>
                {done ? (
                    <>
                        <Button variant="secondary" onClick={finish}>{t('common.close')}</Button>
                        <Button onClick={printArrived} disabled={!done.summary.pieces} data-testid="receive-labels">
                            <Tag className="w-4 h-4" /> {t('receive.printArrived', { n: done.summary.pieces })}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                        <Button onClick={handleSubmit} loading={loading} data-testid="receive-confirm"><Check className="w-4 h-4" /> {t('receive.confirm')}</Button>
                    </>
                )}
            </ModalFooter>
        </Modal>
    );
}

function SummaryBadges({ summary }) {
    return (
        <div className="flex flex-wrap justify-center gap-2 text-sm" data-testid="receive-summary">
            <span className={`badge ${STATUS_STYLE.full}`}><PackageCheck className="w-3.5 h-3.5" /> {t('receive.sum.full', { n: summary.full })}</span>
            {summary.short > 0 && <span className={`badge ${STATUS_STYLE.short}`}><PackageMinus className="w-3.5 h-3.5" /> {t('receive.sum.short', { n: summary.short, pieces: summary.missing })}</span>}
            {summary.over > 0 && <span className={`badge ${STATUS_STYLE.over}`}><PackagePlus className="w-3.5 h-3.5" /> {t('receive.sum.over', { n: summary.over, pieces: summary.extra })}</span>}
        </div>
    );
}
