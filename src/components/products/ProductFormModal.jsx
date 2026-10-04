import { useEffect, useState } from 'react';
import { Trash2, Shirt, ImagePlus, Wand2, Barcode, ChevronDown, Printer } from 'lucide-react';
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
import { t } from '../../i18n';
import { translateErrorLines } from '../../i18n/errors';
import { GENDERS, SEASONS, genderLabel, seasonLabel, sizeSetForCategory } from '../../lib/clothing';
import { printArticleLabels, labelResultMessages } from '../../lib/labels';

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
};


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
    const [hasVariants, setHasVariants] = useState(false);
    const [variants, setVariants] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
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
    const [imagePreview, setImagePreview] = useState(null);
    const [errors, setErrors] = useState([]);
    const [showMore, setShowMore] = useState(false);
    const [showCategories, setShowCategories] = useState(false);
    const { currentEmployee } = useAuthStore();

    useEffect(() => {
        if (!isOpen) return;
        setErrors([]);
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
            });
            setHasVariants(!!product.has_variants);
            setVariants([]);
            if (product.has_variants) {
                setLoadingVariants(true);
                window.electronAPI.catalog.getVariants(product.id, true)
                    .then(rows => setVariants(rows.map(toRow)))
                    .catch(() => toast.error(t('products.loadVariantsFailed')))
                    .finally(() => setLoadingVariants(false));
            }
            if (product.image_path) {
                window.electronAPI.images.get(product.image_path).then(b64 => setImagePreview(b64 || null));
            } else {
                setImagePreview(null);
            }
        } else {
            setFormData({ ...EMPTY_PRODUCT, ...(initialValues || {}) });
            setHasVariants(!initialValues?.barcode);
            setVariants([]);
            setImagePreview(null);
        }
    }, [product, isOpen]);

    const set = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

    const handleImageSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64Data = event.target.result;
            setImagePreview(base64Data);
            try {
                const result = await window.electronAPI.images.save({ base64Data, originalName: file.name });
                if (result.success) set('image_path', result.fileName);
            } catch (error) {
                console.error('Failed to save image:', error);
                toast.error(t('products.imageSaveFailed'));
            }
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveImage = () => {
        // The file is kept on disk: other products may still use it
        setImagePreview(null);
        set('image_path', '');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrors([]);

        if (!formData.name.trim() || formData.price === '') {
            toast.error(t('products.namePriceRequired'));
            return;
        }
        const activeVariants = variants.filter(v => v.is_active);
        // Colours/sizes are optional: ticked but none added -> saved as a simple article
        const useVariants = hasVariants && variants.length > 0;
        if (useVariants && activeVariants.length === 0) {
            toast.error(t('products.needVariant'));
            return;
        }

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
                image_path: formData.image_path || null,
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

    const brandOptions = brands.map(b => ({ value: b.name, label: b.name }));
    if (formData.brand && !brandOptions.some(o => o.value === formData.brand)) brandOptions.unshift({ value: formData.brand, label: formData.brand });

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={product ? t('products.edit') : t('products.add')} size="xl" closeOnOverlay={false}>
            <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
                <ModalBody className="space-y-6">
                    {/* Essentials */}
                    <section className="flex gap-5 items-start">
                        <div className="w-32 flex-none">
                            <div className="aspect-[4/5] bg-dark-primary rounded-xl flex flex-col items-center justify-center overflow-hidden relative border border-dashed border-zinc-700 hover:border-zinc-500 transition-colors">
                                {imagePreview ? (
                                    <>
                                        <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                                        <button type="button" onClick={handleRemoveImage} className="absolute top-1.5 end-1.5 p-1 bg-black/70 rounded-full hover:bg-red-500" aria-label={t('common.delete')}>
                                            <Trash2 className="w-3.5 h-3.5 text-white" />
                                        </button>
                                    </>
                                ) : (
                                    <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center p-2 text-center">
                                        <ImagePlus className="w-7 h-7 text-zinc-500 mb-1.5" />
                                        <span className="text-xs text-zinc-400">{t('products.image')}</span>
                                        <input type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                                    </label>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-4 gap-y-3">
                            <Input label={t('products.name')} value={formData.name} onChange={(e) => set('name', e.target.value)}
                                placeholder={t('products.namePlaceholder')} containerClassName="col-span-2" autoFocus={!product} />
                            <Input label={t('products.sellPrice')} type="number" min="0" step="1" value={formData.price}
                                onChange={(e) => set('price', e.target.value)} placeholder="0" className="tabular" />
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
                            <label className="flex items-center gap-2 text-sm self-end h-10 cursor-pointer">
                                <input type="checkbox" checked={formData.is_active} onChange={(e) => set('is_active', e.target.checked)} className="w-4 h-4 rounded" />
                                {t('products.activeHint')}
                            </label>
                            <p className="col-span-2 form-hint">{t('products.requiredHint')}</p>
                        </div>
                    </section>

                    {/* Colours and sizes */}
                    <section className="rounded-xl border border-dark-border">
                        <label className="flex items-center gap-3 px-4 h-12 cursor-pointer select-none">
                            <span className={`relative w-9 h-5 rounded-full transition-colors ${hasVariants ? 'bg-indigo-500' : 'bg-zinc-700'}`}>
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${hasVariants ? 'start-[18px]' : 'start-0.5'}`} />
                            </span>
                            <input type="checkbox" checked={hasVariants} onChange={(e) => setHasVariants(e.target.checked)} className="sr-only" />
                            <Shirt className="w-4 h-4 text-indigo-300" />
                            <span className="font-medium">{t('products.hasVariants')}</span>
                        </label>
                        <div className="border-t border-dark-border p-4">
                            {product && !product.has_variants && hasVariants && (
                                <p className="text-xs text-amber-300 mb-3">{t('products.stockReplaced', { n: product.stock_quantity })}</p>
                            )}
                            {hasVariants ? (
                                loadingVariants ? (
                                    <div className="text-sm text-zinc-500">{t('products.loadingVariants')}</div>
                                ) : (
                                    <VariantEditor
                                        suggestedSizeSet={sizeSetForCategory(categories.find(c => c.id === formData.category_id)?.name)}
                                        product={{ name: formData.name, sku: formData.sku, price: formData.price, cost: formData.cost }}
                                        variants={variants}
                                        onChange={setVariants}
                                    />
                                )
                            ) : (
                                <div className="grid grid-cols-4 gap-4 items-end">
                                    <Input label={t('products.stock')} type="number" min="0" value={formData.stock_quantity} onChange={(e) => set('stock_quantity', e.target.value)} />
                                    <Input label={t('products.minStock')} type="number" min="0" value={formData.min_stock_level} onChange={(e) => set('min_stock_level', e.target.value)} />
                                    <div className="form-group">
                                        <label className="form-label">{t('products.colSku')}</label>
                                        <div className="flex gap-1.5">
                                            <input className="input font-mono uppercase ltr" value={formData.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder={t('products.skuHint')} data-scan-passthrough />
                                            <Button type="button" variant="secondary" size="icon" onClick={generateSimpleSku} title={t('variants.regenerateSkus')}><Wand2 className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t('products.barcode')}</label>
                                        <div className="flex gap-1.5">
                                            <input className="input font-mono ltr" value={formData.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder={t('products.barcodeHint')} data-scan-passthrough />
                                            <Button type="button" variant="secondary" size="icon" onClick={generateSimpleBarcode} title={t('variants.generateBarcodes')}><Barcode className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                    {(formData.sku || formData.barcode) && (
                                        <div className="col-span-4 flex items-center gap-3 text-xs text-zinc-500">
                                            <QrPreview value={(formData.sku || formData.barcode).trim().toUpperCase()} size={56} />
                                            {t('products.qrContent')} <span className="font-mono ltr">{(formData.sku || formData.barcode).trim().toUpperCase()}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Optional details */}
                    <section className="rounded-xl border border-dark-border">
                        <button type="button" onClick={() => setShowMore(!showMore)} className="w-full flex items-center justify-between px-4 h-12">
                            <span className="font-medium">{t('products.moreDetails')}</span>
                            <span className="flex items-center gap-2 text-xs text-zinc-500">
                                {t('products.moreDetailsHint')}
                                <ChevronDown className={`w-4 h-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
                            </span>
                        </button>
                        {showMore && (
                            <div className="border-t border-dark-border p-4 grid grid-cols-3 gap-4">
                                <Input label={t('products.cost')} type="number" min="0" value={formData.cost}
                                    onChange={(e) => set('cost', e.target.value)} placeholder="0" />
                                <Select label={t('products.supplier')} value={formData.supplier_id} onChange={(v) => set('supplier_id', v)}
                                    options={[{ value: '', label: t('products.noSupplier') }, ...suppliers.map(sp => ({ value: sp.id, label: sp.name }))]} />
                                <Input label={t('products.taxRate')} type="number" min="0" step="0.1" value={formData.tax_rate}
                                    onChange={(e) => set('tax_rate', e.target.value)} />
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
                                {hasVariants && (
                                    <Input label={t('products.productCode')} value={formData.sku} className="font-mono uppercase ltr"
                                        onChange={(e) => set('sku', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} />
                                )}
                                <div className={hasVariants ? 'col-span-2' : 'col-span-3'}>
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
                    {/* Labels printed straight after saving: no need to open the labels page */}
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input type="checkbox" checked={printAfter} onChange={(e) => togglePrintAfter(e.target.checked)} className="w-4 h-4 rounded" />
                            <Printer className="w-4 h-4 text-zinc-400" />
                            <span className="whitespace-nowrap">{t('products.printLabelsAfter')}</span>
                        </label>
                        {printAfter && (
                            <label className="flex items-center gap-2 text-zinc-400">
                                <input type="number" min="1" max="1000" value={labelQty} onChange={(e) => setLabelQty(e.target.value)}
                                    className="input input-sm w-20 tabular" placeholder={t('products.labelQtyStock')} aria-label={t('products.labelQty')} />
                                <span className="text-xs whitespace-nowrap">{labelQty ? t('products.labelQtyEach') : t('products.labelQtyStockHint')}</span>
                            </label>
                        )}
                    </div>
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
