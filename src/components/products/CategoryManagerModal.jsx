import { useState } from 'react';
import { Plus, Trash2, Check, Pencil, X } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { Modal, ModalBody } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { t, currentLanguage } from '../../i18n';
import { CATEGORY_SUGGESTIONS, categoryName } from '../../lib/clothing';

/**
 * Clothing categories (T-shirts, trousers, shoes, bags…). The shop owner can
 * add suggested categories in one click, create their own, rename or delete.
 */
export function CategoryManagerModal({ isOpen, onClose, categories, onSave }) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('categories.title')} size="lg">
            <ModalBody>
                <CategoryManager categories={categories} onSave={onSave} />
            </ModalBody>
        </Modal>
    );
}

/** The category list itself, used in the modal and in Catalogue > Categories. */
export function CategoryManager({ categories, onSave, layout = 'list' }) {
    const [newCategory, setNewCategory] = useState({ name: '', color: '#6366f1' });
    const [editing, setEditing] = useState(null); // { id, name, color }
    const [loading, setLoading] = useState(false);

    const lang = currentLanguage();
    const existingNames = new Set(categories.map(c => c.name.trim().toLowerCase()));
    const suggestions = CATEGORY_SUGGESTIONS.filter(s => ![s.en, s.fr, s.ar].some(n => existingNames.has(n.toLowerCase())));

    const create = async (name, color) => {
        const clean = name.trim();
        if (!clean) {
            toast.error(t('categories.nameRequired'));
            return false;
        }
        if (existingNames.has(clean.toLowerCase())) {
            toast.error(t('categories.exists'));
            return false;
        }
        await window.electronAPI.categories.create({ id: uuid(), name: clean, color });
        return true;
    };

    const handleAdd = async () => {
        setLoading(true);
        try {
            if (await create(newCategory.name, newCategory.color)) {
                setNewCategory({ name: '', color: '#6366f1' });
                toast.success(t('categories.added'));
                onSave();
            }
        } catch {
            toast.error(t('common.saveFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handleSuggestion = async (suggestion) => {
        try {
            if (await create(categoryName(suggestion, lang), suggestion.color)) onSave();
        } catch {
            toast.error(t('common.saveFailed'));
        }
    };

    const handleRename = async () => {
        if (!editing?.name.trim()) {
            toast.error(t('categories.nameRequired'));
            return;
        }
        try {
            await window.electronAPI.categories.update({ id: editing.id, name: editing.name.trim(), color: editing.color });
            setEditing(null);
            onSave();
        } catch {
            toast.error(t('common.saveFailed'));
        }
    };

    const handleDelete = async (category) => {
        if (!confirm(t('categories.deleteConfirm', { name: category.name }))) return;
        try {
            await window.electronAPI.categories.delete(category.id);
            toast.success(t('common.deleted'));
            onSave();
        } catch {
            toast.error(t('common.saveFailed'));
        }
    };

    return (
                <div className="space-y-5">
                    <div className="flex items-end gap-2">
                        <Input
                            label={t('categories.new')}
                            value={newCategory.name}
                            onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                            placeholder={t('categories.namePlaceholder')}
                            containerClassName="flex-1"
                        />
                        <input
                            type="color"
                            value={newCategory.color}
                            onChange={(e) => setNewCategory({ ...newCategory, color: e.target.value })}
                            className="w-10 h-10 rounded-lg cursor-pointer bg-transparent"
                            title={t('categories.color')}
                        />
                        <Button onClick={handleAdd} loading={loading}>
                            <Plus className="w-4 h-4" /> {t('common.add')}
                        </Button>
                    </div>

                    {suggestions.length > 0 && (
                        <div>
                            <p className="text-sm text-zinc-400 mb-2">{t('categories.suggestions')}</p>
                            <div className="flex flex-wrap gap-2">
                                {suggestions.map(s => (
                                    <button
                                        key={s.code}
                                        type="button"
                                        onClick={() => handleSuggestion(s)}
                                        className="px-3 py-1.5 rounded-full text-sm bg-dark-tertiary hover:bg-zinc-700 flex items-center gap-2"
                                    >
                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                                        + {categoryName(s, lang)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className={layout === 'grid' ? 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2 max-h-80 overflow-y-auto'}>
                        {categories.length === 0 && <p className="text-sm text-zinc-500">{t('categories.empty')}</p>}
                        {categories.map(category => (
                            <div key={category.id} className="flex items-center justify-between gap-2 p-3 rounded-lg bg-dark-tertiary">
                                {editing?.id === category.id ? (
                                    <>
                                        <input type="color" value={editing.color || '#6366f1'} onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                                            className="w-8 h-8 rounded cursor-pointer bg-transparent" />
                                        <input className="input py-1.5 flex-1" value={editing.name} autoFocus
                                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(null); }} />
                                        <Button variant="ghost" size="icon" onClick={handleRename} title={t('common.save')}><Check className="w-4 h-4 text-green-400" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => setEditing(null)} title={t('common.cancel')}><X className="w-4 h-4" /></Button>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: category.color }} />
                                            <span className="font-medium truncate">{category.name}</span>
                                            {category.product_count !== undefined && <span className="text-xs text-zinc-500 shrink-0">{t('brands.productCount', { n: category.product_count })}</span>}
                                        </div>
                                        <div className="flex items-center">
                                            <Button variant="ghost" size="icon" title={t('common.edit')}
                                                onClick={() => setEditing({ id: category.id, name: category.name, color: category.color })}>
                                                <Pencil className="w-4 h-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" title={t('common.delete')} onClick={() => handleDelete(category)}>
                                                <Trash2 className="w-4 h-4 text-red-400" />
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-zinc-500">{t('categories.deleteHint')}</p>
                </div>
    );
}

export default CategoryManagerModal;
