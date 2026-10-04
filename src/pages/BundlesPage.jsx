import { t } from '../i18n';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { PackageOpen, Plus, Search, Edit2, Trash2, Package, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal, ModalBody } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/ui/Toast';
import { v4 as uuid } from 'uuid';
import { useSettingsStore } from '../stores/settingsStore';

export default function BundlesPage() {
    const [bundles, setBundles] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showFormModal, setShowFormModal] = useState(false);
    const [editingBundle, setEditingBundle] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingId, setDeletingId] = useState(null);

    // Assembly State
    const [showAssemblyModal, setShowAssemblyModal] = useState(false);
    const [assemblyType, setAssemblyType] = useState('assemble'); // 'assemble' or 'disassemble'
    const [assemblyQuantity, setAssemblyQuantity] = useState(1);
    const [selectedBundleForAssembly, setSelectedBundleForAssembly] = useState(null);

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        bundle_price: '',
        is_active: true,
        deduct_component_stock: false,
        stock_quantity: 0,
    });
    const [bundleItems, setBundleItems] = useState([]);
    const [selectedProduct, setSelectedProduct] = useState('');
    const [selectedQuantity, setSelectedQuantity] = useState(1);
    const { settings, loadSettings } = useSettingsStore();

    useEffect(() => {
        loadBundles();
        loadProducts();
        loadSettings();
    }, []);

    const loadBundles = async () => {
        try {
            const data = await window.electronAPI.bundles.getAll();
            // Load items for each bundle
            const bundlesWithItems = await Promise.all(
                data.map(async (bundle) => {
                    const fullBundle = await window.electronAPI.bundles.getById(bundle.id);
                    return fullBundle;
                })
            );
            setBundles(bundlesWithItems);
        } catch (error) {
            console.error('Failed to load bundles:', error);
            toast.error(t('bundles.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const loadProducts = async () => {
        try {
            const data = await window.electronAPI.products.getAll();
            setProducts(data.filter(p => p.is_active));
        } catch (error) {
            console.error('Failed to load products:', error);
        }
    };

    const resetForm = () => {
        setFormData({ name: '', description: '', bundle_price: '', is_active: true });
        setBundleItems([]);
        setSelectedProduct('');
        setSelectedQuantity(1);
        setEditingBundle(null);
    };

    const handleOpenCreate = () => {
        resetForm();
        setShowFormModal(true);
    };

    const handleOpenEdit = (bundle) => {
        setEditingBundle(bundle);
        setFormData({
            name: bundle.name,
            description: bundle.description || '',
            bundle_price: bundle.bundle_price.toString(),
            is_active: bundle.is_active,
            deduct_component_stock: !!bundle.deduct_component_stock,
            stock_quantity: bundle.stock_quantity || 0,
        });
        setBundleItems(bundle.items || []);
        setShowFormModal(true);
    };

    const handleAddItem = () => {
        if (!selectedProduct) {
            toast.error(t('bundles.selectProduct'));
            return;
        }

        const product = products.find(p => p.id === selectedProduct);
        if (!product) return;

        // Check if already added
        if (bundleItems.find(item => item.product_id === selectedProduct)) {
            toast.error(t('bundles.already'));
            return;
        }

        setBundleItems([
            ...bundleItems,
            {
                product_id: selectedProduct,
                product_name: product.name,
                product_price: product.price,
                quantity: selectedQuantity,
            },
        ]);
        setSelectedProduct('');
        setSelectedQuantity(1);
    };

    const handleRemoveItem = (productId) => {
        setBundleItems(bundleItems.filter(item => item.product_id !== productId));
    };

    const calculateOriginalPrice = () => {
        return bundleItems.reduce((sum, item) => sum + (item.product_price * item.quantity), 0);
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast.error(t('bundles.nameRequired'));
            return;
        }
        if (bundleItems.length === 0) {
            toast.error(t('bundles.needProduct'));
            return;
        }
        if (!formData.bundle_price || parseFloat(formData.bundle_price) <= 0) {
            toast.error(t('bundles.validPrice'));
            return;
        }

        try {
            const bundle = {
                id: editingBundle?.id || uuid(),
                name: formData.name,
                description: formData.description,
                bundle_price: parseFloat(formData.bundle_price),
                is_active: formData.is_active,
                deduct_component_stock: formData.deduct_component_stock ? 1 : 0,
                stock_quantity: formData.deduct_component_stock ? 0 : (formData.stock_quantity || 0),
            };

            const items = bundleItems.map(item => ({
                product_id: item.product_id,
                quantity: item.quantity,
            }));

            if (editingBundle) {
                await window.electronAPI.bundles.update({ bundle, items });
                toast.success(t('bundles.updated'));
            } else {
                await window.electronAPI.bundles.create({ bundle, items });
                toast.success(t('bundles.created'));
            }

            setShowFormModal(false);
            resetForm();
            loadBundles();
        } catch (error) {
            toast.error(t('bundles.saveFailed'));
            console.error(error);
        }
    };

    const handleDelete = async (id) => {
        setDeletingId(id);
        setShowDeleteConfirm(true);
    };

    const confirmDelete = async () => {
        try {
            await window.electronAPI.bundles.delete(deletingId);
            toast.success(t('bundles.deleted'));
            loadBundles();
        } catch (error) {
            toast.error(t('bundles.deleteFailed'));
            console.error(error);
        }
        setDeletingId(null);
    };

    const handleOpenAssembly = (bundle, type) => {
        setSelectedBundleForAssembly(bundle);
        setAssemblyType(type);
        setAssemblyQuantity(1);
        setShowAssemblyModal(true);
    };

    const handleAssemblySubmit = async () => {
        try {
            if (assemblyQuantity <= 0) {
                toast.error(t('bundles.qtyPositive'));
                return;
            }

            if (assemblyType === 'assemble') {
                await window.electronAPI.bundles.assemble({ id: selectedBundleForAssembly.id, quantity: assemblyQuantity });
                toast.success(`Assembled ${assemblyQuantity} bundles`);
            } else {
                await window.electronAPI.bundles.disassemble({ id: selectedBundleForAssembly.id, quantity: assemblyQuantity });
                toast.success(`Disassembled ${assemblyQuantity} bundles`);
            }
            setShowAssemblyModal(false);
            loadBundles();
        } catch (error) {
            toast.error(error.message);
        }
    };

    const filteredBundles = bundles.filter(bundle =>
        bundle.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const formatCurrency = (amount) => {
        return formatMoney(amount || 0);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="page">
            <PageHeader
                icon={PackageOpen}
                title={t('bundles.title')}
                subtitle={t('bundles.subtitle')}
                actions={<Button onClick={handleOpenCreate}><Plus className="w-4 h-4" /> {t('bundles.create')}</Button>}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative w-72 max-w-full">
                        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input className="input ps-9" placeholder={t('bundles.search')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    </div>
                    <span className="text-sm text-zinc-500">
                        {t('bundles.statsLine', { n: bundles.length, active: bundles.filter(b => b.is_active).length })}
                    </span>
                </div>
            </PageHeader>

            <div className="page-body">
                {filteredBundles.length === 0 ? (
                    <div className="text-center py-16 text-zinc-500">
                        <PackageOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
                        <p className="mb-4">{t('bundles.none')}</p>
                        <Button onClick={handleOpenCreate}><Plus className="w-4 h-4" /> {t('bundles.create')}</Button>
                    </div>
                ) : (
                    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                        {filteredBundles.map(bundle => {
                            const savingPct = bundle.original_price > 0 ? Math.round((bundle.savings / bundle.original_price) * 100) : 0;
                            return (
                                <div key={bundle.id} className={`card p-0 overflow-hidden flex flex-col ${bundle.is_active ? '' : 'opacity-60'}`}>
                                    <div className="px-4 pt-4 pb-3 bg-gradient-to-b from-fuchsia-500/20 to-fuchsia-500/0 flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <h3 className="font-semibold truncate">{bundle.name}</h3>
                                            <div className="flex items-baseline gap-2 mt-1">
                                                <span className="text-2xl font-bold tabular">{formatCurrency(bundle.bundle_price)}</span>
                                                {bundle.original_price > bundle.bundle_price && (
                                                    <span className="text-sm line-through text-zinc-500 tabular">{formatCurrency(bundle.original_price)}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            {savingPct > 0 && <span className="badge bg-emerald-500/15 text-emerald-300">-{savingPct}%</span>}
                                            <span className={`badge ${bundle.is_active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-500/20 text-zinc-400'}`}>
                                                {bundle.is_active ? t('status.active') : t('status.inactive')}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="px-4 py-2 flex-1 space-y-1.5">
                                        {bundle.description && <p className="text-sm text-zinc-400">{bundle.description}</p>}
                                        {bundle.items?.map(item => (
                                            <div key={item.product_id} className="flex items-center justify-between gap-2 text-sm">
                                                <span className="truncate"><span className="text-zinc-500 tabular">{item.quantity}×</span> {item.product_name}</span>
                                                <span className="text-zinc-500 tabular whitespace-nowrap">{formatCurrency(item.product_price * item.quantity)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="px-4 py-2 border-t border-dark-border flex items-center gap-1">
                                        {!bundle.deduct_component_stock && (
                                            <>
                                                <button type="button" onClick={() => handleOpenAssembly(bundle, 'assemble')}
                                                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-emerald-300 hover:bg-emerald-500/10">
                                                    <ArrowDownCircle className="w-3.5 h-3.5" /> {t('bundles.assemble')}
                                                </button>
                                                <button type="button" onClick={() => handleOpenAssembly(bundle, 'disassemble')}
                                                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-amber-300 hover:bg-amber-500/10">
                                                    <ArrowUpCircle className="w-3.5 h-3.5" /> {t('bundles.break')}
                                                </button>
                                            </>
                                        )}
                                        <div className="flex-1" />
                                        <button type="button" title={t('common.edit')} onClick={() => handleOpenEdit(bundle)} className="p-2 rounded-lg hover:bg-dark-tertiary text-zinc-400 hover:text-white">
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button type="button" title={t('common.delete')} onClick={() => handleDelete(bundle.id)} className="p-2 rounded-lg hover:bg-red-500/15 text-red-300">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Form Modal */}
            {showFormModal && (
                <Modal
                    isOpen={true}
                    title={editingBundle ? t('bundles.edit') : t('bundles.create')}
                    onClose={() => { setShowFormModal(false); resetForm(); }}
                    size="lg"
                >
                    <ModalBody>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    autoFocus // Ensure focus on open
                                    name="name"
                                    label={t('bundles.name')}
                                    placeholder={t('bundles.namePlaceholder')}
                                    value={formData.name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                />
                                <Input
                                    name="bundle_price"
                                    label={t('bundles.priceDa')}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="19.99"
                                    value={formData.bundle_price}
                                    onChange={(e) => setFormData(prev => ({ ...prev, bundle_price: e.target.value }))}
                                />
                            </div>

                            <Input
                                name="description"
                                label={t('bundles.description')}
                                placeholder={t('bundles.descriptionPlaceholder')}
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                            />

                            <div className="flex flex-col gap-4">
                                <div className="flex gap-4">
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
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="deduct_component_stock"
                                            checked={formData.deduct_component_stock}
                                            onChange={(e) => setFormData({ ...formData, deduct_component_stock: e.target.checked })}
                                            className="w-4 h-4 rounded border-zinc-600 text-indigo-500 focus:ring-indigo-500"
                                        />
                                        <label htmlFor="deduct_component_stock" className="text-sm text-zinc-300">{t('bundles.trackStock')}</label>
                                    </div>
                                </div>

                                {!formData.deduct_component_stock && (
                                    <div className="p-4 bg-purple-500/10 rounded-lg text-sm text-purple-300">
                                        {t('bundles.trackHint')}
                                    </div>
                                )}
                            </div>

                            {/* Add Product to Bundle */}
                            <div className="p-4 bg-zinc-800/50 rounded-lg space-y-3">
                                <p className="text-sm font-medium">{t('bundles.addProducts')}</p>
                                <div className="flex gap-2">
                                    <Select
                                        className="flex-1"
                                        value={selectedProduct}
                                        onChange={setSelectedProduct}
                                        placeholder={t('bundles.selectPlaceholder')}
                                        options={products.map(p => ({
                                            value: p.id,
                                            label: `${p.name} - ${formatCurrency(p.price)}`
                                        }))}
                                    />
                                    <input
                                        type="number"
                                        min="1"
                                        className="input w-20"
                                        value={selectedQuantity}
                                        onChange={(e) => setSelectedQuantity(parseInt(e.target.value) || 1)}
                                    />
                                    <Button onClick={handleAddItem}>
                                        <Plus className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            {/* Bundle Items */}
                            <div className="space-y-2">
                                <p className="text-sm font-medium">Bundle Items ({bundleItems.length})</p>
                                {bundleItems.length === 0 ? (
                                    <p className="text-sm text-zinc-500 p-4 text-center bg-zinc-800/30 rounded-lg">
                                        {t('bundles.noProducts')}
                                    </p>
                                ) : (
                                    <div className="space-y-2 max-h-40 overflow-auto">
                                        {bundleItems.map(item => (
                                            <div key={item.product_id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                                                <div className="flex items-center gap-3">
                                                    <Package className="w-4 h-4 text-zinc-400" />
                                                    <span>{item.quantity}x {item.product_name}</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-zinc-400">{formatCurrency(item.product_price * item.quantity)}</span>
                                                    <button
                                                        onClick={() => handleRemoveItem(item.product_id)}
                                                        className="p-1 hover:bg-red-500/20 rounded"
                                                    >
                                                        <Trash2 className="w-4 h-4 text-red-400" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Price Summary */}
                            {bundleItems.length > 0 && (
                                <div className="p-4 bg-zinc-800/50 rounded-lg space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span>{t('bundles.originalTotal')}</span>
                                        <span>{formatCurrency(calculateOriginalPrice())}</span>
                                    </div>
                                    <div className="flex justify-between font-medium">
                                        <span>{t('bundles.price')}</span>
                                        <span className="text-purple-400">{formatCurrency(parseFloat(formData.bundle_price) || 0)}</span>
                                    </div>
                                    <div className="flex justify-between text-green-400">
                                        <span>{t('bundles.customerSaving')}</span>
                                        <span>{formatCurrency(calculateOriginalPrice() - (parseFloat(formData.bundle_price) || 0))}</span>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3 pt-4">
                                <Button variant="secondary" className="flex-1" onClick={() => { setShowFormModal(false); resetForm(); }}>
                                    {t('common.cancel')}
                                </Button>
                                <Button className="flex-1" onClick={handleSave}>
                                    {editingBundle ? t('bundles.update') : t('bundles.create')}
                                </Button>
                            </div>
                        </div>
                    </ModalBody>
                </Modal>
            )}

            {/* Assembly Modal */}
            {showAssemblyModal && (
                <Modal
                    isOpen={true}
                    title={assemblyType === 'assemble' ? t('bundles.assembleTitle') : t('bundles.disassembleTitle')}
                    onClose={() => setShowAssemblyModal(false)}
                    size="sm"
                >
                    <ModalBody>
                        <div className="space-y-4">
                            <p className="text-zinc-300">
                                {assemblyType === 'assemble'
                                    ? `How many "${selectedBundleForAssembly?.name}" bundles do you want to create? Components will be deducted.`
                                    : `How many "${selectedBundleForAssembly?.name}" bundles do you want to break? Components will be returned to stock.`
                                }
                            </p>

                            <Input
                                label={t('inventory.quantity')}
                                type="number"
                                min="1"
                                value={assemblyQuantity}
                                onChange={(e) => setAssemblyQuantity(parseInt(e.target.value) || 1)}
                            />

                            <div className="flex gap-3 pt-4">
                                <Button variant="secondary" className="flex-1" onClick={() => setShowAssemblyModal(false)}>
                                    {t('common.cancel')}
                                </Button>
                                <Button className="flex-1" onClick={handleAssemblySubmit} variant={assemblyType === 'assemble' ? 'success' : 'warning'}>
                                    {assemblyType === 'assemble' ? t('bundles.assemble') : t('bundles.disassemble')}
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
                title={t('bundles.delete')}
                message={t('bundles.deleteConfirm')}
                confirmText={t('common.delete')}
                variant="danger"
            />
        </div>
    );
}
