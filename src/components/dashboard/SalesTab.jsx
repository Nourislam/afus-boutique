import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Banknote, Receipt, Undo2, BarChart3 } from 'lucide-react';
import { useT } from '../../i18n';
import { formatDate, formatMoney, formatNumber } from '../../i18n/format';
import { compare, localDate } from '../../lib/dashboard';
import { Money, Section, Tile, CompareLine, MiniTabs, Spinner, Empty } from './parts';
import { BestSellers } from './TodayTab';

const safe = async (promise, fallback) => { try { return (await promise) ?? fallback; } catch { return fallback; } };
const AGAINST = { today: 'yesterday', week: 'lastWeek', month: 'lastMonth' };

/** Every hour (or day) of the period, even without sales, so the bars keep their place. */
function fillBuckets(rows, period, bucket, now = new Date()) {
    const byKey = new Map(rows.map(r => [r.bucket, r]));
    const out = [];
    if (bucket === 'hour') {
        const first = Math.min(9, ...rows.map(r => Number(r.bucket)));
        for (let h = first; h <= now.getHours(); h++) {
            const key = String(h).padStart(2, '0');
            out.push({ key, label: `${key}h`, total: byKey.get(key)?.total || 0, count: byKey.get(key)?.count || 0 });
        }
        return out;
    }
    const start = new Date(`${period.startDate.replace(' ', 'T')}Z`);
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (start.getHours() !== 0) day.setDate(day.getDate() + 1);
    for (; day <= now; day.setDate(day.getDate() + 1)) {
        const key = localDate(day);
        out.push({ key, label: formatDate(new Date(day), 'short'), total: byKey.get(key)?.total || 0, count: byKey.get(key)?.count || 0 });
    }
    return out;
}

const shortMoney = (n) => (n >= 1000 ? `${formatNumber(Math.round(n / 100) / 10)}k` : formatNumber(n));

export default function SalesTab({ ranges }) {
    const { t } = useT();
    const [period, setPeriod] = useState('week');
    const [data, setData] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const api = window.electronAPI;
        const p = ranges.periods[period];
        setData(null);
        (async () => {
            const [now, before, series, selling] = await Promise.all([
                safe(api.sales.getStats(p.current), {}),
                safe(api.sales.getStats(p.previous), {}),
                safe(api.dashboard.series({ range: p.current, bucket: p.bucket, offsetMinutes: ranges.offsetMinutes }), []),
                safe(api.dashboard.selling({ range: p.current, since30: ranges.since30 }), { best: { products: [], colors: [], sizes: [] } }),
            ]);
            if (!cancelled) setData({ now, before, series, best: selling.best });
        })();
        return () => { cancelled = true; };
    }, [period, ranges]);

    const p = ranges.periods[period];
    const bars = useMemo(() => (data ? fillBuckets(data.series, p.current, p.bucket) : []), [data, p]);
    const tooltipStyle = { backgroundColor: 'rgb(var(--surface-1))', border: '1px solid rgb(var(--surface-border))', borderRadius: '8px', color: 'rgb(var(--fg))' };

    return (
        <div className="space-y-4">
            <MiniTabs value={period} onChange={setPeriod} tabs={['today', 'week', 'month'].map(id => ({ id, label: t(`dash.period.${id}`) }))} />
            {!data ? <Spinner /> : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 xl:gap-4">
                        <Tile icon={Banknote} label={t(`dash.sold.${period}`)} value={<Money value={data.now.total_revenue || 0} />}>
                            {data.now.total_revenue > 0 || data.before.total_revenue > 0
                                ? <CompareLine cmp={compare(data.now.total_revenue, data.before.total_revenue)} against={AGAINST[period]} />
                                : t('dash.noSaleYet')}
                        </Tile>
                        <Tile icon={Receipt} label={t('dash.ticket.average')} value={<Money value={data.now.average_sale || 0} />}>
                            {t('dash.ticket.count', { n: data.now.total_transactions || 0 })}
                        </Tile>
                        <Tile icon={Undo2} label={t('dash.returns.title')} value={<bdi className="tabular">{data.now.refunds_count || 0}</bdi>}>
                            {data.now.refunds_count > 0 ? <>{t('dash.returns.refunded')} <Money value={data.now.total_refunds || 0} /></> : t('dash.returns.none')}
                        </Tile>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                        <Section title={t(`dash.chart.${p.bucket}`)} icon={BarChart3} className="xl:col-span-7">
                            {bars.every(b => b.total === 0) ? <Empty>{t('dash.noSaleYet')}</Empty> : (
                                <div className="h-60 ltr" data-testid="sales-chart">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                                            <CartesianGrid stroke="rgba(113,113,122,0.18)" vertical={false} />
                                            <XAxis dataKey="label" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
                                            <YAxis tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} width={44} tickFormatter={shortMoney} />
                                            <Tooltip cursor={{ fill: 'rgba(113,113,122,0.12)' }} contentStyle={tooltipStyle} itemStyle={{ color: 'rgb(var(--fg))' }}
                                                formatter={(value, _name, item) => [`${formatMoney(value)} · ${t('dash.ticket.count', { n: item.payload.count })}`, t('dash.chart.sold')]} />
                                            <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={36} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </Section>
                        <div className="xl:col-span-5">
                            <BestSellers best={data.best} title={t(`dash.best.${period}`)} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
