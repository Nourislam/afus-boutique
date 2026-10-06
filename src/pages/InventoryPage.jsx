import { t } from '../i18n';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, AlertTriangle, Plus, Minus, History, ArrowUpDown, ClipboardCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, SearchInput } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeader } from '../components/ui/Table';
import { StatusBadge } from '../components/ui/Badge';
import { StatCard } from '../components/ui/Card';
import { toast } from '../components/ui/Toast';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { variantLabel } from '../lib/clothing';
import { MANUAL_REASONS, stockReasonLabel } from '../lib/stockReasons';
import { readFilter, stockMatches, STOCK_FILTERS } from '../lib/listFilters';
import { PERMISSIONS } from '../lib/permissions';
import StockCountModal from '../components/inventory/StockCountModal';

export default function InventoryPage() {
    const [products, setProducts] = useState([]);
    const [lowStockProducts, setLowStockProducts] = useState([]);
    const [inventoryLogs, setInventoryLogs] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAdjustModal, setShowAdjustModal] = useState(false);
    const [showLogsModal, setShowLogsModal] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [loading, setLoading] = useState(true);
    const [variantsByProduct, setVariantsByProduct] = useState({});
    const [showCount, setShowCount] = useState(false);
    // Sold out / running low: read from the address (?stock=out|low), so a link from the home screen opens filtered
    const [searchParams, setSearchParams] = useSearchParams();
    const stockFilter = readFilter(searchParams, 'stock', STOCK_FILTERS);
    const setStockFilter = (value) => {
        const next = new URLSearchParams(searchParams);
        if (value === 'all') next.delete('stock'); else next.set('stock', value);
        setSearchParams(next, { replace: true });
    };

    const { currentEmployee, hasPermission } = useAuthStore();
    const canCount = hasPermission(PERMISSIONS.INVENTORY_ADJUST);
    const { loadSettings } = useSettingsStore();

    useEffect(() => {
        loadData();
        loadSettings();
    }, []);

    const loadData = async () => {
        try {
            const [productsData, lowStock, logs, allVariants] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.inventory.getLowStock(),
                window.electronAPI.inventory.getLogs(),
                window.electronAPI.catalog.searchVariants('', 10000),
            ]);
            const byProduct = {};
            for (const v of allVariants) (byProduct[v.product_id] = byProduct[v.product_id] || []).push(v);
            setVariantsByProduct(byProduct);
            setProducts(productsData);
            setLowStockProducts(lowStock);
            setInventoryLogs(logs);
        } catch {
            toast.error(t('inventory.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const filteredProducts = products.filter(product =>
        (product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.sku?.toLowerCase().includes(searchQuery.toLowerCase())) &&
        stockMatches(product, variantsByProduct[product.id] || [], stockFilter)
    );
    const stockCount = (filter) => products.filter(p => stockMatches(p, variantsByProduct[p.id] || [], filter)).length;

    const totalStock = products.reduce((sum, p) => sum + p.stock_quantity, 0);
    const totalValue = products.reduce((sum, p) => sum + (p.stock_quantity * p.cost), 0);

    const formatCurrency = (amount) => {
        return formatMoney(amount);
    };

    const getStockStatus = (product) => {
        if (product.stock_quantity <= 0) return 'out-of-stock';
        if (product.stock_quantity <= product.min_stock_level) return 'low-stock';
        return 'in-stock';
    };

    const handleViewLogs = async (product) => {
        setSelectedProduct(product);
        try {
            const logs = await window.electronAPI.inventory.getLogs(product.id);
            setInventoryLogs(logs);
            setShowLogsModal(true);
        } catch {
            toast.error(t('inventory.logsFailed'));
        }
    };

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-dark-border">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">{t('inventory.title')}</h1>
                        <p className="text-zinc-500">{t('inventory.subtitle')}</p>
                    </div>
                    {canCount && (
                        <Button variant="secondary" onClick={() => setShowCount(true)}>
                            <ClipboardCheck className="w-4 h-4" /> {t('count.open')}
                        </Button>
                    )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <StatCard
                        label={t('inventory.totalProducts')}
                        value={products.length}
                        icon={Package}
                        color="primary"
                    />
                    <StatCard
                        label={t('inventory.totalStock')}
                        value={totalStock.toLocaleString()}
                        icon={Package}
                        color="primary"
                    />
                    <StatCard
                        label={t('inventory.stockValue')}
                        value={formatCurrency(totalValue)}
                        icon={Package}
                        color="success"
                    />
                    <StatCard
                        label={t('inventory.lowStockItems')}
                        value={lowStockProducts.length}
                        icon={AlertTriangle}
                        color={lowStockProducts.length > 0 ? 'warning' : 'success'}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <SearchInput
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder={t('inventory.search')}
                        className="max-w-md"
                    />
                    <div className="segmented" role="tablist" data-testid="stock-filter">
                        {STOCK_FILTERS.map(id => (
                            <button key={id} type="button" role="tab" aria-selected={stockFilter === id} className={stockFilter === id ? 'active' : ''} onClick={() => setStockFilter(id)}>
                                {t(`inventory.filter.${id}`)}
                                {!loading && <span className="ms-1.5 text-xs text-zinc-500 tabular">{stockCount(id)}</span>}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {/* Low Stock Alert */}
                {lowStockProducts.length > 0 && (
                    <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                        <div className="flex items-center gap-2 text-amber-400 mb-3">
                            <AlertTriangle className="w-5 h-5" />
                            <span className="font-semibold">{t('inventory.lowAlert')}</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {lowStockProducts.slice(0, 8).map(row => (
                                <div
                                    key={row.variant_id || row.product_id}
                                    className="p-3 rounded-lg bg-dark-tertiary/50"
                                >
                                    <p className="font-medium truncate">{row.product_name}</p>
                                    {(row.color || row.size) && (
                                        <p className="text-xs text-zinc-300 truncate">{variantLabel(row)}</p>
                                    )}
                                    <p className="text-sm text-amber-400">
                                        {t('inventory.remainingN', { n: row.stock_quantity })}
                                    </p>
                                </div>
                            ))}
                        </div>
                        {lowStockProducts.length > 8 && (
                            <p className="text-xs text-amber-400 mt-2">{t('inventory.moreLow', { n: lowStockProducts.length - 8 })}</p>
                        )}
                    </div>
                )}

                {/* Products Table */}
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableHeader>{t('inventory.product')}</TableHeader>
                                <TableHeader>{t('products.sku')}</TableHeader>
                                <TableHeader>{t('inventory.current')}</TableHeader>
                                <TableHeader>{t('inventory.minLevel')}</TableHeader>
                                <TableHeader>{t('inventory.status')}</TableHeader>
                                <TableHeader>{t('inventory.value')}</TableHeader>
                                <TableHeader>{t('inventory.actions')}</TableHeader>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredProducts.map(product => (
                                <TableRow key={product.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-dark-tertiary flex items-center justify-center">
                                                <Package className="w-5 h-5 text-zinc-600" />
                                            </div>
                                            <div className="min-w-0">
                                                <span className="font-medium">{product.name}</span>
                                                {variantsByProduct[product.id]?.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {variantsByProduct[product.id].map(v => (
                                                            <span
                                                                key={v.id}
                                                                title={v.sku}
                                                                className={`text-[11px] px-1.5 py-0.5 rounded bg-dark-tertiary ${v.stock_quantity <= 0 ? 'text-red-400' : v.stock_quantity <= v.min_stock_level ? 'text-amber-400' : 'text-zinc-300'}`}
                                                            >
                                                                {variantLabel(v) || v.sku}: {v.stock_quantity}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-zinc-400">{product.sku || '-'}</TableCell>
                                    <TableCell>
                                        <span className={`font-semibold ${product.stock_quantity <= 0 ? 'text-red-400' :
                                            product.stock_quantity <= product.min_stock_level ? 'text-amber-400' :
                                                'text-green-400'
                                            }`}>
                                            {product.stock_quantity}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-zinc-400">{product.min_stock_level}</TableCell>
                                    <TableCell><StatusBadge status={getStockStatus(product)} /></TableCell>
                                    <TableCell>{formatCurrency(product.stock_quantity * product.cost)}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => { setSelectedProduct(product); setShowAdjustModal(true); }}
                                            >
                                                <ArrowUpDown className="w-3 h-3" />
                                                {t('inventory.adjustShort')}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleViewLogs(product)}
                                            >
                                                <History className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            {/* Stock Adjustment Modal */}
            <StockAdjustmentModal
                isOpen={showAdjustModal}
                onClose={() => setShowAdjustModal(false)}
                product={selectedProduct}
                employeeId={currentEmployee?.id}
                onSave={() => { loadData(); setShowAdjustModal(false); }}
            />

            {/* Inventory Logs Modal */}
            <Modal
                isOpen={showLogsModal}
                onClose={() => setShowLogsModal(false)}
                title={`Stock History - ${selectedProduct?.name || ''}`}
                size="lg"
            >
                <ModalBody>
                    {inventoryLogs.length === 0 ? (
                        <p className="text-center text-zinc-500 py-8">{t('inventory.noHistory')}</p>
                    ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {inventoryLogs.map(log => (
                                <div
                                    key={log.id}
                                    className="flex items-center justify-between p-3 rounded-lg bg-dark-tertiary"
                                >
                                    <div className="flex items-center gap-3">
                                        {(() => {
                                            // Older manual adjustments stored a positive quantity with type 'remove'
                                            const isOut = log.quantity_change < 0 || log.type === 'remove';
                                            const amount = Math.abs(log.quantity_change);
                                            return (
                                                <>
                                                    <div className={`p-2 rounded-lg ${isOut ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
                                                        {isOut ? <Minus className="w-4 h-4 text-red-400" /> : <Plus className="w-4 h-4 text-green-400" />}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium">
                                                            {t('stock.units', { n: `${isOut ? '-' : '+'}${amount}` })}
                                                            {(log.variant_color || log.variant_size) && (
                                                                <span className="ms-2 text-sm text-accent-primary">{variantLabel({ color: log.variant_color, size: log.variant_size })}</span>
                                                            )}
                                                            {log.variant_sku && <span className="ms-2 text-xs font-mono text-zinc-500">{log.variant_sku}</span>}
                                                        </p>
                                                        <p className="text-sm text-zinc-400">
                                                            {log.reason ? stockReasonLabel(log.reason) : (log.type || t('stock.reason.none'))}{log.employee_name ? ` • ${log.employee_name}` : ''}
                                                        </p>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                    <div className="text-end">
                                        <p className="text-sm text-zinc-400">
                                            {log.quantity_before} → {log.quantity_after}
                                        </p>
                                        <p className="text-xs text-zinc-500">
                                            {formatLocalDate(log.created_at, 'datetime')}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ModalBody>
            </Modal>
            <StockCountModal isOpen={showCount} onClose={() => setShowCount(false)} onConfirmed={loadData} />
        </div>
    );
}

function StockAdjustmentModal({ isOpen, onClose, product, employeeId, onSave }) {
    const [adjustType, setAdjustType] = useState('add');
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [variants, setVariants] = useState([]);
    const [variantId, setVariantId] = useState('');

    useEffect(() => {
        if (isOpen) {
            setQuantity('');
            setReason('');
            setAdjustType('add');
            setVariants([]);
            setVariantId('');
            // Clothing products are counted per colour/size
            if (product?.variant_count > 0) {
                window.electronAPI.catalog.getVariants(product.id).then((rows) => {
                    setVariants(rows);
                    if (rows.length === 1) setVariantId(rows[0].id);
                });
            }
        }
    }, [isOpen, product]);

    const selectedVariant = variants.find(v => v.id === variantId) || null;
    const needsVariant = product?.variant_count > 0;
    const currentStock = needsVariant ? (selectedVariant?.stock_quantity ?? 0) : (product?.stock_quantity ?? 0);

    const handleSubmit = async (e) => {
        e.preventDefault();

        const qty = parseInt(quantity);
        if (!qty || qty <= 0) {
            toast.error(t('inventory.validQty'));
            return;
        }

        if (needsVariant && !selectedVariant) {
            toast.error(t('variants.chooseColorSize'));
            return;
        }

        if (adjustType === 'remove' && qty > currentStock) {
            toast.error(t('inventory.tooMuch'));
            return;
        }

        setLoading(true);
        try {
            await window.electronAPI.products.updateStock({
                id: product.id,
                variantId: selectedVariant ? selectedVariant.id : null,
                quantity: qty,
                type: adjustType,
                reason,
                employeeId,
            });
            toast.success(t('inventory.updated'));
            onSave();
        } catch {
            toast.error(t('inventory.updateFailed'));
        } finally {
            setLoading(false);
        }
    };

    if (!product) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('inventory.adjust')} size="md">
            <form onSubmit={handleSubmit}>
                <ModalBody>
                    <div className="space-y-4">
                        {/* Product Info */}
                        <div className="p-4 rounded-lg bg-dark-tertiary">
                            <p className="font-medium">{product.name}</p>
                            <p className="text-sm text-zinc-400">
                                {t('inventory.currentN', { n: currentStock })}
                                {needsVariant && ` ${t('inventory.allVariantsTotal', { n: product.stock_quantity })}`}
                            </p>
                        </div>

                        {needsVariant && (
                            <Select
                                label={t('inventory.variant')}
                                value={variantId}
                                onChange={setVariantId}
                                options={[
                                    { value: '', label: t('inventory.selectVariant') },
                                    ...variants.map(v => ({
                                        value: v.id,
                                        label: `${variantLabel(v) || v.sku} — ${v.sku} (${t('variants.inStock', { n: v.stock_quantity })})`,
                                    })),
                                ]}
                            />
                        )}

                        {/* Adjustment Type */}
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setAdjustType('add')}
                                className={`p-4 rounded-xl border-2 transition-all flex items-center justify-center gap-2
                  ${adjustType === 'add'
                                        ? 'border-green-500 bg-green-500/10 text-green-400'
                                        : 'border-dark-border hover:border-zinc-600'
                                    }`}
                            >
                                <Plus className="w-5 h-5" />
                                {t('inventory.add')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setAdjustType('remove')}
                                className={`p-4 rounded-xl border-2 transition-all flex items-center justify-center gap-2
                  ${adjustType === 'remove'
                                        ? 'border-red-500 bg-red-500/10 text-red-400'
                                        : 'border-dark-border hover:border-zinc-600'
                                    }`}
                            >
                                <Minus className="w-5 h-5" />
                                {t('inventory.remove')}
                            </button>
                        </div>

                        <Input
                            label={t('inventory.quantity')}
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            placeholder={t('inventory.enterQty')}
                            min="1"
                        />

                        <Select
                            label={t('inventory.reason')}
                            value={reason}
                            onChange={setReason}
                            options={[
                                { value: '', label: t('stock.selectReason') },
                                ...MANUAL_REASONS.map(code => ({ value: code, label: t(`stock.reason.${code}`) })),
                            ]}
                        />

                        {/* Preview */}
                        {quantity && (
                            <div className={`p-4 rounded-lg ${adjustType === 'add' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                                <p className="text-sm text-zinc-400">{t('inventory.newLevel')}</p>
                                <p className="text-2xl font-bold">
                                    {adjustType === 'add'
                                        ? currentStock + parseInt(quantity || 0)
                                        : currentStock - parseInt(quantity || 0)
                                    }
                                </p>
                            </div>
                        )}
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                    <Button
                        type="submit"
                        variant={adjustType === 'add' ? 'success' : 'danger'}
                        loading={loading}
                    >
                        {adjustType === 'add' ? t('inventory.add') : t('inventory.remove')}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
