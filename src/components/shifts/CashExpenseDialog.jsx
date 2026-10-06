import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { formatMoney, formatDate } from '../../i18n/format';
import { translateError } from '../../i18n/errors';

/**
 * Cash taken out of the open drawer for an expense. It lowers the cash
 * expected at closing; the sales are not changed. Who takes it is the
 * logged-in employee (checked by the main process).
 */
export default function CashExpenseDialog({ isOpen, onClose, shiftId }) {
    const { t } = useT();
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [list, setList] = useState([]);
    const [saving, setSaving] = useState(false);

    const load = () => window.electronAPI.shifts.getExpenses(shiftId).then(rows => setList(rows || [])).catch(() => setList([]));
    useEffect(() => {
        if (!isOpen || !shiftId) return;
        setAmount(''); setReason('');
        load();
    }, [isOpen, shiftId]);

    const save = async () => {
        setSaving(true);
        try {
            await window.electronAPI.shifts.addExpense({ shiftId, amount: parseFloat(amount), reason });
            toast.success(t('expense.saved'));
            setAmount(''); setReason('');
            load();
        } catch (e) {
            toast.error(translateError(e));
        } finally {
            setSaving(false);
        }
    };

    const total = list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('expense.title')} size="md">
            <ModalBody>
                <div className="space-y-4" data-testid="cash-expense">
                    <p className="text-sm text-zinc-400">{t('expense.hint')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
                        <Input label={t('expense.amount')} type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="ltr" />
                        <Input label={t('expense.reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('expense.reasonPlaceholder')}
                            onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
                    </div>
                    {list.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold mb-1">{t('expense.today', { total: formatMoney(total) })}</h3>
                            <ul className="divide-y divide-dark-border text-sm">
                                {list.map(x => (
                                    <li key={x.id} className="py-1.5 flex justify-between gap-3">
                                        <span className="min-w-0 truncate">{formatDate(x.created_at, 'time')} · {x.reason} · <span className="text-zinc-500">{x.employee_name}</span></span>
                                        <bdi className="tabular text-red-300">-{formatMoney(x.amount)}</bdi>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
                <Button onClick={save} loading={saving} disabled={!(parseFloat(amount) > 0) || !reason.trim()}><Wallet className="w-4 h-4" /> {t('expense.save')}</Button>
            </ModalFooter>
        </Modal>
    );
}
