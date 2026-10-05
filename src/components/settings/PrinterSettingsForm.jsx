import { t } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    RefreshCw, Printer, Tag, Square, Circle, RectangleHorizontal, QrCode, Barcode, Layers, Shirt,
    CheckCircle2, AlertTriangle, Info, Receipt, Minus, Plus, Ruler, Eye, FlaskConical,
} from 'lucide-react';
import { toast } from '../ui/Toast';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { LabelPreview } from '../labels/LabelPreview';

function Toggle({ checked, onChange, label, hint, disabled = false }) {
    return (
        <label className={`flex items-start gap-3 select-none rounded-lg border border-dark-border px-3 py-2.5 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-zinc-600'}`}>
            <input
                type="checkbox"
                checked={!!checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded bg-dark-tertiary border-dark-border flex-none"
            />
            <span className="min-w-0">
                <span className="text-sm">{label}</span>
                {hint && <span className="block text-xs text-zinc-500 mt-0.5">{hint}</span>}
            </span>
        </label>
    );
}

/** One block of settings: a numbered title, a one-line explanation, the fields. */
export function Panel({ icon: Icon, title, hint, children, className = '', actions = null }) {
    return (
        <section className={`card space-y-4 ${className}`}>
            <div className="flex items-start gap-3">
                {Icon && (
                    <div className="w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center flex-none">
                        <Icon className="w-[18px] h-[18px]" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <h4 className="font-semibold leading-tight">{title}</h4>
                    {hint && <p className="text-xs text-zinc-500 mt-1">{hint}</p>}
                </div>
                {actions}
            </div>
            {children}
        </section>
    );
}

/** Printers installed in Windows / macOS, with a refresh button. */
function usePrinterList() {
    const [printerList, setPrinterList] = useState([]);
    const [loading, setLoading] = useState(true);
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
    return { printerList, loading, reload: load };
}

// Same rule as the main process (printDocument.matchPrinter)
const norm = (v) => String(v || '').trim().toLowerCase();
function findPrinter(list, name) {
    return list.find(p => p.name === name) || list.find(p => norm(p.name) === norm(name) || norm(p.displayName) === norm(name)) || null;
}

/**
 * What happens when printing:
 *  direct  - the saved printer is installed: printed straight away, no window
 *  missing - the saved printer is not installed any more: the print window opens
 *  none    - no printer saved: the print window opens to choose one
 *  unknown - the system did not give its list of printers: the saved one is tried
 */
export function printerState(list, saved) {
    if (!saved) return 'none';
    if (list.loading) return 'checking';
    if (!list.printerList.length) return 'unknown';
    return findPrinter(list.printerList, saved) ? 'direct' : 'missing';
}

const STATE_STYLE = {
    direct: { icon: CheckCircle2, cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
    missing: { icon: AlertTriangle, cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
    none: { icon: Info, cls: 'border-dark-border bg-dark-tertiary text-zinc-300' },
    unknown: { icon: Info, cls: 'border-dark-border bg-dark-tertiary text-zinc-300' },
    checking: { icon: RefreshCw, cls: 'border-dark-border bg-dark-tertiary text-zinc-400' },
};

export function PrinterStatus({ state, name }) {
    const { icon: Icon, cls } = STATE_STYLE[state] || STATE_STYLE.none;
    return (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`} role="status">
            <Icon className={`w-4 h-4 mt-0.5 flex-none ${state === 'checking' ? 'animate-spin' : ''}`} />
            <span className="min-w-0">{t(`printing.state.${state}`, { name })}</span>
        </div>
    );
}

/** The printer saved for tickets or labels; it is only changed here, in Settings. */
function PrinterPicker({ value, onChange, list }) {
    const saved = value || '';
    const known = saved && !list.loading && list.printerList.length && !findPrinter(list.printerList, saved);
    const options = [
        { value: '', label: t('printing.noPrinter') },
        ...list.printerList.map(p => ({ value: p.name, label: `${p.displayName || p.name}${p.isDefault ? ` (${t('common.default')})` : ''}` })),
        // A saved printer that is gone stays visible, marked, instead of looking unset
        ...(known ? [{ value: saved, label: t('printing.notFoundOption', { name: saved }) }] : []),
    ];
    return (
        <div className="space-y-2">
            <div className="flex items-end gap-2">
                <Select label={t('printers.printer')} value={saved} onChange={onChange} options={options} className="flex-1 min-w-0" />
                <Button type="button" variant="secondary" onClick={list.reload} loading={list.loading} aria-label={t('printers.refresh')} title={t('printers.refresh')}>
                    <RefreshCw className="w-4 h-4" />
                </Button>
            </div>
            <PrinterStatus state={printerState(list, saved)} name={saved} />
            {list.printerList.length === 0 && !list.loading && <p className="text-xs text-amber-400">{t('printers.none')}</p>}
        </div>
    );
}

// What happens to the ticket after a sale (older settings only had autoPrint)
export const afterSaleMode = (receipt = {}) => receipt.afterSale || (receipt.autoPrint ? 'print' : 'preview');

function Stepper({ label, value, min = 1, max = 5, onChange }) {
    const set = (v) => onChange(Math.min(max, Math.max(min, v)));
    return (
        <div className="form-group">
            <span className="form-label">{label}</span>
            <div className="inline-flex items-center rounded-lg border border-dark-border bg-dark-tertiary h-10">
                <button type="button" className="w-10 h-full flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-40" onClick={() => set(value - 1)} disabled={value <= min} aria-label="-">
                    <Minus className="w-4 h-4" />
                </button>
                <span className="w-10 text-center font-semibold tabular-nums">{value}</span>
                <button type="button" className="w-10 h-full flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-40" onClick={() => set(value + 1)} disabled={value >= max} aria-label="+">
                    <Plus className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

/** Ticket (receipt) printer: printer, paper, copies and what happens after a sale. */
export function ReceiptPrinterForm({ printers, onPrintersChange }) {
    const list = usePrinterList();
    const receipt = printers.receipt || {};
    const setReceipt = (patch) => onPrintersChange({ ...printers, receipt: { ...receipt, ...patch } });
    const mode = afterSaleMode(receipt);
    const paper = parseInt(receipt.paperWidthMm, 10) === 58 ? 58 : 80;

    return (
        <div className="space-y-5">
            <PrinterPicker value={receipt.printerName} onChange={(v) => setReceipt({ printerName: v })} list={list} />
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <div className="form-group">
                    <span className="form-label">{t('printers.paperWidth')}</span>
                    <div className="segmented">
                        {[80, 58].map(w => (
                            <button key={w} type="button" onClick={() => setReceipt({ paperWidthMm: w })} className={paper === w ? 'active' : ''}>
                                <bdi>{t(w === 80 ? 'printers.roll80' : 'printers.roll58')}</bdi>
                            </button>
                        ))}
                    </div>
                </div>
                <Stepper label={t('printers.copies')} value={Math.max(1, parseInt(receipt.copies, 10) || 1)} onChange={(v) => setReceipt({ copies: v })} />
            </div>

            <div>
                <span className="form-label">{t('printers.afterSale')}</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1.5">
                    {['print', 'preview', 'none'].map(id => (
                        <button key={id} type="button" onClick={() => setReceipt({ afterSale: id, autoPrint: id === 'print' })}
                            aria-pressed={mode === id}
                            className={`p-3 rounded-lg border text-start transition-colors ${mode === id ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-600'}`}>
                            <p className="text-sm font-medium">{t(`printers.after.${id}`)}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{t(`printers.after.${id}Hint`)}</p>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** An example sale, in the shop's language, for the preview and the test ticket. */
export function sampleSale() {
    return {
        id: 'test', receipt_number: 'TEST-0001', created_at: new Date().toISOString(), employee_name: t('printers.testName'),
        items: [
            { product_name: t('printers.testItem1'), quantity: 1, unit_price: 2500, total: 2500, size: 'M', color: 'Noir', color_code: 'black', sku: 'TSH-BLK-M-001' },
            { product_name: t('printers.testItem2'), quantity: 2, unit_price: 1200, total: 2400, sku: 'SOC-002' },
        ],
        subtotal: 4900, tax_amount: 0, discount_amount: 0, total: 4900,
        payments: [{ method: 'cash', amount: 4900, reference: JSON.stringify({ tendered: 5000 }) }],
    };
}

/**
 * The real ticket (the same document that is printed), with the settings
 * being edited, drawn at the width of the paper roll.
 * shop: ticket fields not saved yet (header, footer, Afus line, shop details)
 */
export function ReceiptPreview({ shop = {}, paperWidthMm = 80 }) {
    const [html, setHtml] = useState('');
    const [height, setHeight] = useState(420);
    const [error, setError] = useState('');
    const frame = useRef(null);
    const sale = useMemo(() => sampleSale(), []);
    const key = JSON.stringify(shop);

    useEffect(() => {
        const timer = setTimeout(async () => {
            try {
                setHtml(await window.electronAPI.receipts.getHtml(sale, { ...shop, receiptPaperWidthMm: paperWidthMm }));
                setError('');
            } catch (err) {
                setError(translateError(err));
            }
        }, 200);
        return () => clearTimeout(timer);
    }, [key, paperWidthMm, sale]);

    // Paper width at 96 dpi; the ticket is as long as its content
    const widthPx = Math.round(paperWidthMm * 96 / 25.4);
    const scale = Math.min(1, 300 / widthPx);
    const measure = () => {
        try {
            const doc = frame.current?.contentDocument;
            if (doc?.body) setHeight(Math.max(200, Math.ceil(doc.body.getBoundingClientRect().height) + 4));
        } catch { /* cross-origin: keep the default height */ }
    };

    if (error) return <p className="text-sm text-red-400">{error}</p>;
    return (
        <div className="rounded-xl bg-zinc-800/80 border border-dark-border p-4 flex justify-center overflow-hidden">
            <div dir="ltr" className="relative flex-none shadow-lg" style={{ width: widthPx * scale, height: height * scale }}>
                {html && (
                    <iframe
                        ref={frame}
                        title={t('printing.ticketPreview')}
                        // same-origin only to read the height; scripts stay blocked
                        sandbox="allow-same-origin"
                        scrolling="no"
                        srcDoc={html}
                        onLoad={measure}
                        className="absolute top-0 left-0"
                        style={{ width: widthPx, height, transform: `scale(${scale})`, transformOrigin: 'top left', background: 'white', border: 0 }}
                    />
                )}
            </div>
        </div>
    );
}

// A valid EAN-13 (check digit 8) and a QR text, printed on the label printer
const TEST_EAN = '2000000000008';
const TEST_QR = 'AFUS-TEST-QR';

/**
 * Four test prints, each with the settings on screen (saved or not):
 * a ticket, an article label, a barcode label and a QR label.
 */
export function PrintTestPanel({ printers, layout, shop, only }) {
    const [running, setRunning] = useState('');
    const receipt = printers?.receipt || {};
    const label = printers?.label || {};
    const title = t('printing.testLabelTitle');

    const tests = [
        {
            id: 'receipt', icon: Receipt, printer: receipt.printerName,
            run: () => window.electronAPI.receipts.print(sampleSale(), { ...receipt, shop }).then(ok => ({ success: ok !== false })),
        },
        { id: 'label', icon: Tag, printer: label.printerName, run: () => window.electronAPI.labels.print([{ sample: true, quantity: 1 }], layout, label) },
        { id: 'barcode', icon: Barcode, printer: label.printerName, run: () => window.electronAPI.labels.print([{ code: TEST_EAN, symbology: 'ean13', title, price: 2500, quantity: 1 }], layout, label) },
        { id: 'qr', icon: QrCode, printer: label.printerName, run: () => window.electronAPI.labels.print([{ code: TEST_QR, symbology: 'qrcode', title, quantity: 1 }], layout, label) },
    ].filter(test => !only || only.includes(test.id));

    const run = async (test) => {
        setRunning(test.id);
        try {
            const result = await test.run();
            if (result?.success) toast.success(t('printers.testSent'));
            if (result?.issues?.length) toast.warning(t('printing.issuesAfterPrint'), 8000);
        } catch (error) {
            toast.error(t('barcode.printFailed', { error: translateError(error) }));
        } finally {
            setRunning('');
        }
    };

    return (
        <div className="space-y-2">
            {tests.map(test => {
                const Icon = test.icon;
                return (
                    <div key={test.id} className="flex items-center gap-3 rounded-lg border border-dark-border px-3 py-2.5">
                        <Icon className="w-5 h-5 text-zinc-400 flex-none" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{t(`printing.test.${test.id}`)}</p>
                            <p className="text-xs text-zinc-500 break-words">
                                {test.printer ? t('printing.printsOn', { name: test.printer }) : t('printing.opensDialog')}
                            </p>
                        </div>
                        <Button type="button" size="sm" variant="secondary" onClick={() => run(test)} loading={running === test.id} disabled={!!running && running !== test.id}>
                            <Printer className="w-4 h-4" /> {t('printing.print')}
                        </Button>
                    </div>
                );
            })}
        </div>
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
const TEMPLATE_GROUPS = ['roll', 'round', 'sheet'];
const groupOf = (tpl) => (tpl.shape === 'round' ? 'round' : tpl.mode === 'sheet' ? 'sheet' : 'roll');

/** A template drawn at its proportions, with its size under it. */
function TemplateTile({ tpl, active, onClick, children }) {
    const round = tpl && tpl.shape === 'round';
    const w = tpl ? tpl.widthMm : 40;
    const h = tpl ? tpl.heightMm : 30;
    const k = 30 / Math.max(w, h);
    return (
        <button type="button" onClick={onClick} aria-pressed={active}
            className={`h-[88px] p-2 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition-colors ${active ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-dark-border text-zinc-400 hover:text-white hover:border-zinc-600'}`}>
            <span className="flex-none flex items-center justify-center h-[34px]">
                {tpl
                    ? <span className={`block border-2 ${active ? 'border-indigo-400' : 'border-zinc-500'} ${round ? 'rounded-full' : 'rounded-[3px]'}`} style={{ width: w * k, height: h * k }} />
                    : <Ruler className="w-6 h-6" />}
            </span>
            <span className="text-xs font-medium leading-tight text-center">{children}</span>
        </button>
    );
}

const fmtMm = (v) => String(Math.round(v * 100) / 100);

/**
 * Label printer and the look of every label, set once here: size, shape,
 * code type, one code per colour/size or per article, and what is printed.
 * The preview is drawn exactly as the labels will print; a code that the
 * label is too small to print readably is shown as unavailable.
 */
export function LabelPrinterForm({ printers, onPrintersChange, labels, onLabelsChange, compact = false, shop }) {
    const list = usePrinterList();
    const [templates, setTemplates] = useState({});
    const [defaults, setDefaults] = useState({});
    const [codeOptions, setCodeOptions] = useState(null);

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
    const codeType = layout.codeType || 'qr';
    const isRound = (layout.shape || 'rect') === 'round';
    const qrSide = codeType === 'qr' && !isRound;
    const perArticle = layout.codeScope === 'article';

    // Which codes can be read on this size, at this printer resolution
    const optionsKey = JSON.stringify([layout, label.dpi]);
    useEffect(() => {
        if (!Object.keys(defaults).length) return undefined;
        const timer = setTimeout(() => {
            window.electronAPI.labels.codeOptions(layout, { dpi: label.dpi || 0 })
                .then(setCodeOptions)
                .catch(() => setCodeOptions(null));
        }, 150);
        return () => clearTimeout(timer);
    }, [optionsKey, defaults]);

    const barsOk = !codeOptions || codeOptions.bars?.ok;
    // A barcode strip that cannot be scanned on this size is not printed
    useEffect(() => {
        if (codeOptions && layout.showBarcode && (!qrSide || !codeOptions.bars?.ok)) setLayout({ showBarcode: false });
    }, [codeOptions, qrSide]);

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

    const tooSmall = (opt) => opt && opt.ok === false && opt.moduleMm
        ? t('printing.tooSmall', { size: fmtMm(opt.moduleMm), min: fmtMm(opt.minMm) })
        : t('printing.notPossible');
    const current = codeOptions?.codeTypes?.[codeType];
    const firstOk = codeOptions ? CODE_TYPES.find(c => codeOptions.codeTypes[c.id]?.ok) : null;
    const tpl = templates[layout.template];

    const printerPanel = (
        <Panel icon={Printer} title={t('printers.label')} hint={t('printing.labelPrinterHint')}>
            <PrinterPicker value={label.printerName} onChange={(v) => setLabelPrinter({ printerName: v })} list={list} />
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
            <p className="form-hint">{t('printing.dpiHint')}</p>
        </Panel>
    );

    const sizePanel = (
        <Panel icon={Tag} title={t('labels.sizeAndShape')} hint={t('printing.sizeHint')}>
            {TEMPLATE_GROUPS.map(group => {
                const entries = Object.entries(templates).filter(([, tp]) => groupOf(tp) === group);
                if (!entries.length) return null;
                return (
                    <div key={group}>
                        <p className="text-xs font-medium text-zinc-500 mb-1.5">{t(`printing.group.${group}`)}</p>
                        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))' }}>
                            {entries.map(([id, tp]) => (
                                <TemplateTile key={id} tpl={tp} active={layout.template === id} onClick={() => chooseTemplate(id)}>
                                    <bdi dir="ltr">{tp.shape === 'round' ? `Ø ${tp.widthMm}` : `${tp.widthMm} × ${tp.heightMm}`}</bdi>
                                    {group === 'sheet' && <span className="block text-[10px] text-zinc-500"><bdi dir="ltr">A4 · {tp.columns} × {tp.rows}</bdi></span>}
                                    {id === 'tag-35x55' && <span className="block text-[10px] text-zinc-500">{t('printing.hangTag')}</span>}
                                </TemplateTile>
                            ))}
                            {group === 'sheet' && (
                                <TemplateTile active={isCustom} onClick={() => chooseTemplate('custom')}>{t('printing.customSize')}</TemplateTile>
                            )}
                        </div>
                    </div>
                );
            })}

            {!isRound && (
                <div>
                    <span className="form-label">{t('labels.shape')}</span>
                    <div className="segmented w-full mt-1.5">
                        {SHAPES.filter(s => s.id !== 'round' || isCustom).map(({ id, icon: Icon, label: text }) => (
                            <button key={id} type="button" onClick={() => chooseShape(id)}
                                className={`flex-1 inline-flex items-center justify-center gap-1.5 min-w-0 ${(layout.shape || 'rect') === id ? 'active' : ''}`}>
                                <Icon className="w-4 h-4 flex-none" /> <span className="truncate">{t(text)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {isCustom && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg border border-dark-border p-3">
                    <Select label={t('labels.layout')} value={layout.mode || 'roll'} onChange={(v) => setLayout({ mode: v })} className="col-span-2"
                        options={[{ value: 'roll', label: t('labels.rollMode') }, { value: 'sheet', label: t('labels.sheetMode') }]} />
                    <Input label={t('labels.width')} type="number" step="0.1" min="10" value={layout.widthMm ?? ''} onChange={(e) => setLayout({ widthMm: parseFloat(e.target.value) || '' })} />
                    <Input label={t('labels.height')} type="number" step="0.1" min="10" value={layout.heightMm ?? ''} onChange={(e) => setLayout({ heightMm: parseFloat(e.target.value) || '' })} />
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
                    <Input label={t('labels.padding')} type="number" step="0.1" min="0" value={layout.paddingMm ?? 1.5} onChange={(e) => setLayout({ paddingMm: parseFloat(e.target.value) || 0 })} />
                </div>
            )}
            {tpl && <p className="form-hint">{t('printing.chosenSize', { size: tpl.shape === 'round' ? `Ø ${tpl.widthMm} mm` : `${tpl.widthMm} × ${tpl.heightMm} mm` })}</p>}
        </Panel>
    );

    const codePanel = (
        <Panel icon={QrCode} title={t('labels.codeOnLabel')} hint={t('printing.codeHint')}>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
                {CODE_TYPES.map(({ id, name, icon: Icon }) => {
                    const opt = codeOptions?.codeTypes?.[id];
                    const off = opt && !opt.ok && codeType !== id;
                    return (
                        <button key={id} type="button" onClick={() => !off && setLayout({ codeType: id })} disabled={off}
                            aria-pressed={codeType === id}
                            title={off ? tooSmall(opt) : undefined}
                            className={`min-h-[44px] px-2 py-1.5 rounded-lg border text-sm font-medium flex flex-col items-center justify-center transition-colors ${codeType === id ? 'border-indigo-500 bg-indigo-500/10 text-white' : off ? 'border-dark-border text-zinc-600 cursor-not-allowed' : 'border-dark-border text-zinc-400 hover:text-white hover:border-zinc-600'}`}>
                            <span className="flex items-center gap-1.5"><Icon className="w-4 h-4 flex-none" /> <span className="ltr truncate">{name}</span></span>
                            {off && <span className="text-[10px] font-normal leading-tight">{t('printing.tooSmallShort')}</span>}
                        </button>
                    );
                })}
            </div>
            {current && !current.ok ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
                    <AlertTriangle className="w-4 h-4 flex-none" />
                    <span className="flex-1 min-w-[12rem]">{t('printing.currentUnreadable')} {tooSmall(current)}</span>
                    {firstOk && (
                        <Button type="button" size="sm" variant="secondary" onClick={() => setLayout({ codeType: firstOk.id })}>
                            {t('printing.useCode', { name: firstOk.name })}
                        </Button>
                    )}
                </div>
            ) : (
                <p className="form-hint">{t(`labels.codeHint.${codeType}`)}</p>
            )}
            {CODE_TYPES.some(c => codeOptions?.codeTypes?.[c.id]?.ok === false) && <p className="text-xs text-zinc-500">{t('printing.disabledWhy')}</p>}

            <div>
                <span className="form-label">{t('printing.codeFor')}</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                    {[
                        { id: 'variant', icon: Layers },
                        { id: 'article', icon: Shirt },
                    ].map(({ id, icon: Icon }) => (
                        <button key={id} type="button" onClick={() => setLayout({ codeScope: id, ...(id === 'article' ? { showVariant: false } : {}) })}
                            aria-pressed={(layout.codeScope || 'variant') === id}
                            className={`p-3 rounded-lg border text-start transition-colors ${(layout.codeScope || 'variant') === id ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-600'}`}>
                            <p className="text-sm font-medium flex items-center gap-2"><Icon className="w-4 h-4 flex-none" /> {t(`labels.scope.${id}`)}</p>
                            <p className="text-xs text-zinc-500 mt-1">{t(`labels.scope.${id}Hint`)}</p>
                        </button>
                    ))}
                </div>
            </div>
        </Panel>
    );

    const contentPanel = (
        <Panel icon={Barcode} title={t('labels.whatPrinted')} hint={t('printing.contentHint')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Toggle checked={layout.showShopName} onChange={(v) => setLayout({ showShopName: v })} label={t('labels.showShopName')} />
                <Toggle checked={layout.showLogo} onChange={(v) => setLayout({ showLogo: v })} label={t('labels.showLogo')} hint={shop && !shop.shopLogo ? t('printing.noLogoYet') : null} />
                <Toggle checked={layout.showProductName} onChange={(v) => setLayout({ showProductName: v })} label={t('labels.showProductName')} />
                <Toggle checked={layout.showVariant && !perArticle} disabled={perArticle} onChange={(v) => setLayout({ showVariant: v })}
                    label={t('labels.showVariant')} hint={perArticle ? t('labels.variantOffArticle') : null} />
                <Toggle checked={layout.showSku} onChange={(v) => setLayout({ showSku: v })} label={t('labels.showCodeText')} />
                <Toggle checked={layout.showPrice} onChange={(v) => setLayout({ showPrice: v })} label={t('labels.showPrice')} />
                {qrSide && (
                    <Toggle checked={layout.showBarcode && barsOk} disabled={!barsOk} onChange={(v) => setLayout({ showBarcode: v })}
                        label={t('labels.showBarcode')} hint={!barsOk ? t('printing.barsTooSmall') : t('printing.barsHint')} />
                )}
            </div>
            <Input label={t('labels.extraText')} value={layout.extraText || ''} onChange={(e) => setLayout({ extraText: e.target.value })} placeholder={t('printing.extraPlaceholder')} />
        </Panel>
    );

    return (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] gap-4 items-start">
            <div className="space-y-4 min-w-0">
                {printerPanel}
                {sizePanel}
                {codePanel}
                {!compact && contentPanel}
            </div>

            {/* Live preview and tests, kept in view while the settings scroll */}
            <div className="min-w-0 space-y-4 xl:sticky xl:top-0">
                <Panel icon={Eye} title={t('qr.preview')} hint={t('labels.settingsPreviewNote')}>
                    <LabelPreview items={SAMPLE} layout={layout} printer={{ dpi: label.dpi || 0 }} maxWidth={290} maxHeight={240} />
                </Panel>
                <Panel icon={FlaskConical} title={t('printing.testsTitle')} hint={t('printing.testsHint')}>
                    <PrintTestPanel printers={printers} layout={layout} only={['label', 'barcode', 'qr']} />
                </Panel>
            </div>
        </div>
    );
}

/** Both printers on one screen (first start-up wizard). */
export function PrinterSettingsForm(props) {
    return (
        <div className="space-y-4">
            <Panel icon={Receipt} title={t('printers.receipt')} hint={t('printing.receiptPrinterHint')}>
                <ReceiptPrinterForm {...props} />
            </Panel>
            <LabelPrinterForm {...props} compact />
        </div>
    );
}

export default PrinterSettingsForm;
