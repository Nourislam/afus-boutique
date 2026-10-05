import { useEffect, useState } from 'react';
import { Shirt, Wand2, Barcode, ChevronDown, Printer, Boxes, Tag } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { Button } from '../ui/Button';
import { Input, TextArea } from '../ui/Input';
import { Select } from '../ui/Select';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { VariantEditor } from './VariantEditor';
import { CategoryManagerModal } from './CategoryManagerModal';
import { Combobox } from '../ui/Combobox';
import { QrPreview } from './QrPreview';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { t } from '../../i18n';
import { translateErrorLines } from '../../i18n/errors';
import { GENDERS, SEASONS, genderLabel, seasonLabel, sizeSetForCategory } from '../../lib/clothing';
import { printArticleLabels, labelResultMessages } from '../../lib/labels';
import { ProductImages, MAX_IMAGES } from './ProductImages';
import { useTaxEnabled } from '../../lib/useTaxEnabled';

const EMPTY_PRODUCT = {
    name: '',
    sku: '',
    barcode: '',
    description: '',
    category_id: '',
    supplier_id: '',
    brand: '',
    gender: '',
    season: '',
    collection: '',
    price: '',
    cost: '',
    stock_quantity: '0',
    min_stock_level: '5',
    tax_rate: '0',
    is_active: true,
    image_path: '',
    gallery: [],
};


