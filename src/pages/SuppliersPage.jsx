import { t } from '../i18n';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import {
    Search,
    Plus,
    Truck,
    Phone,
    Mail,
    Globe,
    MoreVertical,
    Edit,
    Trash
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Input, SearchInput } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { toast } from '../components/ui/Toast';
import SupplierHistoryModal from '../components/modals/SupplierHistoryModal';
import { History } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';

export default function SuppliersPage() {
    const [suppliers, setSuppliers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [historySupplier, setHistorySupplier] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        contact_person: '',
        email: '',
        phone: '',
        address: '',
        website: '',
        notes: ''
    });
    const { settings, loadSettings } = useSettingsStore();

    useEffect(() => {
        fetchSuppliers();
        loadSettings();
    }, []);

    const fetchSuppliers = async () => {
        setIsLoading(true);
        try {
            const data = await window.electronAPI.suppliers.getAll();
            setSuppliers(data);
        } catch (error) {
            console.error('Failed to fetch suppliers:', error);
            toast.error(t('suppliers.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return formatMoney(amount || 0);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingSupplier) {
                await window.electronAPI.suppliers.update({ ...formData, id: editingSupplier.id });
                toast.success(t('suppliers.updated'));
            } else {
                await window.electronAPI.suppliers.create(formData);
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
        } catch (error) {
            toast.error(t('suppliers.deleteFailed'));
        }
    };

    const handleEdit = (supplier) => {
        setEditingSupplier(supplier);
        setFormData(supplier);
        setShowModal(true);
    };

    const handleHistory = (supplier) => {
        setHistorySupplier(supplier);
        setShowHistoryModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingSupplier(null);
        setFormData({
            name: '',
            contact_person: '',
            email: '',
            phone: '',
            address: '',
            website: '',
            notes: ''
        });
    };

    const filteredSuppliers = suppliers.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.contact_person?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="page">
            <PageHeader
                icon={Truck}
                title={t('suppliers.title')}
                subtitle={t('suppliers.subtitle')}
                actions={(
                    <Button onClick={() => setShowModal(true)}>
                        <Plus className="w-4 h-4" />
                        {t('suppliers.add')}
                    </Button>
                )}
            >
                <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder={t('suppliers.search')} className="max-w-md" />
            </PageHeader>

            <div className="page-body">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredSuppliers.map(supplier => (
                        <Card key={supplier.id} className="p-4 hover:border-accent-primary transition-colors group">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                        <Truck className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">{supplier.name}</h3>
                                        <p className="text-sm text-zinc-400">{supplier.contact_person}</p>
                                    </div>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="icon" onClick={() => handleHistory(supplier)} title={t('suppliers.history')}>
                                        <History className="w-4 h-4 text-blue-400 hover:text-blue-300" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => handleEdit(supplier)} title={t('common.edit')}>
                                        <Edit className="w-4 h-4 text-zinc-400 hover:text-white" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => handleDelete(supplier.id)} title={t('common.delete')}>
                                        <Trash className="w-4 h-4 text-red-400 hover:text-red-300" />
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2 text-sm text-zinc-400">
                                {supplier.balance !== undefined && (
                                    <div className="flex items-center justify-between py-1 border-b border-dark-border mb-2">
                                        <span>{t('suppliers.balance')}</span>
                                        <span className={`font-semibold ${supplier.balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                            {formatCurrency(supplier.balance)}
                                        </span>
                                    </div>
                                )}

                                {supplier.email && (
                                    <div className="flex items-center gap-2">
                                        <Mail className="w-4 h-4" />
                                        <span>{supplier.email}</span>
                                    </div>
                                )}
                                {supplier.phone && (
                                    <div className="flex items-center gap-2">
                                        <Phone className="w-4 h-4" />
                                        <span>{supplier.phone}</span>
                                    </div>
                                )}
                                {supplier.website && (
                                    <div className="flex items-center gap-2">
                                        <Globe className="w-4 h-4" />
                                        <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="hover:text-accent-primary truncate">
                                            {supplier.website}
                                        </a>
                                    </div>
                                )}
                            </div>
                        </Card>
                    ))}
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
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('suppliers.contact')}</label>
                                <Input value={formData.contact_person} onChange={e => setFormData({ ...formData, contact_person: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('shop.email')}</label>
                                    <Input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">{t('customers.phone')}</label>
                                    <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('shop.address')}</label>
                                <Input value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('suppliers.website')}</label>
                                <Input value={formData.website} onChange={e => setFormData({ ...formData, website: e.target.value })} />
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
