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

    const card = (set, { builtIn }) => {
        const off = builtIn && hidden.has(set.code);
        return (
            <div key={set.code} className={`card p-4 ${off ? 'opacity-50 border-dashed' : ''}`}>
                <div className="flex items-center gap-2 mb-3">
                    <Ruler className="w-4 h-4 text-indigo-300 flex-none" />
                    <h4 className="font-semibold flex-1 min-w-0 truncate">{builtIn ? sizeSetLabel(set, lang) : (set[lang] || set.en)}</h4>
                    <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                        {builtIn ? (
                            <button type="button" onClick={() => toggle(set.code)} className="p-1.5 rounded hover:bg-dark-tertiary text-zinc-400 hover:text-white"
                                title={off ? t('catalogCustom.show') : t('catalogCustom.hide')} aria-label={off ? t('catalogCustom.show') : t('catalogCustom.hide')}>
                                {off ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        ) : (
                            <button type="button" onClick={() => remove(set.code)} className="p-1.5 rounded hover:bg-red-500/15 text-red-300" aria-label={t('common.delete')}>
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </PermissionGate>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {set.sizes.map(size => (
                        <span key={size} className="min-w-[2.25rem] h-8 px-2 inline-flex items-center justify-center rounded-md bg-dark-tertiary text-sm font-medium whitespace-nowrap"><bdi>{sizeLabel(size, lang)}</bdi></span>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="page">
            <PageHeader icon={Ruler} title={t('catalogCustom.sizesTitle')} subtitle={t('catalogCustom.sizesSubtitle')}
                actions={(
                    <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
                            <input className="input w-44" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('catalogCustom.setPlaceholder')} />
                            <input className="input w-52 ltr" value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="44, 46, 48, 50" />
                            <Button type="submit"><Plus className="w-4 h-4" /> {t('common.add')}</Button>
                        </form>
                    </PermissionGate>
                )}
            />
            <div className="page-body space-y-6">
                {custom.customSizeSets.length > 0 && (
                    <section>
                        <h3 className="text-sm font-semibold text-zinc-400 mb-2">{t('catalogCustom.yourSizes')}</h3>
                        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                            {custom.customSizeSets.map(set => card(set, { builtIn: false }))}
                        </div>
                    </section>
                )}
                <section>
                    <h3 className="text-sm font-semibold text-zinc-400 mb-2">{t('catalogCustom.builtInSizes')}</h3>
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                        {SIZE_SETS.map(set => card(set, { builtIn: true }))}
                    </div>
                    <p className="form-hint mt-3">{t('catalogCustom.sizesHint')}</p>
                </section>
            </div>
        </div>
    );
}
