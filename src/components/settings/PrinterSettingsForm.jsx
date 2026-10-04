import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { RefreshCw, Printer, Tag } from 'lucide-react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';

function Toggle({ checked, onChange, label, hint }) {
    return (
        <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
                type="checkbox"
                checked={!!checked}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-1 w-4 h-4 rounded bg-dark-tertiary border-dark-border"
            />
            <span>
                <span className="text-sm">{label}</span>
                {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
            </span>
        </label>
    );
}

/**
 * Receipt printer + QR label printer configuration.
 *
 * printers: { receipt: {...}, label: {...} }  (printer_settings)
 * labels:   label layout/content settings      (label_settings)
 * Any printer installed in Windows can be selected; nothing is tied to a
 * printer brand.
 */
export function PrinterSettingsForm({ printers, onPrintersChange, labels, onLabelsChange, compact = false }) {
    const [printerList, setPrinterList] = useState([]);
    const [templates, setTemplates] = useState({});
    const [defaults, setDefaults] = useState({});
    const [loadingPrinters, setLoadingPrinters] = useState(false);

    const loadPrinters = async () => {
        setLoadingPrinters(true);
        try {
            setPrinterList(await window.electronAPI.printers.list());
        } catch (error) {
            console.error('Failed to list printers:', error);
            setPrinterList([]);
        } finally {
            setLoadingPrinters(false);
        }
    };

    useEffect(() => {
        loadPrinters();
        window.electronAPI.labels.getTemplates().then(({ templates: tpls, defaults: d }) => {
            setTemplates(tpls);
            setDefaults(d);
        });
    }, []);

    const layout = { ...defaults, ...labels };
    const setReceipt = (key, v) => onPrintersChange({ ...printers, receipt: { ...printers.receipt, [key]: v } });
    const setLabelPrinter = (key, v) => onPrintersChange({ ...printers, label: { ...printers.label, [key]: v } });
    const setLayout = (patch) => onLabelsChange({ ...labels, ...patch });

    const printerOptions = [
        { value: '', label: t('printers.askDialog') },
        ...printerList.map(p => ({ value: p.name, label: `${p.displayName}${p.isDefault ? ` (${t('common.default')})` : ''}` })),
    ];

    const templateOptions = [
        ...Object.entries(templates).map(([id, tpl]) => ({ value: id, label: tpl.mode === 'sheet'
            ? t('labels.sheetTemplate', { paper: tpl.paper || 'A4', cols: tpl.columns, rows: tpl.rows, w: tpl.widthMm, h: tpl.heightMm })
            : t('labels.rollTemplate', { w: tpl.widthMm, h: tpl.heightMm }) })),
        { value: 'custom', label: t('labels.custom') },
    ];

    const chooseTemplate = (id) => {
        if (id === 'custom') {
            setLayout({ template: 'custom' });
            return;
        }
        const tpl = templates[id] || {};
        setLayout({ template: id, ...tpl, name: undefined });
    };

    const isCustom = layout.template === 'custom';

    return (
        <div className="space-y-8">
            {/* Receipt printer */}
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-semibold flex items-center gap-2"><Printer className="w-4 h-4" /> {t('printers.receipt')}</h4>
                    <Button type="button" variant="ghost" size="sm" onClick={loadPrinters} loading={loadingPrinters}>
                        <RefreshCw className="w-4 h-4" /> {t('printers.refresh')}
                    </Button>
                </div>
                {printerList.length === 0 && !loadingPrinters && (
                    <p className="text-xs text-amber-400">{t('printers.none')}</p>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label={t('printers.printer')}
                        value={printers.receipt.printerName || ''}
                        onChange={(v) => setReceipt('printerName', v)}
                        options={printerOptions}
                    />
                    <Select
                        label={t('printers.paperWidth')}
                        value={String(printers.receipt.paperWidthMm || 80)}
                        onChange={(v) => setReceipt('paperWidthMm', parseInt(v, 10))}
                        options={[
                            { value: '80', label: t('printers.roll80') },
                            { value: '58', label: t('printers.roll58') },
                        ]}
                    />
                    <Input
                        label={t('printers.copies')}
                        type="number"
                        min="1"
                        max="5"
                        value={printers.receipt.copies || 1}
                        onChange={(e) => setReceipt('copies', Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                </div>
                <div className="space-y-3">
                    <Toggle
                        checked={printers.receipt.autoPrint}
                        onChange={(v) => setReceipt('autoPrint', v)}
                        label={t('printers.autoPrint')}
                    />
                    <Toggle
                        checked={printers.receipt.silent}
                        onChange={(v) => setReceipt('silent', v)}
                        label={t('printers.silent')}
                        hint="Only applies when a printer is selected above."
                    />
                </div>
            </section>

            {/* Label printer */}
            <section className="space-y-4">
                <h4 className="font-semibold flex items-center gap-2"><Tag className="w-4 h-4" /> {t('printers.label')}</h4>
                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label={t('printers.printer')}
                        value={printers.label.printerName || ''}
                        onChange={(v) => setLabelPrinter('printerName', v)}
                        options={printerOptions}
                    />
                    <Select
                        label={t('printers.dpi')}
                        value={String(printers.label.dpi || 0)}
                        onChange={(v) => setLabelPrinter('dpi', parseInt(v, 10))}
                        options={[
                            { value: '0', label: t('printers.dpiDefault') },
                            { value: '203', label: t('printers.dpi203') },
                            { value: '300', label: '300 dpi' },
                            { value: '600', label: '600 dpi' },
                        ]}
                    />
                </div>
                <Toggle
                    checked={printers.label.silent}
                    onChange={(v) => setLabelPrinter('silent', v)}
                    label={t('printers.labelSilent')}
                    hint="Only applies when a printer is selected above. Print density/darkness is set in the printer's Windows driver."
                />

                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label={t('labels.size')}
                        value={layout.template || 'roll-40x30'}
                        onChange={chooseTemplate}
                        options={templateOptions}
                    />
                    <Select
                        label={t('labels.layout')}
                        value={layout.mode || 'roll'}
                        onChange={(v) => setLayout({ mode: v, template: 'custom' })}
                        options={[
                            { value: 'roll', label: t('labels.rollMode') },
                            { value: 'sheet', label: t('labels.sheetMode') },
                        ]}
                    />
                    <Input
                        label={t('labels.width')}
                        type="number"
                        step="0.1"
                        value={layout.widthMm ?? ''}
                        disabled={!isCustom}
                        onChange={(e) => setLayout({ widthMm: parseFloat(e.target.value) || '' })}
                    />
                    <Input
                        label={t('labels.height')}
                        type="number"
                        step="0.1"
                        value={layout.heightMm ?? ''}
                        disabled={!isCustom}
                        onChange={(e) => setLayout({ heightMm: parseFloat(e.target.value) || '' })}
                    />
                    <Input
                        label={t('labels.padding')}
                        type="number"
                        step="0.1"
                        value={layout.paddingMm ?? 1.5}
                        onChange={(e) => setLayout({ paddingMm: parseFloat(e.target.value) || 0 })}
                    />
                    {layout.mode === 'sheet' && (
                        <>
                            <Select
                                label={t('labels.paper')}
                                value={layout.paper || 'A4'}
                                onChange={(v) => setLayout({ paper: v, template: 'custom' })}
                                options={[{ value: 'A4', label: 'A4' }, { value: 'A5', label: 'A5' }, { value: 'Letter', label: 'Letter' }]}
                            />
                            <Input label={t('labels.columns')} type="number" min="1" value={layout.columns ?? 3}
                                disabled={!isCustom} onChange={(e) => setLayout({ columns: parseInt(e.target.value, 10) || 1 })} />
                            <Input label={t('labels.rows')} type="number" min="1" value={layout.rows ?? 8}
                                disabled={!isCustom} onChange={(e) => setLayout({ rows: parseInt(e.target.value, 10) || 1 })} />
                            <Input label={t('labels.marginTop')} type="number" step="0.1" value={layout.pageMarginTopMm ?? 0}
                                onChange={(e) => setLayout({ pageMarginTopMm: parseFloat(e.target.value) || 0 })} />
                            <Input label={t('labels.marginLeft')} type="number" step="0.1" value={layout.pageMarginLeftMm ?? 0}
                                onChange={(e) => setLayout({ pageMarginLeftMm: parseFloat(e.target.value) || 0 })} />
                            <Input label={t('labels.gapX')} type="number" step="0.1" value={layout.gapXMm ?? 0}
                                onChange={(e) => setLayout({ gapXMm: parseFloat(e.target.value) || 0 })} />
                            <Input label={t('labels.gapY')} type="number" step="0.1" value={layout.gapYMm ?? 0}
                                onChange={(e) => setLayout({ gapYMm: parseFloat(e.target.value) || 0 })} />
                        </>
                    )}
                </div>
                {!isCustom && <p className="text-xs text-zinc-500">{t('labels.customHint')}</p>}

                {!compact && (
                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <Toggle checked={layout.showShopName} onChange={(v) => setLayout({ showShopName: v })} label={t('labels.showShopName')} />
                        <Toggle checked={layout.showLogo} onChange={(v) => setLayout({ showLogo: v })} label={t('labels.showLogo')} />
                        <Toggle checked={layout.showProductName} onChange={(v) => setLayout({ showProductName: v })} label={t('labels.showProductName')} />
                        <Toggle checked={layout.showVariant} onChange={(v) => setLayout({ showVariant: v })} label={t('labels.showVariant')} />
                        <Toggle checked={layout.showSku} onChange={(v) => setLayout({ showSku: v })} label="SKU" />
                        <Toggle checked={layout.showPrice} onChange={(v) => setLayout({ showPrice: v })} label={t('labels.showPrice')} />
                        <Toggle checked={layout.showBarcode} onChange={(v) => setLayout({ showBarcode: v })} label={t('labels.showBarcode')} />
                        <Input
                            label={t('labels.extraText')}
                            value={layout.extraText || ''}
                            onChange={(e) => setLayout({ extraText: e.target.value })}
                            containerClassName="col-span-2"
                        />
                    </div>
                )}
            </section>
        </div>
    );
}

export default PrinterSettingsForm;
