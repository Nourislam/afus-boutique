import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageX, PackageMinus, Ruler, Warehouse, ShoppingCart, Eye } from 'lucide-react';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';
import { sizeLabel, variantLabel } from '../../lib/clothing';
import { DASHBOARD_LINKS } from '../../lib/listFilters';
import { Money, Section, Row, Empty, Spinner } from './parts';
import { SlowMovers } from './TodayTab';

const safe = async (promise, fallback) => { try { return (await promise) ?? fallback; } catch { return fallback; } };

export default function StockTab({ access, features, ranges }) {
    const { t } = useT();
    const navigate = useNavigate();
    const [data, setData] = useState(null);

    useEffect(() => {
        let cancelled = false;
        safe(window.electronAPI.dashboard.stock({ since30: ranges.since30 }), { outOfStock: [], low: [], missingSizes: [], slow: [], value: null })
            .then(result => { if (!cancelled) setData(result); });
        return () => { cancelled = true; };
    }, [ranges]);

    if (!data) return <Spinner />;
    // "Order" goes to the purchase orders when that module is on, to the stock otherwise
    const order = features.purchaseOrders
        ? <Button size="sm" variant="secondary" onClick={() => navigate(DASHBOARD_LINKS.orderSoldOut)}><ShoppingCart className="w-4 h-4" /> {t('dash.do.order')}</Button>
        : <Button size="sm" variant="secondary" onClick={() => navigate(DASHBOARD_LINKS.stockOut)}><Eye className="w-4 h-4" /> {t('dash.do.see')}</Button>;
    const see = <Button size="sm" variant="ghost" onClick={() => navigate(DASHBOARD_LINKS.stockLow)}>{t('dash.do.seeDetails')}</Button>;
    const piece = (row) => [row.product_name, variantLabel(row)].filter(Boolean).join(' · ');

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 min-[1800px]:grid-cols-3 gap-4">
                <Section title={t('dash.stock.outSelling')} icon={PackageX} action={data.outOfStock.length > 0 && order}>
                    {data.outOfStock.length === 0 ? <Empty good>{t('dash.stock.outSellingNone')}</Empty> : (
                        <ul className="divide-y divide-dark-border">
                            {data.outOfStock.map(row => (
                                <Row key={row.variant_id || row.product_id} aside={<span className="badge bg-red-500/15 text-red-300 whitespace-nowrap">{t('dash.stock.out')}</span>}>
                                    <p className="font-medium truncate">{piece(row)}</p>
                                    <p className="text-xs text-zinc-500">{t('dash.stock.sold30', { n: row.sold })}</p>
                                </Row>
                            ))}
                        </ul>
                    )}
                </Section>

                <Section title={t('dash.stock.low')} icon={PackageMinus} action={data.low.length > 0 && see}>
                    {data.low.length === 0 ? <Empty good>{t('dash.stock.lowNone')}</Empty> : (
                        <ul className="divide-y divide-dark-border">
                            {data.low.map(row => (
                                <Row key={row.variant_id || row.product_id} aside={<span className="badge bg-amber-500/15 text-amber-300 whitespace-nowrap">{t('dash.selling.left', { n: row.stock_quantity })}</span>}>
                                    <p className="font-medium truncate">{piece(row)}</p>
                                </Row>
                            ))}
                        </ul>
                    )}
                </Section>

                <Section title={t('dash.stock.missingSizes')} icon={Ruler} action={data.missingSizes.length > 0 && order}>
                    {data.missingSizes.length === 0 ? <Empty good>{t('dash.stock.missingSizesNone')}</Empty> : (
                        <ul className="divide-y divide-dark-border">
                            {data.missingSizes.map(row => (
                                <Row key={row.product_id}>
                                    <p className="font-medium truncate">{row.product_name}</p>
                                    <p className="text-xs">
                                        <span className="text-red-300">{t('dash.stock.missing', { sizes: row.missing.map(sizeLabel).join(' · ') })}</span>
                                        <span className="text-zinc-500"> — {t('dash.stock.available', { sizes: row.available.map(sizeLabel).join(' · ') })}</span>
                                    </p>
                                </Row>
                            ))}
                        </ul>
                    )}
                </Section>

                {features.promotions && access.promotions && <SlowMovers rows={data.slow} />}

                {access.stockValue && data.value && (
                    <Section title={t('dash.stock.value')} icon={Warehouse}>
                        <p className="text-2xl font-bold"><Money value={data.value.retail} /></p>
                        <p className="text-sm text-zinc-400">
                            {t('dash.stock.valueHint', { n: data.value.units })}
                            {' · '}
                            {t('dash.stock.valueCost')} <Money value={data.value.cost} />
                        </p>
                    </Section>
                )}
            </div>
        </div>
    );
}
