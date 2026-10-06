import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';

/**
 * What a cashier may do without a manager (owner only): the biggest discount
 * given by hand, and returns / exchanges. Saved in settings.security and
 * checked by the main process at every sale and return.
 */
export default function CashierRights() {
    const { t } = useT();
    const [rules, setRules] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        window.electronAPI.auth.rules().then(setRules).catch(() => setRules({ cashierMaxDiscount: 0, cashierReturns: false }));
    }, []);

    if (!rules) return null;

    const save = async () => {
        setSaving(true);
        try {
            const max = Math.min(100, Math.max(0, parseFloat(rules.cashierMaxDiscount) || 0));
            await window.electronAPI.settings.set({ key: 'security', value: { cashierMaxDiscount: max, cashierReturns: !!rules.cashierReturns } });
            setRules({ ...rules, cashierMaxDiscount: max });
            toast.success(t('rights.saved'));
        } catch (e) {
            toast.error(translateError(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="card p-5 space-y-4 max-w-2xl" data-testid="cashier-rights">
            <div>
                <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-300" /> {t('rights.title')}</h2>
                <p className="text-sm text-zinc-400">{t('rights.text')}</p>
            </div>
            <Input label={t('rights.maxDiscount')} type="number" min="0" max="100" value={rules.cashierMaxDiscount}
                onChange={(e) => setRules({ ...rules, cashierMaxDiscount: e.target.value })} className="ltr w-32" />
            <p className="form-hint">{t('rights.maxDiscountHint')}</p>
            <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={!!rules.cashierReturns} onChange={(e) => setRules({ ...rules, cashierReturns: e.target.checked })} />
                <span>
                    <span className="block font-medium">{t('rights.returns')}</span>
                    <span className="block text-sm text-zinc-400">{t('rights.returnsHint')}</span>
                </span>
            </label>
            <Button onClick={save} loading={saving}>{t('common.save')}</Button>
        </section>
    );
}
