import { t } from '../i18n';
import { translateError } from '../i18n/errors';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Users, Star, ShoppingBag, Phone, Mail } from 'lucide-react';
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

export default function CustomersPage() {
    const [customers, setCustomers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [loading, setLoading] = useState(true);
    const { loadSettings } = useSettingsStore();

    useEffect(() => {
        loadData();
        loadSettings();
    }, []);

    const loadData = async () => {
        try {
            const data = await window.electronAPI.customers.getAll();
            setCustomers(data);
        } catch {
            toast.error(t('customers.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const filteredCustomers = customers.filter(customer =>
        customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.phone?.includes(searchQuery) ||
        customer.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const totalCustomers = customers.length;
    const totalLoyaltyPoints = customers.reduce((sum, c) => sum + (c.loyalty_points || 0), 0);
    const totalSpent = customers.reduce((sum, c) => sum + (c.total_spent || 0), 0);

    const formatCurrency = (amount) => {
        return formatMoney(amount);
    };

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

    const handleViewDetails = async (customer) => {
        setSelectedCustomer(customer);
        // In a real app, you'd fetch customer's purchase history here
        setShowDetailsModal(true);
    };

    return (
        <div className="page">
            <PageHeader
                icon={Users}
                title={t('customers.title')}
                subtitle={t('customers.subtitle')}
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
                <div className="flex flex-wrap items-center gap-4">
                    <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder={t('customers.search')} className="w-80" />
                    <span className="text-sm text-zinc-400">{t('customers.total')}: <b className="text-white tabular">{totalCustomers}</b></span>
                    <span className="text-sm text-zinc-400">{t('customers.points')}: <b className="text-amber-300 tabular">{totalLoyaltyPoints.toLocaleString('fr-FR')}</b></span>
                    <span className="text-sm text-zinc-400">{t('customers.spent')}: <b className="text-emerald-300 tabular">{formatCurrency(totalSpent)}</b></span>
                </div>
            </PageHeader>

            {/* Content */}
            <div className="page-body">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filteredCustomers.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title={t('customers.none')}
                        description={searchQuery ? t('customers.tryOther') : t('customers.addFirst')}
                        action={
                            <Button onClick={() => { setEditingCustomer(null); setShowModal(true); }}>
                                <Plus className="w-4 h-4" />
                                {t('customers.add')}
                            </Button>
                        }
                    />
                ) : (
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableHeader>{t('tx.customer')}</TableHeader>
                                <TableHeader>{t('customers.contact')}</TableHeader>
                                <TableHeader>{t('customers.loyalty')}</TableHeader>
                                <TableHeader>{t('customers.spent')}</TableHeader>
                                <TableHeader>{t('customers.joined')}</TableHeader>
                                <TableHeader>{t('inventory.actions')}</TableHeader>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredCustomers.map(customer => (
                                <TableRow
                                    key={customer.id}
                                    onClick={() => handleViewDetails(customer)}
                                    className="cursor-pointer"
                                >
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
                                                <span className="font-semibold text-accent-primary">
                                                    {customer.name.charAt(0)}
                                                </span>
                                            </div>
                                            <span className="font-medium">{customer.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-1">
                                            {customer.phone && (
                                                <div className="flex items-center gap-2 text-sm text-zinc-400">
                                                    <Phone className="w-3 h-3" />
                                                    {customer.phone}
                                                </div>
                                            )}
                                            {customer.email && (
                                                <div className="flex items-center gap-2 text-sm text-zinc-400">
                                                    <Mail className="w-3 h-3" />
                                                    {customer.email}
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1 text-amber-400">
                                            <Star className="w-4 h-4" />
                                            {customer.loyalty_points || 0}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-medium text-green-400">
                                        {formatCurrency(customer.total_spent || 0)}
                                    </TableCell>
                                    <TableCell className="text-zinc-400">
                                        {formatLocalDate(customer.created_at, 'date')}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => { setEditingCustomer(customer); setShowModal(true); }}
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDelete(customer)}
                                            >
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

            {/* Customer Form Modal */}
            <CustomerFormModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                customer={editingCustomer}
                onSave={() => { loadData(); setShowModal(false); }}
            />

            {/* Excel Import Modal */}
            <ExcelImport
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                dataType="customers"
                onImport={handleExcelImport}
                title={t('customers.import')}
            />

            {/* Customer Details Modal */}
            <Modal
                isOpen={showDetailsModal}
                onClose={() => setShowDetailsModal(false)}
                title={t('customers.details')}
                size="lg"
            >
                <ModalBody>
                    {selectedCustomer && (
                        <div className="space-y-6">
                            {/* Customer Info */}
                            <div className="flex items-start gap-4">
                                <div className="w-16 h-16 rounded-full bg-accent-primary/20 flex items-center justify-center">
                                    <span className="text-2xl font-bold text-accent-primary">
                                        {selectedCustomer.name.charAt(0)}
                                    </span>
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-semibold">{selectedCustomer.name}</h3>
                                    <div className="flex items-center gap-4 mt-2 text-sm text-zinc-400">
                                        {selectedCustomer.phone && (
                                            <span className="flex items-center gap-1">
                                                <Phone className="w-4 h-4" />
                                                {selectedCustomer.phone}
                                            </span>
                                        )}
                                        {selectedCustomer.email && (
                                            <span className="flex items-center gap-1">
                                                <Mail className="w-4 h-4" />
                                                {selectedCustomer.email}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="p-4 rounded-lg bg-dark-tertiary text-center">
                                    <div className="flex items-center justify-center gap-1 text-amber-400 mb-1">
                                        <Star className="w-5 h-5" />
                                    </div>
                                    <p className="text-2xl font-bold">{selectedCustomer.loyalty_points || 0}</p>
                                    <p className="text-sm text-zinc-400">{t('customers.loyalty')}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-dark-tertiary text-center">
                                    <div className="flex items-center justify-center gap-1 text-green-400 mb-1">
                                        <ShoppingBag className="w-5 h-5" />
                                    </div>
                                    <p className="text-2xl font-bold">{formatCurrency(selectedCustomer.total_spent || 0)}</p>
                                    <p className="text-sm text-zinc-400">{t('customers.spent')}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-dark-tertiary text-center">
                                    <p className="text-2xl font-bold">
                                        {formatLocalDate(selectedCustomer.created_at, 'month')}
                                    </p>
                                    <p className="text-sm text-zinc-400">{t('customers.since')}</p>
                                </div>
                            </div>

                            {/* Notes */}
                            {selectedCustomer.notes && (
                                <div>
                                    <h4 className="text-sm font-medium text-zinc-400 mb-2">{t('customers.notes')}</h4>
                                    <p className="p-3 rounded-lg bg-dark-tertiary">{selectedCustomer.notes}</p>
                                </div>
                            )}

                            {/* Address */}
                            {selectedCustomer.address && (
                                <div>
                                    <h4 className="text-sm font-medium text-zinc-400 mb-2">{t('shop.address')}</h4>
                                    <p className="p-3 rounded-lg bg-dark-tertiary">{selectedCustomer.address}</p>
                                </div>
                            )}
                        </div>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setShowDetailsModal(false)}>
                        {t('common.close')}
                    </Button>
                    <Button onClick={() => {
                        setEditingCustomer(selectedCustomer);
                        setShowDetailsModal(false);
                        setShowModal(true);
                    }}>
                        <Edit2 className="w-4 h-4" />
                        {t('customers.edit')}
                    </Button>
                </ModalFooter>
            </Modal>
        </div >
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
                            label={t('shop.email')}
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            placeholder="email@example.com"
                        />
                        <Input
                            label={t('customers.phone')}
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            placeholder={t('customers.phonePlaceholder')}
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

