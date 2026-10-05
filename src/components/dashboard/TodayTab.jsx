import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Banknote, Wallet, ShoppingBag, Printer, Archive, CreditCard, Boxes, Tag, Percent, AlertTriangle, CheckCircle2,
    Flame, Snail, CalendarDays, Package, Rocket, Check,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';
import { formatDate, formatMoney } from '../../i18n/format';
import { colorHex, colorName, sizeLabel } from '../../lib/clothing';
import { compare, profitState, isFirstDay, daysWithoutSale, MAX_ALERTS } from '../../lib/dashboard';
import { DASHBOARD_LINKS } from '../../lib/listFilters';
import { Money, Section, Tile, CompareLine, MiniTabs, Row, Empty, Spinner } from './parts';

const ALERT_ICONS = { printer: Printer, drawer: Wallet, stock: Boxes, credit: CreditCard, backup: Archive, price: Tag, offer: Percent };
const TONES = {
    danger: 'bg-red-500/15 text-red-300',
    warning: 'bg-amber-500/15 text-amber-300',
};

const safe = async (promise, fallback) => { try { return (await promise) ?? fallback; } catch { return fallback; } };

/** "What do I do now?": at most 5 lines, the most serious first, each with one button. */
export function ActionList({ alerts, onAction }) {
    const { t } = useT();
    const [all, setAll] = useState(false);
    const shown = all ? alerts : alerts.slice(0, MAX_ALERTS);
    const text = ([key, params = {}]) => t(key, { ...params, amount: params.amount !== undefined ? formatMoney(params.amount) : undefined });
    return (
        <Section title={t('dash.whatNow')} icon={AlertTriangle} className="h-full">
            {alerts.length === 0 ? (
                <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 text-emerald-300 px-3 py-3 font-medium" data-testid="all-good">
                    <CheckCircle2 className="w-5 h-5 flex-none" /> {t('dash.allGood')}
                </p>
            ) : (
                <ul className="divide-y divide-dark-border" data-testid="alerts">
                    {shown.map(alert => {
                        const Icon = ALERT_ICONS[alert.icon] || AlertTriangle;
                        return (
                            <li key={alert.id} className="flex items-center gap-3 py-2.5 min-h-[56px]">
                                <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-none ${TONES[alert.tone] || TONES.warning}`}><Icon className="w-[18px] h-[18px]" /></span>
                                <span className="flex-1 min-w-0 text-sm leading-snug break-words">{text(alert.text)}</span>
                                <Button size="sm" variant="secondary" className="flex-none min-h-[40px]" onClick={() => onAction(alert.action)}>
                                    {t(alert.action.label)}
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}
            {alerts.length > MAX_ALERTS && (
                <button type="button" className="self-start text-sm text-indigo-300 hover:underline" onClick={() => setAll(v => !v)}>
                    {all ? t('dash.showLess') : t('dash.showAll', { n: alerts.length })}
                </button>
            )}
        </Section>
    );
}

/** A brand-new shop: three steps instead of zeros everywhere. */
function FirstSteps({ steps }) {
    const { t } = useT();
    const navigate = useNavigate();
    const items = [
        { id: 'product', done: steps.products > 0, to: '/products' },
        { id: 'drawer', done: steps.shifts > 0, to: '/pos' },
        { id: 'sale', done: steps.sales > 0, to: '/pos' },
    ];
    return (
        <section className="card flex flex-col gap-4" data-testid="first-steps">
            <div>
                <h2 className="text-lg font-semibold flex items-center gap-2"><Rocket className="w-5 h-5 text-indigo-300" /> {t('dash.first.title')}</h2>
                <p className="text-sm text-zinc-400">{t('dash.first.text')}</p>
            </div>
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {items.map((item, i) => (
                    <li key={item.id}>
                        <button type="button" onClick={() => navigate(item.to)}
                            className={`w-full h-full text-start rounded-xl border p-4 flex items-start gap-3 transition-colors ${item.done ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-dark-border hover:border-indigo-500'}`}>
                            <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-none font-bold ${item.done ? 'bg-emerald-500 text-white' : 'bg-dark-tertiary'}`}>
                                {item.done ? <Check className="w-4 h-4" /> : i + 1}
                            </span>
                            <span className="min-w-0">
                                <span className="block font-medium">{t(`dash.first.${item.id}`)}</span>
                                <span className="block text-xs text-zinc-500 mt-0.5">{t(`dash.first.${item.id}Hint`)}</span>
                            </span>
                        </button>
                    </li>
                ))}
            </ol>
            <Button className="self-start" onClick={() => navigate('/pos')}><ShoppingBag className="w-4 h-4" /> {t('dash.first.start')}</Button>
        </section>
    );
}

/** "What sells this week?": best 5 articles, colours or sizes, with the pieces left. */
export function BestSellers({ best, onMore, title }) {
    const { t } = useT();
    const [kind, setKind] = useState('products');
    const rows = best?.[kind] || [];
    const name = (row) => {
        if (kind === 'colors') {
            return (
                <span className="flex items-center gap-2 min-w-0">
                    <span className="w-3.5 h-3.5 rounded-full border border-zinc-600 flex-none" style={{ background: colorHex(row) || '#3f3f46' }} />
                    <span className="truncate">{colorName(row)}</span>
                </span>
            );
        }
        return <span className="truncate block">{kind === 'sizes' ? sizeLabel(row.size) : row.name}</span>;
    };
    return (
        <Section title={title || t('dash.selling.title')} icon={Flame} className="h-full"
            action={onMore && <button type="button" className="text-sm text-indigo-300 hover:underline whitespace-nowrap" onClick={onMore}>{t('dash.salesDetails')}</button>}>
            <MiniTabs value={kind} onChange={setKind} tabs={[
                { id: 'products', label: t('dash.selling.products') },
                { id: 'colors', label: t('dash.selling.colors') },
                { id: 'sizes', label: t('dash.selling.sizes') },
            ]} />
            {!best ? <Spinner /> : rows.length === 0 ? <Empty>{t('dash.selling.none')}</Empty> : (
                <ol className="divide-y divide-dark-border" data-testid="best-sellers">
                    {rows.map((row, i) => (
                        <Row key={i} aside={(
                            <>
                                <span className="text-sm text-zinc-300 whitespace-nowrap">{t('dash.selling.sold', { n: row.quantity })}</span>
                                <span className={`badge whitespace-nowrap ${row.stock <= 0 ? 'bg-red-500/15 text-red-300' : row.stock <= 2 ? 'bg-amber-500/15 text-amber-300' : 'bg-dark-tertiary text-zinc-400'}`}>
                                    {row.stock <= 0 ? t('dash.stock.out') : t('dash.selling.left', { n: row.stock })}
                                </span>
                            </>
                        )}>
                            <span className="flex items-center gap-2 min-w-0">
                                <span className="w-5 text-xs text-zinc-500 flex-none tabular">{i + 1}</span>
                                <span className="min-w-0 flex-1 font-medium">{name(row)}</span>
                            </span>
                        </Row>
                    ))}
                </ol>
            )}
        </Section>
    );
}

/** Articles that did not sell for 30 days, with the button to put them on discount. */
export function SlowMovers({ rows, title }) {
    const { t } = useT();
    const navigate = useNavigate();
    return (
        <Section title={title || t('dash.slow.title')} icon={Snail} className="h-full">
            {!rows ? <Spinner /> : rows.length === 0 ? <Empty good>{t('dash.slow.none')}</Empty> : (
                <ul className="divide-y divide-dark-border" data-testid="slow-movers">
                    {rows.map(row => {
                        const days = daysWithoutSale(row);
                        return (
                            <Row key={row.product_id} aside={(
                                <Button size="sm" variant="secondary" className="min-h-[40px]" onClick={() => navigate(`/offers?tab=promotions&discountProduct=${encodeURIComponent(row.product_id)}`)}>
                                    <Percent className="w-4 h-4" /> {t('dash.do.discount')}
                                </Button>
                            )}>
                                <p className="font-medium truncate">{row.name}</p>
                                <p className="text-xs text-zinc-500">
                                    {t('dash.slow.pieces', { n: row.stock })}
                                    {' · '}
                                    {row.last_sale_at ? t('dash.slow.days', { n: days ?? 0 }) : t('dash.slow.never')}
                                </p>
                            </Row>
                        );
                    })}
                </ul>
            )}
        </Section>
    );
}

export default function TodayTab({ access, features, user, ranges, home, alerts, onAction, onOpenTab }) {
    const { t, lang } = useT();
    const navigate = useNavigate();
    const [figures, setFigures] = useState(null);
    const [drawer, setDrawer] = useState(undefined);
    const [selling, setSelling] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const api = window.electronAPI;
        const own = access.shop ? {} : { employeeId: user?.id };
        const { today, week } = ranges.periods;
        (async () => {
            const [now, before, weekNow, weekBefore] = await Promise.all([
                safe(api.sales.getStats({ ...today.current, ...own }), {}),
                safe(api.sales.getStats({ ...today.previous, ...own }), {}),
                access.shop ? safe(api.sales.getStats(week.current), {}) : null,
                access.shop ? safe(api.sales.getStats(week.previous), {}) : null,
            ]);
            if (!cancelled) setFigures({ now, before, weekNow, weekBefore });

            // The drawer: all open drawers for the shop, the cashier's own otherwise
            let shifts = [];
            if (access.shop) shifts = home?.openShifts || [];
            else if (user?.id) { const mine = await safe(api.shifts.getCurrent(user.id), null); shifts = mine ? [mine] : []; }
            const withStats = await Promise.all(shifts.map(async s => ({ ...s, stats: await safe(api.shifts.getStats(s.id), null) })));
            if (!cancelled) setDrawer(withStats);

            if (access.shop) {
                const data = await safe(api.dashboard.selling({ range: week.current, since30: ranges.since30 }), { best: { products: [], colors: [], sizes: [] }, slow: [] });
                if (!cancelled) setSelling(data);
            }
        })();
        return () => { cancelled = true; };
    }, [access.shop, user?.id, ranges, home]);

    const first = isFirstDay(home?.firstSteps);
    const profit = profitState(access, home?.soldWithoutCost || 0);
    const money = (v) => <Money value={v} />;
    const now = figures?.now || {};
    const showSlow = access.shop && features.promotions && access.promotions;

    const drawerTile = () => {
        if (drawer === undefined) return <Tile icon={Wallet} label={t('dash.tile.drawer')} value="…" testId="tile-drawer" />;
        if (drawer.length === 0) {
            return (
                <Tile icon={Wallet} label={t('dash.tile.drawer')} value={t('dash.drawer.closed')} testId="tile-drawer">
                    <button type="button" className="text-indigo-300 hover:underline" onClick={() => navigate('/pos')}>{t('dash.drawer.open')}</button>
                </Tile>
            );
        }
        const cash = drawer.reduce((sum, s) => sum + (s.stats?.expected_cash || 0), 0);
        const firstShift = drawer[0];
        return (
            <Tile icon={Wallet} label={access.shop ? t('dash.tile.drawer') : t('dash.tile.myDrawer')} value={money(cash)} testId="tile-drawer">
                {drawer.length > 1
                    ? t('dash.drawer.manyOpen', { n: drawer.length })
                    : t('dash.drawer.openSince', { time: formatDate(firstShift.start_time, 'time', { lang }), name: firstShift.employee_name || user?.name || '' })}
            </Tile>
        );
    };

    return (
        <div className="space-y-4">
            {first ? <FirstSteps steps={home.firstSteps} /> : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 xl:gap-4" data-testid="tiles">
                    <Tile icon={Banknote} label={access.shop ? t('dash.tile.sales') : t('dash.tile.mySales')} value={figures ? money(now.total_revenue || 0) : '…'} testId="tile-sales">
                        {figures && (now.total_transactions > 0 || figures.before.total_revenue > 0
                            ? <CompareLine cmp={compare(now.total_revenue, figures.before.total_revenue)} against="yesterday" />
                            : t('dash.noSaleYet'))}
                    </Tile>
                    {profit === 'hidden' ? (
                        <Tile icon={ShoppingBag} label={t('dash.tile.myCount')} value={figures ? <bdi className="tabular">{now.total_transactions || 0}</bdi> : '…'} testId="tile-count">
                            {figures && t('dash.piecesSold', { n: now.items_sold || 0 })}
                        </Tile>
                    ) : (
                        <Tile icon={Wallet} label={profit === 'approx' ? t('dash.tile.profitApprox') : t('dash.tile.profit')}
                            value={figures ? <>{profit === 'approx' && <span className="text-zinc-500">≈ </span>}{money(now.total_profit || 0)}</> : '…'} testId="tile-profit">
                            {profit === 'approx' ? (
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="text-amber-300">{t('dash.profit.noCost', { n: home.soldWithoutCost })}</span>
                                    {access.products && <button type="button" className="text-indigo-300 hover:underline" onClick={() => navigate(DASHBOARD_LINKS.productsNoCost)}>{t('dash.do.completePrices')}</button>}
                                </span>
                            ) : t('dash.profit.hint')}
                        </Tile>
                    )}
                    {drawerTile()}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
                <div className={access.shop && !first ? 'xl:col-span-7 min-[1800px]:col-span-4' : 'xl:col-span-12'}>
                    <ActionList alerts={alerts} onAction={onAction} />
                </div>
                {access.shop && !first && (
                    <div className="xl:col-span-5 min-[1800px]:col-span-4">
                        <BestSellers best={selling?.best} onMore={() => onOpenTab('sales')} />
                    </div>
                )}
                {showSlow && !first && (
                    <div className="xl:col-span-12 min-[1800px]:col-span-4">
                        <SlowMovers rows={selling?.slow} />
                    </div>
                )}
            </div>

            {access.shop && !first && figures?.weekNow && (
                <div className="card flex flex-wrap items-center justify-between gap-3 py-3" data-testid="week-line">
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                        <span className="flex items-center gap-2 font-semibold"><CalendarDays className="w-4 h-4 text-indigo-300" /> {t('dash.week.total')} {money(figures.weekNow.total_revenue || 0)}</span>
                        <CompareLine cmp={compare(figures.weekNow.total_revenue, figures.weekBefore.total_revenue)} against="lastWeek" />
                    </p>
                    <Button size="sm" variant="secondary" onClick={() => onOpenTab('sales')}><Package className="w-4 h-4" /> {t('dash.salesDetails')}</Button>
                </div>
            )}
        </div>
    );
}
