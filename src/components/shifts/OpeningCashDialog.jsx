import { t } from '../../i18n';
import { currentLanguage } from '../../i18n';
import { currencySymbolFor } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../ui/Toast';
import { NumPad } from '../ui/NumPad';

export default function OpeningCashDialog({ employee, onSuccess, onCancel }) {
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuthStore();
    const { settings } = useSettingsStore();

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
            toast.error(error.message || t('shift.startFailed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="card w-full max-w-md p-6 animate-scale-in">
                <h2 className="text-2xl font-bold mb-2">{t('shift.openingCash')}</h2>
                <p className="text-zinc-400 mb-6">
                    {t('shift.openingCashHint')}
                </p>

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
        </div>
    );
}
