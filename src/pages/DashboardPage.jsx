import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Sun, TrendingUp, Boxes, Wallet } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { effectiveFeatures } from '../lib/features';
import { dashboardAccess, dashboardRanges, buildAlerts, greetingKey } from '../lib/dashboard';
import { formatDate } from '../i18n/format';
import { useT } from '../i18n';
import ShiftSummaryDialog from '../components/shifts/ShiftSummaryDialog';
import TodayTab from '../components/dashboard/TodayTab';
import SalesTab from '../components/dashboard/SalesTab';
import StockTab from '../components/dashboard/StockTab';
import CashTab from '../components/dashboard/CashTab';

const TAB_ICONS = { today: Sun, sales: TrendingUp, stock: Boxes, cash: Wallet };

/**
 * Home screen: the state of the shop in a few seconds. Four tabs (Today,
 * Sales, Stock, Cash); the role decides what is shown, there is no switch.
 * Every problem in "What do I do now?" leads to the screen that fixes it.
 */
export default function DashboardPage() {
    const { t, lang } = useT();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const user = useAuthStore(state => state.currentEmployee);
    const hasPermission = useAuthStore(state => state.hasPermission);
    const savedFeatures = useSettingsStore(state => state.settings.features);
    const features = useMemo(() => effectiveFeatures(savedFeatures), [savedFeatures]);
    const access = useMemo(() => dashboardAccess({ role: user?.role, can: hasPermission }), [user?.role, hasPermission]);

    const [refresh, setRefresh] = useState(0);
    const ranges = useMemo(() => dashboardRanges(new Date()), [refresh]);
    const [home, setHome] = useState(null);
    const [closing, setClosing] = useState(null);

    const loadHome = useCallback(async () => {
        try {
            setHome(await window.electronAPI.dashboard.home({
                today: ranges.today, tomorrow: ranges.tomorrow, since30: ranges.since30, todayRange: ranges.periods.today.current,
            }));
        } catch (error) {
            console.error('Dashboard query failed:', error);
            setHome({});
        }
    }, [ranges]);

    useEffect(() => { loadHome(); }, [loadHome]);
    // A drawer opened or closed elsewhere: refresh
    useEffect(() => {
        const again = () => setRefresh(n => n + 1);
        window.addEventListener('pos:shift-changed', again);
        return () => window.removeEventListener('pos:shift-changed', again);
    }, []);

    const alerts = useMemo(() => buildAlerts(home, { access, features, user, now: new Date() }), [home, access, features, user]);
    const tab = access.tabs.includes(params.get('tab')) ? params.get('tab') : 'today';
    const openTab = (id) => setParams(id === 'today' ? {} : { tab: id }, { replace: true });

    const onAction = (action) => {
        if (!action) return;
        if (action.to) navigate(action.to);
        else if (action.closeShift) setClosing(action.closeShift);
        else if (action.recheck) setRefresh(n => n + 1);
    };

    const now = new Date();
    return (
        <div className="page">
            <PageHeader
                icon={LayoutDashboard}
                title={t(greetingKey(now.getHours()), { name: user?.name || '' })}
                subtitle={formatDate(now, 'long', { lang })}
            >
                {access.tabs.length > 1 && (
                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar border-b border-dark-border -mb-3" role="tablist">
                        {access.tabs.map(id => {
                            const Icon = TAB_ICONS[id];
                            const active = tab === id;
                            return (
                                <button key={id} type="button" role="tab" aria-selected={active} onClick={() => openTab(id)}
                                    className={`relative flex items-center gap-2 px-3 h-10 text-sm font-medium whitespace-nowrap transition-colors ${active ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'}`}>
                                    <Icon className="w-4 h-4" />
                                    {t(`dash.tab.${id}`)}
                                    {id === 'today' && alerts.length > 0 && (
                                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold flex items-center justify-center tabular" aria-label={t('dash.alertsCount', { n: alerts.length })}>
                                            {alerts.length}
                                        </span>
                                    )}
                                    {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-400" />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </PageHeader>

            <div className="page-body">
                <div className="max-w-[1600px] mx-auto">
                    {!home ? (
                        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" /></div>
                    ) : tab === 'sales' ? <SalesTab ranges={ranges} />
                        : tab === 'stock' ? <StockTab access={access} features={features} ranges={ranges} />
                            : tab === 'cash' ? <CashTab features={features} ranges={ranges} onCloseShift={setClosing} />
                                : <TodayTab access={access} features={features} user={user} ranges={ranges} home={home} alerts={alerts} onAction={onAction} onOpenTab={openTab} />}
                </div>
            </div>

            {closing && (
                <ShiftSummaryDialog
                    shiftId={closing}
                    mode="close"
                    onClose={() => setClosing(null)}
                    onLogout={() => { setClosing(null); setRefresh(n => n + 1); }}
                />
            )}
        </div>
    );
}
