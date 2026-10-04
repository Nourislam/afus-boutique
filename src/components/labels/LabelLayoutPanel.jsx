import { useEffect, useRef, useState } from 'react';
import { Printer, FileDown, Save, Square, Circle, RectangleHorizontal } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { t } from '../../i18n';

export const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Saved label layout, templates and printers, loaded once per page. */
export function useLabelSetup() {
    const [templates, setTemplates] = useState({});
    const [layout, setLayout] = useState(null);
    const [printers, setPrinters] = useState([]);
    const [printerName, setPrinterName] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const [tpl, savedLayout, printerSettings, printerList] = await Promise.all([
                    window.electronAPI.labels.getTemplates(),
                    window.electronAPI.labels.getSettings(),
                    window.electronAPI.printers.getSettings(),
                    window.electronAPI.printers.list().catch(() => []),
                ]);
                setTemplates(tpl.templates);
                setLayout(savedLayout);
                setPrinterName(printerSettings.label.printerName || '');
                setPrinters(printerList);
            } catch (error) {
                toast.error(`${t('common.loadFailed')}: ${cleanError(error)}`);
            }
        })();
    }, []);

    return { templates, layout, setLayout, printers, printerName, setPrinterName };
}

const SHAPES = [
    { id: 'rect', icon: Square, label: 'labels.shapeRect' },
    { id: 'rounded', icon: RectangleHorizontal, label: 'labels.shapeRounded' },
    { id: 'round', icon: Circle, label: 'labels.shapeRound' },
];

/**
 * Label size, shape, printer, what to print on the label, live preview and
 * the print / PDF buttons. Shared by article labels and free barcodes.
 *
 * items: what labels.preview/print take ([{ variantId|productId|code, quantity, … }])
 * fields: [[layoutKey, text]] check boxes shown for this kind of label
 * children: extra settings shown above the check boxes (e.g. code type)
 */
