import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, FileDown, Settings2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { LabelPreview, cleanError } from './LabelPreview';
import { t } from '../../i18n';
import { translateError } from '../../i18n/errors';

export { cleanError };

const CODE_NAMES = { qr: 'QR', ean13: 'EAN-13', code128: 'Code 128', code39: 'Code 39', datamatrix: 'DataMatrix' };

/**
 * The label look saved in Settings (size, shape, code type, what is printed)
 * and the label printer. Pages only read it; it is changed in Settings.
 */
export function useLabelSetup() {
    const [layout, setLayout] = useState(null);
    const [templates, setTemplates] = useState({});
    const [printer, setPrinter] = useState({});

    useEffect(() => {
        const load = async () => {
            try {
                const [tpl, saved, printers] = await Promise.all([
                    window.electronAPI.labels.getTemplates(),
                    window.electronAPI.labels.getSettings(),
                    window.electronAPI.printers.getSettings(),
                ]);
                setTemplates(tpl.templates);
                setLayout(saved);
                setPrinter(printers.label || {});
            } catch (error) {
                toast.error(`${t('common.loadFailed')}: ${cleanError(error)}`);
            }
        };
        load();
        // Saved in Settings while this page is open
        window.addEventListener('pos:settings-changed', load);
        return () => window.removeEventListener('pos:settings-changed', load);
    }, []);

    return { layout, templates, printer };
}

/** "40 × 30 mm · Round · EAN-13 · one code per article" */
export function layoutSummary(layout, templates = {}) {
    if (!layout) return [];
    const tpl = templates[layout.template];
    const size = layout.template !== 'custom' && tpl
        ? (tpl.shape === 'round' ? `Ø ${tpl.widthMm} mm` : `${tpl.widthMm} × ${tpl.heightMm} mm`)
        : `${layout.widthMm} × ${layout.heightMm} mm`;
    const shape = { rect: 'labels.shapeRect', rounded: 'labels.shapeRounded', round: 'labels.shapeRound' }[layout.shape || 'rect'];
    return [
        size,
        t(shape),
        CODE_NAMES[layout.codeType || 'qr'] || layout.codeType,
        t(layout.codeScope === 'article' ? 'labels.scope.articleShort' : 'labels.scope.variantShort'),
    ];
}

/**
 * Preview of what is about to print (with the saved look), and the print /
 * PDF buttons. Codes still missing are created when printing.
 *
 * items: what labels.print takes ([{ variantId|productId|code, quantity, … }])
 * beforePrint: optional async check returning the items to print (or null)
 */
export function LabelPrintPanel({ setup, items, totalLabels, beforePrint, onPrinted }) {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const { layout, templates, printer } = setup;
    if (!layout) return null;

    const run = async (fn) => {
        if (totalLabels === 0) return toast.error(t('qr.addOne'));
        setBusy(true);
        try {
            const ready = beforePrint ? await beforePrint() : items;
            if (ready) await fn(ready);
        } catch (error) {
            toast.error(t('barcode.printFailed', { error: translateError(error) }));
        } finally {
            setBusy(false);
        }
        return undefined;
    };
    const print = () => run(async (ready) => {
        const result = await window.electronAPI.labels.print(ready, layout, printer);
        if (result?.created) toast.success(t('labels.codesCreated', { n: result.created }));
        if (result?.success) toast.success(t('labels.sent', { n: result.printed || totalLabels }));
        if (result?.issues?.length) toast.warning(t('printing.issuesAfterPrint'), 8000);
        onPrinted?.(result);
    });
    const pdf = () => run(async (ready) => {
        const file = await window.electronAPI.labels.savePdf(ready, layout);
        if (file) toast.success(t('common.savedTo', { path: file }));
        onPrinted?.();
    });

    return (
        <div className="space-y-3">
            <div className="card p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                    {layoutSummary(layout, templates).map((part, i) => (
                        <span key={part} className="badge bg-dark-tertiary text-zinc-300"><bdi dir={i === 0 ? 'ltr' : undefined}>{part}</bdi></span>
                    ))}
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate('/settings?tab=labelPrinter')} title={t('labels.changeInSettings')}>
                    <Settings2 className="w-4 h-4" /> <span className="hidden sm:inline">{t('labels.changeInSettings')}</span>
                </Button>
            </div>

            <LabelPreview items={items.length ? items : [{ sample: true, quantity: 1 }]} layout={layout} printer={{ dpi: printer.dpi || 0 }} />
            <p className="text-xs text-zinc-500">
                {items.length ? t('labels.previewReal') : t('labels.previewSample')}
                {' '}{printer.printerName ? t('printing.printsOn', { name: printer.printerName }) : t('printing.opensDialog')}
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
