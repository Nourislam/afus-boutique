import { t } from '../i18n';
import { formatMoney } from '../i18n/format';
/**
 * Barcode Label Page
 * 
 * Comprehensive barcode labeling system with industry presets and batch printing.
 */

import { useState, useEffect } from 'react';
import {
    Barcode, Printer, Download, Plus, Settings2, Package, Tag, RefreshCw, Check, ChevronDown, Grid, List, QrCode, Gem, Shirt,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, SearchInput } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { toast } from '../components/ui/Toast';
import { PermissionGate } from '../components/auth/PermissionGate';
import { PERMISSIONS } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';

// Label template icons
const INDUSTRY_ICONS = {
    fashion: Shirt,
    retail: Tag,
    accessories: Gem,
    shoebox: Package,
    qr: QrCode,
};

// Fallback barcode types if API fails
const FALLBACK_BARCODE_TYPES = {
    'upca': { name: 'UPC-A', digits: 12, type: '1D', region: 'US/Canada' },
    'upce': { name: 'UPC-E', digits: 8, type: '1D', region: 'US/Canada' },
    'ean13': { name: 'EAN-13', digits: 13, type: '1D', region: 'International' },
    'ean8': { name: 'EAN-8', digits: 8, type: '1D', region: 'International' },
    'code128': { name: 'Code 128', digits: 'Variable', type: '1D', region: 'Universal' },
    'code39': { name: 'Code 39', digits: 'Variable', type: '1D', region: 'Industrial' },
    'qrcode': { name: 'QR Code', digits: 'Variable', type: '2D', region: 'Universal' },
    'datamatrix': { name: 'DataMatrix', digits: 'Variable', type: '2D', region: 'Pharma' },
};

const FALLBACK_PRESETS = {
    fashion: { name: 'Hang tag', barcodeType: 'code128', labelWidth: 45, labelHeight: 80, showPrice: true, showName: true, showSize: true },
    retail: { name: 'Price sticker', barcodeType: 'code128', labelWidth: 50, labelHeight: 25, showPrice: true, showName: true },
    accessories: { name: 'Accessories', barcodeType: 'code128', labelWidth: 25, labelHeight: 15, showPrice: true, showName: true },
    shoebox: { name: 'Shoe box', barcodeType: 'code128', labelWidth: 60, labelHeight: 30, showPrice: true, showName: true },
    qr: { name: 'QR tag', barcodeType: 'qrcode', labelWidth: 30, labelHeight: 30, showPrice: true, showName: true },
};

