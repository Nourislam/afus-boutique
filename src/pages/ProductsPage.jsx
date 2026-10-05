import { t } from '../i18n';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, Package, Grid, List, FileSpreadsheet, QrCode, Tag, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeader, EmptyState } from '../components/ui/Table';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { toast } from '../components/ui/Toast';
import { v4 as uuid } from 'uuid';
import { PermissionGate } from '../components/auth/PermissionGate';
import { PERMISSIONS } from '../stores/authStore';
import { ExcelImport } from '../components/ui/ExcelImport';


import { useSettingsStore } from '../stores/settingsStore';
import { ProductFormModal } from '../components/products/ProductFormModal';
import { lacksCost, readFilter } from '../lib/listFilters';

export default function ProductsPage() {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [viewMode, setViewMode] = useState('grid');
    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showExcelImport, setShowExcelImport] = useState(false);
    const [initialValues, setInitialValues] = useState(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    // Articles without a purchase price (?filter=noCost, from the home screen's "complete the prices")
    const noCostOnly = readFilter(searchParams, 'filter', ['noCost'], '') === 'noCost';
    const [variantsByProduct, setVariantsByProduct] = useState(null);
    const setNoCostOnly = (on) => {
        const next = new URLSearchParams(searchParams);
        if (on) next.set('filter', 'noCost'); else next.delete('filter');
        setSearchParams(next, { replace: true });
    };
    // The colours/sizes have their own purchase price: loaded only while this filter is on
    useEffect(() => {
        if (!noCostOnly) return undefined;
        let cancelled = false;
        window.electronAPI.catalog.searchVariants('', 10000).then(rows => {
            if (cancelled) return;
            const byProduct = {};
            for (const v of rows) (byProduct[v.product_id] = byProduct[v.product_id] || []).push(v);
            setVariantsByProduct(byProduct);
        }).catch(() => { if (!cancelled) setVariantsByProduct({}); });
        return () => { cancelled = true; };
    }, [noCostOnly, products]);

    const { loadSettings } = useSettingsStore();

    useEffect(() => {
        loadData();
        loadSettings();
    }, []);

    // Opened from the POS after scanning an unknown code: start a new product with it
    useEffect(() => {
        const code = searchParams.get('newCode');
        if (code) {
            setEditingProduct(null);
            setInitialValues({ barcode: code });
            setShowProductModal(true);
            setSearchParams({}, { replace: true });
        }
    }, [searchParams]);

    const loadData = async () => {
        try {
            const [productsData, categoriesData] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.categories.getAll(),
            ]);
            setProducts(productsData);
            setCategories(categoriesData);
        } catch {
            toast.error(t('common.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const filteredProducts = (products || []).filter(product => {
        const matchesCategory = selectedCategory === 'all' || product.category_id === selectedCategory;
        const matchesSearch = !searchQuery ||
            product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.barcode?.includes(searchQuery);
        const matchesCost = !noCostOnly || (variantsByProduct !== null && lacksCost(product, variantsByProduct[product.id] || []));
        return matchesCategory && matchesSearch && matchesCost;
    });

    const formatCurrency = (amount) => {
        return formatMoney(amount);
    };

    const formatPrice = (product) => {
        if (product.variant_count > 0 && product.min_variant_price !== product.max_variant_price) {
            return `${formatCurrency(product.min_variant_price)} – ${formatCurrency(product.max_variant_price)}`;
        }
        return formatCurrency(product.variant_count > 0 ? product.min_variant_price : product.price);
    };

    const handleDeleteProduct = async (product) => {
        if (confirm(t('common.deleteConfirm', { name: product.name }))) {
            try {
                await window.electronAPI.products.delete(product.id);
                toast.success(t('products.deleted'));
                loadData();
            } catch {
                toast.error(t('products.deleteFailed'));
            }
        }
    };

    const getStockStatus = (product) => {
        if (product.stock_quantity <= 0) return 'out-of-stock';
        if (product.stock_quantity <= product.min_stock_level) return 'low-stock';
        return 'in-stock';
    };

    const handleExcelImport = async (records) => {
        let successCount = 0;
        const failures = [];
        for (const record of records) {
            try {
                // Find or create category
                let categoryId = null;
                if (record.category) {
                    const existingCat = categories.find(
                        c => c.name.toLowerCase() === record.category.toLowerCase()
                    );
                    categoryId = existingCat?.id || null;
                }

                await window.electronAPI.products.create({
                    id: uuid(),
                    sku: record.sku || null,
                    barcode: record.barcode || null,
                    name: record.name,
                    description: record.description || null,
                    category_id: categoryId,
                    brand: record.brand || null,
                    price: parseFloat(record.price) || 0,
                    cost: parseFloat(record.cost) || 0,
                    stock_quantity: parseInt(record.stock_quantity) || 0,
                    min_stock_level: parseInt(record.min_stock_level) || 5,
                    tax_rate: parseFloat(record.tax_rate) || 0,
                    is_active: true,
                    image_path: null,
                });
                successCount++;
            } catch (error) {
                console.error('Failed to import product:', record.name, error);
                failures.push(record.name);
            }
        }
        toast.success(t('products.imported', { n: successCount }));
        if (failures.length) toast.error(t('products.importFailures', { n: failures.length, names: failures.slice(0, 3).join(', ') }));
        loadData();
    };

    return (
        <>
            <div className="h-full flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-dark-border">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h1 className="text-2xl font-bold">{t('products.title')}</h1>
                            <p className="text-zinc-500">{t('products.count', { n: products.length })}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <PermissionGate permission={PERMISSIONS.PRODUCTS_CREATE}>
                                <Button variant="secondary" onClick={() => setShowExcelImport(true)}>
                                    <FileSpreadsheet className="w-4 h-4" />
                                    {t('common.importExcel')}
                                </Button>
                                <Button onClick={() => {
                                    setInitialValues(null);
                                    setEditingProduct(null);
                                    setShowProductModal(true);
                                }}>
                                    <Plus className="w-4 h-4" />
                                    {t('products.add')}
                                </Button>
                            </PermissionGate>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder={t('products.search')}
                            className="flex-1 max-w-md"
                        />
                        <Select
                            value={selectedCategory}
                            onChange={setSelectedCategory}
                            options={[
                                { value: 'all', label: t('products.allCategories') },
                                ...categories.map(c => ({ value: c.id, label: c.name }))
                            ]}
                            className="w-48"
                        />
                        <button type="button" onClick={() => setNoCostOnly(!noCostOnly)} aria-pressed={noCostOnly} data-testid="filter-no-cost"
                            className={`h-10 px-3 rounded-lg border text-sm inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${noCostOnly ? 'border-amber-500/50 bg-amber-500/15 text-amber-200' : 'border-dark-border text-zinc-400 hover:text-white'}`}>
                            <Tag className="w-4 h-4" /> {t('products.filterNoCost')}
                            {noCostOnly && <X className="w-3.5 h-3.5" aria-label={t('common.clear')} />}
                        </button>
                        <div className="flex items-center gap-1 bg-dark-tertiary rounded-lg p-1">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2 rounded ${viewMode === 'grid' ? 'bg-accent-primary' : 'hover:bg-zinc-700'}`}
                            >
                                <Grid className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={`p-2 rounded ${viewMode === 'list' ? 'bg-accent-primary' : 'hover:bg-zinc-700'}`}
                            >
                                <List className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <EmptyState
                            icon={Package}
                            title={t('products.notFound')}
                            description={searchQuery ? t('products.tryOther') : t('products.addFirst')}
                            action={
                                <Button onClick={() => { setEditingProduct(null); setShowProductModal(true); }}>
                                    <Plus className="w-4 h-4" />
                                    {t('products.add')}
                                </Button>
                            }
                        />
                    ) : viewMode === 'grid' ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {filteredProducts.map(product => (
                                <div key={product.id} className="card group">
                                    <div className="aspect-square bg-dark-tertiary rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                                        {product.image_path ? (
                                            <img src={`app://${product.image_path}`} alt={product.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <Package className="w-12 h-12 text-zinc-600" />
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="font-medium truncate">{product.name}</h3>
                                        <p className="text-sm text-zinc-500 truncate">
                                            {product.variant_count > 0 ? t('products.variantsInStock', { n: product.variant_count, stock: product.stock_quantity }) : (product.sku || t('products.noSku'))}
                                        </p>
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="font-semibold text-accent-primary truncate">{formatPrice(product)}</p>
                                            <StatusBadge status={getStockStatus(product)} />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="flex-1"
                                                onClick={() => { setEditingProduct(product); setShowProductModal(true); }}
                                            >
                                                <Edit2 className="w-3 h-3" />
                                                {t('common.edit')}
                                            </Button>
                                        </PermissionGate>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            title={t('products.printLabels')}
                                            onClick={() => navigate(`/labels?tab=articles&product=${product.id}`)}
                                        >
                                            <QrCode className="w-3 h-3" />
                                        </Button>
                                        <PermissionGate permission={PERMISSIONS.PRODUCTS_DELETE}>
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => handleDeleteProduct(product)}
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        </PermissionGate>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableHeader>{t('products.product')}</TableHeader>
                                    <TableHeader>{t('products.colSku')}</TableHeader>
                                    <TableHeader>{t('products.colCategory')}</TableHeader>
                                    <TableHeader>{t('products.colPrice')}</TableHeader>
                                    <TableHeader>{t('products.colStock')}</TableHeader>
                                    <TableHeader>{t('products.colStatus')}</TableHeader>
                                    <TableHeader>{t('products.colActions')}</TableHeader>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {filteredProducts.map(product => (
                                    <TableRow key={product.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-dark-tertiary flex items-center justify-center">
                                                    {product.image_path ? (
                                                        <img src={`app://${product.image_path}`} alt="" className="w-full h-full object-cover rounded-lg" />
                                                    ) : (
                                                        <Package className="w-5 h-5 text-zinc-600" />
                                                    )}
                                                </div>
                                                <span className="font-medium">{product.name}</span>
                                                {product.variant_count > 0 && <Badge>{t('products.variantCount', { n: product.variant_count })}</Badge>}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-zinc-400">{product.sku || '-'}</TableCell>
                                        <TableCell>
                                            {product.category_name ? (
                                                <Badge style={{ backgroundColor: `${product.category_color}20`, color: product.category_color }}>
                                                    {product.category_name}
                                                </Badge>
                                            ) : '-'}
                                        </TableCell>
                                        <TableCell className="font-medium">{formatPrice(product)}</TableCell>
                                        <TableCell>{product.stock_quantity}</TableCell>
                                        <TableCell><StatusBadge status={getStockStatus(product)} /></TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => { setEditingProduct(product); setShowProductModal(true); }}
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title={t('products.printLabels')}
                                                    onClick={() => navigate(`/labels?tab=articles&product=${product.id}`)}
                                                >
                                                    <QrCode className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDeleteProduct(product)}
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

                {/* Product Modal */}
                <ProductFormModal
                    isOpen={showProductModal}
                    onClose={() => setShowProductModal(false)}
                    product={editingProduct}
                    categories={categories}
                    initialValues={initialValues}
                    onCategoriesChanged={loadData}
                    onSave={() => { loadData(); setShowProductModal(false); }}
                />


                {/* Excel Import Modal */}
                <ExcelImport
                    isOpen={showExcelImport}
                    onClose={() => setShowExcelImport(false)}
                    dataType="products"
                    onImport={handleExcelImport}
                    title={t('products.importTitle')}
                />
            </div>
        </>
    );
}
