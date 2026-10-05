import { useState } from 'react';
import {
    Rows3, LayoutGrid, CreditCard, Users, Percent, PackageOpen, Gift, Truck, FileText, Mail, Globe, ShoppingBag, Boxes, Wifi,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { useSettingsStore } from '../../stores/settingsStore';
import { saveUiMode } from '../../lib/uiMode';
import { MODULE_GROUPS, MODULE_REQUIRES, resolveFeatures, offersEnabled } from '../../lib/features';

const MODULE_ICONS = {
    credit: CreditCard, customers: Users, promotions: Percent, bundles: PackageOpen, giftCards: Gift,
    suppliers: Truck, purchaseOrders: FileText, email: Mail, ecommerce: Globe,
};
const GROUP_ICONS = { sales: ShoppingBag, offers: Percent, stock: Boxes, online: Wifi };

/** On / off switch with its label (a real checkbox, for the keyboard and screen readers). */
function Switch({ checked, disabled, onChange, label }) {
    return (
        <span className="relative inline-flex flex-none">
            <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
            <span className={`w-10 h-6 rounded-full transition-colors ${checked ? 'bg-indigo-500' : 'bg-zinc-600'} ${disabled ? 'opacity-40' : ''} peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400`} />
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'start-5' : 'start-1'}`} />
        </span>
    );
}

/**
 * Settings › Modules: simple or full menu, and every optional module shown
 * or hidden. Applied at once: a hidden module leaves the menu, its tabs and
 * its buttons; its data is kept.
 */
export function ModulesSettings({ features, onFeaturesChange }) {
    const { t } = useT();
    const uiMode = useSettingsStore(state => state.settings.uiMode);
    const loadSettings = useSettingsStore(state => state.loadSettings);
    const [saving, setSaving] = useState('');

    const chooseMode = async (mode) => {
        if (mode === uiMode) return;
        try {
            await saveUiMode(mode);
            toast.success(t(mode === 'simple' ? 'nav.mode.nowSimple' : 'nav.mode.nowFull'));
        } catch (error) {
            toast.error(translateError(error));
        }
    };

    const toggle = async (key, on) => {
        const next = resolveFeatures({ ...features, [key]: on });
        const previous = features;
        onFeaturesChange(next);
        setSaving(key);
        try {
            await window.electronAPI.settings.set({ key: 'features', value: next });
            await loadSettings();
            window.dispatchEvent(new Event('pos:settings-changed'));
        } catch (error) {
            onFeaturesChange(previous);
            toast.error(translateError(error));
        } finally {
            setSaving('');
        }
    };

    return (
        <div className="space-y-4">
            {/* Simple or full menu */}
            <Card className="space-y-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-none"><Rows3 className="w-5 h-5" /></div>
                    <div className="min-w-0">
                        <h3 className="font-semibold">{t('nav.mode.title')}</h3>
                        <p className="text-sm text-zinc-500">{t('nav.mode.text')}</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[{ id: 'simple', icon: Rows3 }, { id: 'full', icon: LayoutGrid }].map(({ id, icon: Icon }) => (
                        <button key={id} type="button" onClick={() => chooseMode(id)} aria-pressed={uiMode === id}
                            className={`p-4 rounded-lg border text-start transition-colors ${uiMode === id ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-600'}`}>
                            <p className="text-sm font-semibold flex items-center gap-2"><Icon className="w-4 h-4 flex-none" /> {t(`nav.mode.${id}`)}</p>
                            <p className="text-xs text-zinc-500 mt-1">{t(`nav.mode.${id}Hint`)}</p>
                        </button>
                    ))}
                </div>
            </Card>

            {/* Optional modules, by what they are for */}
            <Card className="space-y-1">
                <div className="flex items-start gap-3 pb-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center flex-none"><LayoutGrid className="w-5 h-5" /></div>
                    <div className="min-w-0">
                        <h3 className="font-semibold">{t('modules.title')}</h3>
                        <p className="text-sm text-zinc-500">{t('modules.text')}</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {MODULE_GROUPS.map(group => {
                        const GroupIcon = GROUP_ICONS[group.id];
                        return (
                            <section key={group.id} className="rounded-xl border border-dark-border">
                                <h4 className="flex items-center gap-2 px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                    <GroupIcon className="w-4 h-4" /> {t(`modules.group.${group.id}`)}
                                </h4>
                                <ul className="divide-y divide-dark-border">
                                    {group.modules.map(key => {
                                        const Icon = MODULE_ICONS[key];
                                        const needs = MODULE_REQUIRES[key];
                                        const blocked = needs && !features[needs];
                                        const on = !!features[key] && !blocked;
                                        return (
                                            <li key={key}>
                                                <label className={`flex items-center gap-3 px-4 py-3 ${blocked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-dark-tertiary/40'}`}>
                                                    <Icon className={`w-5 h-5 flex-none ${on ? 'text-indigo-400' : 'text-zinc-500'}`} />
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-sm font-medium">{t(`settings.feature.${key}`)}</span>
                                                        <span className="block text-xs text-zinc-500">
                                                            {blocked ? t('modules.needs', { name: t(`settings.feature.${needs}`) }) : t(`settings.feature.${key}Hint`)}
                                                        </span>
                                                    </span>
                                                    <Switch checked={on} disabled={blocked || saving === key} onChange={(v) => toggle(key, v)} label={t(`settings.feature.${key}`)} />
                                                </label>
                                            </li>
                                        );
                                    })}
                                </ul>
                                {group.id === 'offers' && !offersEnabled(features) && (
                                    <p className="px-4 pb-3 text-xs text-amber-400">{t('modules.offersHidden')}</p>
                                )}
                            </section>
                        );
                    })}
                </div>
                <p className="text-xs text-zinc-500 pt-2">{t('modules.appliedNow')}</p>
            </Card>
        </div>
    );
}

export default ModulesSettings;
