import { t } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Printer, Tag, FlaskConical, Square, Circle, RectangleHorizontal, QrCode, Barcode, Layers, Shirt } from 'lucide-react';
import { toast } from '../ui/Toast';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { LabelPreview } from '../labels/LabelPreview';

function Toggle({ checked, onChange, label, hint, disabled = false }) {
    return (
        <label className={`flex items-start gap-3 select-none ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
                type="checkbox"
                checked={!!checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-1 w-4 h-4 rounded bg-dark-tertiary border-dark-border flex-none"
            />
            <span className="min-w-0">
                <span className="text-sm">{label}</span>
                {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
            </span>
        </label>
    );
}

/** Printers installed in Windows / macOS, with a refresh button. */
function usePrinterList() {
    const [printerList, setPrinterList] = useState([]);
    const [loading, setLoading] = useState(false);
    const load = async () => {
        setLoading(true);
        try {
            setPrinterList(await window.electronAPI.printers.list());
        } catch {
            setPrinterList([]);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);
    const options = [
        { value: '', label: t('printers.askDialog') },
        ...printerList.map(p => ({ value: p.name, label: `${p.displayName}${p.isDefault ? ` (${t('common.default')})` : ''}` })),
    ];
    return { printerList, options, loading, reload: load };
}

function PrinterPicker({ value, onChange, list }) {
    return (
        <div className="space-y-2">
            <div className="flex items-end gap-2">
                <Select label={t('printers.printer')} value={value || ''} onChange={onChange} options={list.options} className="flex-1" />
                <Button type="button" variant="secondary" onClick={list.reload} loading={list.loading} aria-label={t('printers.refresh')} title={t('printers.refresh')}>
                    <RefreshCw className="w-4 h-4" />
                </Button>
            </div>
            {list.printerList.length === 0 && !list.loading && <p className="text-xs text-amber-400">{t('printers.none')}</p>}
        </div>
    );
}

// What happens to the ticket after a sale (older settings only had autoPrint)
export const afterSaleMode = (receipt = {}) => receipt.afterSale || (receipt.autoPrint ? 'print' : 'preview');

/** Ticket (receipt) printer: printer, paper, copies and what happens after a sale. */
export function ReceiptPrinterForm({ printers, onPrintersChange }) {
    const list = usePrinterList();
    const [testing, setTesting] = useState(false);
    const receipt = printers.receipt || {};
    const setReceipt = (patch) => onPrintersChange({ ...printers, receipt: { ...receipt, ...patch } });
    const mode = afterSaleMode(receipt);

    const testReceipt = async () => {
        setTesting(true);
        try {
            const sale = {
                id: 'test', receipt_number: 'TEST-0001', created_at: new Date().toISOString(), employee_name: t('printers.testName'),
                items: [
                    { product_name: t('printers.testItem1'), quantity: 1, unit_price: 2500, total: 2500, size: 'M', color: 'Noir', color_code: 'black' },
                    { product_name: t('printers.testItem2'), quantity: 2, unit_price: 1200, total: 2400 },
                ],
                subtotal: 4900, tax_amount: 0, discount_amount: 0, total: 4900,
                payments: [{ method: 'cash', amount: 4900, reference: JSON.stringify({ tendered: 5000 }) }],
            };
            const result = await window.electronAPI.receipts.print(sale, receipt);
            if (result?.success !== false) toast.success(t('printers.testSent'));
        } catch (error) {
            toast.error(t('barcode.printFailed', { error: translateError(error) }));
        } finally {
            setTesting(false);
        }
    };

    return (
        <section className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PrinterPicker value={receipt.printerName} onChange={(v) => setReceipt({ printerName: v })} list={list} />
                <Select
                    label={t('printers.paperWidth')}
                    value={String(receipt.paperWidthMm || 80)}
                    onChange={(v) => setReceipt({ paperWidthMm: parseInt(v, 10) })}
                    options={[{ value: '80', label: t('printers.roll80') }, { value: '58', label: t('printers.roll58') }]}
                />
                <Input
                    label={t('printers.copies')}
                    type="number" min="1" max="5"
                    value={receipt.copies || 1}
                    onChange={(e) => setReceipt({ copies: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                />
            </div>

            <div>
                <span className="form-label">{t('printers.afterSale')}</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1.5">
                    {['print', 'preview', 'none'].map(id => (
                        <button key={id} type="button" onClick={() => setReceipt({ afterSale: id, autoPrint: id === 'print' })}
                            className={`p-3 rounded-lg border text-start transition-colors ${mode === id ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-600'}`}>
                            <p className="text-sm font-medium">{t(`printers.after.${id}`)}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{t(`printers.after.${id}Hint`)}</p>
                        </button>
                    ))}
                </div>
            </div>

            <Toggle checked={receipt.silent} onChange={(v) => setReceipt({ silent: v })} label={t('printers.silent')} hint={t('printers.silentHint')} />
            <Button type="button" variant="secondary" size="sm" onClick={testReceipt} loading={testing}>
                <FlaskConical className="w-4 h-4" /> {t('printers.testReceipt')}
            </Button>
        </section>
    );
}

