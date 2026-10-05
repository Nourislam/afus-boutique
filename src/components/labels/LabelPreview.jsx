import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { t } from '../../i18n';

export const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/**
 * Labels drawn at their real proportions, exactly as they will print.
 * items: what labels.preview takes; [{ sample: true }] shows an example article.
 * layout: label settings (the saved ones, or the ones being edited).
 * printer: { dpi } of the label printer, to warn about codes too small to scan.
 */
export function LabelPreview({ items, layout, printer, maxWidth = 340, maxHeight = 300, className = '' }) {
    const [preview, setPreview] = useState(null);
    const timer = useRef(null);

    useEffect(() => {
        if (!layout) return undefined;
        clearTimeout(timer.current);
        if (!items?.length) {
            setPreview(null);
            return undefined;
        }
        timer.current = setTimeout(async () => {
            try {
                // Only the first labels: enough to judge, fast to draw
                const sample = [];
                let left = layout.mode === 'sheet' ? (layout.columns || 1) * (layout.rows || 1) : 2;
                for (const item of items) {
                    if (left <= 0) break;
                    const qty = Math.min(Math.max(1, parseInt(item.quantity, 10) || 1), left);
                    sample.push({ ...item, quantity: qty });
                    left -= qty;
                }
                const result = await window.electronAPI.labels.preview(sample, layout, printer);
                const count = sample.reduce((sum, i) => sum + i.quantity, 0);
                setPreview({ ...result, pages: layout.mode === 'sheet' ? 1 : Math.max(1, count) });
            } catch (error) {
                setPreview({ error: cleanError(error) });
            }
        }, 200);
        return () => clearTimeout(timer.current);
    }, [items, layout, printer?.dpi]);

    // CSS mm -> px at 96 dpi, scaled to fit the box
    const pageW = preview?.page ? preview.page.width * 96 / 25.4 : 0;
    const pageH = preview?.page ? preview.page.height * 96 / 25.4 : 0;
    const scale = pageW ? Math.min(2.2, maxWidth / pageW, maxHeight / pageH) : 1;
    const gap = 12;
    // One line per code type that is too small, whatever the number of labels
    const issues = [];
    for (const issue of preview?.issues || []) {
        const key = `${issue.kind}:${issue.symbology}`;
        if (!issues.some(i => i.key === key)) issues.push({ ...issue, key });
    }

    return (
        <div className="space-y-2">
            <div className={`rounded-xl bg-zinc-800/80 border border-dark-border p-4 flex items-start justify-center min-h-[200px] overflow-auto ${className}`}>
                {!preview ? (
                    <span className="text-sm text-zinc-500 self-center">{t('qr.previewHere')}</span>
                ) : preview.error ? (
                    <span className="text-sm text-red-400 self-center text-center">{preview.error}</span>
                ) : (
                    // Each roll label is its own page: show them one under the other
                    <div dir="ltr" className="relative flex-none" style={{ width: pageW * scale, height: (pageH * scale + gap) * preview.pages - gap }}>
                        <iframe
                            className="absolute top-0 left-0"
                            title={t('qr.preview')}
                            sandbox=""
                            scrolling="no"
                            // srcDoc, not a data: URL (limited to about 2 MB: many labels with a logo)
                            srcDoc={preview.html}
                            style={{ width: pageW, height: pageH * preview.pages, transform: `scale(${scale})`, transformOrigin: 'top left', background: 'white', border: 0, borderRadius: 4 }}
                        />
                    </div>
                )}
            </div>
            {issues.map(issue => (
                <p key={issue.key} className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    <AlertTriangle className="w-4 h-4 flex-none" />
                    <span>{issue.error
                        ? t('printing.codeError', { error: issue.error })
                        : t(issue.kind === 'bars' ? 'printing.barsUnreadable' : 'printing.codeUnreadable', { size: Math.round(issue.moduleMm * 100) / 100, min: Math.round(issue.minMm * 100) / 100 })}</span>
                </p>
            ))}
        </div>
    );
}

export default LabelPreview;
