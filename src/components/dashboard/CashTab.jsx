import { useEffect, useState } from 'react';
import { Wallet, CreditCard, Users, Receipt, History, Coins } from 'lucide-react';
import { useT } from '../../i18n';
import { formatDate } from '../../i18n/format';
import { paymentLabel } from '../../lib/payments';
import { formatDuration } from '../shifts/ShiftSummaryDialog';
import { Money, Section, Row, Empty, Spinner } from './parts';

const safe = async (promise, fallback) => { try { return (await promise) ?? fallback; } catch { return fallback; } };

export default function CashTab({ features, ranges, onCloseShift }) {
    const { t, lang } = useT();
    const [data, setData] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const api = window.electronAPI;
        const today = ranges.periods.today.current;
        (async () => {
            const [cash, methods, sales] = await Promise.all([
                safe(api.dashboard.cash({ range: today, closuresSince: ranges.closuresSince }), { openShifts: [], credit: null, employees: [], closures: [] }),
                safe(api.reports.paymentMethods(today), []),
                safe(api.sales.getToday({}), []),
            ]);
            if (!cancelled) setData({ ...cash, methods, sales: sales.slice(0, 5) });
        })();
        return () => { cancelled = true; };
    }, [ranges]);

    if (!data) return <Spinner />;
    const time = (v) => <bdi className="tabular">{formatDate(v, 'time', { lang })}</bdi>;
    const diffText = (d) => {
        if (d === null || d === undefined) return <span className="text-zinc-500">—</span>;
        if (Math.abs(d) < 1) return <span className="text-emerald-300">{t('dash.cash.exact')}</span>;
        return <span className={d < 0 ? 'text-red-300' : 'text-amber-300'}>{t(d < 0 ? 'dash.cash.missing' : 'dash.cash.extra')} <Money value={Math.abs(d)} /></span>;
    };

    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 min-[1800px]:grid-cols-3 gap-4">
            {/* The drawer now */}
            <Section title={t('dash.cash.now')} icon={Wallet}>
                {data.openShifts.length === 0 ? <Empty>{t('dash.drawer.closed')}</Empty> : (
                    <ul className="divide-y divide-dark-border">
                        {data.openShifts.map(shift => (
                            <Row key={shift.id} aside={<button type="button" className="text-sm text-indigo-300 hover:underline" onClick={() => onCloseShift(shift.id)}>{t('dash.do.closeDrawer')}</button>}>
                                <p className="text-xl font-bold"><Money value={shift.stats?.expected_cash || 0} /></p>
                                <p className="text-xs text-zinc-500">
                                    {t('dash.cash.openedBy', { name: shift.employee_name || '' })} · {time(shift.start_time)}
                                    {shift.stats?.duration_minutes !== undefined && <> · {formatDuration(shift.stats.duration_minutes)}</>}
                                </p>
                                <p className="text-xs text-zinc-500">{t('dash.cash.startedWith')} <Money value={shift.opening_cash || 0} /></p>
                            </Row>
                        ))}
                    </ul>
                )}
            </Section>

            {/* Today's money, by way of payment */}
            <Section title={t('dash.cash.byMethod')} icon={Receipt}>
                {data.methods.length === 0 ? <Empty>{t('dash.noSaleYet')}</Empty> : (
                    <ul className="divide-y divide-dark-border">
                        {data.methods.map(m => (
                            <Row key={m.method} aside={<span className="font-semibold"><Money value={m.total} /></span>}>
                                <p className="font-medium">{paymentLabel(m.method)}</p>
                                <p className="text-xs text-zinc-500">{t('dash.ticket.count', { n: m.count })}</p>
                            </Row>
                        ))}
                    </ul>
                )}
            </Section>

            {/* Credit given and received today: only with the credit module */}
            {features.credit && data.credit && (
                <Section title={t('dash.cash.credit')} icon={CreditCard}>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-dark-tertiary p-3">
                            <p className="text-xs text-zinc-400">{t('dash.cash.creditGiven')}</p>
                            <p className="text-lg font-bold"><Money value={data.credit.given} /></p>
                            <p className="text-xs text-zinc-500">{t('dash.ticket.count', { n: data.credit.givenCount })}</p>
                        </div>
                        <div className="rounded-lg bg-dark-tertiary p-3">
                            <p className="text-xs text-zinc-400 flex items-center gap-1"><Coins className="w-3.5 h-3.5" /> {t('dash.cash.creditReceived')}</p>
                            <p className="text-lg font-bold"><Money value={data.credit.received} /></p>
                            <p className="text-xs text-zinc-500">{t('dash.cash.paymentsN', { n: data.credit.receivedCount })}</p>
                        </div>
                    </div>
                </Section>
            )}

            {/* Each employee today */}
            <Section title={t('dash.cash.team')} icon={Users}>
                {data.employees.length === 0 ? <Empty>{t('dash.cash.teamNone')}</Empty> : (
                    <ul className="divide-y divide-dark-border">
                        {data.employees.map(emp => (
                            <Row key={emp.id} aside={<span className="font-semibold"><Money value={emp.sales_total} /></span>}>
                                <p className="font-medium truncate">{emp.name}</p>
                                <p className="text-xs text-zinc-500">
                                    {t('dash.ticket.count', { n: emp.sales_count })}
                                    {emp.minutes_worked > 0 && <> · {formatDuration(emp.minutes_worked)}</>}
                                    {emp.open_shift_start && <> · <span className="text-emerald-300">{t('dash.cash.working')}</span></>}
                                </p>
                            </Row>
                        ))}
                    </ul>
                )}
            </Section>

            {/* Last 5 sales: to check the drawer */}
            <Section title={t('dash.cash.lastSales')} icon={Receipt}>
                {data.sales.length === 0 ? <Empty>{t('dash.noSaleYet')}</Empty> : (
                    <ul className="divide-y divide-dark-border">
                        {data.sales.map(sale => (
                            <Row key={sale.id} aside={<span className="font-semibold"><Money value={sale.total} /></span>}>
                                <p className="text-sm">{time(sale.created_at)} · {sale.employee_name || ''}</p>
                            </Row>
                        ))}
                    </ul>
                )}
            </Section>

            {/* Last closings: was the drawer right? */}
            <Section title={t('dash.cash.closures')} icon={History}>
                {data.closures.length === 0 ? <Empty>{t('dash.cash.closuresNone')}</Empty> : (
                    <ul className="divide-y divide-dark-border">
                        {data.closures.map(c => (
                            <Row key={c.id} aside={<span className="text-sm font-medium whitespace-nowrap">{diffText(c.cash_difference)}</span>}>
                                <p className="text-sm font-medium truncate">{c.employee_name}</p>
                                <p className="text-xs text-zinc-500"><bdi className="tabular">{formatDate(c.end_time, 'datetime', { lang })}</bdi></p>
                            </Row>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
}
