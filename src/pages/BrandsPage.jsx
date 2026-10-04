import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Tags, Eye, EyeOff, Search } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/ui/Toast';
import { PermissionGate } from '../components/auth/PermissionGate';
import { PERMISSIONS } from '../stores/authStore';
import { t } from '../i18n';
import { translateError as errorText } from '../i18n/errors';

/**
 * Brands: a ready-made list (Nike, Adidas, LC Waikiki, Zara…) that the shop
 * can extend, so the brand is picked in one click when entering articles.
 * The brand stays optional on articles.
 */
export default function BrandsPage() {
    const [brands, setBrands] = useState([]);
    const [query, setQuery] = useState('');
    const [newName, setNewName] = useState('');
    const [editing, setEditing] = useState(null);
    const [showHidden, setShowHidden] = useState(false);

    const load = async () => {
        try {
            setBrands(await window.electronAPI.brands.getAll());
        } catch {
            toast.error(t('common.loadFailed'));
        }
    };

    useEffect(() => { load(); }, []);

    const add = async () => {
        if (!newName.trim()) return toast.error(t('brands.nameRequired'));
        try {
            await window.electronAPI.brands.create({ name: newName });
            setNewName('');
            toast.success(t('brands.added'));
            load();
        } catch (error) {
            toast.error(errorText(error));
        }
        return undefined;
    };

    const rename = async () => {
        try {
            await window.electronAPI.brands.update({ id: editing.id, name: editing.name });
            setEditing(null);
            load();
        } catch (error) {
            toast.error(errorText(error));
        }
    };

    const toggle = async (brand) => {
        await window.electronAPI.brands.update({ id: brand.id, is_active: !brand.is_active });
        load();
    };

    const remove = async (brand) => {
        if (!confirm(t('brands.deleteConfirm', { name: brand.name }))) return;
        await window.electronAPI.brands.delete(brand.id);
        load();
    };

    const visible = brands.filter(b =>
        (showHidden || b.is_active) && (!query || b.name.toLowerCase().includes(query.toLowerCase())));
    const hiddenCount = brands.filter(b => !b.is_active).length;
    const used = brands.filter(b => b.product_count > 0).length;

    return (
        <div className="page">
            <PageHeader
                icon={Tags}
                title={t('brands.title')}
                subtitle={t('brands.subtitle')}
                actions={(
                    <PermissionGate permission={PERMISSIONS.PRODUCTS_CREATE}>
                        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
                            <input className="input w-56" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('brands.newPlaceholder')} />
                            <Button type="submit"><Plus className="w-4 h-4" /> {t('common.add')}</Button>
                        </form>
                    </PermissionGate>
                )}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative w-72">
                        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input className="input ps-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('brands.search')} />
                    </div>
                    <span className="text-sm text-zinc-500">{t('brands.stats', { n: brands.length - hiddenCount, used })}</span>
                    {hiddenCount > 0 && (
                        <button type="button" onClick={() => setShowHidden(v => !v)} className="text-sm text-indigo-300 hover:text-indigo-200">
                            {showHidden ? t('brands.hideHidden') : t('brands.showHidden', { n: hiddenCount })}
                        </button>
                    )}
                </div>
            </PageHeader>

            <div className="page-body">
                {visible.length === 0 ? (
                    <p className="text-center text-zinc-500 mt-12">{t('common.noResults')}</p>
                ) : (
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                        {visible.map(brand => (
                            <div key={brand.id} className={`group h-12 flex items-center gap-2 ps-3 pe-1.5 rounded-lg border border-dark-border bg-dark-secondary ${brand.is_active ? '' : 'opacity-50'}`}>
                                {editing?.id === brand.id ? (
                                    <>
                                        <input className="input input-sm flex-1" value={editing.name} autoFocus
                                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} />
                                        <button type="button" onClick={rename} className="p-1.5 rounded hover:bg-dark-tertiary" aria-label={t('common.save')}><Check className="w-4 h-4 text-emerald-400" /></button>
                                        <button type="button" onClick={() => setEditing(null)} className="p-1.5 rounded hover:bg-dark-tertiary" aria-label={t('common.cancel')}><X className="w-4 h-4" /></button>
                                    </>
                                ) : (
                                    <>
                                        <span className="flex-1 min-w-0 font-medium truncate ltr text-start">{brand.name}</span>
                                        {brand.product_count > 0 && <span className="badge bg-dark-tertiary text-zinc-400">{brand.product_count}</span>}
                                        <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                                            <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                                <button type="button" title={t('common.edit')} onClick={() => setEditing({ id: brand.id, name: brand.name })} className="p-1.5 rounded hover:bg-dark-tertiary"><Pencil className="w-3.5 h-3.5" /></button>
                                                <button type="button" title={brand.is_active ? t('brands.hide') : t('brands.show')} onClick={() => toggle(brand)} className="p-1.5 rounded hover:bg-dark-tertiary">
                                                    {brand.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                </button>
                                                <button type="button" title={t('common.delete')} onClick={() => remove(brand)} className="p-1.5 rounded hover:bg-red-500/15"><Trash2 className="w-3.5 h-3.5 text-red-300" /></button>
                                            </div>
                                        </PermissionGate>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                <p className="text-xs text-zinc-500 mt-6">{t('brands.hint')}</p>
            </div>
        </div>
    );
}
