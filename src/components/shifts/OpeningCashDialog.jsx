import { t } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { currentLanguage } from '../../i18n';
import { currencySymbolFor } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../ui/Toast';
import { NumPad } from '../ui/NumPad';
import { formatMoney, formatDate } from '../../i18n/format';
import ShiftSummaryDialog from './ShiftSummaryDialog';

export default function OpeningCashDialog({ employee, onSuccess, onCancel }) {
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [otherOpen, setOtherOpen] = useState([]);
    const [lastClosed, setLastClosed] = useState(null);
    const [closing, setClosing] = useState(null); // another employee's open drawer being closed
    const { settings } = useSettingsStore();

    // One drawer per shop: a colleague's drawer left open is closed (counted)
    // before a new one is opened, and its counted cash is the new opening amount.
    const loadHandover = async () => {
        try {
            const [open, last] = await Promise.all([
                window.electronAPI.shifts.getOpen(),
                window.electronAPI.shifts.getLastClosed(),
            ]);
            setOtherOpen((open || []).filter(s => s.employee_id !== employee.id));
            setLastClosed(last || null);
            if (last && last.closing_cash !== null && last.closing_cash !== undefined) {
                setAmount(prev => (prev === '' ? String(last.closing_cash) : prev));
            }
        } catch { /* the dialog still works without the handover hints */ }
    };

    useEffect(() => { loadHandover(); }, [employee.id]);

    const handleSubmit = async () => {
        if (!amount || parseFloat(amount) < 0) {
            toast.error(t('shift.enterValidAmount'));
            return;
        }

        setLoading(true);
        try {
            // Start the shift
            const result = await window.electronAPI.shifts.start({
                employeeId: employee.id,
                openingCash: parseFloat(amount),
                notes: t('shift.started')
            });

            if (result) {
                // Shift started successfully, proceed with login flow
                onSuccess(result);
            }
        } catch (error) {
            console.error('Failed to start shift:', error);
            toast.error(translateError(error) || t('shift.startFailed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="card w-full max-w-md p-6 animate-scale-in">
                <h2 className="text-2xl font-bold mb-2">{t('shift.openingCash')}</h2>
                <p className="text-zinc-400 mb-4">
                    {t('shift.openingCashHint')}
                </p>

                {otherOpen.map(shift => (
                    <div key={shift.id} className="mb-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-300 flex-none mt-0.5" />
                        <div className="flex-1">
                            <p>{t('shift.otherOpen', { name: shift.employee_name || '?', time: formatDate(shift.start_time, 'datetime') })}</p>
                            <button type="button" className="mt-1 text-amber-200 underline underline-offset-2" onClick={() => setClosing(shift)}>
                                {t('shift.closeTheirs')}
                            </button>
                        </div>
                    </div>
                ))}
                {lastClosed && lastClosed.closing_cash !== null && lastClosed.closing_cash !== undefined && (
                    <p className="mb-4 text-xs text-zinc-500">
                        {t('shift.lastCounted', { name: lastClosed.employee_name || '?', amount: formatMoney(lastClosed.closing_cash) })}
                    </p>
                )}

                <div className="mb-8">
                    <div className="flex items-center input w-full h-20 px-6 gap-3 bg-dark-tertiary focus-within:ring-2 focus-within:ring-accent-primary focus-within:border-transparent transition-all">
                        <span className="text-zinc-400 text-xl font-medium whitespace-nowrap">{currencySymbolFor(currentLanguage(), settings?.currency)}</span>
                        <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            autoFocus
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, '').slice(0, 9))}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                            data-scan-passthrough
                            className="input-transparent no-spinners w-full text-3xl font-bold text-center p-0 placeholder:text-zinc-600 focus:ring-0 text-white"
                            placeholder="0"
                        />
                    </div>
                </div>

                <div className="mb-6">
                    <NumPad
                        value={amount}
                        onChange={setAmount}
                        onEnter={handleSubmit}
                        maxLength={6}
                    />
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={onCancel}
                        className="btn btn-secondary flex-1"
                        disabled={loading}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="btn btn-primary flex-1 h-12 text-lg"
                        disabled={loading || !amount}
                    >
                        {loading ? t('shift.starting') : t('shift.start')}
                    </button>
                </div>
            </div>

            {closing && (
                <ShiftSummaryDialog
                    shiftId={closing.id}
                    mode="close"
                    ownerName={closing.employee_name}
                    onClose={() => setClosing(null)}
                    onLogout={() => { setClosing(null); setAmount(''); loadHandover(); }}
                />
            )}
        </div>
    );
}
