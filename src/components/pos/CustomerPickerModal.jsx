import { useEffect, useMemo, useState } from 'react';
import { translateError } from '../../i18n/errors';
import { Search, UserPlus, Star, CreditCard } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { Modal, ModalBody } from '../ui/Modal';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { formatMoney } from '../../i18n/format';
import { t } from '../../i18n';

/**
 * Attach a customer to the ticket: search by name or phone, or add a new
 * customer with just a name and a phone number (05/06/07…).
 */
export default function CustomerPickerModal({ isOpen, onClose, onSelect }) {
    const [customers, setCustomers] = useState([]);
    const [query, setQuery] = useState('');
    const [newCustomer, setNewCustomer] = useState(null); // { name, phone }

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setNewCustomer(null);
        window.electronAPI.customers.getAll().then(setCustomers).catch(() => setCustomers([]));
    }, [isOpen]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        const digits = q.replace(/\D/g, '');
        return customers.filter(c => !q
            || c.name?.toLowerCase().includes(q)
            || (digits && String(c.phone || '').replace(/\D/g, '').includes(digits))).slice(0, 30);
    }, [customers, query]);

    const create = async () => {
        if (!newCustomer?.name?.trim()) {
            toast.error(t('customers.nameRequired'));
            return;
        }
        const customer = { id: uuid(), name: newCustomer.name.trim(), phone: newCustomer.phone?.trim() || '', email: '', address: '', notes: '', loyalty_points: 0 };
        try {
            await window.electronAPI.customers.create(customer);
            toast.success(t('customers.created'));
            onSelect(customer);
        } catch (error) {
            toast.error(translateError(error) || t('common.saveFailed'));
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('pos.chooseCustomer')} size="md">
            <ModalBody>
                {newCustomer ? (
                    <div className="space-y-3">
                        <input autoFocus className="input" placeholder={t('customers.namePlaceholder')} value={newCustomer.name}
                            onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
                        <input className="input ltr" inputMode="tel" placeholder="05 / 06 / 07 …" value={newCustomer.phone}
                            onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setNewCustomer(null)}>{t('common.back')}</Button>
                            <Button onClick={create}><UserPlus className="w-4 h-4" /> {t('customers.add')}</Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input autoFocus className="input ps-9" placeholder={t('pos.customerSearch')} value={query}
                                    onChange={(e) => setQuery(e.target.value)} data-scan-passthrough />
                            </div>
                            <Button variant="secondary" onClick={() => setNewCustomer({ name: /\d/.test(query) ? '' : query, phone: /\d/.test(query) ? query : '' })}>
                                <UserPlus className="w-4 h-4" /> {t('pos.newCustomer')}
                            </Button>
                        </div>
                        <div className="max-h-80 overflow-y-auto space-y-1.5">
                            {results.length === 0 && <p className="text-center text-sm text-zinc-500 py-6">{t('customers.none')}</p>}
                            {results.map(c => (
                                <button key={c.id} type="button" onClick={() => onSelect(c)}
                                    className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-dark-tertiary/60 hover:bg-dark-tertiary text-start">
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">{c.name}</p>
                                        <p className="text-xs text-zinc-500 ltr text-start">{c.phone || '—'}</p>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs flex-none">
                                        {c.loyalty_points > 0 && <span className="badge badge-warning"><Star className="w-3 h-3" />{c.loyalty_points}</span>}
                                        {c.credit_balance > 0 && <span className="badge badge-danger"><CreditCard className="w-3 h-3" />{formatMoney(c.credit_balance)}</span>}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </ModalBody>
        </Modal>
    );
}
