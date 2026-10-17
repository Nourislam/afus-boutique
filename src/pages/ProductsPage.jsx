import { t } from '../i18n';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import ProductMatrixModal from '../components/products/ProductMatrixModal';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, Package, Grid, List, FileSpreadsheet, QrCode, Tag, X, Grid3x3 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeader, EmptyState } from '../components/ui/Table';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { toast } from '../components/ui/Toast';
import { PermissionGate } from '../components/auth/PermissionGate';
import { PERMISSIONS } from '../stores/authStore';
import { ExcelImport } from '../components/ui/ExcelImport';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { translateError } from '../i18n/errors';


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
    // Colours x sizes of one article (stock, sold, buying plan)
    const [matrixOf, setMatrixOf] = useState(null);
    const [editingProduct, setEditingProduct] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showExcelImport, setShowExcelImport] = useState(false);
    const [importReport, setImportReport] = useState(null);
    const [initialValues, setInitialValues] = useState(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    // Articles without a purchase price (?filter=noCost, from the home screen's "complete the prices")
    const noCostOnly = readFilter(searchParams, 'filter', ['noCost'], '') === 'noCost';
    const [variantsByProduct, setVariantsByProduct] = useState(null);
    // On the website or not (shown only while the website module is on)
    const websiteOn = useSettingsStore(state => state.settings.features?.website !== false);
    const [webFilter, setWebFilter] = useState('all');
    const onWebsite = (product) => product.show_on_website === undefined || product.show_on_website === null || !!product.show_on_website;
    const setNoCostOnly = (on) => {
        const next = new URLSearchParams(searchParams);
        if (on) next.set('filter', 'noCost'); else next.delete('filter');
        setSearchParams(next, { replace: true });
    };
    // The colours/sizes have their own purchase price: loaded only while this filter is on
    useEffect(() => {
        if (!noCostOnly) return undefined;
        let cancelled = false;
        window.electronAPI.catalog.searchVariants('').then(rows => {
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
        const matchesWeb = !websiteOn || webFilter === 'all' || (webFilter === 'shown') === onWebsite(product);
        return matchesCategory && matchesSearch && matchesCost && matchesWeb;
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

    // One row per size/colour: rows with the same name become one article with
    // its variants (main process). Rows not imported are listed with the reason.
    const handleExcelImport = async (records, validation) => {
        const rows = records.map(({ __row, ...record }) => ({ ...record, row: __row }));
        const report = await window.electronAPI.excel.importProducts(rows);
        const refused = [
            ...(validation?.errors || []).map(e => ({ rows: [e.row], name: e.data?.name || '', reason: e.errors.join('\n') })),
            ...report.rejected,
        ];
        toast.success(t('import.done', { n: report.imported.length, pieces: report.imported.reduce((s, x) => s + (x.pieces || 0), 0) }));
        if (refused.length) setImportReport({ imported: report.imported, rejected: refused });
        loadData();
        return { reported: true };
    };

    return (
        <>
            <div className="page">
                <PageHeader
                    icon={Package}
                    title={t('products.title')}
                    subtitle={t('products.count', { n: products.length })}
                    actions={(
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
                    )}
                >
                    <div className="flex flex-wrap items-center gap-3">
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder={t('products.search')}
                            className="flex-1 min-w-[240px] max-w-md"
                        />
                        <Select
                            value={selectedCategory}
                            onChange={setSelectedCategory}
                            options={[
                                { value: 'all', label: t('products.allCategories') },
                                ...categories.map(c => ({ value: c.id, label: c.name }))
                            ]}
                            className="w-56"
                        />
                        {websiteOn && (
                            <Select
                                value={webFilter}
                                onChange={setWebFilter}
                                options={[
                                    { value: 'all', label: `${t('products.filterWebsite')}: ${t('products.filterWebsiteAll')}` },
                                    { value: 'shown', label: t('products.filterWebsiteShown') },
                                    { value: 'hidden', label: t('products.filterWebsiteHidden') },
                                ]}
                                className="w-44"
                                data-testid="filter-website"
                            />
                        )}
                        <button type="button" onClick={() => setNoCostOnly(!noCostOnly)} aria-pressed={noCostOnly} data-testid="filter-no-cost"
                            className={`h-10 px-3 rounded-lg border text-sm inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${noCostOnly ? 'border-amber-500/50 bg-amber-500/15 text-amber-200' : 'border-dark-border text-zinc-400 hover:text-white'}`}>
                            <Tag className="w-4 h-4" /> {t('products.filterNoCost')}
                            {noCostOnly && <X className="w-3.5 h-3.5" aria-label={t('common.clear')} />}
                        </button>
                        <div className="flex items-center gap-1 bg-dark-tertiary rounded-lg p-1">
                            <button
                                type="button"
                                onClick={() => setViewMode('grid')}
                                title={t('pos.viewGrid')}
                                aria-label={t('pos.viewGrid')}
                                aria-pressed={viewMode === 'grid'}
                                className={`p-2 rounded ${viewMode === 'grid' ? 'bg-accent-primary' : 'hover:bg-zinc-700'}`}
                            >
                                <Grid className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('list')}
                                title={t('pos.viewList')}
                                aria-label={t('pos.viewList')}
                                aria-pressed={viewMode === 'list'}
                                className={`p-2 rounded ${viewMode === 'list' ? 'bg-accent-primary' : 'hover:bg-zinc-700'}`}
                            >
                                <List className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </PageHeader>

                {/* Content */}
                <div className="page-body">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <EmptyState
                            icon={Package}
                            title={t('products.notFound')}
                            description={searchQuery ? t('products.tryOther') : t('products.addFirst')}
                            action={products.length === 0 && !searchQuery && (
                                <Button onClick={() => { setEditingProduct(null); setShowProductModal(true); }}>
                                    <Plus className="w-4 h-4" />
                                    {t('products.add')}
                                </Button>
                            )}
                        />
                    ) : viewMode === 'grid' ? (
                        <div className="grid fit-grid-sm gap-4">
                            {filteredProducts.map(product => (
                                <div key={product.id} className="card flex flex-col min-w-0">
                                    <div className="aspect-square bg-dark-tertiary rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                                        {product.image_path ? (
                                            <img src={`app://${product.image_path}`} alt={product.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <Package className="w-12 h-12 text-zinc-600" />
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <h3 dir="auto" className="font-medium leading-snug line-clamp-2 break-words" title={product.name}>{product.name}</h3>
                                        {websiteOn && !onWebsite(product) && <Badge className="bg-zinc-500/15 text-zinc-400" data-testid="badge-not-on-website">{t('products.hiddenOnWebsite')}</Badge>}
                                        <p className="text-xs text-zinc-500 leading-snug">
                                            {product.variant_count > 0 ? t('products.variantsInStock', { n: product.variant_count, stock: product.stock_quantity }) : (product.sku || t('products.noSku'))}
                                        </p>
                                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                            <p className="font-semibold text-accent-primary whitespace-nowrap">{formatPrice(product)}</p>
                                            <StatusBadge status={getStockStatus(product)} />
                                        </div>
                                    </div>
                                    {/* Always shown (no buttons that appear only on hover): edit on its
                                        own line, then colours x sizes, labels and delete, never out of the card */}
                                    <div className="mt-auto pt-3 space-y-1.5">
                                        <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="w-full"
                                                onClick={() => { setEditingProduct(product); setShowProductModal(true); }}
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                                {t('common.edit')}
                                            </Button>
                                        </PermissionGate>
                                        <div className="grid grid-cols-3 gap-1.5">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="justify-center"
                                                title={t('dash.do.matrix')}
                                                aria-label={t('dash.do.matrix')}
                                                data-testid="product-matrix"
                                                onClick={() => setMatrixOf(product.id)}
                                            >
                                                <Grid3x3 className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="justify-center"
                                                title={t('products.printLabels')}
                                                aria-label={t('products.printLabels')}
                                                onClick={() => navigate(`/labels?tab=articles&product=${product.id}`)}
                                            >
                                                <QrCode className="w-4 h-4" />
                                            </Button>
                                            <PermissionGate permission={PERMISSIONS.PRODUCTS_DELETE}>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="justify-center"
                                                    title={t('common.delete')}
                                                    aria-label={t('common.delete')}
                                                    onClick={() => handleDeleteProduct(product)}
                                                >
                                                    <Trash2 className="w-4 h-4 text-red-400" />
                                                </Button>
                                            </PermissionGate>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableHeader>{t('products.product')}</TableHeader>
                                    <TableHeader className="hidden xl:table-cell">{t('products.colSku')}</TableHeader>
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
                                                <span className="min-w-0">
                                                    <span dir="auto" className="block font-medium break-words">{product.name}</span>
                                                    {product.variant_count > 0 && <span className="text-xs text-zinc-500">{t('products.variantCount', { n: product.variant_count })}</span>}
                                                    {websiteOn && !onWebsite(product) && <span className="block text-xs text-zinc-500">{t('products.hiddenOnWebsite')}</span>}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="hidden xl:table-cell text-zinc-400 font-mono text-xs whitespace-nowrap">{product.sku || '—'}</TableCell>
                                        <TableCell>
                                            {product.category_name ? (
                                                <Badge style={{ backgroundColor: `${product.category_color}20`, color: product.category_color }}>
                                                    {product.category_name}
                                                </Badge>
                                            ) : '-'}
                                        </TableCell>
                                        <TableCell className="font-medium whitespace-nowrap">{formatPrice(product)}</TableCell>
                                        <TableCell>{product.stock_quantity}</TableCell>
                                        <TableCell><StatusBadge status={getStockStatus(product)} /></TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1 flex-nowrap">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title={t('common.edit')}
                                                    aria-label={t('common.edit')}
                                                    onClick={() => { setEditingProduct(product); setShowProductModal(true); }}
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    title={t('dash.do.matrix')}
                                                    aria-label={t('dash.do.matrix')}
                                                    data-testid="product-matrix"
                                                    onClick={() => setMatrixOf(product.id)}
                                                >
                                                    <Grid3x3 className="w-3 h-3" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title={t('products.printLabels')}
                                                    aria-label={t('products.printLabels')}
                                                    onClick={() => navigate(`/labels?tab=articles&product=${product.id}`)}
                                                >
                                                    <QrCode className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title={t('common.delete')}
                                                    aria-label={t('common.delete')}
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
                <Modal isOpen={!!importReport} onClose={() => setImportReport(null)} title={t('import.reportTitle')} size="lg">
                    <ModalBody>
                        <div className="space-y-3" data-testid="import-report">
                            <p className="text-sm">{t('import.reportText', { ok: importReport?.imported.length || 0, bad: importReport?.rejected.length || 0 })}</p>
                            <ul className="divide-y divide-dark-border text-sm max-h-80 overflow-y-auto">
                                {(importReport?.rejected || []).map((r, i) => (
                                    <li key={i} className="py-2">
                                        <span className="font-medium">{t('import.rows', { rows: r.rows.join(', ') })}{r.name ? ` · ${r.name}` : ''}</span>
                                        <span className="block text-red-300 whitespace-pre-line">{translateError(r.reason)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </ModalBody>
                    <ModalFooter><Button onClick={() => setImportReport(null)}>{t('common.close')}</Button></ModalFooter>
                </Modal>
                <ExcelImport
                    isOpen={showExcelImport}
                    onClose={() => setShowExcelImport(false)}
                    dataType="products"
                    onImport={handleExcelImport}
                    title={t('products.importTitle')}
                />
                <ProductMatrixModal productId={matrixOf} isOpen={!!matrixOf} onClose={() => { setMatrixOf(null); loadData(); }} />
            </div>
        </>
    );
}
