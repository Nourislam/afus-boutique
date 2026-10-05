import { t } from '../i18n';
import { translateError } from '../i18n/errors';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Users, Phone, Mail, MapPin, Wallet, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Input, SearchInput, TextArea } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeader, EmptyState } from '../components/ui/Table';
import { toast } from '../components/ui/Toast';
import { v4 as uuid } from 'uuid';
import { ExcelImport } from '../components/ui/ExcelImport';
import { FileSpreadsheet } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore, PERMISSIONS } from '../stores/authStore';
import { paymentLabel } from '../lib/payments';

// Phone numbers are compared by their digits only ("0555 12 34 56" = "0555123456")
const digits = (v) => String(v || '').replace(/\D/g, '');

/** "2 days ago"-style date, short and readable, or a dash. */
function when(value) {
    return value ? formatLocalDate(value, 'date') : '—';
}

function OwedBadge({ amount }) {
    if (!(amount > 0.004)) return <span className="text-sm text-zinc-500">{t('partners.nothingOwed')}</span>;
    return <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-red-500/15 text-red-300 font-semibold tabular whitespace-nowrap"><bdi>{formatMoney(amount)}</bdi></span>;
}

export default function CustomersPage() {
    const navigate = useNavigate();
    const [customers, setCustomers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [onlyOwing, setOnlyOwing] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [history, setHistory] = useState(null);
    const [loading, setLoading] = useState(true);
    const creditOn = useSettingsStore(state => state.settings.features?.credit !== false);
    const canSeeCredit = useAuthStore(state => state.hasPermission(PERMISSIONS.CUSTOMERS_VIEW));
    const showCredit = creditOn && canSeeCredit;

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            setCustomers(await window.electronAPI.customers.overview());
        } catch {
            toast.error(t('customers.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const query = searchQuery.trim().toLowerCase();
    const queryDigits = digits(searchQuery);
    const filteredCustomers = customers.filter(c => {
        if (showCredit && onlyOwing && !(c.owed > 0.004)) return false;
        if (!query) return true;
        return c.name.toLowerCase().includes(query)
            || (queryDigits.length >= 2 && digits(c.phone).includes(queryDigits))
            || c.email?.toLowerCase().includes(query);
    });

    const owing = customers.filter(c => c.owed > 0.004);
    const totalOwed = owing.reduce((sum, c) => sum + c.owed, 0);

    const handleDelete = async (customer) => {
        if (confirm(t('common.deleteConfirm', { name: customer.name }))) {
            try {
                await window.electronAPI.customers.delete(customer.id);
                toast.success(t('customers.deleted'));
                loadData();
            } catch {
                toast.error(t('customers.deleteFailed'));
            }
        }
    };

    const handleExcelImport = async (records) => {
        let successCount = 0;
        for (const record of records) {
            try {
                await window.electronAPI.customers.create({
                    id: uuid(),
                    name: record.name,
                    email: record.email || null,
                    phone: record.phone || null,
                    address: record.address || null,
                    notes: record.notes || null,
                    loyalty_points: parseInt(record.loyalty_points) || 0,
                    total_spent: parseFloat(record.total_spent) || 0,
                });
                successCount++;
            } catch (error) {
                console.error('Failed to import customer:', record.name, error);
            }
        }
        toast.success(`Imported ${successCount} customers`);
        loadData();
    };

    const openDetails = async (customer) => {
        setSelectedCustomer(customer);
        setHistory(null);
        try {
            setHistory(await window.electronAPI.customers.history(customer.id));
        } catch {
            setHistory({ owed: 0, paid: 0, credits: [], payments: [], sales: [] });
        }
    };

    return (
        <div className="page">
            <PageHeader
                icon={Users}
                title={t('customers.title')}
                subtitle={t('partners.customersSubtitle')}
                actions={(
                    <>
                        <Button variant="secondary" onClick={() => setShowImportModal(true)}>
                            <FileSpreadsheet className="w-4 h-4" />
                            {t('common.importExcel')}
                        </Button>
                        <Button onClick={() => { setEditingCustomer(null); setShowModal(true); }}>
                            <Plus className="w-4 h-4" />
                            {t('customers.add')}
                        </Button>
                    </>
                )}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder={t('partners.customerSearch')} className="w-full sm:w-96" />
                    {showCredit && (
                        <div className="segmented">
                            <button type="button" className={!onlyOwing ? 'active' : ''} onClick={() => setOnlyOwing(false)}>
                                {t('partners.all')} <span className="ms-1 text-zinc-500 tabular">{customers.length}</span>
                            </button>
                            <button type="button" className={onlyOwing ? 'active' : ''} onClick={() => setOnlyOwing(true)}>
                                {t('partners.owing')} <span className="ms-1 text-red-300 tabular">{owing.length}</span>
                            </button>
                        </div>
                    )}
                </div>
            </PageHeader>

            <div className="page-body space-y-4">
                {/* What matters first: how much customers still owe */}
                {showCredit && customers.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="card flex items-center gap-3">
                            <Wallet className="w-8 h-8 text-red-300 flex-none" />
                            <div className="min-w-0">
                                <p className="text-xs text-zinc-500">{t('partners.totalOwedByCustomers')}</p>
                                <p className="text-xl font-bold text-red-300 tabular"><bdi>{formatMoney(totalOwed)}</bdi></p>
                            </div>
                        </div>
                        <div className="card flex items-center gap-3">
                            <AlertCircle className="w-8 h-8 text-amber-300 flex-none" />
                            <div className="min-w-0">
                                <p className="text-xs text-zinc-500">{t('partners.customersOwing')}</p>
                                <p className="text-xl font-bold tabular">{owing.length}</p>
                            </div>
                        </div>
                        <div className="card flex items-center gap-3">
                            <Users className="w-8 h-8 text-indigo-300 flex-none" />
                            <div className="min-w-0">
                                <p className="text-xs text-zinc-500">{t('customers.total')}</p>
                                <p className="text-xl font-bold tabular">{customers.length}</p>
                            </div>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filteredCustomers.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title={onlyOwing && !query ? t('partners.nobodyOwes') : t('customers.none')}
                        description={searchQuery ? t('customers.tryOther') : (onlyOwing ? '' : t('customers.addFirst'))}
                        action={!onlyOwing && (
                            <Button onClick={() => { setEditingCustomer(null); setShowModal(true); }}>
                                <Plus className="w-4 h-4" />
                                {t('customers.add')}
                            </Button>
                        )}
                    />
                ) : (
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableHeader>{t('tx.customer')}</TableHeader>
                                <TableHeader>{t('customers.phone')}</TableHeader>
                                {showCredit && <TableHeader>{t('partners.stillOwes')}</TableHeader>}
                                <TableHeader>{t('partners.lastActivity')}</TableHeader>
                                <TableHeader>{t('partners.purchases')}</TableHeader>
                                <TableHeader>{t('inventory.actions')}</TableHeader>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredCustomers.map(customer => (
                                <TableRow key={customer.id} onClick={() => openDetails(customer)} className="cursor-pointer">
                                    <TableCell>
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-accent-primary/20 flex items-center justify-center flex-none">
                                                <span className="font-semibold text-accent-primary">{customer.name.charAt(0)}</span>
                                            </div>
                                            <span className="font-medium truncate">{customer.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {customer.phone
                                            ? <span className="inline-flex items-center gap-1.5 font-medium tabular"><Phone className="w-3.5 h-3.5 text-zinc-500" /><bdi dir="ltr">{customer.phone}</bdi></span>
                                            : <span className="text-xs text-zinc-500">{t('partners.noPhone')}</span>}
                                    </TableCell>
                                    {showCredit && <TableCell><OwedBadge amount={customer.owed} /></TableCell>}
                                    <TableCell className="text-zinc-400 whitespace-nowrap">{when(customer.last_sale_at)}</TableCell>
                                    <TableCell className="tabular whitespace-nowrap">
                                        <bdi>{formatMoney(customer.sales_total)}</bdi>
                                        <span className="text-xs text-zinc-500 ms-1">({t('partners.salesN', { n: customer.sales_count })})</span>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                            <Button variant="ghost" size="icon" onClick={() => { setEditingCustomer(customer); setShowModal(true); }} aria-label={t('customers.edit')}>
                                                <Edit2 className="w-4 h-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleDelete(customer)} aria-label={t('common.delete')}>
                                                <Trash2 className="w-4 h-4 text-red-400" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <CustomerFormModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                customer={editingCustomer}
                onSave={() => { loadData(); setShowModal(false); }}
            />

            <ExcelImport
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                dataType="customers"
                onImport={handleExcelImport}
                title={t('customers.import')}
            />

            {/* One customer: contact, what he still owes, the payments, the last purchases */}
            <Modal isOpen={!!selectedCustomer} onClose={() => setSelectedCustomer(null)} title={selectedCustomer?.name || ''} size="lg">
                <ModalBody>
                    {selectedCustomer && (
                        <div className="space-y-5">
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-zinc-300">
                                {selectedCustomer.phone
                                    ? <span className="inline-flex items-center gap-1.5 text-base font-semibold"><Phone className="w-4 h-4 text-zinc-500" /><bdi dir="ltr">{selectedCustomer.phone}</bdi></span>
                                    : <span className="text-zinc-500">{t('partners.noPhone')}</span>}
                                {selectedCustomer.email && <span className="inline-flex items-center gap-1.5"><Mail className="w-4 h-4 text-zinc-500" /><bdi dir="ltr">{selectedCustomer.email}</bdi></span>}
                                {selectedCustomer.address && <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4 text-zinc-500" />{selectedCustomer.address}</span>}
                            </div>

                            <div className={`grid gap-3 ${showCredit ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
                                {showCredit && (
                                    <div className={`p-4 rounded-xl border ${selectedCustomer.owed > 0.004 ? 'border-red-500/40 bg-red-500/10' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
                                        <p className="text-xs text-zinc-400">{t('partners.stillOwes')}</p>
                                        <p className={`text-2xl font-bold tabular ${selectedCustomer.owed > 0.004 ? 'text-red-300' : 'text-emerald-300'}`}>
                                            <bdi>{selectedCustomer.owed > 0.004 ? formatMoney(selectedCustomer.owed) : t('partners.nothingOwed')}</bdi>
                                        </p>
                                        <p className="text-xs text-zinc-500 mt-1">
                                            {selectedCustomer.credit_enabled
                                                ? (selectedCustomer.credit_limit > 0
                                                    ? t('partners.creditLimitLeft', { limit: formatMoney(selectedCustomer.credit_limit), left: formatMoney(Math.max(0, selectedCustomer.credit_limit - selectedCustomer.owed)) })
                                                    : t('partners.creditAllowedNoLimit'))
                                                : t('customers.creditNotAllowed')}
                                        </p>
                                    </div>
                                )}
                                <div className="p-4 rounded-xl bg-dark-tertiary">
                                    <p className="text-xs text-zinc-400">{t('partners.purchases')}</p>
                                    <p className="text-2xl font-bold tabular"><bdi>{formatMoney(selectedCustomer.sales_total)}</bdi></p>
                                    <p className="text-xs text-zinc-500 mt-1">{t('partners.salesN', { n: selectedCustomer.sales_count })}</p>
                                </div>
                                <div className="p-4 rounded-xl bg-dark-tertiary">
                                    <p className="text-xs text-zinc-400">{t('partners.lastActivity')}</p>
                                    <p className="text-lg font-bold">{when(selectedCustomer.last_sale_at)}</p>
                                    {showCredit && <p className="text-xs text-zinc-500 mt-1">{t('partners.lastPayment', { date: when(selectedCustomer.last_payment_at) })}</p>}
                                </div>
                            </div>

                            {!history ? (
                                <p className="text-sm text-zinc-500">{t('common.loading')}</p>
                            ) : (
                                <>
                                    {showCredit && (
                                        <section>
                                            <h4 className="text-sm font-semibold mb-2">{t('partners.unpaidCredit')}</h4>
                                            {history.credits.filter(c => c.remaining > 0.004).length === 0 ? (
                                                <p className="text-sm text-zinc-500 rounded-lg border border-dashed border-dark-border px-3 py-2">{t('partners.noUnpaidCredit')}</p>
                                            ) : (
                                                <ul className="rounded-lg border border-dark-border divide-y divide-dark-border">
                                                    {history.credits.filter(c => c.remaining > 0.004).map(c => {
                                                        const late = c.due_date && new Date(c.due_date).getTime() < Date.now();
                                                        return (
                                                            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                                                                <span className="flex-1 min-w-[10rem]">
                                                                    <span className="font-medium">{t('partners.boughtOn', { date: when(c.created_at) })}</span>
                                                                    <span className="text-xs text-zinc-500 ms-2"><bdi dir="ltr">{c.receipt_number || c.invoice_number}</bdi></span>
                                                                </span>
                                                                <span className="text-zinc-400 tabular"><bdi>{t('partners.paidOf', { paid: formatMoney(c.amount_paid), total: formatMoney(c.amount_due) })}</bdi></span>
                                                                <span className="font-semibold text-red-300 tabular"><bdi>{t('partners.leftN', { amount: formatMoney(c.remaining) })}</bdi></span>
                                                                {late && <span className="badge bg-amber-500/15 text-amber-300">{t('partners.late')}</span>}
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            )}
                                        </section>
                                    )}

                                    {showCredit && (
                                        <section>
                                            <h4 className="text-sm font-semibold mb-2">{t('partners.paymentsHistory')}</h4>
                                            {history.payments.length === 0 ? (
                                                <p className="text-sm text-zinc-500 rounded-lg border border-dashed border-dark-border px-3 py-2">{t('partners.noPayments')}</p>
                                            ) : (
                                                <ul className="rounded-lg border border-dark-border divide-y divide-dark-border max-h-52 overflow-y-auto">
                                                    {history.payments.map(p => (
                                                        <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                                                            <span className="flex-1 min-w-[8rem] whitespace-nowrap"><bdi dir="ltr">{formatLocalDate(p.created_at, 'datetime')}</bdi></span>
                                                            <span className="text-zinc-400">{paymentLabel(p.payment_method)}</span>
                                                            {p.received_by_name && <span className="text-xs text-zinc-500">{p.received_by_name}</span>}
                                                            <span className="font-semibold text-emerald-300 tabular"><bdi>+{formatMoney(p.amount)}</bdi></span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </section>
                                    )}

                                    <section>
                                        <h4 className="text-sm font-semibold mb-2">{t('partners.lastPurchases')}</h4>
                                        {history.sales.length === 0 ? (
                                            <p className="text-sm text-zinc-500 rounded-lg border border-dashed border-dark-border px-3 py-2">{t('partners.noPurchases')}</p>
                                        ) : (
                                            <ul className="rounded-lg border border-dark-border divide-y divide-dark-border max-h-52 overflow-y-auto">
                                                {history.sales.map(sale => (
                                                    <li key={sale.id} className="flex items-center gap-4 px-3 py-2 text-sm">
                                                        <span className="flex-1 whitespace-nowrap"><bdi dir="ltr">{formatLocalDate(sale.created_at, 'datetime')}</bdi></span>
                                                        <span className="text-xs text-zinc-500"><bdi dir="ltr">{sale.receipt_number}</bdi></span>
                                                        <span className="font-semibold tabular"><bdi>{formatMoney(sale.total)}</bdi></span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </section>

                                    {selectedCustomer.notes && (
                                        <section>
                                            <h4 className="text-sm font-semibold mb-2">{t('customers.notes')}</h4>
                                            <p className="p-3 rounded-lg bg-dark-tertiary text-sm">{selectedCustomer.notes}</p>
                                        </section>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </ModalBody>
                <ModalFooter>
                    {showCredit && selectedCustomer?.owed > 0.004 && (
                        <Button variant="secondary" onClick={() => navigate('/credit-sales')} className="me-auto">
                            <Wallet className="w-4 h-4" /> {t('partners.receivePayment')}
                        </Button>
                    )}
                    <Button variant="secondary" onClick={() => setSelectedCustomer(null)}>{t('common.close')}</Button>
                    <Button onClick={() => { setEditingCustomer(selectedCustomer); setSelectedCustomer(null); setShowModal(true); }}>
                        <Edit2 className="w-4 h-4" />
                        {t('customers.edit')}
                    </Button>
                </ModalFooter>
            </Modal>
        </div>
    );
}

function CustomerFormModal({ isOpen, onClose, customer, onSave }) {
    const canManageCredit = useAuthStore(state => state.hasPermission(PERMISSIONS.CUSTOMERS_CREDIT));
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        address: '',
        notes: '',
        credit_enabled: false,
        credit_limit: 0,
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (customer) {
            setFormData({
                name: customer.name,
                email: customer.email || '',
                phone: customer.phone || '',
                address: customer.address || '',
                notes: customer.notes || '',
                credit_enabled: !!customer.credit_enabled,
                credit_limit: customer.credit_limit || 0,
            });
        } else {
            setFormData({
                name: '',
                email: '',
                phone: '',
                address: '',
                notes: '',
                credit_enabled: false,
                credit_limit: 0,
            });
        }
    }, [customer, isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.name) {
            toast.error(t('customers.nameRequired'));
            return;
        }

        setLoading(true);
        try {
            const data = {
                ...formData,
                id: customer?.id || uuid(),
                loyalty_points: customer?.loyalty_points || 0,
                total_spent: customer?.total_spent || 0,
                credit_enabled: formData.credit_enabled ? 1 : 0,
                credit_limit: parseFloat(formData.credit_limit) || 0,
                credit_balance: customer?.credit_balance || 0,
            };

            if (customer) {
                await window.electronAPI.customers.update(data);
                toast.success(t('customers.updated'));
            } else {
                await window.electronAPI.customers.create(data);
                toast.success(t('customers.created'));
            }
            onSave();
        } catch (error) {
            toast.error(translateError(error));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={customer ? t('customers.edit') : t('customers.add')} size="md">
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                <ModalBody>
                    <div className="space-y-4">
                        <Input
                            label={t('setup.adminName')}
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder={t('customers.namePlaceholder')}
                        />
                        <Input
                            label={t('customers.phone')}
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            placeholder={t('customers.phonePlaceholder')}
                            className="ltr"
                            inputMode="tel"
                        />
                        <Input
                            label={t('shop.email')}
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            placeholder="email@example.com"
                        />
                        <TextArea
                            label={t('shop.address')}
                            value={formData.address}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            placeholder={t('customers.addressPlaceholder')}
                        />
                        <TextArea
                            label={t('customers.notes')}
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            placeholder={t('customers.notesPlaceholder')}
                        />

                        {/* Credit Settings Section */}
                        <div className="pt-4 border-t border-dark-border">
                            <h4 className="text-sm font-medium text-zinc-400 mb-3">{t('customers.creditSettings')}</h4>
                            <div className="space-y-3">
                                {canManageCredit ? (
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.credit_enabled}
                                            onChange={(e) => setFormData({ ...formData, credit_enabled: e.target.checked })}
                                            className="w-5 h-5 rounded border-dark-border bg-dark-tertiary accent-accent-primary"
                                        />
                                        <span>{t('customers.enableCredit')}</span>
                                    </label>
                                ) : (
                                    // Workers see the decision but cannot change it
                                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-dark-tertiary text-sm">
                                        <span>{formData.credit_enabled ? t('customers.creditAllowed') : t('customers.creditNotAllowed')}</span>
                                        <span className="text-xs text-zinc-500">{t('customers.creditManagerOnly')}</span>
                                    </div>
                                )}

                                {formData.credit_enabled && canManageCredit && (
                                    <Input
                                        label={t('customers.creditLimitDa')}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={formData.credit_limit}
                                        onChange={(e) => setFormData({ ...formData, credit_limit: e.target.value })}
                                        placeholder="0.00"
                                    />
                                )}

                                {customer && customer.credit_balance > 0 && (
                                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                        <p className="text-sm text-amber-400">
                                            {t('customers.currentCredit')} <span className="font-bold">{formatMoney(customer.credit_balance || 0)}</span>
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                    <Button type="submit" loading={loading}>
                        {customer ? t('customers.update') : t('customers.add')}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}

