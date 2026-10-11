import { useState } from 'react';
import { Percent, CreditCard, Smartphone, FileText, Wallet, Star } from 'lucide-react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { useSettingsStore } from '../../stores/settingsStore';
import { resolvePosControls } from '../../lib/posControls';
import { Switch } from './ModulesSettings';

const ROWS = [
    { group: 'discount', icon: Percent, keys: [{ key: 'discountCashier', icon: Percent }, { key: 'discountManager', icon: Percent }] },
    { group: 'payment', icon: Wallet, keys: [{ key: 'payCard', icon: CreditCard }, { key: 'payTransfer', icon: Smartphone }, { key: 'payCredit', icon: FileText, module: 'credit' }] },
];

/**
 * Settings › Sales screen (owner only): bargaining shown or not for the
 * cashiers and for the managers, and the payment methods offered at the
 * till. Applied at once, and checked again by the main process at every sale.
 */
export function PosControlsSettings() {
    const { t } = useT();
    const saved = useSettingsStore(state => state.settings.pos_controls);
    const features = useSettingsStore(state => state.settings.features) || {};
    const loadSettings = useSettingsStore(state => state.loadSettings);
    const [controls, setControls] = useState(() => resolvePosControls(saved));
    const [saving, setSaving] = useState('');

    const toggle = async (key, on) => {
        const previous = controls;
        const next = { ...controls, [key]: on };
        setControls(next);
        setSaving(key);
        try {
            await window.electronAPI.settings.set({ key: 'pos_controls', value: next });
            await loadSettings();
        } catch (error) {
            setControls(previous);
            toast.error(translateError(error));
        } finally {
            setSaving('');
        }
    };

    const [maxDraft, setMaxDraft] = useState(() => String(resolvePosControls(saved).cashierMaxDiscount));
    const saveMax = async () => {
        const value = Math.min(100, Math.max(0, Number(maxDraft) || 0));
        setMaxDraft(String(value));
        await toggle('cashierMaxDiscount', value);
    };

    // Loyalty: what one point is worth when turned into a voucher
    const savedLoyalty = useSettingsStore(state => state.settings.loyalty);
    const [pointValue, setPointValue] = useState(() => String(Number(savedLoyalty?.pointValue) || 0));
    const saveLoyalty = async () => {
        const value = Math.max(0, Number(pointValue) || 0);
        setSaving('loyalty');
        try {
            await window.electronAPI.settings.set({ key: 'loyalty', value: { pointValue: value } });
            await loadSettings();
            setPointValue(String(value));
            toast.success(t('loyalty.saved'));
        } catch (error) {
            toast.error(translateError(error));
        } finally {
            setSaving('');
        }
    };

    return (
        <div className="space-y-4" data-testid="pos-controls">
            {ROWS.map(({ group, icon: GroupIcon, keys }) => (
                <Card key={group} className="space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center flex-none"><GroupIcon className="w-5 h-5" /></div>
                        <div className="min-w-0">
                            <h3 className="font-semibold">{t(`posControls.${group}.title`)}</h3>
                            <p className="text-sm text-zinc-500">{t(`posControls.${group}.text`)}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {keys.map(({ key, icon: Icon, module }) => {
                            // Kridi needs its module (Settings › Modules)
                            const moduleOff = module && features[module] === false;
                            return (
                                <label key={key} className={`flex items-center gap-3 rounded-lg border border-dark-border px-3 py-2.5 ${moduleOff ? 'opacity-60' : 'cursor-pointer hover:border-zinc-600'}`}>
                                    <Icon className="w-4 h-4 text-zinc-400 flex-none" />
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-sm font-medium">{t(`posControls.${key}`)}</span>
                                        <span className="block text-xs text-zinc-500">{moduleOff ? t('posControls.moduleOff') : t(`posControls.${key}Hint`)}</span>
                                    </span>
                                    <Switch checked={!!controls[key] && !moduleOff} disabled={!!saving || moduleOff} onChange={(on) => toggle(key, on)} label={t(`posControls.${key}`)} />
                                </label>
                            );
                        })}
                    </div>
                    {/* How far a cashier goes alone; above it a manager's PIN (100 = no limit) */}
                    {group === 'discount' && controls.discountCashier && (
                        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dark-border px-3 py-2.5" data-testid="cashier-max-discount">
                            <Input label={t('posControls.cashierMax')} type="number" min="0" max="100" value={maxDraft}
                                onChange={(e) => setMaxDraft(e.target.value)} className="tabular w-28" />
                            <Button size="sm" variant="secondary" onClick={saveMax} loading={saving === 'cashierMaxDiscount'} disabled={!!saving} data-testid="cashier-max-save">{t('common.save')}</Button>
                            <p className="form-hint basis-full">{t('posControls.cashierMaxHint')}</p>
                        </div>
                    )}
                    {group === 'discount' && <p className="form-hint">{t('posControls.discount.ownerHint')}</p>}
                </Card>
            ))}
            <Card className="space-y-3" data-testid="loyalty-settings">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/15 text-amber-300 flex items-center justify-center flex-none"><Star className="w-5 h-5" /></div>
                    <div className="min-w-0">
                        <h3 className="font-semibold">{t('loyalty.settingsTitle')}</h3>
                        <p className="text-sm text-zinc-500">{t('loyalty.settingsText')}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <Input label={t('loyalty.pointValue')} type="number" min="0" step="0.5" value={pointValue} onChange={(e) => setPointValue(e.target.value)} className="tabular w-40" data-testid="loyalty-point-value" />
                    <Button onClick={saveLoyalty} loading={saving === 'loyalty'} disabled={!!saving} data-testid="loyalty-save">{t('common.save')}</Button>
                </div>
            </Card>
        </div>
    );
}

export default PosControlsSettings;
