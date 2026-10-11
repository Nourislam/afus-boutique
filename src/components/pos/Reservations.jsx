import { useEffect, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { DatePicker } from '../ui/DatePicker';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { formatMoney, formatDate } from '../../i18n/format';
import { useCartStore } from '../../stores/cartStore';

const inDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
};

/**
 * Reserve the pieces of the ticket for its customer, with a deposit paid in
 * cash now. The pieces leave the stock that can be sold until they are
 * picked up or the reservation is cancelled.
 */
export function ReserveDialog({ isOpen, onClose, onDone }) {
    const { t } = useT();
    const cart = useCartStore();
    const [deposit, setDeposit] = useState('');
    const [until, setUntil] = useState(inDays(7));
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const total = cart.getSubtotal();

    useEffect(() => {
        if (isOpen) { setDeposit(''); setUntil(inDays(7)); setNotes(''); }
    }, [isOpen]);

    const save = async () => {
        setSaving(true);
        try {
            const saved = await window.electronAPI.reservations.create({
                customer_id: cart.customer?.id,
                items: cart.items.map(i => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity, unit_price: i.unit_price, product_name: i.product_name, variant_label: i.variant_label })),
                deposit: parseFloat(deposit) || 0,
                deposit_method: 'cash',
                expires_at: until || null,
                notes,
            });
            toast.success(t('res.created', { n: saved.number }));
            cart.clearCart();
            onDone?.(saved);
            onClose();
        } catch (error) {
            toast.error(translateError(error));
        } finally {
            setSaving(false);
        }
    };

    const left = Math.max(0, total - (parseFloat(deposit) || 0));
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('res.title')} size="md">
            <ModalBody className="space-y-4">
                <p className="text-sm text-zinc-400">{t('res.text')}</p>
                {!cart.customer ? (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{t('res.needCustomer')}</p>
                ) : (
                    <p className="text-sm"><span className="text-zinc-400">{t('tx.customer')}: </span><span className="font-medium">{cart.customer.name}</span></p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input label={t('res.deposit')} type="number" min="0" max={total} value={deposit} onChange={(e) => setDeposit(e.target.value)} className="tabular" data-testid="res-deposit" />
                    <div className="form-group">
                        <label className="form-label">{t('res.until')}</label>
                        <DatePicker value={until} onChange={setUntil} />
                    </div>
                </div>
                <Input label={t('res.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
                <p className="text-sm text-zinc-300">{t('res.total', { total: formatMoney(total), left: formatMoney(left) })}</p>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                <Button onClick={save} loading={saving} disabled={!cart.customer || !cart.items.length} data-testid="res-save">
                    <Bookmark className="w-4 h-4" /> {t('res.reserve')}
                </Button>
            </ModalFooter>
        </Modal>
    );
}

/** Open reservations: picked up at the till, or cancelled (pieces back in stock). */
export function ReservationsDialog({ isOpen, onClose, onPickUp }) {
    const { t } = useT();
    const [list, setList] = useState([]);
    const [toCancel, setToCancel] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = () => window.electronAPI.reservations.list({ status: 'open' }).then(setList).catch(() => setList([]));
    useEffect(() => { if (isOpen) load(); }, [isOpen]);

    const pickUp = async (reservation) => {
        const customer = reservation.customer_id ? await window.electronAPI.customers.getById(reservation.customer_id).catch(() => null) : null;
        useCartStore.getState().loadReservation(reservation, customer);
        toast.success(t('res.inCart', { n: reservation.number, amount: formatMoney(reservation.deposit) }));
        onPickUp?.(reservation);
        onClose();
    };
    const cancel = async (refund) => {
        setBusy(true);
        try {
            await window.electronAPI.reservations.cancel({ id: toCancel.id, refund: refund ? toCancel.deposit : 0 });
            toast.success(t('res.cancelled'));
            setToCancel(null);
            load();
        } catch (error) {
            toast.error(translateError(error));
        } finally {
            setBusy(false);
        }
    };
    const today = new Date().toISOString().slice(0, 10);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('res.list')} size="lg">
            <ModalBody>
                {list.length === 0 ? (
                    <p className="text-center text-zinc-500 py-8">{t('res.none')}</p>
                ) : (
                    <ul className="space-y-2" data-testid="res-list">
                        {list.map(r => (
                            <li key={r.id} className="p-4 rounded-xl bg-dark-tertiary flex flex-wrap items-start gap-3">
                                <div className="flex-1 min-w-[12rem]">
                                    <p className="font-medium"><bdi>{r.customer_name}</bdi> <span className="text-xs text-zinc-500 ltr">{r.number}</span></p>
                                    <p className="text-sm text-zinc-400 truncate">{r.items.map(i => [i.product_name, i.variant_label].filter(Boolean).join(' ')).join('، ')}</p>
                                    <p className="text-xs text-zinc-500 mt-1">
                                        {t('res.total', { total: formatMoney(r.total), left: formatMoney(r.total - r.deposit) })}
                                        {r.expires_at && <> · {t('res.until')} {formatDate(r.expires_at)}</>}
                                        {r.expires_at && String(r.expires_at).slice(0, 10) < today && <span className="ms-2 badge bg-red-500/15 text-red-300">{t('res.expired')}</span>}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={() => pickUp(r)} data-testid="res-pickup">{t('res.pickUp')}</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setToCancel(r)} className="text-red-300">{t('common.cancel')}</Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </ModalBody>
            {toCancel && (
                <Modal isOpen onClose={() => setToCancel(null)} title={t('res.cancel')} size="sm">
                    <ModalBody><p className="text-sm text-zinc-300">{t('res.cancelText', { amount: formatMoney(toCancel.deposit) })}</p></ModalBody>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => cancel(false)} disabled={busy}>{t('res.cancelKeep')}</Button>
                        {toCancel.deposit > 0 && <Button variant="danger" onClick={() => cancel(true)} loading={busy}>{t('res.cancelRefund')}</Button>}
                    </ModalFooter>
                </Modal>
            )}
        </Modal>
    );
}
