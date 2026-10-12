import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageX, PackageMinus, Ruler, Warehouse, ShoppingCart, Eye, Hourglass, Gauge, Moon, Percent, Grid3x3, Coins, TrendingUp } from 'lucide-react';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';
import { sizeLabel, variantLabel, seasonLabel } from '../../lib/clothing';
import { DASHBOARD_LINKS } from '../../lib/listFilters';
import { Money, Section, Row, Empty, Spinner, Tile, MiniTabs } from './parts';
import ProductMatrixModal from '../products/ProductMatrixModal';

const DEAD_DAYS = [30, 60, 90];
const ST_BY = ['product', 'collection', 'season'];
const stTone = (rate) => (rate < 30 ? 'bg-red-400' : rate < 60 ? 'bg-amber-400' : 'bg-emerald-400');

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

    // Decision figures: what will run out, what sold of what was there, what sleeps, what the stock is worth
    const [runOut, setRunOut] = useState(null);
    const [stBy, setStBy] = useState('product');
    const [st, setSt] = useState(null);
    const [deadDays, setDeadDays] = useState(60);
    const [dead, setDead] = useState(null);
    const [worth, setWorth] = useState(null);
    const [matrixOf, setMatrixOf] = useState(null);
    useEffect(() => {
        let cancelled = false;
        safe(window.electronAPI.insights.runOut({}), []).then(rows => { if (!cancelled) setRunOut(rows); });
        return () => { cancelled = true; };
    }, [ranges]);
    useEffect(() => {
        let cancelled = false;
        setSt(null);
        safe(window.electronAPI.insights.sellThrough({ by: stBy }), { rows: [], total: {} }).then(r => { if (!cancelled) setSt(r); });
        return () => { cancelled = true; };
    }, [stBy, ranges]);
    useEffect(() => {
        let cancelled = false;
        setDead(null);
        safe(window.electronAPI.insights.deadStock({ days: deadDays }), { rows: [], total: {} }).then(r => { if (!cancelled) setDead(r); });
        if (access.stockValue) safe(window.electronAPI.insights.stockWorth({ dormantDays: deadDays }), null).then(r => { if (!cancelled) setWorth(r); });
        return () => { cancelled = true; };
    }, [deadDays, ranges, access.stockValue]);

    if (!data) return <Spinner />;
    const stLabel = (row) => (stBy === 'season' ? seasonLabel(row.key) : row.label);
    const matrixButton = (productId) => (
        <Button size="sm" variant="ghost" onClick={() => setMatrixOf(productId)} title={t('dash.do.matrix')} aria-label={t('dash.do.matrix')}>
            <Grid3x3 className="w-4 h-4" />
        </Button>
    );
    // "Order" goes to the purchase orders when that module is on, to the stock otherwise
    const order = features.purchaseOrders
        ? <Button size="sm" variant="secondary" onClick={() => navigate(DASHBOARD_LINKS.orderSoldOut)}><ShoppingCart className="w-4 h-4" /> {t('dash.do.order')}</Button>
        : <Button size="sm" variant="secondary" onClick={() => navigate(DASHBOARD_LINKS.stockOut)}><Eye className="w-4 h-4" /> {t('dash.do.see')}</Button>;
    const see = <Button size="sm" variant="ghost" onClick={() => navigate(DASHBOARD_LINKS.stockLow)}>{t('dash.do.seeDetails')}</Button>;
    const piece = (row) => [row.product_name, variantLabel(row)].filter(Boolean).join(' · ');

    return (
        <div className="space-y-4">
            {/* What the stock is worth: bought for, sells for, profit in it, and the part asleep */}
            {access.stockValue && worth && (
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4" data-testid="stock-worth">
                    <Tile icon={Warehouse} label={t('dash.worth.cost')} value={<Money value={worth.cost} />}>{t('dash.worth.pieces', { n: worth.units })}</Tile>
                    <Tile icon={Coins} label={t('dash.worth.retail')} value={<Money value={worth.retail} />} />
                    <Tile icon={TrendingUp} label={t('dash.worth.profit')} value={<Money value={worth.profit} />}>
                        {worth.units_without_cost > 0 && <span className="text-amber-300">{t('dash.worth.noCost', { n: worth.units_without_cost })}</span>}
                    </Tile>
                    <Tile icon={Moon} label={t('dash.worth.dormant', { days: worth.dormant.days })} value={<Money value={worth.dormant.cost} />}>{t('dash.worth.dormantHint', { n: worth.dormant.pieces })}</Tile>
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 min-[1800px]:grid-cols-3 gap-4">
                <Section title={t('dash.runOut.title')} icon={Hourglass} action={runOut?.length > 0 && order}>
                    {!runOut ? <Spinner /> : runOut.length === 0 ? <Empty good>{t('dash.runOut.none')}</Empty> : (
                        <ul className="divide-y divide-dark-border" data-testid="run-out">
                            {runOut.map(row => (
                                <Row key={row.variant_id || row.product_id} aside={(
                                    <>
                                        <span className={`badge whitespace-nowrap ${row.days_left < 1 ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
                                            {row.days_left < 1 ? t('dash.runOut.today') : t('dash.runOut.days', { n: Math.max(1, Math.round(row.days_left)) })}
                                        </span>
                                        {matrixButton(row.product_id)}
                                    </>
                                )}>
                                    <p className="font-medium truncate">{piece(row)}</p>
                                    <p className="text-xs text-zinc-500">{t('dash.runOut.left', { n: row.stock })} · {t('dash.runOut.pace', { sold: row.sold, perDay: row.per_day })}</p>
                                </Row>
                            ))}
                        </ul>
                    )}
                </Section>

                <Section title={t('dash.st.title')} icon={Gauge}>
                    <MiniTabs value={stBy} onChange={setStBy} tabs={ST_BY.map(id => ({ id, label: t(`dash.st.by${id[0].toUpperCase()}${id.slice(1)}`) }))} />
                    <p className="text-xs text-zinc-500">{t('dash.st.hint')}</p>
                    {!st ? <Spinner /> : st.rows.length === 0 ? <Empty>{t('dash.st.none')}</Empty> : (
                        <>
                            {st.total?.rate !== null && st.total?.rate !== undefined && <p className="text-sm font-semibold">{t('dash.st.total', { rate: Math.round(st.total.rate) })}</p>}
                            <ul className="space-y-2 max-h-80 overflow-y-auto pe-1" data-testid="sell-through">
                                {st.rows.map(row => (
                                    <li key={row.key} className="text-sm">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="truncate font-medium">{stLabel(row)}</span>
                                            <span className="flex items-center gap-2 flex-none">
                                                <span className="text-xs text-zinc-500 tabular">{t('dash.st.row', { sold: row.sold, total: row.sold + row.stock })}</span>
                                                <span className="font-semibold tabular w-12 text-end"><bdi>{Math.round(row.rate)} %</bdi></span>
                                                {stBy === 'product' && matrixButton(row.key)}
                                            </span>
                                        </div>
                                        <span className="mt-1 block h-1.5 rounded-full bg-dark-tertiary overflow-hidden" aria-hidden="true">
                                            <span className={`block h-full ${stTone(row.rate)}`} style={{ width: `${Math.min(100, row.rate)}%` }} />
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </Section>

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

                <Section title={t('dash.dead.title')} icon={Moon}>
                    <MiniTabs value={String(deadDays)} onChange={(v) => setDeadDays(Number(v))} tabs={DEAD_DAYS.map(d => ({ id: String(d), label: t('dash.dead.days', { n: d }) }))} />
                    {!dead ? <Spinner /> : dead.rows.length === 0 ? <Empty good>{t('dash.dead.none', { days: deadDays })}</Empty> : (
                        <>
                            {access.stockValue && <p className="text-sm text-zinc-300">{t('dash.dead.total', { articles: dead.total.articles, pieces: dead.total.pieces, cost: '' })}<Money value={dead.total.cost} /></p>}
                            <ul className="divide-y divide-dark-border max-h-80 overflow-y-auto pe-1" data-testid="dead-stock">
                                {dead.rows.map(row => (
                                    <Row key={row.product_id} aside={(
                                        <>
                                            {features.promotions && access.promotions && (
                                                <Button size="sm" variant="secondary" onClick={() => navigate(`/offers?tab=promotions&discountProduct=${encodeURIComponent(row.product_id)}`)}>
                                                    <Percent className="w-4 h-4" /> {t('dash.do.discount')}
                                                </Button>
                                            )}
                                            {matrixButton(row.product_id)}
                                        </>
                                    )}>
                                        <p className="font-medium truncate">{row.name}</p>
                                        <p className="text-xs text-zinc-500">
                                            {access.stockValue ? <>{t('dash.dead.row', { n: row.stock, cost: '' })}<Money value={row.cost_value} /></> : t('dash.slow.pieces', { n: row.stock })}
                                            {' · '}
                                            {row.last_sale_at ? t('dash.slow.days', { n: Math.max(0, Math.floor((Date.now() - Date.parse(String(row.last_sale_at).replace(' ', 'T') + 'Z')) / 86400000)) }) : t('dash.slow.never')}
                                        </p>
                                    </Row>
                                ))}
                            </ul>
                        </>
                    )}
                </Section>

            </div>
            <ProductMatrixModal productId={matrixOf} isOpen={!!matrixOf} onClose={() => setMatrixOf(null)} />
        </div>
    );
}
