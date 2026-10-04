import { t } from '../i18n';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { Percent, Plus, Search, Edit2, Trash2, Calendar, Tag, Banknote, Users } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal, ModalBody } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';
import { v4 as uuid } from 'uuid';
import { useSettingsStore } from '../stores/settingsStore';

// Built on each render so the labels follow the interface language
const PROMO_TYPES = () => ['percentage', 'fixed', 'bogo', 'threshold'].map(value => ({
    value,
    label: t(`promo.type.${value}`),
    description: t(`promo.type.${value}Hint`),
}));

export default function PromotionsPage() {
    const [promotions, setPromotions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showFormModal, setShowFormModal] = useState(false);
    const [editingPromo, setEditingPromo] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const { settings, loadSettings } = useSettingsStore();

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        type: 'percentage',
        value: '',
        min_purchase: '',
        max_discount: '',
        max_uses: '',
        start_date: '',
        end_date: '',
        coupon_code: '',
        auto_apply: true,
        is_active: true,
    });

    useEffect(() => {
        loadPromotions();
        loadSettings();
    }, []);

    const loadPromotions = async () => {
        try {
            const data = await window.electronAPI.promotions.getAll();
            setPromotions(data);
        } catch (error) {
            console.error('Failed to load promotions:', error);
            toast.error(t('promo.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            description: '',
            type: 'percentage',
            value: '',
            min_purchase: '',
            max_discount: '',
            max_uses: '',
            start_date: '',
            end_date: '',
            coupon_code: '',
            auto_apply: true,
            is_active: true,
        });
        setEditingPromo(null);
    };

    const handleOpenCreate = () => {
        resetForm();
        setShowFormModal(true);
    };

    const handleOpenEdit = (promo) => {
        setEditingPromo(promo);
        setFormData({
            name: promo.name,
            description: promo.description || '',
            type: promo.type,
            value: promo.value?.toString() || '',
            min_purchase: promo.min_purchase?.toString() || '',
            max_discount: promo.max_discount?.toString() || '',
            max_uses: promo.max_uses?.toString() || '',
            start_date: promo.start_date ? promo.start_date.split('T')[0] : '',
            end_date: promo.end_date ? promo.end_date.split('T')[0] : '',
            coupon_code: promo.coupon_code || '',
            auto_apply: promo.auto_apply,
            is_active: promo.is_active,
        });
        setShowFormModal(true);
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast.error(t('promo.nameRequired'));
            return;
        }
        if (!formData.value || parseFloat(formData.value) <= 0) {
            toast.error(t('promo.validValue'));
            return;
        }

        try {
            const promo = {
                id: editingPromo?.id || uuid(),
                name: formData.name,
                description: formData.description || null,
                type: formData.type,
                value: parseFloat(formData.value),
                min_purchase: formData.min_purchase ? parseFloat(formData.min_purchase) : 0,
                max_discount: formData.max_discount ? parseFloat(formData.max_discount) : null,
                max_uses: formData.max_uses ? parseInt(formData.max_uses) : null,
                start_date: formData.start_date || null,
                end_date: formData.end_date || null,
                coupon_code: formData.coupon_code || null,
                auto_apply: formData.auto_apply,
                is_active: formData.is_active,
                current_uses: editingPromo?.current_uses || 0,
            };

            if (editingPromo) {
                await window.electronAPI.promotions.update(promo);
                toast.success(t('promo.updated'));
            } else {
                await window.electronAPI.promotions.create(promo);
                toast.success(t('promo.created'));
            }

            setShowFormModal(false);
            resetForm();
            loadPromotions();
        } catch (error) {
            toast.error(t('promo.saveFailed'));
            console.error(error);
        }
    };

    const handleDelete = async (id) => {
        setDeletingId(id);
        setShowDeleteConfirm(true);
    };

    const confirmDelete = async () => {
        try {
            await window.electronAPI.promotions.delete(deletingId);
            toast.success(t('promo.deleted'));
            loadPromotions();
        } catch (error) {
            toast.error(t('promo.deleteFailed'));
            console.error(error);
        }
        setDeletingId(null);
    };

    const handleToggleActive = async (promo) => {
        try {
            await window.electronAPI.promotions.update({
                ...promo,
                is_active: !promo.is_active,
            });
            toast.success(promo.is_active ? t('promo.deactivated') : t('promo.activated'));
            loadPromotions();
        } catch (error) {
            toast.error(t('promo.updateFailed'));
            console.error(error);
        }
    };

    const isPromoActive = (promo) => {
        if (!promo.is_active) return false;
        const now = new Date();
        if (promo.start_date && new Date(promo.start_date) > now) return false;
        if (promo.end_date && new Date(promo.end_date) < now) return false;
        if (promo.max_uses && promo.current_uses >= promo.max_uses) return false;
        return true;
    };

    const filteredPromos = promotions.filter(promo =>
        promo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (promo.coupon_code && promo.coupon_code.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const formatCurrency = (amount) => {
        return amount ? formatMoney(amount) : '-';
    };
    const formatDate = (date) => date ? formatLocalDate(date, 'date') : '-';

    const getPromoValueDisplay = (promo) => {
        switch (promo.type) {
            case 'percentage':
                return `${promo.value}% off`;
            case 'fixed':
                return `${settings.currencySymbol || '$'}${promo.value} off`;
            case 'bogo':
                return `Buy One Get One`;
            case 'threshold':
                return `${promo.value}% off (min ${settings.currencySymbol || '$'}${promo.min_purchase || 0})`;
            default:
                return promo.value;
        }
    };

    const getTypeColor = (type) => {
        switch (type) {
            case 'percentage': return 'bg-indigo-500/20 text-indigo-400';
            case 'fixed': return 'bg-green-500/20 text-green-400';
            case 'bogo': return 'bg-purple-500/20 text-purple-400';
            case 'threshold': return 'bg-amber-500/20 text-amber-400';
            default: return 'bg-zinc-500/20 text-zinc-400';
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col p-6 gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <Percent className="w-7 h-7 text-amber-500" />
                        {t('promo.title')}
                    </h1>
                    <p className="text-zinc-400 mt-1">{t('promo.subtitle')}</p>
                </div>
                <Button onClick={handleOpenCreate}>
                    <Plus className="w-4 h-4" />
                    {t('promo.create')}
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="card flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                        <Tag className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{promotions.length}</p>
                        <p className="text-zinc-400 text-sm">{t('promo.total')}</p>
                    </div>
                </div>
                <div className="card flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                        <Percent className="w-6 h-6 text-green-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{promotions.filter(p => isPromoActive(p)).length}</p>
                        <p className="text-zinc-400 text-sm">{t('promo.activeNow')}</p>
                    </div>
                </div>
                <div className="card flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                        <Users className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{promotions.reduce((sum, p) => sum + (p.current_uses || 0), 0)}</p>
                        <p className="text-zinc-400 text-sm">{t('promo.uses')}</p>
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="max-w-md">
                <Input
                    icon={Search}
                    placeholder={t('promo.search')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            {/* Promotions Grid */}
            <div className="flex-1 overflow-auto">
                {filteredPromos.length === 0 ? (
                    <div className="text-center py-12 text-zinc-400">
                        <Percent className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>{t('promo.none')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredPromos.map(promo => (
                            <div key={promo.id} className={`card p-5 ${!isPromoActive(promo) ? 'opacity-60' : ''}`}>
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 className="font-semibold mb-2">{promo.name}</h3>
                                        <div className="flex gap-2">
                                            <span className={`text-xs px-2 py-1 rounded-full ${getTypeColor(promo.type)}`}>
                                                {promo.type}
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded-full ${isPromoActive(promo) ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400'}`}>
                                                {isPromoActive(promo) ? t('status.active') : t('status.inactive')}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleOpenEdit(promo)}
                                            className="p-2 hover:bg-zinc-700 rounded-lg transition-colors"
                                        >
                                            <Edit2 className="w-4 h-4 text-zinc-400" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(promo.id)}
                                            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4 text-red-400" />
                                        </button>
                                    </div>
                                </div>

                                {/* Value Display */}
                                <div className="text-2xl font-bold text-amber-400 mb-3">
                                    {getPromoValueDisplay(promo)}
                                </div>

                                {promo.description && (
                                    <p className="text-sm text-zinc-400 mb-3">{promo.description}</p>
                                )}

                                {/* Details */}
                                <div className="space-y-2 text-sm text-zinc-400">
                                    {promo.coupon_code && (
                                        <div className="flex items-center gap-2">
                                            <Tag className="w-4 h-4" />
                                            <span className="font-mono bg-zinc-800 px-2 py-0.5 rounded">{promo.coupon_code}</span>
                                        </div>
                                    )}
                                    {(promo.start_date || promo.end_date) && (
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4" />
                                            <span>{formatDate(promo.start_date)} - {formatDate(promo.end_date)}</span>
                                        </div>
                                    )}
                                    {promo.min_purchase > 0 && (
                                        <div className="flex items-center gap-2">
                                            <Banknote className="w-4 h-4" />
                                            <span>Min. purchase: {formatCurrency(promo.min_purchase)}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Usage */}
                                <div className="mt-4 pt-3 border-t border-zinc-700 flex justify-between text-sm">
                                    <span className="text-zinc-500">Uses: {promo.current_uses || 0}{promo.max_uses ? ` / ${promo.max_uses}` : ''}</span>
                                    <button
                                        onClick={() => handleToggleActive(promo)}
                                        className={`text-xs px-2 py-1 rounded ${promo.is_active ? 'text-red-400 hover:bg-red-500/20' : 'text-green-400 hover:bg-green-500/20'}`}
                                    >
                                        {promo.is_active ? t('promo.deactivate') : t('promo.activate')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Form Modal */}
            {showFormModal && (
                <Modal
                    isOpen={true}
                    title={editingPromo ? t('promo.edit') : t('promo.create')}
                    onClose={() => { setShowFormModal(false); resetForm(); }}
                    size="lg"
                >
                    <ModalBody>
                        <div className="space-y-4 max-h-[70vh] overflow-auto">
                            <Input
                                label={t('promo.name')}
                                placeholder={t('promo.namePlaceholder')}
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />

                            <Input
                                label={t('bundles.description')}
                                placeholder={t('promo.descriptionPlaceholder')}
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            />

                            {/* Promotion Type */}
                            <div className="form-group">
                                <label className="form-label">{t('promo.type')}</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {PROMO_TYPES().map(type => (
                                        <button
                                            key={type.value}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, type: type.value })}
                                            className={`p-3 rounded-lg border text-start transition-all ${formData.type === type.value ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-700 hover:border-zinc-600'}`}
                                        >
                                            <p className="font-medium text-sm">{type.label}</p>
                                            <p className="text-xs text-zinc-500">{type.description}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label={formData.type === 'fixed' ? t('promo.amountDa') : t('promo.percent')}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder={formData.type === 'fixed' ? '10.00' : '20'}
                                    value={formData.value}
                                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                                />
                                <Input
                                    label={t('promo.minPurchase')}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                    value={formData.min_purchase}
                                    onChange={(e) => setFormData({ ...formData, min_purchase: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label={t('promo.maxDiscount')}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder={t('promo.noLimit')}
                                    value={formData.max_discount}
                                    onChange={(e) => setFormData({ ...formData, max_discount: e.target.value })}
                                />
                                <Input
                                    label={t('promo.maxUses')}
                                    type="number"
                                    min="0"
                                    placeholder={t('promo.unlimited')}
                                    value={formData.max_uses}
                                    onChange={(e) => setFormData({ ...formData, max_uses: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label={t('promo.start')}
                                    type="date"
                                    value={formData.start_date}
                                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                                />
                                <Input
                                    label={t('promo.end')}
                                    type="date"
                                    value={formData.end_date}
                                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                                />
                            </div>

                            <Input
                                label={t('promo.coupon')}
                                placeholder={t('promo.couponPlaceholder')}
                                value={formData.coupon_code}
                                onChange={(e) => setFormData({ ...formData, coupon_code: e.target.value.toUpperCase() })}
                            />

                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="auto_apply"
                                        checked={formData.auto_apply}
                                        onChange={(e) => setFormData({ ...formData, auto_apply: e.target.checked })}
                                        className="w-4 h-4 rounded border-zinc-600 text-indigo-500 focus:ring-indigo-500"
                                    />
                                    <label htmlFor="auto_apply" className="text-sm text-zinc-300">{t('promo.autoApply')}</label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="is_active"
                                        checked={formData.is_active}
                                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                        className="w-4 h-4 rounded border-zinc-600 text-indigo-500 focus:ring-indigo-500"
                                    />
                                    <label htmlFor="is_active" className="text-sm text-zinc-300">{t('status.active')}</label>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <Button variant="secondary" className="flex-1" onClick={() => { setShowFormModal(false); resetForm(); }}>
                                    {t('common.cancel')}
                                </Button>
                                <Button className="flex-1" onClick={handleSave}>
                                    {editingPromo ? t('common.update') : t('common.create')} Promotion
                                </Button>
                            </div>
                        </div>
                    </ModalBody>
                </Modal>
            )}

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                isOpen={showDeleteConfirm}
                onClose={() => { setShowDeleteConfirm(false); setDeletingId(null); }}
                onConfirm={confirmDelete}
                title={t('promo.delete')}
                message={t('promo.deleteConfirm')}
                confirmText={t('common.delete')}
                variant="danger"
            />
        </div>
    );
}
