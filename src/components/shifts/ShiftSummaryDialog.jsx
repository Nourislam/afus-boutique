import { useState, useEffect, useMemo } from 'react';
import { Banknote, Receipt, AlertCircle, Clock, Shirt, Calculator, LogOut, CheckCircle2 } from 'lucide-react';
import { toast } from '../ui/Toast';
import { Button } from '../ui/Button';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatMoney, formatDate, currencySymbolFor } from '../../i18n/format';
import { t, currentLanguage } from '../../i18n';

// Algerian notes and coins, for counting the drawer
const DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 20, 10, 5];

export const formatDuration = (minutes) => {
    const m = Math.max(0, Math.round(minutes || 0));
    return t('shift.duration', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
};

/**
 * Closing a cash drawer: what the employee sold, the cash that should be in
 * the drawer, and the cash actually counted. The count is typed before the
 * expected amount is shown, so the difference is honest.
 *
 * mode 'logout': opened when leaving; can also leave with the drawer open.
 * mode 'close': closing someone's drawer (handover) without logging out.
 */
export default function ShiftSummaryDialog({ shiftId, onClose, onLogout, mode = 'logout', ownerName }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [closingCash, setClosingCash] = useState('');
    const [counts, setCounts] = useState({});
    const [showCounter, setShowCounter] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const currentEmployee = useAuthStore(state => state.currentEmployee);
    const settings = useSettingsStore(state => state.settings);

    useEffect(() => {
        let cancelled = false;
        window.electronAPI.shifts.getStats(shiftId)
            .then(data => { if (!cancelled) setStats(data); })
            .catch(() => toast.error(t('shift.loadFailed')))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [shiftId]);

    const counted = useMemo(
        () => DENOMINATIONS.reduce((sum, d) => sum + d * (parseInt(counts[d], 10) || 0), 0),
        [counts],
    );
    useEffect(() => { if (showCounter) setClosingCash(counted ? String(counted) : ''); }, [counted, showCounter]);

    const handleCloseShift = async () => {
        if (closingCash === '' || Number(closingCash) < 0) return toast.error(t('shift.enterClosing'));
        if (!revealed) { setRevealed(true); return undefined; }
        setSubmitting(true);
        try {
            const byOther = currentEmployee && stats.employee_id && currentEmployee.id !== stats.employee_id;
            await window.electronAPI.shifts.end({
                shiftId,
                closingCash: parseFloat(closingCash),
                notes: [notes, byOther ? t('shift.closedByNote', { name: currentEmployee.name }) : ''].filter(Boolean).join(' — '),
                closedBy: currentEmployee?.id,
                // The detail of the notes and coins counted, kept with the drawer
                cashCount: showCounter ? counts : null,
            });
            toast.success(t('shift.closed'));
            window.dispatchEvent(new Event('pos:shift-changed'));
            onLogout();
        } catch {
            toast.error(t('shift.closeFailed'));
            setSubmitting(false);
        }
        return undefined;
    };

    if (loading) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                <Banknote size={40} className="animate-pulse text-indigo-400" />
            </div>
        );
    }
    if (!stats) return null;

    const difference = closingCash === '' ? null : Math.round((parseFloat(closingCash) - stats.expected_cash) * 100) / 100;
    const otherMethods = [
        ['pay.card', stats.total_card_sales],
        ['pay.transferShort', stats.total_transfer_sales],
        ['pay.credit', stats.total_credit_sales],
        ['pay.giftCard', stats.total_gift_card_sales],
    ].filter(([, v]) => v > 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
            <div className="card p-0 w-full max-w-3xl max-h-[92vh] overflow-y-auto animate-scale-in">
                <div className="px-6 py-4 border-b border-dark-border flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold">{t('shift.summary')}{ownerName ? ` — ${ownerName}` : ''}</h2>
                        <p className="text-zinc-500 text-sm">
                            {t('shift.openedAt', { time: formatDate(stats.start_time, 'datetime') })} · <Clock className="inline w-3.5 h-3.5" /> {formatDuration(stats.duration_minutes)}
                        </p>
                    </div>
                </div>

                <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* What happened during the shift */}
                    <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-dark-tertiary p-3 rounded-xl">
                                <div className="text-zinc-500 text-xs mb-1 flex items-center gap-1.5"><Receipt size={13} /> {t('reports.totalSales')}</div>
                                <div className="text-lg font-bold tabular">{formatMoney(stats.total_sales)}</div>
                            </div>
                            <div className="bg-dark-tertiary p-3 rounded-xl">
                                <div className="text-zinc-500 text-xs mb-1">{t('shift.tickets')}</div>
                                <div className="text-lg font-bold tabular">{stats.total_transactions}</div>
                            </div>
                            <div className="bg-dark-tertiary p-3 rounded-xl">
                                <div className="text-zinc-500 text-xs mb-1 flex items-center gap-1.5"><Shirt size={13} /> {t('shift.pieces')}</div>
                                <div className="text-lg font-bold tabular">{stats.items_sold}</div>
                            </div>
                        </div>

                        {otherMethods.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {otherMethods.map(([key, value]) => (
                                    <span key={key} className="badge bg-dark-tertiary text-zinc-300">{t(key)}: <span className="tabular">{formatMoney(value)}</span></span>
                                ))}
                            </div>
                        )}

                        <div className="bg-dark-tertiary/50 p-4 rounded-xl space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-zinc-400">{t('shift.openingCash')}</span><span className="tabular">{formatMoney(stats.opening_cash)}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-400">{t('shift.cashSales')}</span><span className="tabular text-emerald-400">+ {formatMoney(stats.total_cash_sales)}</span></div>
                            {stats.credit_collected_cash > 0 && (
                                <div className="flex justify-between"><span className="text-zinc-400">{t('shift.creditCollected')}</span><span className="tabular text-emerald-400">+ {formatMoney(stats.credit_collected_cash)}</span></div>
                            )}
                            {stats.total_cash_refunds > 0 && (
                                <div className="flex justify-between"><span className="text-zinc-400">{t('shift.refunds')}</span><span className="tabular text-red-400">- {formatMoney(stats.total_cash_refunds)}</span></div>
                            )}
                            {stats.total_expenses > 0 && (
                                <div className="flex justify-between"><span className="text-zinc-400">{t('expense.inDrawer')}</span><span className="tabular text-red-400">- {formatMoney(stats.total_expenses)}</span></div>
                            )}
                            <div className="h-px bg-dark-border" />
                            <div className="flex justify-between text-base font-bold">
                                <span>{t('shift.expectedCash')}</span>
                                <span className="tabular">{revealed ? formatMoney(stats.expected_cash) : '••••'}</span>
                            </div>
                        </div>
                        {!revealed && <p className="form-hint">{t('shift.blindHint')}</p>}
                    </div>

                    {/* Counting */}
                    <div className="space-y-4">
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm text-zinc-400">{t('shift.closingCash')}</label>
                                <button type="button" onClick={() => setShowCounter(v => !v)} className="text-xs text-indigo-300 hover:text-indigo-200 flex items-center gap-1">
                                    <Calculator className="w-3.5 h-3.5" /> {t('shift.countNotes')}
                                </button>
                            </div>
                            <div className="flex items-center input h-14 px-4 gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    value={closingCash}
                                    onChange={(e) => { setShowCounter(false); setClosingCash(e.target.value); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleCloseShift(); }}
                                    className="input-transparent no-spinners w-full text-2xl font-bold p-0 focus:ring-0 text-white tabular"
                                    placeholder="0"
                                    autoFocus
                                    data-scan-passthrough
                                />
                                <span className="text-zinc-500 font-medium">{currencySymbolFor(currentLanguage(), settings?.currency)}</span>
                            </div>
                            {showCounter && (
                                <div className="grid grid-cols-3 gap-2 mt-3">
                                    {DENOMINATIONS.map(d => (
                                        <label key={d} className="flex items-center gap-1.5 bg-dark-tertiary rounded-lg px-2 py-1.5">
                                            <span className="text-xs text-zinc-400 w-12 tabular">{d}</span>
                                            <span className="text-zinc-600">×</span>
                                            <input type="number" min="0" className="input-transparent no-spinners w-full text-sm tabular p-0 focus:ring-0"
                                                value={counts[d] ?? ''} placeholder="0"
                                                onChange={(e) => setCounts(prev => ({ ...prev, [d]: e.target.value }))} />
                                        </label>
                                    ))}
                                </div>
                            )}
                            {revealed && difference !== null && (
                                <div className={`mt-3 flex items-center gap-2 text-sm font-medium ${Math.abs(difference) < 0.01 ? 'text-emerald-400' : difference > 0 ? 'text-amber-300' : 'text-rose-400'}`}>
                                    {Math.abs(difference) < 0.01 ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                    {Math.abs(difference) < 0.01
                                        ? t('shift.match')
                                        : t(difference > 0 ? 'shift.over' : 'shift.short', { amount: formatMoney(Math.abs(difference)) })}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm text-zinc-400 mb-2">{t('shift.notesOptional')}</label>
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input h-20 resize-none py-2" placeholder={t('shift.notesPlaceholder')} />
                        </div>

                        <div className="flex flex-col gap-2">
                            <Button onClick={handleCloseShift} loading={submitting} disabled={closingCash === ''} className="w-full">
                                {!revealed ? t('shift.checkCount') : mode === 'logout' ? t('shift.closeAndLogout') : t('shift.closeDrawer')}
                            </Button>
                            <div className="flex gap-2">
                                <Button variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
                                {/* Leave without closing (lunch break…): the drawer stays open in this employee's name */}
                                {mode === 'logout' && (
                                    <Button variant="ghost" className="flex-1" onClick={() => onLogout({ keptOpen: true })} disabled={submitting} title={t('shift.keepOpenHint')}>
                                        <LogOut className="w-4 h-4 flip-rtl" /> {t('shift.keepOpen')}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