const SHAPES = [
    { id: 'rect', icon: Square, label: 'labels.shapeRect' },
    { id: 'rounded', icon: RectangleHorizontal, label: 'labels.shapeRounded' },
    { id: 'round', icon: Circle, label: 'labels.shapeRound' },
];

export const CODE_TYPES = [
    { id: 'qr', name: 'QR', icon: QrCode },
    { id: 'ean13', name: 'EAN-13', icon: Barcode },
    { id: 'code128', name: 'Code 128', icon: Barcode },
    { id: 'code39', name: 'Code 39', icon: Barcode },
    { id: 'datamatrix', name: 'DataMatrix', icon: QrCode },
];

const SAMPLE = [{ sample: true, quantity: 1 }];

/**
 * Label printer and the look of every label, set once here: size, shape,
 * code type, one code per colour/size or per article, and what is printed.
 * The preview is drawn exactly as the labels will print.
 */
export function LabelPrinterForm({ printers, onPrintersChange, labels, onLabelsChange, compact = false }) {
    const list = usePrinterList();
    const [templates, setTemplates] = useState({});
    const [defaults, setDefaults] = useState({});
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        window.electronAPI.labels.getTemplates().then(({ templates: tpls, defaults: d }) => {
            setTemplates(tpls);
            setDefaults(d);
        });
    }, []);

    const label = printers.label || {};
    const setLabelPrinter = (patch) => onPrintersChange({ ...printers, label: { ...label, ...patch } });
    const layout = useMemo(() => ({ ...defaults, ...labels }), [defaults, labels]);
    const setLayout = (patch) => onLabelsChange({ ...labels, ...patch });
    const isCustom = layout.template === 'custom';
    const qrSide = (layout.codeType || 'qr') === 'qr';
    const perArticle = layout.codeScope === 'article';

    const templateOptions = [
        ...Object.entries(templates).map(([id, tpl]) => ({
            value: id,
            label: tpl.shape === 'round'
                ? t('labels.roundTemplate', { w: tpl.widthMm })
                : tpl.mode === 'sheet'
                    ? t('labels.sheetTemplate', { paper: tpl.paper || 'A4', cols: tpl.columns, rows: tpl.rows, w: tpl.widthMm, h: tpl.heightMm })
                    : t('labels.rollTemplate', { w: tpl.widthMm, h: tpl.heightMm }),
        })),
        { value: 'custom', label: t('labels.custom') },
    ];

    const chooseTemplate = (id) => {
        if (id === 'custom') return setLayout({ template: 'custom' });
        const tpl = templates[id] || {};
        return setLayout({ template: id, ...tpl, name: undefined, shape: tpl.shape || (layout.shape === 'round' ? 'rect' : layout.shape || 'rect') });
    };
    const chooseShape = (id) => {
        if (id === 'round' && templates[layout.template]?.shape !== 'round' && !isCustom) return setLayout({ shape: id, template: 'round-40', ...templates['round-40'], name: undefined });
        if (id !== 'round' && templates[layout.template]?.shape === 'round') return setLayout({ shape: id, template: 'roll-40x30', ...templates['roll-40x30'], name: undefined });
        return setLayout({ shape: id });
    };

    const testLabel = async () => {
        setTesting(true);
        try {
            const result = await window.electronAPI.labels.print(SAMPLE, layout, label);
            if (result?.success) toast.success(t('printers.testSent'));
        } catch (error) {
            toast.error(t('barcode.printFailed', { error: translateError(error) }));
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <div className="xl:col-span-3 space-y-6 min-w-0">
                {/* Printer */}
                <section className="space-y-4">
                    <h4 className="font-semibold flex items-center gap-2"><Printer className="w-4 h-4" /> {t('printers.label')}</h4>
                    <PrinterPicker value={label.printerName} onChange={(v) => setLabelPrinter({ printerName: v })} list={list} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Select
                            label={t('printers.dpi')}
                            value={String(label.dpi || 0)}
                            onChange={(v) => setLabelPrinter({ dpi: parseInt(v, 10) })}
                            options={[
                                { value: '0', label: t('printers.dpiDefault') },
                                { value: '203', label: t('printers.dpi203') },
                                { value: '300', label: '300 dpi' },
                                { value: '600', label: '600 dpi' },
                            ]}
                        />
                    </div>
                    <Toggle checked={label.silent} onChange={(v) => setLabelPrinter({ silent: v })} label={t('printers.labelSilent')} hint={t('printers.labelSilentHint')} />
                </section>

                {/* Size and shape */}
                <section className="space-y-4">
                    <h4 className="font-semibold flex items-center gap-2"><Tag className="w-4 h-4" /> {t('labels.sizeAndShape')}</h4>
                    <div className="space-y-4">
                        <Select label={t('labels.size')} value={layout.template || 'roll-40x30'} onChange={chooseTemplate} options={templateOptions} />
                        <div>
                            <span className="form-label">{t('labels.shape')}</span>
                            <div className="segmented w-full mt-1.5">
                                {SHAPES.map(({ id, icon: Icon, label: text }) => (
                                    <button key={id} type="button" onClick={() => chooseShape(id)}
                                        className={`flex-1 inline-flex items-center justify-center gap-1.5 min-w-0 ${(layout.shape || 'rect') === id ? 'active' : ''}`}>
                                        <Icon className="w-4 h-4 flex-none" /> <span className="truncate">{t(text)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    {isCustom && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <Select label={t('labels.layout')} value={layout.mode || 'roll'} onChange={(v) => setLayout({ mode: v })} className="col-span-2"
                                options={[{ value: 'roll', label: t('labels.rollMode') }, { value: 'sheet', label: t('labels.sheetMode') }]} />
                            <Input label={t('labels.width')} type="number" step="0.1" value={layout.widthMm ?? ''} onChange={(e) => setLayout({ widthMm: parseFloat(e.target.value) || '' })} />
                            <Input label={t('labels.height')} type="number" step="0.1" value={layout.heightMm ?? ''} onChange={(e) => setLayout({ heightMm: parseFloat(e.target.value) || '' })} />
                            {layout.mode === 'sheet' && (
                                <>
                                    <Select label={t('labels.paper')} value={layout.paper || 'A4'} onChange={(v) => setLayout({ paper: v })}
                                        options={[{ value: 'A4', label: 'A4' }, { value: 'A5', label: 'A5' }, { value: 'Letter', label: 'Letter' }]} />
                                    <Input label={t('labels.columns')} type="number" min="1" value={layout.columns ?? 3} onChange={(e) => setLayout({ columns: parseInt(e.target.value, 10) || 1 })} />
                                    <Input label={t('labels.rows')} type="number" min="1" value={layout.rows ?? 8} onChange={(e) => setLayout({ rows: parseInt(e.target.value, 10) || 1 })} />
                                    <Input label={t('labels.marginTop')} type="number" step="0.1" value={layout.pageMarginTopMm ?? 0} onChange={(e) => setLayout({ pageMarginTopMm: parseFloat(e.target.value) || 0 })} />
                                    <Input label={t('labels.marginLeft')} type="number" step="0.1" value={layout.pageMarginLeftMm ?? 0} onChange={(e) => setLayout({ pageMarginLeftMm: parseFloat(e.target.value) || 0 })} />
                                    <Input label={t('labels.gapX')} type="number" step="0.1" value={layout.gapXMm ?? 0} onChange={(e) => setLayout({ gapXMm: parseFloat(e.target.value) || 0 })} />
                                    <Input label={t('labels.gapY')} type="number" step="0.1" value={layout.gapYMm ?? 0} onChange={(e) => setLayout({ gapYMm: parseFloat(e.target.value) || 0 })} />
                                </>
                            )}
                            <Input label={t('labels.padding')} type="number" step="0.1" value={layout.paddingMm ?? 1.5} onChange={(e) => setLayout({ paddingMm: parseFloat(e.target.value) || 0 })} />
                        </div>
                    )}
                    {!isCustom && <p className="form-hint">{t('labels.customHint')}</p>}
                </section>

                {/* Code */}
                <section className="space-y-4">
                    <h4 className="font-semibold flex items-center gap-2"><Barcode className="w-4 h-4" /> {t('labels.codeOnLabel')}</h4>
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
                        {CODE_TYPES.map(({ id, name, icon: Icon }) => (
                            <button key={id} type="button" onClick={() => setLayout({ codeType: id })}
                                className={`h-11 px-2 rounded-lg border text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${(layout.codeType || 'qr') === id ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-dark-border text-zinc-400 hover:text-white hover:border-zinc-600'}`}>
                                <Icon className="w-4 h-4 flex-none" /> <span className="ltr truncate">{name}</span>
                            </button>
                        ))}
                    </div>
                    <p className="form-hint">{t(`labels.codeHint.${layout.codeType || 'qr'}`)}</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                            { id: 'variant', icon: Layers },
                            { id: 'article', icon: Shirt },
                        ].map(({ id, icon: Icon }) => (
                            <button key={id} type="button" onClick={() => setLayout({ codeScope: id, ...(id === 'article' ? { showVariant: false } : {}) })}
                                className={`p-3 rounded-lg border text-start transition-colors ${(layout.codeScope || 'variant') === id ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-600'}`}>
                                <p className="text-sm font-medium flex items-center gap-2"><Icon className="w-4 h-4 flex-none" /> {t(`labels.scope.${id}`)}</p>
                                <p className="text-xs text-zinc-500 mt-1">{t(`labels.scope.${id}Hint`)}</p>
                            </button>
                        ))}
                    </div>
                </section>

                {/* What is printed */}
                {!compact && (
                    <section className="space-y-3">
                        <h4 className="font-semibold">{t('labels.whatPrinted')}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Toggle checked={layout.showShopName} onChange={(v) => setLayout({ showShopName: v })} label={t('labels.showShopName')} />
                            <Toggle checked={layout.showLogo} onChange={(v) => setLayout({ showLogo: v })} label={t('labels.showLogo')} />
                            <Toggle checked={layout.showProductName} onChange={(v) => setLayout({ showProductName: v })} label={t('labels.showProductName')} />
                            <Toggle checked={layout.showVariant && !perArticle} disabled={perArticle} onChange={(v) => setLayout({ showVariant: v })}
                                label={t('labels.showVariant')} hint={perArticle ? t('labels.variantOffArticle') : null} />
                            <Toggle checked={layout.showSku} onChange={(v) => setLayout({ showSku: v })} label={t('labels.showCodeText')} />
                            <Toggle checked={layout.showPrice} onChange={(v) => setLayout({ showPrice: v })} label={t('labels.showPrice')} />
                            {qrSide && <Toggle checked={layout.showBarcode} onChange={(v) => setLayout({ showBarcode: v })} label={t('labels.showBarcode')} />}
                        </div>
                        <Input label={t('labels.extraText')} value={layout.extraText || ''} onChange={(e) => setLayout({ extraText: e.target.value })} />
                    </section>
                )}
            </div>

            {/* Live preview */}
            <div className="xl:col-span-2 min-w-0 order-first xl:order-none">
                <div className="xl:sticky xl:top-0 space-y-3">
                    <h4 className="font-semibold">{t('qr.preview')}</h4>
                    <LabelPreview items={SAMPLE} layout={layout} maxWidth={250} maxHeight={240} />
                    <p className="text-xs text-zinc-500">{t('labels.settingsPreviewNote')}</p>
                    <Button type="button" variant="secondary" size="sm" onClick={testLabel} loading={testing}>
                        <FlaskConical className="w-4 h-4" /> {t('printers.testLabelButton')}
                    </Button>
                </div>
            </div>
        </div>
    );
}

/** Both printers on one screen (first start-up wizard). */
export function PrinterSettingsForm(props) {
    return (
        <div className="space-y-8">
            <div>
                <h4 className="font-semibold flex items-center gap-2 mb-4"><Printer className="w-4 h-4" /> {t('printers.receipt')}</h4>
                <ReceiptPrinterForm {...props} />
            </div>
            <LabelPrinterForm {...props} compact />
        </div>
    );
}

export default PrinterSettingsForm;
