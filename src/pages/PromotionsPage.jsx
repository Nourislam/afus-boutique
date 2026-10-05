import { useState, useEffect, useMemo } from 'react';
import { Percent, Plus, Search, Edit2, Trash2, Calendar, Tag, Banknote, LayoutGrid, List, Shirt, Store, Gift, TrendingUp, Pause, Play, Package, Sun, X } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/ui/Toast';
import { isPromotionLive, parseIds, promotionPreset, PROMOTION_PRESETS } from '../lib/promotions';
import { formatDate as formatLocalDate, formatMoney } from '../i18n/format';
import { t } from '../i18n';

const TYPE_STYLE = {
    percentage: { icon: Percent, tone: 'from-indigo-500/25 to-indigo-500/5 text-indigo-300' },
    fixed: { icon: Banknote, tone: 'from-emerald-500/25 to-emerald-500/5 text-emerald-300' },
    bogo: { icon: Gift, tone: 'from-fuchsia-500/25 to-fuchsia-500/5 text-fuchsia-300' },
    threshold: { icon: TrendingUp, tone: 'from-amber-500/25 to-amber-500/5 text-amber-300' },
};

const EMPTY_FORM = {
    name: '', description: '', type: 'percentage', value: '', min_purchase: '', max_discount: '', max_uses: '',
    start_date: '', end_date: '', coupon_code: '', auto_apply: true, is_active: true, applies_to: 'all', applies_to_ids: [],
};

const PRESET_ICONS = { season: Sun, category: Shirt, product: Package };

const VIEW_KEY = 'promotions.view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'grid'; } catch { return 'grid'; } };

/** Where a promotion is in its life: live, scheduled, ended, paused or used up. */
function promoStatus(promo, now = Date.now()) {
    if (!promo.is_active) return 'paused';
    if (isPromotionLive(promo, now)) return 'live';
    if (promo.max_uses && (promo.current_uses || 0) >= promo.max_uses) return 'usedUp';
    if (promo.start_date && new Date(`${String(promo.start_date).slice(0, 10)}T00:00:00`).getTime() > now) return 'scheduled';
    return 'ended';
}

const STATUS_STYLE = {
    live: 'bg-emerald-500/15 text-emerald-300',
    scheduled: 'bg-sky-500/15 text-sky-300',
    paused: 'bg-zinc-500/20 text-zinc-400',
    ended: 'bg-zinc-500/20 text-zinc-500',
    usedUp: 'bg-amber-500/15 text-amber-300',
};

