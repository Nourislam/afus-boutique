import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Tags, Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/ui/Input';
import { toast } from '../components/ui/Toast';
import { PermissionGate } from '../components/auth/PermissionGate';
import { PERMISSIONS } from '../stores/authStore';
import { t } from '../i18n';

import { translateError as errorText } from '../i18n/errors';

/**
 * Brands: a ready-made list (Nike, Adidas, LC Waikiki, Zara…) that the shop
 * can extend, so the brand is picked in one click when entering products.
 * The brand stays optional on products.
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

    return (
        <div className="h-full flex flex-col overflow-hidden">
            <div className="p-6 border-b border-dark-border space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-3"><Tags className="w-7 h-7 text-accent-primary" /> {t('brands.title')}</h1>
                        <p className="text-zinc-500">{t('brands.subtitle')}</p>
                    </div>
                    <PermissionGate permission={PERMISSIONS.PRODUCTS_CREATE}>
                        <div className="flex items-center gap-2">
                            <input
                                className="input w-64"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                                placeholder={t('brands.newPlaceholder')}
                            />
                            <Button onClick={add}><Plus className="w-4 h-4" /> {t('common.add')}</Button>
                        </div>
                    </PermissionGate>
                </div>
                <div className="flex items-center gap-4">
                    <SearchInput value={query} onChange={setQuery} placeholder={t('brands.search')} className="flex-1 max-w-md" />
                    {hiddenCount > 0 && (
                        <button type="button" onClick={() => setShowHidden(v => !v)} className="text-sm text-zinc-400 hover:text-white">
                            {showHidden ? t('brands.hideHidden') : t('brands.showHidden', { n: hiddenCount })}
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                {visible.length === 0 ? (
                    <p className="text-center text-zinc-500 mt-12">{t('common.noResults')}</p>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                        {visible.map(brand => (
                            <div key={brand.id} className={`card flex items-center justify-between gap-2 py-3 ${brand.is_active ? '' : 'opacity-50'}`}>
                                {editing?.id === brand.id ? (
                                    <>
                                        <input className="input py-1.5 flex-1" value={editing.name} autoFocus
                                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEditing(null); }} />
                                        <Button variant="ghost" size="icon" onClick={rename}><Check className="w-4 h-4 text-green-400" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => setEditing(null)}><X className="w-4 h-4" /></Button>
                                    </>
                                ) : (
                                    <>
                                        <div className="min-w-0">
                                            <p className="font-semibold truncate ltr">{brand.name}</p>
                                            <p className="text-xs text-zinc-500">{t('brands.productCount', { n: brand.product_count })}</p>
                                        </div>
                                        <PermissionGate permission={PERMISSIONS.PRODUCTS_EDIT}>
                                            <div className="flex items-center shrink-0">
                                                <Button variant="ghost" size="icon" title={t('common.edit')} onClick={() => setEditing({ id: brand.id, name: brand.name })}>
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" title={brand.is_active ? t('brands.hide') : t('brands.show')} onClick={() => toggle(brand)}>
                                                    {brand.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </Button>
                                                <Button variant="ghost" size="icon" title={t('common.delete')} onClick={() => remove(brand)}>
                                                    <Trash2 className="w-4 h-4 text-red-400" />
                                                </Button>
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
