import { useEffect, useState } from 'react';
import { Palette, Ruler, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/ui/Toast';
import { PermissionGate } from '../components/auth/PermissionGate';
import { PERMISSIONS } from '../stores/authStore';
import {
    COLORS, SIZE_SETS, getCatalogCustomization, setCatalogCustomization, onCatalogCustomization, sizeLabel, sizeSetLabel,
} from '../lib/clothing';
import { t, useT } from '../i18n';

/** Shop colours and sizes, saved in settings (catalog_custom). */
function useCustomization() {
    const [value, setValue] = useState(getCatalogCustomization);
    useEffect(() => onCatalogCustomization(setValue), []);
    const save = async (next) => {
        try {
            await window.electronAPI.settings.set({ key: 'catalog_custom', value: next });
            setCatalogCustomization(next);
            toast.success(t('catalogCustom.saved'));
        } catch {
            toast.error(t('common.saveFailed'));
        }
    };
    return [value, save];
}

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function Swatch({ hex, size = 'w-5 h-5' }) {
    return <span className={`${size} rounded-full border border-zinc-600 flex-none`} style={{ background: hex }} />;
}

/**
 * Colours offered when entering articles: hide the ones the shop never uses,
 * add its own (name + colour).
 */
export function ColorsPage() {
    const { lang } = useT();
    const [custom, save] = useCustomization();
    const [name, setName] = useState('');
    const [hex, setHex] = useState('#8b5cf6');
    const hidden = new Set(custom.hiddenColors);

    const toggle = (code) => save({
        ...custom,
        hiddenColors: hidden.has(code) ? custom.hiddenColors.filter(c => c !== code) : [...custom.hiddenColors, code],
    });

    const add = (e) => {
        e.preventDefault();
        const clean = name.trim();
        if (!clean) return toast.error(t('catalogCustom.nameRequired'));
        const exists = [...COLORS, ...custom.customColors].some(c => [c.en, c.fr, c.ar].some(n => n?.toLowerCase() === clean.toLowerCase()));
        if (exists) return toast.error(t('catalogCustom.colorExists', { name: clean }));
        // One name typed by the shop, shown the same in every language
        save({ ...custom, customColors: [...custom.customColors, { code: newId('c'), hex, en: clean, fr: clean, ar: clean }] });
        setName('');
        return undefined;
    };

    const remove = (code) => save({ ...custom, customColors: custom.customColors.filter(c => c.code !== code) });

    return (
        <div className="page">
            <PageHeader icon={Palette} title={t('catalogCustom.colorsTitle')} subtitle={t('catalogCustom.colorsSubtitle')}
                actions={(
                    <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                        <form onSubmit={add} className="flex items-center gap-2">
                            <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label={t('catalogCustom.pickColor')}
                                className="w-10 h-10 rounded-lg border border-dark-border bg-dark-primary p-1 cursor-pointer" />
                            <input className="input w-48" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('catalogCustom.colorPlaceholder')} />
                            <Button type="submit"><Plus className="w-4 h-4" /> {t('common.add')}</Button>
                        </form>
                    </PermissionGate>
                )}
            />
            <div className="page-body space-y-6">
                {custom.customColors.length > 0 && (
                    <section>
                        <h3 className="text-sm font-semibold text-zinc-400 mb-2">{t('catalogCustom.yourColors')}</h3>
                        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                            {custom.customColors.map(c => (
                                <div key={c.code} className="h-12 flex items-center gap-2.5 ps-3 pe-1.5 rounded-lg border border-dark-border bg-dark-secondary">
                                    <Swatch hex={c.hex} />
                                    <span className="flex-1 min-w-0 truncate font-medium">{c[lang] || c.en}</span>
                                    <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                                        <button type="button" onClick={() => remove(c.code)} className="p-1.5 rounded hover:bg-red-500/15 text-red-300" aria-label={t('common.delete')}>
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </PermissionGate>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
                <section>
                    <h3 className="text-sm font-semibold text-zinc-400 mb-2">{t('catalogCustom.builtInColors')}</h3>
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                        {COLORS.map(c => {
                            const off = hidden.has(c.code);
                            return (
                                <button key={c.code} type="button" onClick={() => toggle(c.code)} title={off ? t('catalogCustom.show') : t('catalogCustom.hide')}
                                    className={`h-12 flex items-center gap-2.5 ps-3 pe-3 rounded-lg border bg-dark-secondary text-start transition-opacity ${off ? 'opacity-45 border-dashed border-dark-border' : 'border-dark-border hover:border-zinc-600'}`}>
                                    <Swatch hex={c.hex} />
                                    <span className="flex-1 min-w-0 truncate font-medium">{c[lang] || c.en}</span>
                                    {off ? <EyeOff className="w-4 h-4 text-zinc-500 flex-none" /> : <Eye className="w-4 h-4 text-zinc-500 flex-none" />}
                                </button>
                            );
                        })}
                    </div>
                    <p className="form-hint mt-3">{t('catalogCustom.colorsHint')}</p>
                </section>
            </div>
        </div>
    );
}

/** Size sets: hide the ones not sold, add the shop's own (e.g. 44–58 for big sizes). */
export function SizesPage() {
    const { lang } = useT();
    const [custom, save] = useCustomization();
    const [name, setName] = useState('');
    const [sizes, setSizes] = useState('');
    const hidden = new Set(custom.hiddenSizeSets);

    const toggle = (code) => save({
        ...custom,
        hiddenSizeSets: hidden.has(code) ? custom.hiddenSizeSets.filter(c => c !== code) : [...custom.hiddenSizeSets, code],
    });

    const add = (e) => {
        e.preventDefault();
        const clean = name.trim();
        const list = [...new Set(sizes.split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
        if (!clean) return toast.error(t('catalogCustom.nameRequired'));
        if (!list.length) return toast.error(t('catalogCustom.sizesRequired'));
        save({ ...custom, customSizeSets: [...custom.customSizeSets, { code: newId('s'), en: clean, fr: clean, ar: clean, sizes: list }] });
        setName('');
        setSizes('');
        return undefined;
    };

    const remove = (code) => save({ ...custom, customSizeSets: custom.customSizeSets.filter(s => s.code !== code) });

    const preview = [...new Set(sizes.split(/[,;\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean))];

    // One set per row: name and count, the sizes in order, shown or hidden
    const row = (set, { builtIn }) => {
        const off = builtIn && hidden.has(set.code);
        const label = builtIn ? sizeSetLabel(set, lang) : (set[lang] || set.en);
        return (
            <li key={set.code} className={`flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 ${off ? 'opacity-55' : ''}`}>
                <div className="md:w-56 flex-none flex items-center gap-2.5 min-w-0">
                    <Ruler className="w-4 h-4 text-indigo-300 flex-none" />
                    <span className="font-medium truncate">{label}</span>
                    <span className="badge bg-dark-tertiary text-zinc-400 flex-none tabular">{set.sizes.length}</span>
                </div>
                <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                    {set.sizes.map(size => (
                        <span key={size} className="min-w-[2.5rem] h-8 px-2.5 inline-flex items-center justify-center rounded-md border border-dark-border bg-dark-primary text-sm font-semibold tabular whitespace-nowrap"><bdi>{sizeLabel(size, lang)}</bdi></span>
                    ))}
                </div>
                <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                    <div className="flex-none flex items-center gap-2 md:justify-end md:w-40">
                        {builtIn ? (
                            <button type="button" onClick={() => toggle(set.code)} aria-pressed={!off}
                                className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border text-sm ${off ? 'border-dashed border-dark-border text-zinc-500 hover:text-white' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                                {off ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                {off ? t('catalogCustom.hiddenState') : t('catalogCustom.shownState')}
                            </button>
                        ) : (
                            <button type="button" onClick={() => remove(set.code)} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 text-sm text-red-300 hover:bg-red-500/10">
                                <Trash2 className="w-4 h-4" /> {t('common.delete')}
                            </button>
                        )}
                    </div>
                </PermissionGate>
            </li>
        );
    };

    const shown = SIZE_SETS.filter(set => !hidden.has(set.code)).length;

    return (
        <div className="page">
            <PageHeader icon={Ruler} title={t('catalogCustom.sizesTitle')} subtitle={t('catalogCustom.sizesSubtitle')} />
            <div className="page-body space-y-5 max-w-5xl">
                {/* Add the shop's own set */}
                <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                    <form onSubmit={add} className="card space-y-3">
                        <h3 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-indigo-300" /> {t('catalogCustom.addSet')}</h3>
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
                            <label className="form-group">
                                <span className="form-label">{t('catalogCustom.setName')}</span>
                                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('catalogCustom.setPlaceholder')} />
                            </label>
                            <label className="form-group">
                                <span className="form-label">{t('catalogCustom.setSizes')}</span>
                                <input className="input ltr" value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="44, 46, 48, 50" />
                            </label>
                            <Button type="submit"><Plus className="w-4 h-4" /> {t('common.add')}</Button>
                        </div>
                        {preview.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                                {t('catalogCustom.preview')}
                                {preview.map(size => <span key={size} className="h-7 px-2 inline-flex items-center rounded-md bg-indigo-500/15 text-indigo-100 text-sm font-semibold"><bdi>{size}</bdi></span>)}
                            </div>
                        )}
                    </form>
                </PermissionGate>

                {custom.customSizeSets.length > 0 && (
                    <section className="card !p-0 overflow-hidden">
                        <h3 className="px-4 py-3 border-b border-dark-border text-sm font-semibold flex items-center justify-between">
                            {t('catalogCustom.yourSizes')}
                            <span className="text-xs font-normal text-zinc-500 tabular">{custom.customSizeSets.length}</span>
                        </h3>
                        <ul className="divide-y divide-dark-border">{custom.customSizeSets.map(set => row(set, { builtIn: false }))}</ul>
                    </section>
                )}

                <section className="card !p-0 overflow-hidden">
                    <h3 className="px-4 py-3 border-b border-dark-border text-sm font-semibold flex items-center justify-between">
                        {t('catalogCustom.builtInSizes')}
                        <span className="text-xs font-normal text-zinc-500">{t('catalogCustom.shownCount', { n: shown, total: SIZE_SETS.length })}</span>
                    </h3>
                    <ul className="divide-y divide-dark-border">{SIZE_SETS.map(set => row(set, { builtIn: true }))}</ul>
                </section>
                <p className="form-hint">{t('catalogCustom.sizesHint')}</p>
            </div>
        </div>
    );
}