export default function PromotionsPage() {
    const [promotions, setPromotions] = useState([]);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [productQuery, setProductQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [view, setView] = useState(readView);
    const [form, setForm] = useState(null); // null = closed
    const [editing, setEditing] = useState(null);
    const [deleting, setDeleting] = useState(null);

    const load = async () => {
        try {
            const [promos, cats, articles] = await Promise.all([
                window.electronAPI.promotions.getAll(),
                window.electronAPI.categories.getAll().catch(() => []),
                window.electronAPI.products.getAll().catch(() => []),
            ]);
            setPromotions(promos);
            setCategories(cats);
            setProducts(articles);
        } catch {
            toast.error(t('promo.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const changeView = (next) => {
        setView(next);
        try { localStorage.setItem(VIEW_KEY, next); } catch { /* per-viewer convenience only */ }
    };

    const categoryName = (id) => categories.find(c => c.id === id)?.name;
    const productName = (id) => products.find(p => p.id === id)?.name;
    const scopeText = (promo) => {
        const scope = promo.applies_to || 'all';
        const ids = parseIds(promo.applies_to_ids);
        if (scope === 'category' && ids.length) return ids.map(categoryName).filter(Boolean).join(' · ') || t('promo.someCategories', { n: ids.length });
        if (scope === 'product' && ids.length) {
            const names = ids.map(productName).filter(Boolean);
            return names.length === ids.length && names.length <= 3 ? names.join(' · ') : t('promo.someArticles', { n: ids.length });
        }
        return t('promo.wholeShop');
    };

    const valueText = (promo) => {
        const value = Number(promo.value) || 0;
        switch (promo.type) {
            case 'percentage': return `-${value}%`;
            case 'fixed': return `-${formatMoney(value)}`;
            case 'threshold': return `-${value}%`;
            case 'bogo': return value > 0 && value < 100 ? t('promo.bogoPercent', { n: value }) : t('promo.bogoFree');
            default: return String(value);
        }
    };

    const openCreate = () => { setEditing(null); setProductQuery(''); setForm({ ...EMPTY_FORM }); };
    // A quick start fills the form and suggests a name
    const applyPreset = (kind) => setForm(prev => ({
        ...prev,
        ...promotionPreset(kind),
        // Replace the name only while it is empty or still the one a quick start suggested
        name: !prev.name.trim() || (prev.preset && prev.name === t(`promo.preset.${prev.preset}Name`)) ? t(`promo.preset.${kind}Name`) : prev.name,
        preset: kind,
    }));
    const openEdit = (promo) => {
        setEditing(promo);
        setProductQuery('');
        setForm({
            ...EMPTY_FORM,
            name: promo.name,
            description: promo.description || '',
            type: promo.type,
            value: promo.value?.toString() || '',
            min_purchase: promo.min_purchase ? String(promo.min_purchase) : '',
            max_discount: promo.max_discount ? String(promo.max_discount) : '',
            max_uses: promo.max_uses ? String(promo.max_uses) : '',
            start_date: promo.start_date ? String(promo.start_date).split('T')[0] : '',
            end_date: promo.end_date ? String(promo.end_date).split('T')[0] : '',
            coupon_code: promo.coupon_code || '',
            auto_apply: !!promo.auto_apply,
            is_active: !!promo.is_active,
            applies_to: promo.applies_to || 'all',
            applies_to_ids: parseIds(promo.applies_to_ids),
        });
    };
    const close = () => { setForm(null); setEditing(null); };
    const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

    const save = async () => {
        if (!form.name.trim()) return toast.error(t('promo.nameRequired'));
        const value = parseFloat(form.value);
        // BOGO without a value means "second piece free"
        if (form.type !== 'bogo' && !(value > 0)) return toast.error(t('promo.validValue'));
        if ((form.type === 'percentage' || form.type === 'threshold') && value > 100) return toast.error(t('promo.validValue'));
        if (form.type === 'threshold' && !(parseFloat(form.min_purchase) > 0)) return toast.error(t('promo.thresholdNeedsMin'));
        if (form.applies_to === 'category' && form.applies_to_ids.length === 0) return toast.error(t('promo.pickCategory'));
        if (form.applies_to === 'product' && form.applies_to_ids.length === 0) return toast.error(t('promo.pickArticle'));
        if (form.start_date && form.end_date && form.end_date < form.start_date) return toast.error(t('promo.datesOrder'));

        const promo = {
            id: editing?.id || uuid(),
            name: form.name.trim(),
            description: form.description || null,
            type: form.type,
            value: value > 0 ? value : 0,
            min_purchase: form.min_purchase ? parseFloat(form.min_purchase) : 0,
            max_discount: form.max_discount ? parseFloat(form.max_discount) : null,
            max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
            start_date: form.start_date || null,
            end_date: form.end_date || null,
            coupon_code: form.coupon_code.trim() || null,
            auto_apply: form.auto_apply,
            is_active: form.is_active,
            applies_to: form.applies_to,
            applies_to_ids: form.applies_to === 'all' ? null : form.applies_to_ids,
            current_uses: editing?.current_uses || 0,
        };
        try {
            if (editing) await window.electronAPI.promotions.update(promo);
            else await window.electronAPI.promotions.create(promo);
            toast.success(editing ? t('promo.updated') : t('promo.created'));
            close();
            load();
        } catch {
            toast.error(t('promo.saveFailed'));
        }
        return undefined;
    };

    const toggleActive = async (promo) => {
        try {
            await window.electronAPI.promotions.update({ ...promo, is_active: !promo.is_active, applies_to_ids: parseIds(promo.applies_to_ids) });
            toast.success(promo.is_active ? t('promo.deactivated') : t('promo.activated'));
            load();
        } catch {
            toast.error(t('promo.updateFailed'));
        }
    };

    const confirmDelete = async () => {
        try {
            await window.electronAPI.promotions.delete(deleting);
            toast.success(t('promo.deleted'));
            load();
        } catch {
            toast.error(t('promo.deleteFailed'));
        }
        setDeleting(null);
    };

    const withStatus = useMemo(() => promotions.map(p => ({ ...p, status: promoStatus(p) })), [promotions]);
    const counts = useMemo(() => withStatus.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }), {}), [withStatus]);
    const visible = withStatus.filter(p => (filter === 'all' || p.status === filter || (filter === 'ended' && p.status === 'usedUp')) && (!query
        || p.name.toLowerCase().includes(query.toLowerCase())
        || p.coupon_code?.toLowerCase().includes(query.toLowerCase())));
    const totalUses = promotions.reduce((sum, p) => sum + (p.current_uses || 0), 0);
    const dates = (p) => (p.start_date || p.end_date)
        ? `${p.start_date ? formatLocalDate(p.start_date, 'date') : '…'} → ${p.end_date ? formatLocalDate(p.end_date, 'date') : '…'}`
        : t('promo.noEnd');

    const renderActions = (promo) => (
        <div className="flex items-center gap-0.5">
            <button type="button" title={promo.is_active ? t('promo.deactivate') : t('promo.activate')} onClick={() => toggleActive(promo)}
                className="p-2 rounded-lg hover:bg-dark-tertiary text-zinc-400 hover:text-white">
                {promo.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button type="button" title={t('common.edit')} onClick={() => openEdit(promo)} className="p-2 rounded-lg hover:bg-dark-tertiary text-zinc-400 hover:text-white">
                <Edit2 className="w-4 h-4" />
            </button>
            <button type="button" title={t('common.delete')} onClick={() => setDeleting(promo.id)} className="p-2 rounded-lg hover:bg-red-500/15 text-red-300">
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    );

    return (
        <div className="page">
            <PageHeader
                icon={Percent}
                title={t('promo.title')}
                subtitle={t('promo.subtitle')}
                actions={(
                    <>
                        <div className="segmented">
                            <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => changeView('grid')} aria-label={t('pos.viewGrid')} title={t('pos.viewGrid')}>
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => changeView('list')} aria-label={t('pos.viewList')} title={t('pos.viewList')}>
                                <List className="w-4 h-4" />
                            </button>
                        </div>
                        <Button onClick={openCreate}><Plus className="w-4 h-4" /> {t('promo.create')}</Button>
                    </>
                )}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative w-72 max-w-full">
                        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input className="input ps-9" placeholder={t('promo.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <div className="segmented no-scrollbar overflow-x-auto max-w-full">
                        {['all', 'live', 'scheduled', 'paused', 'ended'].map(id => (
                            <button key={id} type="button" className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
                                {t(`promo.status.${id}`)}
                                <span className="ms-1.5 text-xs text-zinc-500 tabular">{id === 'all' ? promotions.length : (counts[id] || 0) + (id === 'ended' ? (counts.usedUp || 0) : 0)}</span>
                            </button>
                        ))}
                    </div>
                    <span className="text-sm text-zinc-500 hidden xl:inline">{t('promo.usesTotal', { n: totalUses })}</span>
                </div>
            </PageHeader>

            <div className="page-body">
                {loading ? (
                    <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : visible.length === 0 ? (
                    <div className="text-center py-16 text-zinc-500">
                        <Percent className="w-12 h-12 mx-auto mb-3 opacity-40" />
                        <p className="mb-4">{t('promo.none')}</p>
                        <Button onClick={openCreate}><Plus className="w-4 h-4" /> {t('promo.create')}</Button>
                    </div>
                ) : view === 'grid' ? (
                    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                        {visible.map(promo => {
                            const style = TYPE_STYLE[promo.type] || TYPE_STYLE.percentage;
                            const Icon = style.icon;
                            const scope = promo.applies_to || 'all';
                            return (
                                <div key={promo.id} className={`card p-0 overflow-hidden flex flex-col ${promo.status === 'live' ? '' : 'opacity-75'}`}>
                                    <div className={`bg-gradient-to-b ${style.tone} px-4 pt-4 pb-3 flex items-start justify-between gap-2`}>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5 text-xs font-medium opacity-90"><Icon className="w-3.5 h-3.5" /> {t(`promo.type.${promo.type}`)}</div>
                                            <div className="text-3xl font-bold mt-1 tabular truncate"><bdi dir={promo.type === 'bogo' ? undefined : 'ltr'}>{valueText(promo)}</bdi></div>
                                        </div>
                                        <span className={`badge ${STATUS_STYLE[promo.status]}`}>{t(`promo.status.${promo.status}`)}</span>
                                    </div>
                                    <div className="px-4 py-3 flex-1 space-y-2">
                                        <h3 className="font-semibold truncate">{promo.name}</h3>
                                        <div className="flex items-center gap-2 text-sm text-zinc-400">
                                            {scope === 'all' ? <Store className="w-4 h-4 flex-none" /> : <Shirt className="w-4 h-4 flex-none" />}
                                            <span className="truncate">{scopeText(promo)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-zinc-400">
                                            <Calendar className="w-4 h-4 flex-none" /> <span className="truncate">{dates(promo)}</span>
                                        </div>
                                        {promo.min_purchase > 0 && (
                                            <div className="flex items-center gap-2 text-sm text-zinc-400">
                                                <Banknote className="w-4 h-4 flex-none" /> {t('promo.fromAmount', { amount: formatMoney(promo.min_purchase) })}
                                            </div>
                                        )}
                                        {promo.coupon_code && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <Tag className="w-4 h-4 text-zinc-400 flex-none" />
                                                <span className="font-mono bg-dark-tertiary border border-dashed border-zinc-600 px-2 py-0.5 rounded ltr">{promo.coupon_code}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="px-4 py-2 border-t border-dark-border flex items-center justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-zinc-500">{t('promo.usedN', { n: promo.current_uses || 0 })}{promo.max_uses ? ` / ${promo.max_uses}` : ''}</p>
                                            {promo.max_uses > 0 && (
                                                <div className="h-1 mt-1 rounded-full bg-dark-tertiary overflow-hidden">
                                                    <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, ((promo.current_uses || 0) / promo.max_uses) * 100)}%` }} />
                                                </div>
                                            )}
                                        </div>
                                        {renderActions(promo)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="card p-0 overflow-x-auto">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{t('promo.name')}</th>
                                    <th>{t('promo.discount')}</th>
                                    <th>{t('promo.appliesTo')}</th>
                                    <th>{t('promo.period')}</th>
                                    <th>{t('promo.couponShort')}</th>
                                    <th>{t('promo.usesShort')}</th>
                                    <th>{t('common.status')}</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map(promo => (
                                    <tr key={promo.id}>
                                        <td className="font-medium">{promo.name}<div className="text-xs text-zinc-500">{t(`promo.type.${promo.type}`)}</div></td>
                                        <td className="font-semibold tabular whitespace-nowrap"><bdi dir={promo.type === 'bogo' ? undefined : 'ltr'}>{valueText(promo)}</bdi></td>
                                        <td className="text-zinc-400 max-w-[220px] truncate">{scopeText(promo)}</td>
                                        <td className="text-zinc-400 whitespace-nowrap">{dates(promo)}</td>
                                        <td className="font-mono ltr">{promo.coupon_code || '—'}</td>
                                        <td className="tabular">{promo.current_uses || 0}{promo.max_uses ? ` / ${promo.max_uses}` : ''}</td>
                                        <td><span className={`badge ${STATUS_STYLE[promo.status]}`}>{t(`promo.status.${promo.status}`)}</span></td>
                                        <td>{renderActions(promo)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {form && (
                <Modal isOpen onClose={close} title={editing ? t('promo.edit') : t('promo.create')} size="lg" closeOnOverlay={false}>
                    <ModalBody>
                        <div className="space-y-4">
                            {!editing && (
                                <div className="form-group">
                                    <label className="form-label">{t('promo.preset.title')}</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        {PROMOTION_PRESETS.map(kind => {
                                            const Icon = PRESET_ICONS[kind];
                                            return (
                                                <button key={kind} type="button" onClick={() => applyPreset(kind)} aria-pressed={form.preset === kind}
                                                    className={`p-3 rounded-lg border text-start transition-colors ${form.preset === kind ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-600'}`}>
                                                    <p className="font-medium text-sm flex items-center gap-1.5"><Icon className="w-4 h-4 text-indigo-300 flex-none" /> {t(`promo.preset.${kind}`)}</p>
                                                    <p className="text-xs text-zinc-500 leading-snug mt-0.5">{t(`promo.preset.${kind}Hint`)}</p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            <Input label={t('promo.name')} placeholder={t('promo.namePlaceholder')} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />

                            <div className="form-group">
                                <label className="form-label">{t('promo.type')}</label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {Object.entries(TYPE_STYLE).map(([type, style]) => {
                                        const Icon = style.icon;
                                        return (
                                            <button key={type} type="button" onClick={() => set({ type })}
                                                className={`p-3 rounded-lg border text-start transition-colors ${form.type === type ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-600'}`}>
                                                <Icon className="w-4 h-4 mb-1 text-indigo-300" />
                                                <p className="font-medium text-sm">{t(`promo.type.${type}`)}</p>
                                                <p className="text-xs text-zinc-500 leading-snug">{t(`promo.type.${type}Hint`)}</p>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label={form.type === 'fixed' ? t('promo.amountDa') : form.type === 'bogo' ? t('promo.bogoValue') : t('promo.percent')}
                                    type="number" step="0.01" min="0" max={form.type === 'fixed' ? undefined : 100}
                                    placeholder={form.type === 'fixed' ? '500' : form.type === 'bogo' ? '100' : '20'}
                                    value={form.value} onChange={(e) => set({ value: e.target.value })}
                                />
                                <Input
                                    label={form.type === 'threshold' ? t('promo.minPurchaseRequired') : t('promo.minPurchase')}
                                    type="number" step="0.01" min="0" placeholder="0"
                                    value={form.min_purchase} onChange={(e) => set({ min_purchase: e.target.value })}
                                />
                            </div>

                            {/* Applies to */}
                            <div className="form-group">
                                <label className="form-label">{t('promo.appliesTo')}</label>
                                <div className="segmented w-full mb-2 no-scrollbar overflow-x-auto">
                                    {[
                                        { id: 'all', icon: Store, label: t('promo.wholeShop') },
                                        { id: 'category', icon: Shirt, label: t('promo.someCategoriesPick') },
                                        { id: 'product', icon: Package, label: t('promo.someArticlesPick') },
                                    ].map(({ id, icon: Icon, label }) => (
                                        <button key={id} type="button" className={`flex-1 inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${form.applies_to === id ? 'active' : ''}`}
                                            onClick={() => set({ applies_to: id, applies_to_ids: form.applies_to === id ? form.applies_to_ids : [] })}>
                                            <Icon className="w-4 h-4" /> {label}
                                        </button>
                                    ))}
                                </div>
                                {form.applies_to === 'product' && (
                                    <ArticlePicker products={products} selected={form.applies_to_ids} query={productQuery} onQuery={setProductQuery}
                                        onChange={(ids) => set({ applies_to_ids: ids })} />
                                )}
                                {form.applies_to === 'category' && (
                                    categories.length === 0 ? <p className="form-hint">{t('promo.noCategories')}</p> : (
                                        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                                            {categories.map(cat => {
                                                const on = form.applies_to_ids.includes(cat.id);
                                                return (
                                                    <button key={cat.id} type="button"
                                                        onClick={() => set({ applies_to_ids: on ? form.applies_to_ids.filter(id => id !== cat.id) : [...form.applies_to_ids, cat.id] })}
                                                        className={`px-3 h-8 rounded-full border text-sm transition-colors ${on ? 'border-indigo-500 bg-indigo-500/20 text-white' : 'border-dark-border text-zinc-400 hover:text-white hover:border-zinc-600'}`}>
                                                        {cat.name}{cat.product_count > 0 && <span className="ms-1 text-xs opacity-60">{cat.product_count}</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Input label={t('promo.start')} type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
                                <Input label={t('promo.end')} type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} />
                            </div>
                            <p className="form-hint -mt-2">{form.start_date || form.end_date ? t('promo.datesHint') : t('promo.noDatesHint')}</p>

                            <div className="grid grid-cols-3 gap-4">
                                <Input label={t('promo.coupon')} placeholder={t('promo.couponPlaceholder')} value={form.coupon_code}
                                    onChange={(e) => set({ coupon_code: e.target.value.toUpperCase() })} className="ltr" />
                                <Input label={t('promo.maxDiscount')} type="number" step="0.01" min="0" placeholder={t('promo.noLimit')}
                                    value={form.max_discount} onChange={(e) => set({ max_discount: e.target.value })} />
                                <Input label={t('promo.maxUses')} type="number" min="0" placeholder={t('promo.unlimited')}
                                    value={form.max_uses} onChange={(e) => set({ max_uses: e.target.value })} />
                            </div>

                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={form.auto_apply} onChange={(e) => set({ auto_apply: e.target.checked })} className="w-4 h-4 rounded" />
                                    {t('promo.autoApply')}
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="w-4 h-4 rounded" />
                                    {t('status.active')}
                                </label>
                            </div>
                            {!form.auto_apply && !form.coupon_code && <p className="form-hint text-amber-300">{t('promo.needsCouponOrAuto')}</p>}
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
                        <Button onClick={save}>{editing ? t('common.save') : t('promo.create')}</Button>
                    </ModalFooter>
                </Modal>
            )}

            <ConfirmDialog
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                onConfirm={confirmDelete}
                title={t('promo.delete')}
                message={t('promo.deleteConfirm')}
                confirmText={t('common.delete')}
                variant="danger"
            />
        </div>
    );
}


/** Pick the articles of a promotion: search by name, SKU or barcode; the chosen ones stay on top. */
function ArticlePicker({ products, selected, query, onQuery, onChange }) {
    const chosen = selected.map(id => products.find(p => p.id === id) || { id, name: '?' });
    const q = query.trim().toLowerCase();
    const results = q
        ? products.filter(p => !selected.includes(p.id) && (p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q))).slice(0, 30)
        : [];
    return (
        <div className="space-y-2">
            {chosen.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {chosen.map(p => (
                        <span key={p.id} className="inline-flex items-center gap-1 ps-3 pe-1 h-8 rounded-full border border-indigo-500 bg-indigo-500/20 text-sm">
                            <span className="truncate max-w-[14rem]">{p.name}</span>
                            <button type="button" onClick={() => onChange(selected.filter(id => id !== p.id))} className="p-1 rounded-full hover:bg-white/10" aria-label={t('common.delete')}>
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </span>
                    ))}
                </div>
            ) : <p className="form-hint">{t('promo.noArticlePicked')}</p>}
            {products.length === 0 ? <p className="form-hint">{t('promo.noArticles')}</p> : (
                <>
                    <div className="relative">
                        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input className="input ps-9" placeholder={t('promo.searchArticle')} value={query} onChange={(e) => onQuery(e.target.value)} />
                    </div>
                    {q && (
                        results.length === 0 ? <p className="form-hint">{t('common.noResults')}</p> : (
                            <ul className="max-h-40 overflow-y-auto rounded-lg border border-dark-border divide-y divide-dark-border">
                                {results.map(p => (
                                    <li key={p.id}>
                                        <button type="button" onClick={() => { onChange([...selected, p.id]); onQuery(''); }}
                                            className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-start hover:bg-dark-tertiary">
                                            <span className="min-w-0">
                                                <span className="block truncate">{p.name}</span>
                                                {p.sku && <span className="block text-xs text-zinc-500 ltr truncate">{p.sku}</span>}
                                            </span>
                                            <span className="flex-none text-zinc-400 tabular"><bdi>{formatMoney(p.price)}</bdi></span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )
                    )}
                </>
            )}
        </div>
    );
}