export default function BarcodeLabelPage() {
    const [products, setProducts] = useState([]);
    const [selectedProducts, setSelectedProducts] = useState([]);
    const [barcodeTypes, setBarcodeTypes] = useState(FALLBACK_BARCODE_TYPES);
    const [industryPresets, setIndustryPresets] = useState(FALLBACK_PRESETS);
    const [selectedPreset, setSelectedPreset] = useState('fashion');
    const [generatedLabels, setGeneratedLabels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [quantityPerLabel, setQuantityPerLabel] = useState(1);
    const [showPreview, setShowPreview] = useState(false);
    const [customBarcode, setCustomBarcode] = useState({ type: 'ean13', data: '' });
    const [showCustomModal, setShowCustomModal] = useState(false);
    const [customBarcodeResult, setCustomBarcodeResult] = useState(null);
    const { settings, loadSettings } = useSettingsStore();

    useEffect(() => {
        loadData();
        loadSettings();
    }, []);

    const loadData = async () => {
        try {
            const [productsData, types, presets] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.barcode.getTypes(),
                window.electronAPI.barcode.getPresets(),
            ]);
            setProducts(productsData);
            setBarcodeTypes(types);
            setIndustryPresets(presets);
        } catch (error) {
            toast.error(t('common.loadFailed'));
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return formatMoney(amount || 0);
    };

    const toggleProductSelection = (productId) => {
        setSelectedProducts(prev =>
            prev.includes(productId)
                ? prev.filter(id => id !== productId)
                : [...prev, productId]
        );
    };

    const selectAllProducts = () => {
        setSelectedProducts(products.map(p => p.id));
    };

    const clearSelection = () => {
        setSelectedProducts([]);
    };

    const generateLabels = async () => {
        if (selectedProducts.length === 0) {
            toast.error(t('barcode.selectProduct'));
            return;
        }

        setGenerating(true);
        try {
            const selectedProductsData = products.filter(p => selectedProducts.includes(p.id));
            const labels = await window.electronAPI.barcode.generateBatch(
                selectedProductsData,
                selectedPreset,
                quantityPerLabel
            );
            setGeneratedLabels(labels);
            setShowPreview(true);
            toast.success(t('barcode.generated', { n: labels.length }));
        } catch (error) {
            toast.error(t('barcode.generateFailed'));
            console.error(error);
        } finally {
            setGenerating(false);
        }
    };

    const generateCustomBarcode = async () => {
        if (!customBarcode.data) {
            toast.error(t('barcode.enterData'));
            return;
        }

        try {
            const result = await window.electronAPI.barcode.generate({
                type: customBarcode.type,
                data: customBarcode.data,
                scale: 3,
            });

            if (result.success) {
                setCustomBarcodeResult(result);
                toast.success(t('barcode.done'));
            } else {
                toast.error(result.error);
            }
        } catch (error) {
            toast.error(t('barcode.failed'));
        }
    };

    const generateRandomBarcode = async () => {
        try {
            const randomData = await window.electronAPI.barcode.generateRandom(customBarcode.type);
            setCustomBarcode(prev => ({ ...prev, data: randomData }));
        } catch (error) {
            toast.error(t('barcode.randomFailed'));
        }
    };

    const printLabels = async () => {
        // Printed through the main process (pop-up windows are blocked in the app)
        const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = (`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${t('barcode.print')}</title>
                <style>
                    body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
                    .label { 
                        display: inline-block; 
                        border: 1px dashed #ccc; 
                        padding: 10px; 
                        margin: 5px; 
                        text-align: center;
                        page-break-inside: avoid;
                    }
                    .barcode-image { max-width: 100%; height: auto; }
                    .product-name { font-size: 12px; font-weight: bold; margin-top: 5px; }
                    .product-price { font-size: 14px; color: #333; }
                    .barcode-data { font-size: 10px; color: #666; }
                    @media print {
                        .label { border: none; }
                    }
                </style>
            </head>
            <body>
                ${generatedLabels.map(label => `
                    <div class="label" style="width: ${label.template?.labelWidth || 50}mm;">
                        <img class="barcode-image" src="${label.barcode}" alt="" />
                        ${label.template?.showName ? `<div class="product-name">${escapeHtml(label.productName)}</div>` : ''}
                        ${label.template?.showPrice ? `<div class="product-price">${escapeHtml(formatCurrency(label.price))}</div>` : ''}
                        <div class="barcode-data">${escapeHtml(label.barcodeData)}</div>
                    </div>
                `).join('')}
            </body>
            </html>
        `);
        try {
            await window.electronAPI.labels.printHtml(html);
        } catch (error) {
            toast.error(t('barcode.printFailed', { error: error.message }));
        }
    };

    const filteredProducts = products.filter(product =>
        !searchQuery ||
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
    );

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
                        <Barcode className="w-7 h-7 text-indigo-500" />
                        {t('barcode.title')}
                    </h1>
                    <p className="text-zinc-400 mt-1">{t('barcode.subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => setShowCustomModal(true)}>
                        <QrCode className="w-4 h-4" />
                        {t('barcode.custom')}
                    </Button>
                    <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                        <Button onClick={generateLabels} disabled={generating || selectedProducts.length === 0}>
                            {generating ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <Printer className="w-4 h-4" />
                            )}
                            {t('barcode.generate', { n: selectedProducts.length })}
                        </Button>
                    </PermissionGate>
                </div>
            </div>

            {/* Industry Presets */}
            <div className="flex flex-col gap-2">
                <span className="text-sm text-zinc-400">{t('barcode.presetLabel')}</span>
                <div className="flex gap-2 flex-wrap overflow-x-auto pb-2">
                    {Object.entries(industryPresets).map(([key, preset]) => {
                        const Icon = INDUSTRY_ICONS[key] || Tag;
                        return (
                            <button
                                key={key}
                                onClick={() => setSelectedPreset(key)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all whitespace-nowrap text-sm ${selectedPreset === key
                                    ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400'
                                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                                    }`}
                            >
                                <Icon className="w-4 h-4" />
                                {t(`barcode.preset.${key}`)}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Preset Description */}
            {industryPresets[selectedPreset] && (
                <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
                    <div className="flex items-start gap-4">
                        <div className="flex-1">
                            <h3 className="font-medium">{t(`barcode.preset.${selectedPreset}`)}</h3>
                            <p className="text-sm text-zinc-400 mt-1">
                                {t(`barcode.preset.${selectedPreset}Hint`)}
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="text-end">
                                <p className="text-xs text-zinc-500">{t('barcode.type')}</p>
                                <p className="font-medium text-indigo-400">
                                    {barcodeTypes[industryPresets[selectedPreset].barcodeType]?.name}
                                </p>
                            </div>
                            <div className="text-end">
                                <p className="text-xs text-zinc-500">{t('barcode.size')}</p>
                                <p className="font-medium">
                                    {industryPresets[selectedPreset].labelWidth}×{industryPresets[selectedPreset].labelHeight} mm
                                </p>
                            </div>
                            <div>
                                <label className="text-xs text-zinc-500 block">{t('barcode.qty')}</label>
                                <Input
                                    type="number"
                                    value={quantityPerLabel}
                                    onChange={(e) => setQuantityPerLabel(parseInt(e.target.value) || 1)}
                                    min={1}
                                    max={100}
                                    className="w-20"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-4">
                <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t('inventory.search')}
                    className="flex-1 max-w-md"
                />
                <Button variant="secondary" size="sm" onClick={selectAllProducts}>
                    {t('barcode.selectAll')}
                </Button>
                <Button variant="secondary" size="sm" onClick={clearSelection}>
                    {t('qr.clear')}
                </Button>
            </div>

            {/* Product Grid */}
            <div className="flex-1 overflow-auto">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {filteredProducts.map(product => (
                        <div
                            key={product.id}
                            onClick={() => toggleProductSelection(product.id)}
                            className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedProducts.includes(product.id)
                                ? 'bg-indigo-500/20 border-indigo-500'
                                : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
                                }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center ${selectedProducts.includes(product.id)
                                    ? 'bg-indigo-500 border-indigo-500'
                                    : 'border-zinc-600'
                                    }`}>
                                    {selectedProducts.includes(product.id) && (
                                        <Check className="w-3 h-3 text-white" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{product.name}</p>
                                    <p className="text-sm text-zinc-400">{product.sku || t('barcode.noSku')}</p>
                                    <p className="text-xs text-zinc-500 mt-1 font-mono">
                                        {product.barcode || t('barcode.noBarcode')}
                                    </p>
                                    <p className="text-indigo-400 font-semibold mt-1">
                                        {formatCurrency(product.price)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Preview Modal */}
            {showPreview && (
                <Modal
                    isOpen={showPreview}
                    onClose={() => setShowPreview(false)}
                    title={t('qr.preview')}
                    size="xl"
                >
                    <ModalBody>
                        <div className="bg-white rounded-lg p-6 overflow-auto max-h-96">
                            <div className="flex flex-wrap gap-4 justify-center">
                                {generatedLabels.map((label, index) => (
                                    <div
                                        key={index}
                                        className="border border-gray-300 p-3 text-center bg-white"
                                        style={{ width: `${label.template?.labelWidth || 50}mm` }}
                                    >
                                        {label.error ? (
                                            <p className="text-red-500 text-xs">{label.error}</p>
                                        ) : (
                                            <>
                                                <img
                                                    src={label.barcode}
                                                    alt={t('products.barcode')}
                                                    className="mx-auto"
                                                />
                                                {label.template?.showName && (
                                                    <p className="text-xs font-bold mt-1 text-gray-800 truncate">
                                                        {label.productName}
                                                    </p>
                                                )}
                                                {label.template?.showPrice && (
                                                    <p className="text-sm font-semibold text-gray-700">
                                                        {formatCurrency(label.price)}
                                                    </p>
                                                )}
                                                <p className="text-xs text-gray-500 font-mono">
                                                    {label.barcodeData}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setShowPreview(false)}>
                            {t('common.close')}
                        </Button>
                        <Button onClick={printLabels}>
                            <Printer className="w-4 h-4" />
                            {t('barcode.print')}
                        </Button>
                    </ModalFooter>
                </Modal>
            )}

            {/* Custom Barcode Modal */}
            {showCustomModal && (
                <Modal
                    isOpen={showCustomModal}
                    onClose={() => { setShowCustomModal(false); setCustomBarcodeResult(null); }}
                    title={t('barcode.customTitle')}
                    size="md"
                >
                    <ModalBody>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">{t('barcode.type')}</label>
                                <Select
                                    value={customBarcode.type}
                                    onChange={(val) => setCustomBarcode(prev => ({ ...prev, type: val }))}
                                    options={Object.entries(barcodeTypes).map(([key, spec]) => ({
                                        value: key,
                                        label: `${spec.name} (${spec.type})`
                                    }))}
                                    placeholder={t('barcode.selectType')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">{t('barcode.data')}</label>
                                <div className="flex gap-2">
                                    <Input
                                        value={customBarcode.data}
                                        onChange={(e) => setCustomBarcode(prev => ({ ...prev, data: e.target.value }))}
                                        placeholder={`Enter ${barcodeTypes[customBarcode.type]?.digits || 'variable'} characters`}
                                    />
                                    <Button variant="secondary" onClick={generateRandomBarcode}>
                                        <RefreshCw className="w-4 h-4" />
                                    </Button>
                                </div>
                                <p className="text-xs text-zinc-500 mt-1">
                                    {barcodeTypes[customBarcode.type]?.name}: {barcodeTypes[customBarcode.type]?.digits} digits
                                </p>
                            </div>
                            <Button onClick={generateCustomBarcode} className="w-full">
                                {t('barcode.generateOne')}
                            </Button>

                            {customBarcodeResult?.success && (
                                <div className="bg-white rounded-lg p-6 text-center">
                                    <img
                                        src={customBarcodeResult.image}
                                        alt={t('barcode.result')}
                                        className="mx-auto"
                                    />
                                    <p className="text-gray-600 font-mono text-sm mt-2">
                                        {customBarcodeResult.data}
                                    </p>
                                </div>
                            )}
                        </div>
                    </ModalBody>
                </Modal>
            )}
        </div>
    );
}
