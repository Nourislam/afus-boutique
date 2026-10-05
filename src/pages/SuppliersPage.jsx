import { t } from '../i18n';
import { formatMoney, formatDate as formatLocalDate } from '../i18n/format';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus,
    Truck,
    Phone,
    Mail,
    Globe,
    MapPin,
    User,
    Edit,
    Trash,
    History,
    Wallet,
    AlertCircle,
    PackageCheck,
    Clock,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Input, SearchInput } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { toast } from '../components/ui/Toast';
import SupplierHistoryModal from '../components/modals/SupplierHistoryModal';
import { useSettingsStore } from '../stores/settingsStore';
import { effectiveFeatures } from '../lib/features';

const EMPTY_FORM = { name: '', contact_person: '', email: '', phone: '', address: '', website: '', notes: '' };

// Phone numbers are compared by their digits only ("0555 12 34 56" = "0555123456")
const digits = (v) => String(v || '').replace(/\D/g, '');
const when = (value) => (value ? formatLocalDate(value, 'date') : '—');

export default function SuppliersPage() {
    const navigate = useNavigate();
    const [suppliers, setSuppliers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [onlyToPay, setOnlyToPay] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [historySupplier, setHistorySupplier] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const ordersOn = useSettingsStore(state => effectiveFeatures(state.settings.features).purchaseOrders);

    useEffect(() => {
        fetchSuppliers();
    }, []);

    const fetchSuppliers = async () => {
        setIsLoading(true);
        try {
            setSuppliers(await window.electronAPI.suppliers.overview());
        } catch (error) {
            console.error('Failed to fetch suppliers:', error);
            toast.error(t('suppliers.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        // Only the supplier's own fields are saved, not the figures shown on the card
        const data = Object.fromEntries(Object.keys(EMPTY_FORM).map(key => [key, formData[key] ?? '']));
        try {
            if (editingSupplier) {
                await window.electronAPI.suppliers.update({ ...data, id: editingSupplier.id });
                toast.success(t('suppliers.updated'));
            } else {
                await window.electronAPI.suppliers.create(data);
                toast.success(t('suppliers.created'));
            }
            fetchSuppliers();
            handleCloseModal();
        } catch (error) {
            console.error('Failed to save supplier:', error);
            toast.error(t('suppliers.saveFailed'));
        }
    };

    const handleDelete = async (id) => {
        if (!confirm(t('suppliers.deleteConfirm'))) return;
        try {
            await window.electronAPI.suppliers.delete(id);
            toast.success(t('suppliers.deleted'));
            fetchSuppliers();
        } catch {
            toast.error(t('suppliers.deleteFailed'));
        }
    };

    const handleEdit = (supplier) => {
        setEditingSupplier(supplier);
        setFormData(Object.fromEntries(Object.keys(EMPTY_FORM).map(key => [key, supplier[key] ?? ''])));
        setShowModal(true);
    };

    const handleHistory = (supplier) => {
        setHistorySupplier(supplier);
        setShowHistoryModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingSupplier(null);
        setFormData(EMPTY_FORM);
    };

    const query = searchQuery.trim().toLowerCase();
    const queryDigits = digits(searchQuery);
    const filteredSuppliers = suppliers.filter(s => {
        if (onlyToPay && !(s.owed > 0.004)) return false;
        if (!query) return true;
        return s.name.toLowerCase().includes(query)
            || s.contact_person?.toLowerCase().includes(query)
            || (queryDigits.length >= 2 && digits(s.phone).includes(queryDigits));
    });

    const toPay = suppliers.filter(s => s.owed > 0.004);
    const totalOwed = toPay.reduce((sum, s) => sum + s.owed, 0);

    return (
        <div className="page">
            <PageHeader
                icon={Truck}
                title={t('suppliers.title')}
                subtitle={t('partners.suppliersSubtitle')}
                actions={(
                    <Button onClick={() => setShowModal(true)}>
                        <Plus className="w-4 h-4" />
                        {t('suppliers.add')}
                    </Button>
                )}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder={t('partners.supplierSearch')} className="w-full sm:w-96" />
                    <div className="segmented">
                        <button type="button" className={!onlyToPay ? 'active' : ''} onClick={() => setOnlyToPay(false)}>
                            {t('partners.all')} <span className="ms-1 text-zinc-500 tabular">{suppliers.length}</span>
                        </button>
                        <button type="button" className={onlyToPay ? 'active' : ''} onClick={() => setOnlyToPay(true)}>
                            {t('partners.toPay')} <span className="ms-1 text-red-300 tabular">{toPay.length}</span>
                        </button>
                    </div>
                </div>
            </PageHeader>

            <div className="page-body space-y-4">
                {/* What matters first: how much the shop still owes */}
                {suppliers.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="card flex items-center gap-3">
                            <Wallet className="w-8 h-8 text-red-300 flex-none" />
                            <div className="min-w-0">
                                <p className="text-xs text-zinc-500">{t('partners.totalOwedToSuppliers')}</p>
                                <p className="text-xl font-bold text-red-300 tabular"><bdi>{formatMoney(totalOwed)}</bdi></p>
                            </div>
                        </div>
                        <div className="card flex items-center gap-3">
                            <AlertCircle className="w-8 h-8 text-amber-300 flex-none" />
                            <div className="min-w-0">
                                <p className="text-xs text-zinc-500">{t('partners.suppliersToPay')}</p>
                                <p className="text-xl font-bold tabular">{toPay.length}</p>
                            </div>
                        </div>
                        <div className="card flex items-center gap-3">
                            <Truck className="w-8 h-8 text-indigo-300 flex-none" />
                            <div className="min-w-0">
                                <p className="text-xs text-zinc-500">{t('partners.suppliersCount')}</p>
                                <p className="text-xl font-bold tabular">{suppliers.length}</p>
                            </div>
                        </div>
                    </div>
                )}

                {isLoading && suppliers.length === 0 && (
                    <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
                )}
                {!isLoading && filteredSuppliers.length === 0 && (
                    <p className="text-center text-zinc-500 py-16">{onlyToPay && !query ? t('partners.nothingToPay') : t('common.noResults')}</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredSuppliers.map(supplier => {
                        const owes = supplier.owed > 0.004;
                        return (
                            <Card key={supplier.id} className="p-4 flex flex-col gap-3">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 flex-none">
                                            <Truck className="w-5 h-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-semibold break-words">{supplier.name}</h3>
                                            {supplier.contact_person && (
                                                <p className="text-sm text-zinc-400 flex items-center gap-1 min-w-0"><User className="w-3.5 h-3.5 flex-none" /> <span className="truncate">{supplier.contact_person}</span></p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-1 flex-none">
                                        <Button variant="ghost" size="icon" onClick={() => handleHistory(supplier)} title={t('suppliers.history')} aria-label={t('suppliers.history')}>
                                            <History className="w-4 h-4 text-blue-400" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleEdit(supplier)} title={t('common.edit')} aria-label={t('common.edit')}>
                                            <Edit className="w-4 h-4 text-zinc-400" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(supplier.id)} title={t('common.delete')} aria-label={t('common.delete')}>
                                            <Trash className="w-4 h-4 text-red-400" />
                                        </Button>
                                    </div>
                                </div>

                                {/* What the shop still owes this supplier */}
                                <div className={`rounded-lg p-3 ${owes ? 'bg-red-500/10 border border-red-500/30' : 'bg-dark-tertiary border border-dark-border'}`}>
                                    <p className="text-xs text-zinc-400">{t('partners.youStillOwe')}</p>
                                    <p className={`text-2xl font-bold tabular ${owes ? 'text-red-300' : 'text-emerald-300'}`}>
                                        {owes ? <bdi>{formatMoney(supplier.owed)}</bdi> : t('partners.nothingOwed')}
                                    </p>
                                    {supplier.received_total > 0 && (
                                        <p className="text-xs text-zinc-500 mt-1 tabular">
                                            <bdi>{t('partners.goodsReceivedPaid', { total: formatMoney(supplier.received_total), paid: formatMoney(supplier.received_paid) })}</bdi>
                                            {supplier.returned_total > 0 && <bdi> · {t('partners.returnedN', { amount: formatMoney(supplier.returned_total) })}</bdi>}
                                        </p>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-lg bg-dark-tertiary/60 p-2">
                                        <p className="text-zinc-500 flex items-center gap-1"><PackageCheck className="w-3.5 h-3.5" /> {t('partners.lastDelivery')}</p>
                                        <p className="font-medium text-sm mt-0.5">{when(supplier.last_received_at)}</p>
                                    </div>
                                    <div className="rounded-lg bg-dark-tertiary/60 p-2">
                                        <p className="text-zinc-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {t('partners.waitingOrders')}</p>
                                        <p className="font-medium text-sm mt-0.5 tabular">{supplier.waiting_orders}</p>
                                    </div>
                                </div>

                                <div className="space-y-1.5 text-sm text-zinc-400">
                                    <p className="flex items-center gap-2">
                                        <Phone className="w-4 h-4 flex-none" />
                                        {supplier.phone ? <span className="ltr tabular text-zinc-200 font-medium">{supplier.phone}</span> : <span className="text-zinc-600">{t('partners.noPhone')}</span>}
                                    </p>
                                    {supplier.email && (
                                        <p className="flex items-center gap-2 min-w-0"><Mail className="w-4 h-4 flex-none" /> <span className="truncate ltr">{supplier.email}</span></p>
                                    )}
                                    {supplier.address && (
                                        <p className="flex items-center gap-2 min-w-0"><MapPin className="w-4 h-4 flex-none" /> <span className="truncate">{supplier.address}</span></p>
                                    )}
                                    {supplier.website && (
                                        <p className="flex items-center gap-2 min-w-0">
                                            <Globe className="w-4 h-4 flex-none" />
                                            <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="hover:text-accent-primary truncate ltr">{supplier.website}</a>
                                        </p>
                                    )}
                                </div>

                                {owes && ordersOn && (
                                    <Button variant="secondary" size="sm" className="mt-auto" onClick={() => navigate('/purchase-orders')}>
                                        <Wallet className="w-4 h-4" />
                                        {t('partners.paySupplier')}
                                    </Button>
                                )}
                            </Card>
                        );
                    })}
                </div>
            </div>

            <Modal isOpen={showModal} onClose={handleCloseModal} title={editingSupplier ? t('suppliers.edit') : t('suppliers.add')}>
                <form onSubmit={handleSubmit}>
                    <ModalBody>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('suppliers.company')}</label>
                                <Input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('customers.phone')}</label>
                                    <Input className="ltr" inputMode="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('suppliers.contact')}</label>
                                    <Input value={formData.contact_person} onChange={e => setFormData({ ...formData, contact_person: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('shop.address')}</label>
                                <Input value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('shop.email')}</label>
                                    <Input type="email" className="ltr" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('suppliers.website')}</label>
                                    <Input className="ltr" value={formData.website} onChange={e => setFormData({ ...formData, website: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('customers.notes')}</label>
                                <textarea
                                    className="input w-full h-24 pt-2"
                                    value={formData.notes}
                                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                />
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button type="button" variant="secondary" onClick={handleCloseModal}>{t('common.cancel')}</Button>
                        <Button type="submit">{editingSupplier ? t('common.update') : t('common.create')}</Button>
                    </ModalFooter>
                </form>
            </Modal>

            <SupplierHistoryModal
                isOpen={showHistoryModal}
                onClose={() => setShowHistoryModal(false)}
                supplier={historySupplier}
            />
        </div>
    );
}
