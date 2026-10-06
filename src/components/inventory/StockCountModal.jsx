import { useState, useEffect, useCallback, useRef } from 'react';
import { ClipboardCheck, ScanLine, Trash2 } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { formatMoney, formatDate } from '../../i18n/format';
import { translateError } from '../../i18n/errors';
import { variantLabel } from '../../lib/clothing';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { useAuthStore } from '../../stores/authStore';

const diffClass = (d) => (d < 0 ? 'text-red-400' : d > 0 ? 'text-amber-300' : 'text-emerald-400');
const signed = (d) => (d > 0 ? `+${d}` : String(d));

/**
 * Stock count: start (whole shop or one section), scan or type what is on the
 * shelves, see expected / found / difference, then confirm with a reason.
 * The stock changes only when the count is confirmed (main process).
 */
export default function StockCountModal({ isOpen, onClose, onConfirmed }) {
    const { t } = useT();
    const user = useAuthStore(state => state.currentEmployee);
    const [summary, setSummary] = useState(null);
    const [report, setReport] = useState(null);
    const [history, setHistory] = useState([]);
    const [categories, setCategories] = useState([]);
    const [scope, setScope] = useState('all');
    const [code, setCode] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [lastError, setLastError] = useState('');
    const inputRef = useRef(null);

    const refresh = useCallback(async (countId) => {
        const data = countId ? await window.electronAPI.stockCount.summary(countId) : await window.electronAPI.stockCount.current();
        setSummary(data);
        return data;
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        setReport(null); setReason(''); setLastError(''); setCode('');
        refresh().catch(() => setSummary(null));
        window.electronAPI.categories.getAll().then(rows => setCategories(rows || [])).catch(() => setCategories([]));
        window.electronAPI.stockCount.list(10).then(rows => setHistory(rows || [])).catch(() => setHistory([]));
    }, [isOpen, refresh]);

    const count = summary?.count?.status === 'open' ? summary.count : null;

    const addCode = useCallback(async (value) => {
        const text = String(value || '').trim();
        if (!text || !count) return;
        try {
            await window.electronAPI.stockCount.scan({ countId: count.id, code: text });
            setLastError('');
            await refresh(count.id);
        } catch (e) {
            const message = translateError(e);
            setLastError(message);
            toast.error(message);
        }
    }, [count, refresh]);

    // A USB scanner works anywhere in the window while the count is open
    useBarcodeScanner((scanned) => addCode(scanned), { isActive: () => isOpen && !!count && !report });

    const start = async () => {
        setBusy(true);
        try {
            const data = await window.electronAPI.stockCount.start({ categoryId: scope === 'all' ? null : scope, employeeId: user?.id || null });
            setSummary(data);
            setTimeout(() => inputRef.current?.focus(), 50);
        } catch (e) {
            toast.error(translateError(e));
        } finally {
            setBusy(false);
        }
    };

    const setCounted = async (line, value) => {
        try {
            await window.electronAPI.stockCount.setCounted({ countId: count.id, lineId: line.id, counted: value });
            await refresh(count.id);
        } catch (e) {
            toast.error(translateError(e));
        }
    };

    const removeLine = async (line) => {
        try {
            await window.electronAPI.stockCount.removeLine({ countId: count.id, lineId: line.id });
            await refresh(count.id);
        } catch (e) {
            toast.error(translateError(e));
        }
    };

    const cancel = async () => {
        if (!confirm(t('count.cancelConfirm'))) return;
        try {
            await window.electronAPI.stockCount.cancel(count.id);
            toast.success(t('count.cancelled'));
            setSummary(null);
            onClose();
        } catch (e) {
            toast.error(translateError(e));
        }
    };

    const confirmCount = async () => {
        if (!reason.trim()) { toast.error(t('errors.COUNT_REASON_REQUIRED')); return; }
        setBusy(true);
        try {
            const done = await window.electronAPI.stockCount.confirm({ countId: count.id, reason: reason.trim(), employeeId: user?.id || null });
            setReport(done);
            setSummary(null);
            toast.success(t('count.confirmed'));
            onConfirmed?.();
        } catch (e) {
            toast.error(translateError(e));
        } finally {
            setBusy(false);
        }
    };

    const scopeName = (c) => (c?.category_id ? (categories.find(x => x.id === c.category_id)?.name || c.category_name) : t('count.wholeShop'));
    const shown = report || summary;
    const lines = shown?.lines || [];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('count.title')} size="full">
            <ModalBody>
                <div className="space-y-4" data-testid="stock-count">
                    {!count && !report && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            <div className="space-y-3">
                                <p className="text-sm text-zinc-400">{t('count.intro')}</p>
                                <Select label={t('count.scope')} value={scope} onChange={setScope}
                                    options={[{ value: 'all', label: t('count.wholeShop') }, ...categories.map(c => ({ value: c.id, label: c.name }))]} />
                                <Button onClick={start} loading={busy}><ClipboardCheck className="w-4 h-4" /> {t('count.start')}</Button>
                            </div>
                            <div>
                                <h3 className="font-semibold mb-2">{t('count.history')}</h3>
                                {history.length === 0 ? <p className="text-sm text-zinc-500">{t('count.noHistory')}</p> : (
                                    <ul className="divide-y divide-dark-border text-sm">
                                        {history.map(h => (
                                            <li key={h.id} className="py-2 flex justify-between gap-3">
                                                <span className="min-w-0 truncate">{formatDate(h.confirmed_at || h.created_at, 'datetime')} · {scopeName(h)} · {t(`count.status.${h.status}`)}</span>
                                                <span className={`tabular ${diffClass(h.difference)}`}>{h.status === 'confirmed' ? signed(h.difference) : ''}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}

                    {(count || report) && (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-zinc-400">
                                    {scopeName(shown.count)} · {t('count.startedAt', { time: formatDate(shown.count.created_at, 'datetime') })}
                                    {report && <> · <span className="text-emerald-400">{t('count.status.confirmed')}</span> — {report.count.reason}</>}
                                </p>
                                {count && (
                                    <div className="flex items-end gap-2">
                                        <Input ref={inputRef} containerClassName="w-72" value={code} placeholder={t('count.scanHint')} autoFocus
                                            onChange={(e) => setCode(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { addCode(code); setCode(''); } }} />
                                        <Button variant="secondary" onClick={() => { addCode(code); setCode(''); }}><ScanLine className="w-4 h-4" /></Button>
                                    </div>
                                )}
                            </div>
                            {lastError && count && <p className="text-sm text-red-400" role="alert">{lastError}</p>}

                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                                <div className="bg-dark-tertiary rounded-lg p-3"><p className="text-zinc-500">{t('count.counted')}</p><p className="text-lg font-bold tabular">{shown.pieces_counted}</p></div>
                                <div className="bg-dark-tertiary rounded-lg p-3"><p className="text-zinc-500">{t('count.shortage')}</p><p className="text-lg font-bold tabular text-red-400">{shown.shortage_pieces}</p><p className="text-xs text-zinc-500"><bdi>{formatMoney(shown.shortage_value)}</bdi></p></div>
                                <div className="bg-dark-tertiary rounded-lg p-3"><p className="text-zinc-500">{t('count.surplus')}</p><p className="text-lg font-bold tabular text-amber-300">{shown.surplus_pieces}</p><p className="text-xs text-zinc-500"><bdi>{formatMoney(shown.surplus_value)}</bdi></p></div>
                                <div className="bg-dark-tertiary rounded-lg p-3"><p className="text-zinc-500">{t('count.same')}</p><p className="text-lg font-bold tabular text-emerald-400">{shown.unchanged}</p></div>
                                <div className="bg-dark-tertiary rounded-lg p-3"><p className="text-zinc-500">{t('count.notCounted')}</p><p className="text-lg font-bold tabular">{shown.not_counted}</p><p className="text-xs text-zinc-500">{t('count.notCountedHint')}</p></div>
                            </div>

                            <div className="border border-dark-border rounded-lg overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-dark-tertiary text-zinc-400">
                                        <tr>
                                            <th className="p-2 text-start">{t('inventory.product')}</th>
                                            <th className="p-2 text-start">{t('products.sku')}</th>
                                            <th className="p-2 text-end">{t('count.expected')}</th>
                                            <th className="p-2 text-end">{t('count.found')}</th>
                                            <th className="p-2 text-end">{t('count.difference')}</th>
                                            {count && <th className="p-2" />}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-dark-border">
                                        {lines.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-zinc-500">{t('count.empty')}</td></tr>}
                                        {lines.map(l => (
                                            <tr key={l.id}>
                                                <td className="p-2"><span className="font-medium">{l.product_name}</span>{(l.color || l.size) && <span className="text-zinc-400"> · {variantLabel(l)}</span>}</td>
                                                <td className="p-2 text-zinc-400 ltr">{l.sku || '-'}</td>
                                                <td className="p-2 text-end tabular">{l.expected}</td>
                                                <td className="p-2 text-end">
                                                    {count ? (
                                                        <input type="number" min="0" defaultValue={l.counted} key={`${l.id}-${l.counted}`}
                                                            onBlur={(e) => { if (String(l.counted) !== e.target.value) setCounted(l, e.target.value); }}
                                                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                                            className="w-20 bg-zinc-900 border border-dark-border rounded px-2 py-1 text-center" aria-label={t('count.found')} />
                                                    ) : <span className="tabular">{l.counted}</span>}
                                                </td>
                                                <td className={`p-2 text-end font-semibold tabular ${diffClass(l.difference)}`}>{signed(l.difference)}</td>
                                                {count && <td className="p-2 text-end"><button type="button" onClick={() => removeLine(l)} className="text-zinc-500 hover:text-red-400" aria-label={t('common.delete')}><Trash2 className="w-4 h-4" /></button></td>}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {count && (
                                <Input label={t('count.reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('count.reasonPlaceholder')} />
                            )}
                        </>
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                {count && <Button variant="danger" onClick={cancel} className="me-auto">{t('count.cancel')}</Button>}
                <Button variant="secondary" onClick={onClose}>{count ? t('count.later') : t('common.close')}</Button>
                {count && <Button onClick={confirmCount} loading={busy} disabled={lines.length === 0}>{t('count.confirm')}</Button>}
            </ModalFooter>
        </Modal>
    );
}