export function LabelLayoutPanel({ setup, items, totalLabels, fields, children, beforePrint }) {
    const { templates, layout, setLayout, printers, printerName, setPrinterName } = setup;
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const timer = useRef(null);
    const setField = (patch) => setLayout(prev => ({ ...prev, ...patch }));

    // Live preview of the first labels (debounced)
    useEffect(() => {
        if (!layout) return undefined;
        clearTimeout(timer.current);
        if (!items.length) {
            setPreview(null);
            return undefined;
        }
        timer.current = setTimeout(async () => {
            try {
                const sample = [];
                let left = layout.mode === 'sheet' ? (layout.columns || 1) * (layout.rows || 1) : 3;
                for (const item of items) {
                    if (left <= 0) break;
                    const qty = Math.min(item.quantity, left);
                    sample.push({ ...item, quantity: qty });
                    left -= qty;
                }
                const result = await window.electronAPI.labels.preview(sample, layout);
                const count = sample.reduce((sum, i) => sum + i.quantity, 0);
                setPreview({ ...result, pages: layout.mode === 'sheet' ? 1 : Math.max(1, count) });
            } catch (error) {
                setPreview({ error: cleanError(error) });
            }
        }, 250);
        return () => clearTimeout(timer.current);
    }, [items, layout]);

    if (!layout) return null;

    const run = async (fn) => {
        if (totalLabels === 0) return toast.error(t('qr.addOne'));
        setBusy(true);
        try {
            const ready = beforePrint ? await beforePrint() : items;
            if (ready) await fn(ready);
        } catch (error) {
            toast.error(t('barcode.printFailed', { error: cleanError(error) }));
        } finally {
            setBusy(false);
        }
        return undefined;
    };
    const print = () => run(async (ready) => {
        const result = await window.electronAPI.labels.print(ready, layout, { printerName });
        if (result?.success) toast.success(t('labels.sent', { n: totalLabels }));
    });
    const pdf = () => run(async (ready) => {
        const file = await window.electronAPI.labels.savePdf(ready, layout);
        if (file) toast.success(t('common.savedTo', { path: file }));
    });
    const saveAsDefault = async () => {
        await window.electronAPI.settings.set({ key: 'label_settings', value: layout });
        toast.success(t('qr.savedDefault'));
    };

    const chooseTemplate = (id) => {
        if (id === 'custom') setField({ template: 'custom' });
        else setField({ template: id, ...(templates[id] || {}), shape: templates[id]?.shape || (layout.shape === 'round' ? 'rect' : layout.shape), name: undefined });
    };
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

    // Fit the preview page in the panel (CSS mm -> px at 96 dpi)
    const pageW = preview?.page ? preview.page.width * 96 / 25.4 : 0;
    const pageH = preview?.page ? preview.page.height * 96 / 25.4 : 0;
    const scale = pageW ? Math.min(2, 340 / pageW, preview.pages === 1 ? 300 / pageH : 2) : 1;
    const shape = layout.shape || 'rect';

    return (
        <div className="space-y-4">
            <div className="card p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <Select label={t('labels.size')} value={layout.template || 'roll-40x30'} onChange={chooseTemplate} options={templateOptions} />
                    <Select
                        label={t('printers.printer')}
                        value={printerName}
                        onChange={setPrinterName}
                        options={[
                            { value: '', label: t('qr.chooseInDialog') },
                            ...printers.map(p => ({ value: p.name, label: `${p.displayName}${p.isDefault ? ` (${t('labels.defaultPrinter')})` : ''}` })),
                        ]}
                    />
                    {layout.template === 'custom' && (
                        <>
                            <Select label={t('labels.layout')} value={layout.mode || 'roll'} onChange={(v) => setField({ mode: v })}
                                options={[{ value: 'roll', label: t('qr.roll') }, { value: 'sheet', label: t('qr.sheet') }]} />
                            <div />
                            <Input label={t('qr.width')} type="number" step="0.1" value={layout.widthMm} onChange={(e) => setField({ widthMm: parseFloat(e.target.value) || '' })} />
                            <Input label={t('qr.height')} type="number" step="0.1" value={layout.heightMm} onChange={(e) => setField({ heightMm: parseFloat(e.target.value) || '' })} />
                            {layout.mode === 'sheet' && (
                                <>
                                    <Input label={t('qr.perRow')} type="number" value={layout.columns} onChange={(e) => setField({ columns: parseInt(e.target.value, 10) || 1 })} />
                                    <Input label={t('qr.rows')} type="number" value={layout.rows} onChange={(e) => setField({ rows: parseInt(e.target.value, 10) || 1 })} />
                                </>
                            )}
                        </>
                    )}
                </div>

                <div>
                    <span className="form-label">{t('labels.shape')}</span>
                    <div className="segmented w-full">
                        {SHAPES.map(({ id, icon: Icon, label }) => (
                            <button key={id} type="button" className={`flex-1 inline-flex items-center justify-center gap-1.5 ${shape === id ? 'active' : ''}`}
                                onClick={() => setField(id === 'round'
                                    ? { shape: id, ...(layout.template === 'custom' || templates[layout.template]?.shape === 'round' ? {} : { template: 'round-40', ...templates['round-40'] }) }
                                    : { shape: id, ...(templates[layout.template]?.shape === 'round' ? { template: 'roll-40x30', ...templates['roll-40x30'], shape: id } : {}) })}>
                                <Icon className="w-4 h-4" /> {t(label)}
                            </button>
                        ))}
                    </div>
                </div>

                {children}

                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm pt-1">
                    {fields.map(([key, text]) => (
                        <label key={key} className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={!!(layout[key] ?? true)} onChange={(e) => setField({ [key]: e.target.checked })} className="w-4 h-4 rounded" />
                            {text}
                        </label>
                    ))}
                </div>
                <button type="button" onClick={saveAsDefault} className="text-xs text-zinc-400 hover:text-white flex items-center gap-1">
                    <Save className="w-3 h-3" /> {t('qr.saveDefault')}
                </button>
            </div>

            <div className="rounded-xl bg-zinc-800/80 border border-dark-border p-4 flex items-start justify-center min-h-[220px] max-h-[420px] overflow-auto">
                {!preview ? (
                    <span className="text-sm text-zinc-500 self-center">{t('qr.previewHere')}</span>
                ) : preview.error ? (
                    <span className="text-sm text-red-400 self-center text-center">{preview.error}</span>
                ) : (
                    <div dir="ltr" className="relative flex-none" style={{ width: pageW * scale, height: pageH * scale * preview.pages }}>
                        <iframe
                            className="absolute top-0 left-0"
                            title={t('qr.preview')}
                            sandbox=""
                            scrolling="no"
                            src={`data:text/html;charset=utf-8,${encodeURIComponent(preview.html)}`}
                            style={{ width: pageW, height: pageH * preview.pages, transform: `scale(${scale})`, transformOrigin: 'top left', background: 'white', border: 0 }}
                        />
                    </div>
                )}
            </div>
            <p className="text-xs text-zinc-500">
                {t('labels.previewNote', { size: preview?.page ? `${preview.page.width} × ${preview.page.height}` : '—' })}
            </p>

            <div className="flex gap-2">
                <Button className="flex-1" onClick={print} loading={busy} disabled={totalLabels === 0}>
                    <Printer className="w-4 h-4" /> {t('labels.printN', { n: totalLabels })}
                </Button>
                <Button variant="secondary" onClick={pdf} disabled={busy || totalLabels === 0}>
                    <FileDown className="w-4 h-4" /> PDF
                </Button>
            </div>
        </div>
    );
}
