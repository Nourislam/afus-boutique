import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, Equal, QrCode, ShoppingCart } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { colorName, colorHex, sizeLabel } from '../../lib/clothing';
import { toDb } from '../../lib/dashboard';
import { useAuthStore, PERMISSIONS } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { mix, plan } from '../../../electron/shared/buyingPlan.mjs';

const PERIODS = [{ id: '30', days: 30 }, { id: '90', days: 90 }, { id: 'all', days: null }];
const cellKey = (color, size) => `${color}\u0000${size}`;

/**
 * One article, colour by size: the stock and the pieces sold in each cell
 * (red at 0, amber at 1-2), a count typed in a cell, the share of each size
 * and colour in the sales with what to buy more or less of next time, and a
 * buying plan for N new pieces split like the sales.
 */
export default function ProductMatrixModal({ productId, isOpen, onClose }) {
    const { t } = useT();
    const navigate = useNavigate();
    const canAdjust = useAuthStore(state => state.hasPermission(PERMISSIONS.INVENTORY_ADJUST));
    const me = useAuthStore(state => state.currentEmployee);
    const purchaseOrders = useSettingsStore(state => state.settings.features?.purchaseOrders !== false);
    const [period, setPeriod] = useState('90');
    const [data, setData] = useState(null);
    const [editing, setEditing] = useState(null);
    const [draft, setDraft] = useState('');
    const [planTotal, setPlanTotal] = useState('');
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (!isOpen || !productId) return;
        const days = PERIODS.find(p => p.id === period)?.days;
        const since = days ? toDb(new Date(Date.now() - days * 86400000)) : null;
        let cancelled = false;
        window.electronAPI.insights.matrix({ productId, since })
            .then(result => { if (!cancelled) setData(result || null); })
            .catch(() => { if (!cancelled) setData(null); });
        return () => { cancelled = true; };
    }, [isOpen, productId, period, reload]);

    const byCell = useMemo(() => new Map((data?.cells || []).map(c => [cellKey(c.color, c.size), c])), [data]);
    const sizeMix = useMemo(() => mix(data?.cells, 'size'), [data]);
    const colorMix = useMemo(() => mix(data?.cells, 'color'), [data]);
    const planned = useMemo(() => new Map(plan(data?.cells || [], planTotal).map(p => [p.id, p.quantity])), [data, planTotal]);

    const save = async (cell) => {
        const value = Math.max(0, parseInt(draft, 10));
        setEditing(null);
        if (!Number.isFinite(value) || value === cell.stock) return;
        const delta = value - cell.stock;
        try {
            await window.electronAPI.products.updateStock({
                id: productId, variantId: cell.id, quantity: Math.abs(delta), type: delta > 0 ? 'add' : 'remove',
                reason: 'Matrix count', employeeId: me?.id || null,
            });
            toast.success(t('matrix.saved', { n: value }));
            setReload(n => n + 1);
        } catch (error) {
            toast.error(translateError(error));
        }
    };

    const tone = (stock) => (stock <= 0 ? 'bg-red-500/15 text-red-200 border-red-500/30' : stock <= 2 ? 'bg-amber-500/10 text-amber-200 border-amber-500/30' : 'bg-dark-tertiary border-dark-border');
    const Advice = ({ advice }) => {
        if (advice === 'up') return <span className="inline-flex items-center gap-1 text-emerald-300"><ArrowUp className="w-3.5 h-3.5" />{t('matrix.more')}</span>;
        if (advice === 'down') return <span className="inline-flex items-center gap-1 text-red-300"><ArrowDown className="w-3.5 h-3.5" />{t('matrix.less')}</span>;
        if (advice === 'same') return <span className="inline-flex items-center gap-1 text-zinc-400"><Equal className="w-3.5 h-3.5" />{t('matrix.same')}</span>;
        return null;
    };
    const MixList = ({ title, m, label }) => (
        <section className="space-y-2" data-testid={`matrix-mix-${title}`}>
            <h4 className="text-sm font-semibold">{t(`matrix.mix.${title}`)}</h4>
            {!m.enough && <p className="text-xs text-zinc-500">{t('matrix.mix.thin')}</p>}
            <ul className="space-y-1.5">
                {m.rows.map(r => (
                    <li key={r.key} className="grid grid-cols-[minmax(4rem,8rem)_1fr_auto] items-center gap-3 text-sm">
                        <span className="truncate">{label(r.key)}</span>
                        <span className="h-2 rounded-full bg-dark-tertiary overflow-hidden" aria-hidden="true">
                            <span className="block h-full bg-indigo-400" style={{ width: `${Math.round(r.demand * 100)}%` }} />
                        </span>
                        <span className="flex items-center gap-3 tabular whitespace-nowrap">
                            <bdi>{Math.round(r.demand * 100)} %</bdi>
                            <Advice advice={r.advice} />
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );

    const colorLabel = (key) => colorName(key) || t('matrix.noColor');
    const hasGrid = data && data.cells.length > 0;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={data?.product?.name ? t('matrix.title', { name: data.product.name }) : t('dash.do.matrix')} size="full">
            <ModalBody className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="segmented" role="tablist">
                        {PERIODS.map(p => (
                            <button key={p.id} type="button" role="tab" aria-selected={period === p.id} className={period === p.id ? 'active' : ''} onClick={() => setPeriod(p.id)}>
                                {t(`matrix.period.${p.id}`)}
                            </button>
                        ))}
                    </div>
                    {data && <p className="text-sm text-zinc-400 tabular">{t('matrix.totals', { stock: data.totals.stock, sold: data.totals.sold })}</p>}
                </div>

                {!data ? <p className="text-sm text-zinc-500">{t('common.loading')}</p> : !hasGrid ? (
                    <p className="text-sm text-zinc-400 rounded-lg border border-dashed border-dark-border px-3 py-4">{t('matrix.noVariants')}</p>
                ) : (
                    <>
                        <div className="overflow-x-auto" data-testid="matrix-grid">
                            <table className="w-full text-sm border-separate border-spacing-1">
                                <thead>
                                    <tr>
                                        <th className="text-start font-medium text-zinc-400 px-2">{t('matrix.colorSize')}</th>
                                        {data.sizes.map(size => <th key={size} className="font-semibold px-2 min-w-[4.5rem]">{sizeLabel(size) || '—'}</th>)}
                                        <th className="font-medium text-zinc-400 px-2">{t('matrix.total')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.colors.map(color => {
                                        const row = data.totals.byColor.find(c => c.color === color.key);
                                        return (
                                            <tr key={color.key}>
                                                <th className="text-start font-medium px-2 whitespace-nowrap">
                                                    <span className="inline-flex items-center gap-2">
                                                        <span className="w-3.5 h-3.5 rounded-full border border-white/20 flex-none" style={{ background: colorHex({ color: color.key, color_code: color.code }) || 'transparent' }} />
                                                        {colorLabel(color.key)}
                                                    </span>
                                                </th>
                                                {data.sizes.map(size => {
                                                    const cell = byCell.get(cellKey(color.key, size));
                                                    if (!cell) return <td key={size} className="text-center text-zinc-600">·</td>;
                                                    const isEditing = editing === cell.id;
                                                    return (
                                                        <td key={size} className={`rounded-lg border text-center align-middle px-2 py-1.5 ${tone(cell.stock)}`} data-testid={`matrix-cell-${cell.sku || cell.id}`}>
                                                            {isEditing ? (
                                                                <input type="number" min="0" autoFocus value={draft} aria-label={t('matrix.count')}
                                                                    onChange={(e) => setDraft(e.target.value)}
                                                                    onBlur={() => save(cell)}
                                                                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }}
                                                                    className="w-16 bg-transparent text-center text-lg font-bold tabular outline-none border-b border-indigo-400" />
                                                            ) : (
                                                                <button type="button" disabled={!canAdjust} title={canAdjust ? t('matrix.countHint') : undefined}
                                                                    onClick={() => { setEditing(cell.id); setDraft(String(cell.stock)); }}
                                                                    className="w-full disabled:cursor-default">
                                                                    <span className="block text-lg font-bold tabular leading-tight">{cell.stock}</span>
                                                                    <span className="block text-[11px] text-zinc-400 tabular">{t('matrix.sold', { n: cell.sold })}</span>
                                                                </button>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                                <td className="text-center tabular text-zinc-300 px-2">{row?.stock ?? 0}<span className="block text-[11px] text-zinc-500">{t('matrix.sold', { n: row?.sold ?? 0 })}</span></td>
                                            </tr>
                                        );
                                    })}
                                    <tr>
                                        <th className="text-start font-medium text-zinc-400 px-2">{t('matrix.total')}</th>
                                        {data.totals.bySize.map(s => <td key={s.size} className="text-center tabular text-zinc-300">{s.stock}<span className="block text-[11px] text-zinc-500">{t('matrix.sold', { n: s.sold })}</span></td>)}
                                        <td className="text-center font-bold tabular">{data.totals.stock}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        {canAdjust && <p className="form-hint">{t('matrix.countHint')}</p>}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            <MixList title="size" m={sizeMix} label={(k) => sizeLabel(k) || '—'} />
                            <MixList title="color" m={colorMix} label={colorLabel} />
                        </div>
                        <p className="form-hint">{t('matrix.mix.hint')}</p>

                        <section className="space-y-3 rounded-xl border border-dark-border p-4" data-testid="matrix-plan">
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="min-w-0">
                                    <h4 className="font-semibold">{t('matrix.plan.title')}</h4>
                                    <p className="text-sm text-zinc-400">{t('matrix.plan.text')}</p>
                                </div>
                                <Input label={t('matrix.plan.total')} type="number" min="0" value={planTotal} onChange={(e) => setPlanTotal(e.target.value)} className="tabular w-32" data-testid="matrix-plan-total" />
                            </div>
                            {Number(planTotal) > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="text-sm border-separate border-spacing-1">
                                        <thead><tr><th />{data.sizes.map(size => <th key={size} className="px-2 font-semibold">{sizeLabel(size) || '—'}</th>)}</tr></thead>
                                        <tbody>
                                            {data.colors.map(color => (
                                                <tr key={color.key}>
                                                    <th className="text-start font-medium px-2 whitespace-nowrap">{colorLabel(color.key)}</th>
                                                    {data.sizes.map(size => {
                                                        const cell = byCell.get(cellKey(color.key, size));
                                                        return <td key={size} className="text-center tabular px-3 py-1 rounded bg-indigo-500/10 font-semibold">{cell ? planned.get(cell.id) || 0 : '·'}</td>;
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    </>
                )}
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={() => navigate(`/labels?tab=articles&product=${encodeURIComponent(productId)}`)}>
                    <QrCode className="w-4 h-4" /> {t('products.printLabels')}
                </Button>
                {purchaseOrders && (
                    <Button variant="secondary" onClick={() => navigate('/purchase-orders?order=soldOut')}>
                        <ShoppingCart className="w-4 h-4" /> {t('dash.do.order')}
                    </Button>
                )}
                <Button onClick={onClose}>{t('common.close')}</Button>
            </ModalFooter>
        </Modal>
    );
}