function parseGallery(product) {
    try {
        const list = product?.gallery ? JSON.parse(product.gallery) : [];
        return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch {
        return [];
    }
}

function toRow(v) {
    return {
        key: v.id,
        id: v.id,
        isNew: false,
        color: v.color || '',
        color_code: v.color_code || null,
        size: v.size || '',
        sku: v.sku || '',
        savedSku: v.sku || '',
        qr_code: v.qr_code || '',
        barcode: v.barcode || '',
        price: v.price ?? '',
        cost: v.cost ?? '',
        stock_quantity: v.stock_quantity ?? 0,
        min_stock_level: v.min_stock_level ?? 0,
        is_active: !!v.is_active,
    };
}

/**
 * Create / edit a product. Clothing products can have colour × size variants,
 * each with its own SKU (encoded in its QR label), stock, price and cost.
 * Simple products without variants work exactly as before.
 */
export function ProductFormModal({ isOpen, onClose, product, categories, onSave, initialValues, onCategoriesChanged }) {
    const [formData, setFormData] = useState(EMPTY_PRODUCT);
    const [variants, setVariants] = useState([]);
    // Colours and sizes, each on or off (products.has_colors / has_sizes);
    // both off = a simple article with one stock quantity
    const [colorsOn, setColorsOn] = useState(true);
    const [sizesOn, setSizesOn] = useState(true);
    const hasVariants = colorsOn || sizesOn;
    const [suppliers, setSuppliers] = useState([]);
    const suppliersOn = useSettingsStore(state => state.settings.features?.suppliers !== false);
    const taxOn = useTaxEnabled();
    const [brands, setBrands] = useState([]);
    const [loading, setLoading] = useState(false);
    // Print the labels right after saving (remembered on this computer)
    const [printAfter, setPrintAfter] = useState(() => { try { return localStorage.getItem('product.printAfter') === '1'; } catch { return false; } });
    const [labelQty, setLabelQty] = useState('');
    const togglePrintAfter = (value) => {
        setPrintAfter(value);
        try { localStorage.setItem('product.printAfter', value ? '1' : '0'); } catch { /* per-viewer convenience */ }
    };
    const [loadingVariants, setLoadingVariants] = useState(false);
    const [labelScope, setLabelScope] = useState('variant');
    // A new colour/size editor each time the form opens: nothing is carried over from the last article
    const [formKey, setFormKey] = useState(0);
    const [errors, setErrors] = useState([]);
    const [showMore, setShowMore] = useState(false);
    const [showCategories, setShowCategories] = useState(false);
    const { currentEmployee } = useAuthStore();

    useEffect(() => {
        if (!isOpen) return;
        setErrors([]);
        setFormKey(k => k + 1);
        window.electronAPI.suppliers.getAll().then(setSuppliers).catch(() => setSuppliers([]));
        window.electronAPI.brands.getAll().then(list => setBrands(list.filter(b => b.is_active))).catch(() => setBrands([]));

        if (product) {
            setFormData({
                ...EMPTY_PRODUCT,
                name: product.name,
                sku: product.sku || '',
                barcode: product.barcode || '',
                description: product.description || '',
                category_id: product.category_id || '',
                supplier_id: product.supplier_id || '',
                brand: product.brand || '',
                gender: product.gender || '',
                season: product.season || '',
                collection: product.collection || '',
                price: (product.price ?? 0).toString(),
                cost: (product.cost ?? 0).toString(),
                stock_quantity: (product.stock_quantity ?? 0).toString(),
                min_stock_level: (product.min_stock_level ?? 5).toString(),
                tax_rate: (product.tax_rate ?? 0).toString(),
                is_active: product.is_active ?? true,
                image_path: product.image_path || '',
                gallery: parseGallery(product),
            });
            // Saved switches; articles saved before them follow has_variants
            const flag = (value) => (value === null || value === undefined ? !!product.has_variants : !!value);
            setColorsOn(flag(product.has_colors));
            setSizesOn(flag(product.has_sizes));
            setVariants([]);
            if (product.has_variants) {
                setLoadingVariants(true);
                window.electronAPI.catalog.getVariants(product.id, true)
                    .then(rows => setVariants(rows.map(toRow)))
                    .catch(() => toast.error(t('products.loadVariantsFailed')))
                    .finally(() => setLoadingVariants(false));
            }
        } else {
            setFormData({ ...EMPTY_PRODUCT, ...(initialValues || {}) });
            // A scanned barcode is usually one simple article
            setColorsOn(!initialValues?.barcode);
            setSizesOn(!initialValues?.barcode);
            setVariants([]);
        }
    }, [product, isOpen]);

    const set = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

    // Photos: the first is image_path, the next two are the gallery
    const images = [formData.image_path, ...(formData.gallery || [])].filter(Boolean).slice(0, MAX_IMAGES);
    const setImages = (list) => setFormData(prev => ({ ...prev, image_path: list[0] || '', gallery: list.slice(1) }));

    // The label look (one code per piece or per article) decides how many labels print
    useEffect(() => {
        if (!isOpen || !printAfter) return;
        window.electronAPI.labels.getSettings().then(l => setLabelScope(l?.codeScope === 'article' ? 'article' : 'variant')).catch(() => { });
    }, [isOpen, printAfter]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrors([]);

        if (!formData.name.trim() || formData.price === '') {
            toast.error(t('products.namePriceRequired'));
            return;
        }
        // Colours and sizes are optional and independent: with none chosen the
        // article is saved as a simple article with one stock quantity
        const useVariants = hasVariants && variants.some(v => v.is_active);

        setLoading(true);
        try {
            // Pieces whose SKU is not generated yet get one now
            let rows = variants;
            const missing = useVariants ? rows.filter(v => v.is_active && !String(v.sku || '').trim()) : [];
            if (missing.length) {
                const skus = await window.electronAPI.catalog.generateSkus(
                    { name: formData.name, sku: formData.sku },
                    missing.map(v => ({ id: v.id || null, color: v.color, color_code: v.color_code, size: v.size })),
                    rows.map(v => String(v.sku || '').trim().toUpperCase()).filter(Boolean));
                const byKey = new Map(missing.map((v, i) => [v.key, skus[i]]));
                rows = rows.map(v => (byKey.has(v.key) ? { ...v, sku: byKey.get(v.key) } : v));
                setVariants(rows);
            }
            const data = {
                ...formData,
                id: product?.id || uuid(),
                name: formData.name.trim(),
                price: parseFloat(formData.price),
                cost: formData.cost ? parseFloat(formData.cost) : 0,
                stock_quantity: parseInt(formData.stock_quantity, 10) || 0,
                min_stock_level: parseInt(formData.min_stock_level, 10) || 0,
                tax_rate: parseFloat(formData.tax_rate) || 0,
                category_id: formData.category_id || null,
                supplier_id: formData.supplier_id || null,
                image_path: images[0] || null,
                gallery: images.slice(1),
                // On only when the article really uses them (a switch on with nothing chosen is off)
                has_colors: useVariants && colorsOn && rows.some(v => v.is_active && String(v.color || '').trim() !== ''),
                has_sizes: useVariants && sizesOn && rows.some(v => v.is_active && String(v.size || '').trim() !== ''),
                sku: formData.sku.trim() || null,
                barcode: formData.barcode.trim() || null,
            };
            const variantPayload = useVariants
                ? rows.map(v => ({
                    id: v.isNew ? null : v.id,
                    color: v.color,
                    color_code: v.color_code || null,
                    size: v.size,
                    sku: v.sku,
                    qr_code: v.isNew ? null : v.qr_code,
                    barcode: v.barcode,
                    price: v.price,
                    cost: v.cost,
                    stock_quantity: v.stock_quantity,
                    min_stock_level: v.min_stock_level,
                    is_active: v.is_active,
                }))
                : [];

            // A brand typed for the first time is added to the brands list
            if (data.brand && !brands.some(b => b.name.toLowerCase() === data.brand.trim().toLowerCase())) {
                await window.electronAPI.brands.create({ name: data.brand }).catch(() => { });
            }
            await window.electronAPI.catalog.saveProduct({
                product: data,
                variants: variantPayload,
                employeeId: currentEmployee?.id || null,
                isNew: !product,
            });
            toast.success(product ? t('products.updated') : t('products.created'));
            if (printAfter) {
                // With the look saved in Settings; missing barcodes are created now
                try {
                    const result = await printArticleLabels(data.id, labelQty);
                    labelResultMessages(result).forEach(msg => toast.success(msg));
                    if (result.issues?.length) toast.warning(t('printing.issuesAfterPrint'), 8000);
                } catch (printError) {
                    toast.error(t('barcode.printFailed', { error: translateErrorLines(printError).join(' ') }));
                }
            }
            onSave();
        } catch (error) {
            setErrors(translateErrorLines(error));
            toast.error(t('products.saveFailed'));
        } finally {
            setLoading(false);
        }
    };

    const generateSimpleSku = async () => {
        if (!formData.name.trim()) return toast.error(t('variants.nameFirst'));
        try {
            const [sku] = await window.electronAPI.catalog.generateSkus({ name: formData.name, sku: '' }, [{ id: null }], []);
            set('sku', sku);
        } catch (error) {
            toast.error(translateErrorLines(error).join(' '));
        }
        return undefined;
    };

    const generateSimpleBarcode = async () => {
        try {
            const [code] = await window.electronAPI.catalog.generateBarcodes(1, []);
            set('barcode', code);
        } catch (error) {
            toast.error(translateErrorLines(error).join(' '));
        }
    };

    const createBrand = async (name) => {
        try {
            await window.electronAPI.brands.create({ name });
            setBrands(await window.electronAPI.brands.getAll().then(list => list.filter(b => b.is_active)));
        } catch { /* already exists */ }
        return name.trim();
    };

    // What the form shows from the colour/size grid, and how many labels will print
    const activeRows = hasVariants ? variants.filter(v => v.is_active) : [];
    const useVariants = activeRows.length > 0;
    const activeCount = activeRows.length;
    const variantStock = activeRows.reduce((sum, v) => sum + (parseInt(v.stock_quantity, 10) || 0), 0);
    const perArticleLabels = labelScope === 'article' || !useVariants;
    const fixedLabels = parseInt(labelQty, 10) > 0 ? parseInt(labelQty, 10) : null;
    // Same rule as printArticleLabels: one label per piece in stock (at least one), or a fixed number
    const labelCount = perArticleLabels
        ? (fixedLabels || Math.max(1, useVariants ? variantStock : parseInt(formData.stock_quantity, 10) || 0))
        : activeRows.reduce((sum, v) => sum + (fixedLabels || Math.max(1, parseInt(v.stock_quantity, 10) || 0)), 0);

    const brandOptions = brands.map(b => ({ value: b.name, label: b.name }));
    if (formData.brand && !brandOptions.some(o => o.value === formData.brand)) brandOptions.unshift({ value: formData.brand, label: formData.brand });

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={product ? t('products.edit') : t('products.add')} size="xl" closeOnOverlay={false}>
            <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
                <ModalBody className="space-y-4">
                    {/* 1. The essentials: photos, name, prices */}
                    <section className="grid gap-5 sm:grid-cols-[150px_1fr] items-start">
                        <ProductImages images={images} onChange={setImages} />
                        <div className="min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                            <Input label={t('products.name')} value={formData.name} onChange={(e) => set('name', e.target.value)}
                                placeholder={t('products.namePlaceholder')} containerClassName="sm:col-span-2" autoFocus={!product} />
                            <Input label={t('products.sellPrice')} type="number" min="0" step="1" value={formData.price}
                                onChange={(e) => set('price', e.target.value)} placeholder="0" className="tabular" />
                            <Input label={t('products.costLabel')} type="number" min="0" step="1" value={formData.cost}
                                onChange={(e) => set('cost', e.target.value)} placeholder={t('common.optional')} className="tabular" />
                            <div className="form-group">
                                <label className="form-label flex items-center justify-between">
                                    {t('products.category')}
                                    <button type="button" onClick={() => setShowCategories(true)} className="text-xs text-indigo-300 hover:text-indigo-200">{t('products.manageCategoriesShort')}</button>
                                </label>
                                <Select value={formData.category_id} onChange={(v) => set('category_id', v)}
                                    options={[{ value: '', label: t('categories.none') }, ...categories.map(c => ({ value: c.id, label: c.name }))]} />
                            </div>
                            <Combobox
                                label={t('products.brand')}
                                value={formData.brand}
                                onChange={(v) => set('brand', v)}
                                options={brandOptions}
                                placeholder={t('brands.pick')}
                                createLabel={t('brands.addNew')}
                                onCreate={createBrand}
                                emptyText={t('common.noResults')}
                            />
                            <p className="sm:col-span-2 form-hint">{t('products.requiredHint')}</p>
                        </div>
                    </section>

                    {/* 2. Colours and sizes (both optional, one without the other) */}
                    <section className="rounded-xl border border-dark-border">
                        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-dark-border">
                            <Shirt className="w-4 h-4 text-indigo-300 flex-none" />
                            <div className="flex-1 min-w-[12rem]">
                                <h3 className="font-medium leading-tight">{t('products.colorsSizes')}</h3>
                                <p className="text-xs text-zinc-500">{t('products.colorsSizesHint')}</p>
                            </div>
                        </div>
                        <div className="p-4">
                            {product && !product.has_variants && useVariants && (
                                <p className="text-xs text-amber-300 mb-3">{t('products.stockReplaced', { n: product.stock_quantity })}</p>
                            )}
                            {loadingVariants ? (
                                <div className="text-sm text-zinc-500">{t('products.loadingVariants')}</div>
                            ) : (
                                <VariantEditor
                                    key={formKey}
                                    suggestedSizeSet={sizeSetForCategory(categories.find(c => c.id === formData.category_id)?.name)}
                                    product={{ name: formData.name, sku: formData.sku, price: formData.price, cost: formData.cost }}
                                    variants={variants}
                                    onChange={setVariants}
                                    hideEmptyHint
                                    colorsOn={colorsOn}
                                    sizesOn={sizesOn}
                                    onColorsOnChange={setColorsOn}
                                    onSizesOnChange={setSizesOn}
                                />
                            )}
                        </div>
                        {!hasVariants && product?.has_variants ? (
                            <p className="px-4 py-3 text-xs text-amber-300">{t('products.variantsOffWarning')}</p>
                        ) : null}
                    </section>

                    {/* 3. Stock, codes and labels */}
                    <section className={`rounded-xl border ${printAfter ? 'border-indigo-500/40' : 'border-dark-border'}`}>
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-border">
                            <Boxes className="w-4 h-4 text-indigo-300 flex-none" />
                            <div className="flex-1 min-w-0">
                                <h3 className="font-medium leading-tight">{t('products.stockAndCodes')}</h3>
                                <p className="text-xs text-zinc-500">{useVariants ? t('products.stockFromGrid', { n: activeCount, stock: variantStock }) : t('products.stockSimpleHint')}</p>
                            </div>
                        </div>
                        <div className="p-4 space-y-4">
                            {!useVariants ? (
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                                    <Input label={t('products.stock')} type="number" min="0" value={formData.stock_quantity} onChange={(e) => set('stock_quantity', e.target.value)} className="tabular" />
                                    <Input label={t('products.minStock')} type="number" min="0" value={formData.min_stock_level} onChange={(e) => set('min_stock_level', e.target.value)} className="tabular" />
                                    <div className="form-group">
                                        <label className="form-label">{t('products.skuLabel')}</label>
                                        <div className="flex gap-1.5">
                                            <input className="input font-mono uppercase ltr min-w-0" value={formData.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder={t('products.skuHint')} data-scan-passthrough />
                                            <Button type="button" variant="secondary" size="icon" onClick={generateSimpleSku} title={t('variants.regenerateSkus')} aria-label={t('variants.regenerateSkus')}><Wand2 className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t('products.barcode')}</label>
                                        <div className="flex gap-1.5">
                                            <input className="input font-mono ltr min-w-0" value={formData.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder={t('products.barcodeHint')} data-scan-passthrough />
                                            <Button type="button" variant="secondary" size="icon" onClick={generateSimpleBarcode} title={t('variants.generateBarcodes')} aria-label={t('variants.generateBarcodes')}><Barcode className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                    {(formData.sku || formData.barcode) && (
                                        <div className="col-span-2 lg:col-span-4 flex items-center gap-3 text-xs text-zinc-500">
                                            <QrPreview value={(formData.sku || formData.barcode).trim().toUpperCase()} size={56} />
                                            {t('products.qrContent')} <span className="font-mono ltr">{(formData.sku || formData.barcode).trim().toUpperCase()}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                                    <Input label={t('products.skuPrefixLabel')} value={formData.sku} className="font-mono uppercase ltr"
                                        onChange={(e) => set('sku', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="TSH" />
                                    <p className="form-hint pb-2">{t('products.skuPrefixHint')}</p>
                                </div>
                            )}

                            {/* Labels printed straight after saving */}
                            <div className={`rounded-lg ${printAfter ? 'bg-indigo-500/5 border border-indigo-500/30 p-3 space-y-3' : ''}`}>
                                <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                                    <input type="checkbox" checked={printAfter} onChange={(e) => togglePrintAfter(e.target.checked)} className="w-4 h-4 rounded" />
                                    <Printer className="w-4 h-4 text-zinc-400" />
                                    <span className="font-medium">{t('products.printLabelsAfterSave')}</span>
                                </label>
                                {printAfter && (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {[
                                                { id: 'stock', title: t('products.labelsPerStock'), hint: t('products.labelsPerStockHint') },
                                                { id: 'fixed', title: t('products.labelsFixed'), hint: t(perArticleLabels ? 'products.labelsFixedArticleHint' : 'products.labelsFixedHint') },
                                            ].map(opt => {
                                                const on = (opt.id === 'fixed') === (labelQty !== '');
                                                return (
                                                    <button key={opt.id} type="button" aria-pressed={on}
                                                        onClick={() => setLabelQty(opt.id === 'fixed' ? (labelQty || '1') : '')}
                                                        className={`p-3 rounded-lg border text-start transition-colors ${on ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-600'}`}>
                                                        <p className="text-sm font-medium">{opt.title}</p>
                                                        <p className="text-xs text-zinc-500 mt-0.5">{opt.hint}</p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            {labelQty !== '' && (
                                                <label className="flex items-center gap-2 text-sm">
                                                    <span className="text-zinc-400">{t('products.labelQty')}</span>
                                                    <input type="number" min="1" max="1000" value={labelQty} onChange={(e) => setLabelQty(e.target.value.replace(/[^0-9]/g, '') || '1')}
                                                        className="input input-sm w-20 tabular" aria-label={t('products.labelQty')} />
                                                </label>
                                            )}
                                            <span className="flex items-center gap-1.5 text-sm text-indigo-200">
                                                <Tag className="w-4 h-4" /> {t('products.labelsWillPrint', { n: labelCount })}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* 4. Optional details */}
                    <section className="rounded-xl border border-dark-border">
                        <button type="button" onClick={() => setShowMore(!showMore)} className="w-full flex items-center justify-between px-4 h-12" aria-expanded={showMore}>
                            <span className="font-medium">{t('products.moreDetails')}</span>
                            <span className="flex items-center gap-2 text-xs text-zinc-500">
                                {t(taxOn ? 'products.moreDetailsHintTax' : 'products.moreDetailsHintNoTax')}
                                <ChevronDown className={`w-4 h-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
                            </span>
                        </button>
                        {showMore && (
                            <div className="border-t border-dark-border p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {suppliersOn && (
                                    <Select label={t('products.supplier')} value={formData.supplier_id} onChange={(v) => set('supplier_id', v)}
                                        options={[{ value: '', label: t('products.noSupplier') }, ...suppliers.map(sp => ({ value: sp.id, label: sp.name }))]} />
                                )}
                                {taxOn && (
                                    <Input label={t('products.taxRate')} type="number" min="0" step="0.1" value={formData.tax_rate}
                                        onChange={(e) => set('tax_rate', e.target.value)} />
                                )}
                                <Select label={t('products.gender')} value={formData.gender} onChange={(v) => set('gender', v)}
                                    options={[{ value: '', label: '—' }, ...GENDERS.map(g => ({ value: g.code, label: genderLabel(g.code) }))]} />
                                <Select label={t('products.season')} value={formData.season} onChange={(v) => set('season', v)}
                                    options={[
                                        { value: '', label: '—' },
                                        ...SEASONS.map(x => ({ value: x.code, label: seasonLabel(x.code) })),
                                        // Free text typed in an older version stays selectable
                                        ...(formData.season && !SEASONS.some(x => x.code === formData.season) ? [{ value: formData.season, label: formData.season }] : []),
                                    ]} />
                                <Input label={t('products.collection')} value={formData.collection} onChange={(e) => set('collection', e.target.value)}
                                    placeholder={t('products.collectionPlaceholder')} />
                                {/* Off: the article leaves the lists and the sales screen (like a deleted one) */}
                                <label className="sm:col-span-3 flex items-start gap-3 cursor-pointer select-none rounded-lg border border-dark-border px-3 py-2.5 hover:border-zinc-600">
                                    <input type="checkbox" checked={!!formData.is_active} onChange={(e) => set('is_active', e.target.checked)} className="mt-0.5 w-4 h-4 rounded flex-none" />
                                    <span className="min-w-0">
                                        <span className="block text-sm">{t('products.availableForSale')}</span>
                                        <span className={`block text-xs ${formData.is_active ? 'text-zinc-500' : 'text-amber-400'}`}>{t('products.availableForSaleHint')}</span>
                                    </span>
                                </label>
                                <div className="sm:col-span-3">
                                    <TextArea label={t('products.description')} value={formData.description} onChange={(e) => set('description', e.target.value)} className="min-h-[60px]" />
                                </div>
                            </div>
                        )}
                    </section>

                    {errors.length > 0 && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 space-y-1">
                            {errors.map((err, i) => <div key={i}>{err}</div>)}
                        </div>
                    )}
                </ModalBody>
                <ModalFooter>
                    <div className="flex-1" />
                    <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                    <Button type="submit" loading={loading}>
                        {printAfter ? <Printer className="w-4 h-4" /> : null}
                        {printAfter ? t('products.saveAndPrint') : (product ? t('products.update') : t('products.add'))}
                    </Button>
                </ModalFooter>
            </form>
            <CategoryManagerModal
                isOpen={showCategories}
                onClose={() => setShowCategories(false)}
                categories={categories}
                onSave={() => onCategoriesChanged?.()}
            />
        </Modal>
    );
}

export default ProductFormModal;
