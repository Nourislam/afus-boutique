import { useEffect, useState } from 'react';
import { Package, Trash2, Shirt } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { Button } from '../ui/Button';
import { Input, TextArea } from '../ui/Input';
import { Select } from '../ui/Select';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { VariantEditor } from './VariantEditor';
import { QrPreview } from './QrPreview';
import { useAuthStore } from '../../stores/authStore';

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
    price: '',
    cost: '',
    stock_quantity: '0',
    min_stock_level: '5',
    tax_rate: '0',
    is_active: true,
    image_path: '',
};

const GENDERS = [
    { value: '', label: '—' },
    { value: 'women', label: 'Women' },
    { value: 'men', label: 'Men' },
    { value: 'unisex', label: 'Unisex' },
    { value: 'girls', label: 'Girls' },
    { value: 'boys', label: 'Boys' },
    { value: 'baby', label: 'Baby' },
];

function toRow(v) {
    return {
        key: v.id,
        id: v.id,
        isNew: false,
        color: v.color || '',
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
export function ProductFormModal({ isOpen, onClose, product, categories, onSave, initialValues }) {
    const [formData, setFormData] = useState(EMPTY_PRODUCT);
    const [hasVariants, setHasVariants] = useState(false);
    const [variants, setVariants] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingVariants, setLoadingVariants] = useState(false);
    const [imagePreview, setImagePreview] = useState(null);
    const [errors, setErrors] = useState([]);
    const { currentEmployee } = useAuthStore();

    useEffect(() => {
        if (!isOpen) return;
        setErrors([]);
        window.electronAPI.suppliers.getAll().then(setSuppliers).catch(() => setSuppliers([]));

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
                    .catch(() => toast.error('Failed to load variants'))
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
                toast.error('Failed to save the image');
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
            toast.error('Name and price are required');
            return;
        }
        const activeVariants = variants.filter(v => v.is_active);
        if (hasVariants && activeVariants.length === 0) {
            toast.error('Generate at least one variant, or turn off sizes/colours');
            return;
        }

        setLoading(true);
        try {
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
            const variantPayload = hasVariants
                ? variants.map(v => ({
                    id: v.isNew ? null : v.id,
                    color: v.color,
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

            await window.electronAPI.catalog.saveProduct({
                product: data,
                variants: variantPayload,
                employeeId: currentEmployee?.id || null,
                isNew: !product,
            });
            toast.success(product ? 'Product updated' : 'Product created');
            onSave();
        } catch (error) {
            // IPC errors arrive as "Error invoking remote method '...': Error: <message>"
            const message = String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
            setErrors(message.split('\n').filter(Boolean));
            toast.error('The product could not be saved');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={product ? 'Edit Product' : 'Add Product'} size="full">
            <form onSubmit={handleSubmit}>
                <ModalBody className="max-h-[75vh] overflow-y-auto">
                    <div className="grid grid-cols-4 gap-4">
                        <div className="col-span-1">
                            <label className="form-label mb-2 block">Product image</label>
                            <div className="aspect-square bg-dark-tertiary rounded-lg flex flex-col items-center justify-center overflow-hidden relative border-2 border-dashed border-zinc-600 hover:border-zinc-500 transition-colors">
                                {imagePreview ? (
                                    <>
                                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                                        <button type="button" onClick={handleRemoveImage} className="absolute top-2 right-2 p-1 bg-red-500 rounded-full hover:bg-red-600">
                                            <Trash2 className="w-4 h-4 text-white" />
                                        </button>
                                    </>
                                ) : (
                                    <label className="cursor-pointer flex flex-col items-center p-4 text-center">
                                        <Package className="w-10 h-10 text-zinc-500 mb-2" />
                                        <span className="text-sm text-zinc-400">Click to upload</span>
                                        <span className="text-xs text-zinc-500 mt-1">JPG, PNG up to 5MB</span>
                                        <input type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                                    </label>
                                )}
                            </div>
                            <label className="flex items-center gap-2 mt-4 text-sm">
                                <input type="checkbox" checked={formData.is_active} onChange={(e) => set('is_active', e.target.checked)} className="w-4 h-4 rounded" />
                                Active (can be sold)
                            </label>
                        </div>

                        <div className="col-span-3 grid grid-cols-3 gap-4 content-start">
                            <Input label="Product name *" value={formData.name} onChange={(e) => set('name', e.target.value)}
                                placeholder="e.g. T-Shirt Basic" containerClassName="col-span-2" />
                            <Input label="Brand" value={formData.brand} onChange={(e) => set('brand', e.target.value)} />
                            <Select label="Category" value={formData.category_id} onChange={(v) => set('category_id', v)}
                                options={[{ value: '', label: 'No category' }, ...categories.map(c => ({ value: c.id, label: c.name }))]} />
                            <Select label="Supplier" value={formData.supplier_id} onChange={(v) => set('supplier_id', v)}
                                options={[{ value: '', label: 'No supplier' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
                            <Select label="Gender" value={formData.gender} onChange={(v) => set('gender', v)} options={GENDERS} />
                            <Input label="Season / collection" value={formData.season} onChange={(e) => set('season', e.target.value)} placeholder="e.g. Summer 2025" />
                            <Input label={hasVariants ? 'Base selling price *' : 'Selling price *'} type="number" step="0.01" value={formData.price}
                                onChange={(e) => set('price', e.target.value)} placeholder="0.00" />
                            <Input label={hasVariants ? 'Base cost' : 'Cost'} type="number" step="0.01" value={formData.cost}
                                onChange={(e) => set('cost', e.target.value)} placeholder="0.00" />
                            <Input label="Tax rate (%)" type="number" step="0.1" value={formData.tax_rate}
                                onChange={(e) => set('tax_rate', e.target.value)} />
                            <div className="col-span-2">
                                <TextArea label="Description" value={formData.description} onChange={(e) => set('description', e.target.value)} className="min-h-[60px]" />
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-dark-border">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={hasVariants} onChange={(e) => setHasVariants(e.target.checked)} className="w-4 h-4 rounded" />
                            <Shirt className="w-4 h-4 text-accent-primary" />
                            <span className="font-medium">This product comes in several colours and/or sizes</span>
                        </label>
                        {product && !product.has_variants && hasVariants && (
                            <p className="text-xs text-amber-400 mt-2">
                                The current stock of this product ({product.stock_quantity}) will be replaced by the stock you enter per variant.
                            </p>
                        )}
                    </div>

                    {hasVariants ? (
                        <div className="mt-4 space-y-3">
                            <Input
                                label="Product code (optional, used as SKU prefix, e.g. TSH)"
                                value={formData.sku}
                                onChange={(e) => set('sku', e.target.value.toUpperCase())}
                                containerClassName="max-w-xs"
                            />
                            {loadingVariants ? (
                                <div className="text-sm text-zinc-500">Loading variants…</div>
                            ) : (
                                <VariantEditor
                                    product={{ name: formData.name, sku: formData.sku, price: formData.price, cost: formData.cost }}
                                    variants={variants}
                                    onChange={setVariants}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="mt-4 grid grid-cols-4 gap-4 items-start">
                            <Input label="SKU" value={formData.sku} onChange={(e) => set('sku', e.target.value)} placeholder="Used in the QR code" data-scan-passthrough />
                            <Input label="Barcode" value={formData.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan or type" data-scan-passthrough />
                            <Input label="Stock quantity" type="number" value={formData.stock_quantity} onChange={(e) => set('stock_quantity', e.target.value)} />
                            <Input label="Min stock level" type="number" value={formData.min_stock_level} onChange={(e) => set('min_stock_level', e.target.value)} />
                            {(formData.sku || formData.barcode) && (
                                <div className="col-span-4 flex items-center gap-3 text-xs text-zinc-500">
                                    <QrPreview value={(formData.sku || formData.barcode).trim().toUpperCase()} size={64} />
                                    QR label content: <span className="font-mono">{(formData.sku || formData.barcode).trim().toUpperCase()}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {errors.length > 0 && (
                        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 space-y-1">
                            {errors.map((err, i) => <div key={i}>{err}</div>)}
                        </div>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" loading={loading}>
                        {product ? 'Update Product' : 'Add Product'}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}

export default ProductFormModal;
