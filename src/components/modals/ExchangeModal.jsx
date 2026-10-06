import { useState, useEffect, useMemo } from 'react';
import { ArrowLeftRight, ScanLine } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { formatMoney } from '../../i18n/format';
import { translateError } from '../../i18n/errors';
import { variantLabel } from '../../lib/clothing';
import { useAuthStore } from '../../stores/authStore';
import { withManagerApproval } from '../../lib/approval';

/**
 * Exchange a piece of a ticket for another size, colour or article. The old
 * piece is returned and the new one sold in one go (main process,
 * exchangeService.js); the screen shows what the customer pays or gets back.
 * onDone(result): result.sale_id is the new ticket (to preview or print).
 */
export default function ExchangeModal({ isOpen, onClose, sale, onDone }) {
    const { t } = useT();
    const user = useAuthStore(state => state.currentEmployee);
    const [lines, setLines] = useState([]);
    const [lineId, setLineId] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [condition, setCondition] = useState('sellable');
    const [variants, setVariants] = useState([]);
    const [target, setTarget] = useState(null); // { variantId } or { productId, label }
    const [code, setCode] = useState('');
    const [preview, setPreview] = useState(null);
    const [previewError, setPreviewError] = useState('');
    const [method, setMethod] = useState('cash');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen || !sale) return undefined;
        let cancelled = false;
        setLineId(''); setTarget(null); setPreview(null); setPreviewError(''); setQuantity(1); setCondition('sellable'); setCode('');
        window.electronAPI.sales.getById(sale.id).then(full => {
            if (cancelled || !full) return;
            const rows = (full.items || []).map(item => ({ ...item, left: Math.max(0, (Number(item.quantity) || 0) - (Number(item.returned_quantity) || 0)) }));
            setLines(rows);
            const first = rows.find(r => r.left > 0);
            if (first) setLineId(first.id);
        }).catch(() => toast.error(t('return.loadFailed')));
        return () => { cancelled = true; };
    }, [isOpen, sale, t]);

    const line = useMemo(() => lines.find(l => l.id === lineId) || null, [lines, lineId]);

    // The other sizes and colours of the article brought back
    useEffect(() => {
        if (!line?.product_id) { setVariants([]); return undefined; }
        let cancelled = false;
        window.electronAPI.catalog.getVariants(line.product_id)
            .then(rows => { if (!cancelled) setVariants((rows || []).filter(v => v.id !== line.variant_id)); })
            .catch(() => { if (!cancelled) setVariants([]); });
        return () => { cancelled = true; };
    }, [line]);

    // What the customer pays or gets back, computed by the main process
    useEffect(() => {
        if (!isOpen || !sale || !line || !target) { setPreview(null); setPreviewError(''); return undefined; }
        let cancelled = false;
        window.electronAPI.exchanges.preview({
            sale_id: sale.id, sale_item_id: line.id, quantity,
            new_variant_id: target.variantId || null, new_product_id: target.productId || null,
        }).then(p => { if (!cancelled) { setPreview(p); setPreviewError(''); } })
            .catch(e => { if (!cancelled) { setPreview(null); setPreviewError(translateError(e)); } });
        return () => { cancelled = true; };
    }, [isOpen, line, target, quantity, sale]);

    const findOther = async () => {
        const value = code.trim();
        if (!value) return;
        try {
            const found = await window.electronAPI.catalog.lookupCode(value);
            if (!found) { toast.error(t('exchange.codeUnknown', { code: value })); return; }
            if (found.type === 'variant') setTarget({ variantId: found.variant.id, label: `${found.product.name} · ${variantLabel(found.variant)}` });
            else if (found.needsVariant) toast.error(t('exchange.pickPiece'));
            else setTarget({ productId: found.product.id, label: found.product.name });
            setCode('');
        } catch (e) {
            toast.error(translateError(e));
        }
    };

    const submit = async () => {
        if (!line || !target || !preview) return;
        setSaving(true);
        try {
            // A cashier may need a manager's PIN (checked by the main process)
            const result = await withManagerApproval((approval) => window.electronAPI.exchanges.create({
                sale_id: sale.id, sale_item_id: line.id, quantity, condition,
                new_variant_id: target.variantId || null, new_product_id: target.productId || null,
                payment_method: method, employee_id: user?.id || null, approval,
            }));
            toast.success(t('exchange.done'));
            onDone?.(result);
            onClose();
        } catch (e) {
            toast.error(`${t('exchange.failed')} — ${translateError(e)}`);
        } finally {
            setSaving(false);
        }
    };

    const lineText = (l) => [l.product_name, l.variant_label].filter(Boolean).join(' · ');
    const diff = preview?.difference ?? 0;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('exchange.titleFor', { receipt: sale?.receipt_number || '' })} size="xl">
            <ModalBody>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5" data-testid="exchange-modal">
                    <section className="space-y-3 min-w-0">
                        <h3 className="font-semibold">{t('exchange.step1')}</h3>
                        <ul className="space-y-2">
                            {lines.map(l => (
                                <li key={l.id}>
                                    <button type="button" disabled={l.left === 0}
                                        onClick={() => { setLineId(l.id); setTarget(null); setQuantity(1); }}
                                        className={`w-full text-start rounded-lg border p-3 transition-colors disabled:opacity-50 ${l.id === lineId ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-500'}`}>
                                        <span className="block font-medium truncate">{lineText(l)}</span>
                                        <span className="block text-xs text-zinc-500">
                                            {t('exchange.lineInfo', { sold: l.quantity, left: l.left })} · <bdi>{formatMoney(l.unit_price)}</bdi>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {line && (
                            <div className="grid grid-cols-2 gap-3">
                                <Input label={t('exchange.quantity')} type="number" min="1" max={line.left} value={quantity}
                                    onChange={(e) => setQuantity(Math.min(Math.max(1, parseInt(e.target.value, 10) || 1), Math.max(1, line.left)))} />
                                <Select label={t('return.condition')} value={condition} onChange={setCondition}
                                    options={[{ value: 'sellable', label: t('return.sellable') }, { value: 'damaged', label: t('return.damaged') }]} />
                            </div>
                        )}
                    </section>

                    <section className="space-y-3 min-w-0">
                        <h3 className="font-semibold">{t('exchange.step2')}</h3>
                        {line && variants.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {variants.map(v => {
                                    const out = (Number(v.stock_quantity) || 0) <= 0;
                                    return (
                                        <button key={v.id} type="button" disabled={out}
                                            onClick={() => setTarget({ variantId: v.id, label: `${line.product_name} · ${variantLabel(v)}` })}
                                            className={`rounded-lg border p-2 text-start text-sm disabled:opacity-40 ${target?.variantId === v.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-500'}`}>
                                            <span className="block font-medium truncate">{variantLabel(v)}</span>
                                            <span className="block text-xs text-zinc-500">{out ? t('dash.stock.out') : t('exchange.inStock', { n: v.stock_quantity })}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        <div className="flex items-end gap-2">
                            <Input containerClassName="flex-1" label={t('exchange.otherArticle')} value={code} placeholder={t('exchange.scanHint')}
                                onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') findOther(); }} />
                            <Button variant="secondary" onClick={findOther}><ScanLine className="w-4 h-4" /></Button>
                        </div>
                        {target && <p className="text-sm">{t('exchange.newPiece')}: <span className="font-medium">{target.label}</span></p>}

                        {previewError && <p className="text-sm text-red-400" role="alert">{previewError}</p>}
                        {preview && (
                            <div className="rounded-xl bg-dark-tertiary p-4 space-y-1.5 text-sm" data-testid="exchange-preview">
                                <div className="flex justify-between gap-3"><span className="text-zinc-400">{t('exchange.credit')}</span><bdi>{formatMoney(preview.credit)}</bdi></div>
                                <div className="flex justify-between gap-3"><span className="text-zinc-400">{t('exchange.newTotal')}</span><bdi>{formatMoney(preview.new_total)}</bdi></div>
                                <div className={`flex justify-between gap-3 text-base font-bold pt-1 border-t border-dark-border ${diff > 0 ? 'text-amber-300' : diff < 0 ? 'text-emerald-300' : ''}`}>
                                    <span>{diff > 0 ? t('exchange.customerPays') : diff < 0 ? t('exchange.giveBack') : t('exchange.noDifference')}</span>
                                    {diff !== 0 && <bdi>{formatMoney(Math.abs(diff))}</bdi>}
                                </div>
                                {diff > 0 && (
                                    <Select label={t('exchange.payWith')} value={method} onChange={setMethod}
                                        options={[{ value: 'cash', label: t('pay.cash') }, { value: 'card', label: t('pay.card') }, { value: 'transfer', label: t('pay.transferShort') }]} />
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                <Button onClick={submit} loading={saving} disabled={!preview}>
                    <ArrowLeftRight className="w-4 h-4" /> {t('exchange.confirm')}
                </Button>
            </ModalFooter>
        </Modal>
    );
}
