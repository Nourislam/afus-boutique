import { t } from '../../i18n';
import { useState, useEffect } from 'react';
import { toast } from '../ui/Toast';
import { Banknote, Receipt, CreditCard, AlertCircle } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import confetti from 'canvas-confetti';

export default function ShiftSummaryDialog({ shiftId, onClose, onLogout }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [closingCash, setClosingCash] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    
    const { formatCurrency, settings } = useSettingsStore();

    useEffect(() => {
        loadStats();
    }, [shiftId]);

    const loadStats = async () => {
        try {
            const data = await window.electronAPI.shifts.getStats(shiftId);
            console.log('DEBUG: Shift Stats Received:', data);
            setStats(data);
            setClosingCash(data.expected_cash.toString());
        } catch (error) {
            console.error('Failed to load shift stats:', error);
            toast.error(t('shift.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handleCloseShift = async () => {
        if (!closingCash) {
            toast.error(t('shift.enterClosing'));
            return;
        }

        setSubmitting(true);
        try {
            await window.electronAPI.shifts.end({
                shiftId,
                closingCash: parseFloat(closingCash),
                notes
            });

            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 }
            });

            toast.success(t('shift.closed'));
            onLogout(); // Log the user out after closing shift
        } catch (error) {
            console.error('Failed to close shift:', error);
            toast.error(t('shift.closeFailed'));
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                <div className="animate-spin text-accent-primary">
                    <Banknote size={40} />
                </div>
            </div>
        );
    }

    if (!stats) return null;

    const cashDifference = parseFloat(closingCash || 0) - stats.expected_cash;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-scale-in">
                <div className="p-4 md:p-6 border-b border-dark-border">
                    <h2 className="text-xl md:text-2xl font-bold">{t('shift.summary')}</h2>
                    <p className="text-zinc-400 text-sm">{t('shift.summaryHint')}</p>
                </div>

                <div className="p-4 md:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Financial Stats */}
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-dark-tertiary p-4 rounded-xl">
                                <div className="text-zinc-400 text-sm mb-1 flex items-center gap-2">
                                    <Receipt size={14} /> {t('reports.totalSales')}
                                </div>
                                <div className="text-xl font-bold text-white">
                                    {formatCurrency(stats.total_sales)}
                                </div>
                                <div className="text-xs text-zinc-500 mt-1">
                                    {stats.total_transactions} transactions
                                </div>
                            </div>
                            <div className="bg-dark-tertiary p-4 rounded-xl">
                                <div className="text-zinc-400 text-sm mb-1 flex items-center gap-2">
                                    <CreditCard size={14} /> {t('shift.cashSales')}
                                </div>
                                <div className="text-xl font-bold text-emerald-400">
                                    {formatCurrency(stats.total_cash_sales)}
                                </div>
                            </div>
                        </div>

                        {/* Payment Method Breakdown */}
                        <div className="grid grid-cols-3 gap-2">
                            {stats.total_card_sales > 0 && (
                                <div className="bg-dark-tertiary/50 p-3 rounded-lg text-center">
                                    <div className="text-xs text-zinc-400">{t('pay.card')}</div>
                                    <div className="font-semibold text-blue-400">{formatCurrency(stats.total_card_sales)}</div>
                                </div>
                            )}
                            {stats.total_transfer_sales > 0 && (
                                <div className="bg-dark-tertiary/50 p-3 rounded-lg text-center">
                                    <div className="text-xs text-zinc-400">{t('pay.transferShort')}</div>
                                    <div className="font-semibold text-sky-400">{formatCurrency(stats.total_transfer_sales)}</div>
                                </div>
                            )}
                            {stats.total_credit_sales > 0 && (
                                <div className="bg-dark-tertiary/50 p-3 rounded-lg text-center">
                                    <div className="text-xs text-zinc-400">{t('pay.credit')}</div>
                                    <div className="font-semibold text-amber-400">{formatCurrency(stats.total_credit_sales)}</div>
                                </div>
                            )}
                            {stats.total_gift_card_sales > 0 && (
                                <div className="bg-dark-tertiary/50 p-3 rounded-lg text-center">
                                    <div className="text-xs text-zinc-400">{t('pay.giftCard')}</div>
                                    <div className="font-semibold text-purple-400">{formatCurrency(stats.total_gift_card_sales)}</div>
                                </div>
                            )}
                        </div>

                        <div className="bg-dark-tertiary/50 p-4 rounded-xl space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-zinc-400">{t('shift.openingCash')}</span>
                                <span className="font-medium">{formatCurrency(stats.opening_cash)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-zinc-400">{t('shift.cashSales')}</span>
                                <span className="font-medium text-emerald-400">+ {formatCurrency(stats.total_cash_sales)}</span>
                            </div>
                            {stats.total_refunds > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-zinc-400">{t('shift.refunds')}</span>
                                    <span className="font-medium text-red-400">- {formatCurrency(stats.total_refunds)}</span>
                                </div>
                            )}
                            <div className="h-px bg-dark-border my-2"></div>
                            <div className="flex justify-between text-base font-bold">
                                <span>{t('shift.expectedCash')}</span>
                                <span className="text-accent-primary">{formatCurrency(stats.expected_cash)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Closing Entry */}
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-2">{t('shift.closingCash')}</label>
                            <div className="flex items-center input w-full h-14 px-4 gap-2 focus-within:ring-2 focus-within:ring-accent-primary focus-within:border-transparent transition-all">
                                <span className="text-zinc-400 font-medium whitespace-nowrap">{settings?.currencySymbol || '$'}</span>
                                <input
                                    type="number"
                                    value={closingCash}
                                    onChange={(e) => setClosingCash(e.target.value)}
                                    className="input-transparent no-spinners w-full text-2xl font-bold p-0 placeholder:text-zinc-600 focus:ring-0 text-white"
                                    placeholder="0.00"
                                    autoFocus
                                />
                            </div>
                            {closingCash && (
                                <div className={`mt-2 flex items-center gap-2 text-sm ${
                                    Math.abs(cashDifference) < 0.01 ? 'text-emerald-400' : 
                                    cashDifference > 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}>
                                    <AlertCircle size={14} />
                                    {Math.abs(cashDifference) < 0.01 
                                        ? t('shift.match') 
                                        : t(cashDifference > 0 ? 'shift.over' : 'shift.short', { amount: formatCurrency(Math.abs(cashDifference)) })
                                    }
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm text-zinc-400 mb-2">{t('shift.notesOptional')}</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="input w-full h-24 resize-none py-3"
                                placeholder={t('shift.notesPlaceholder')}
                            />
                        </div>

                        <div className="flex gap-3 mt-auto">
                            <button
                                onClick={onClose}
                                className="btn btn-ghost flex-1"
                                disabled={submitting}
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                onClick={handleCloseShift}
                                className="btn btn-primary flex-1"
                                disabled={submitting || !closingCash}
                            >
                                {submitting ? t('shift.closing') : t('shift.closeAndLogout')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
