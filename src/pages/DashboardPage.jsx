import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, ShoppingCart, TrendingUp, AlertTriangle, Clock, Warehouse, Shirt, Ruler, Palette, Wallet } from 'lucide-react';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Button } from '../components/ui/Button';
import { StatCard } from '../components/ui/Card';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatDate as formatLocalDate, formatMoney } from '../i18n/format';
import { useT } from '../i18n';
import { colorHex, colorName, sizeLabel, variantLabel } from '../lib/clothing';
import { paymentLabel } from '../lib/payments';
import AIInsightsWidget from '../components/dashboard/AIInsightsWidget';

const toDbDate = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

/** "3 h 25 min" since the given time */
function workedHours(start) {
    const value = typeof start === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(start) ? `${start.replace(' ', 'T')}Z` : start;
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

function RankList({ rows, empty, render }) {
    if (!rows.length) return <p className="py-6 text-center text-sm text-zinc-500">{empty}</p>;
    const max = Math.max(...rows.map(r => r.quantity || 0), 1);
    return (
        <div className="space-y-2">
            {rows.map((row, i) => (
                <div key={i}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate flex items-center gap-2">{render(row)}</span>
                        <span className="font-semibold shrink-0">{row.quantity}</span>
                    </div>
                    <div className="h-1.5 mt-1 rounded-full bg-dark-tertiary overflow-hidden">
                        <div className="h-full rounded-full bg-accent-primary" style={{ width: `${(row.quantity / max) * 100}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function DashboardPage() {
    const { t, lang } = useT();
    const navigate = useNavigate();
    const aiEnabled = useSettingsStore(state => state.settings.features?.ai);
    const [stats, setStats] = useState({ todaySales: 0, todayTransactions: 0, todayProfit: 0, monthSales: 0 });
    const [clothing, setClothing] = useState({ topSizes: [], topColors: [], stockValue: { cost: 0, retail: 0, units: 0 }, lowStock: [] });
    const [salesTrend, setSalesTrend] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [recentSales, setRecentSales] = useState([]);
    const [topProducts, setTopProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewScope, setViewScope] = useState('store'); // 'store' or 'personal'
    const [shift, setShift] = useState(null); // open cash drawer of the current user (personal view)

    const { currentEmployee: user } = useAuthStore();

    useEffect(() => {
        if (user) loadDashboardData();
    }, [user, viewScope]);

    const safe = async (promise, fallback) => {
        try { return (await promise) ?? fallback; } catch (e) { console.error('Dashboard query failed:', e); return fallback; }
    };

    const loadDashboardData = async () => {
        try {
            const now = new Date();
            const todayStart = toDbDate(startOfDay(now));
            const todayEnd = toDbDate(endOfDay(now));
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(now.getDate() - 6);

            const params = viewScope === 'personal' ? { employeeId: user?.id } : {};
            const monthParams = { ...params, startDate: toDbDate(startOfMonth(now)), endDate: toDbDate(endOfMonth(now)) };
            const api = window.electronAPI;

            const [todayStats, monthStats, sales, top, trend, methods, clothingData] = await Promise.all([
                safe(api.sales.getStats({ ...params, startDate: todayStart, endDate: todayEnd }), {}),
                safe(api.sales.getStats(monthParams), {}),
                safe(api.sales.getToday(params), []),
                safe(api.reports.topProducts({ ...monthParams, limit: 5 }), []),
                safe(api.reports.salesByDate({ ...params, startDate: toDbDate(startOfDay(sevenDaysAgo)), endDate: todayEnd }), []),
                safe(api.reports.paymentMethods(monthParams), []),
                safe(api.reports.clothingDashboard(monthParams), null),
            ]);

            setStats({
                todaySales: todayStats.total_revenue || 0,
                todayTransactions: todayStats.total_transactions || 0,
                todayProfit: todayStats.total_profit || 0,
                monthSales: monthStats.total_revenue || 0,
            });
            if (clothingData) setClothing(clothingData);
            setRecentSales(sales.slice(0, 6));
            setTopProducts(top);
            setSalesTrend(trend.map(row => ({ date: row.date, revenue: row.revenue })));
            setPaymentMethods(methods);

            // "My sales": also the cash drawer opened by this user
            if (viewScope === 'personal' && user?.id) {
                const current = await safe(api.shifts.getCurrent(user.id), null);
                setShift(current ? { ...current, stats: await safe(api.shifts.getStats(current.id), null) } : null);
            } else {
                setShift(null);
            }
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const money = (amount) => formatMoney(amount, { lang });

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const tooltipStyle = { backgroundColor: 'rgb(var(--surface-1))', border: '1px solid rgb(var(--surface-border))', borderRadius: '8px', color: 'rgb(var(--fg))' };

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold">{t('nav.dashboard')}</h1>
                        <p className="text-zinc-500">
                            {formatLocalDate(new Date(), 'long')}
                            {' · '}
                            {viewScope === 'personal' ? t('dashboard.scopeMine', { name: user?.name || '' }) : t('dashboard.scopeShop')}
                        </p>
                    </div>
                    <div className="segmented" role="tablist">
                        <button type="button" role="tab" aria-selected={viewScope === 'store'} className={viewScope === 'store' ? 'active' : ''}
                            onClick={() => setViewScope('store')}>
                            {t('dashboard.shop')}
                        </button>
                        <button type="button" role="tab" aria-selected={viewScope === 'personal'} className={viewScope === 'personal' ? 'active' : ''}
                            onClick={() => setViewScope('personal')}>
                            {t('dashboard.mine')}
                        </button>
                    </div>
                </div>

                {aiEnabled && <AIInsightsWidget salesData={{ stats, recentSales, topProducts }} />}

                {/* Key figures */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label={t('dashboard.todaySales')} value={money(stats.todaySales)} icon={Banknote} color="success" />
                    <StatCard label={t('dashboard.todayTransactions')} value={stats.todayTransactions} icon={ShoppingCart} color="primary" />
                    <StatCard label={t('dashboard.todayProfit')} value={money(stats.todayProfit)} icon={Wallet} color="success" />
                    <StatCard label={t('dashboard.month')} value={money(stats.monthSales)} icon={TrendingUp} color="primary" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {viewScope === 'personal' ? (
                        <div className="card">
                            <h3 className="font-semibold mb-4 flex items-center gap-2"><Wallet className="w-5 h-5 text-accent-primary" /> {t('dashboard.myDrawer')}</h3>
                            {shift ? (
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between"><span className="text-zinc-400">{t('dashboard.drawerOpened')}</span><span className="tabular">{formatLocalDate(shift.start_time, 'datetime')}</span></div>
                                    <div className="flex justify-between"><span className="text-zinc-400">{t('dashboard.drawerHours')}</span><span className="tabular">{workedHours(shift.start_time)}</span></div>
                                    <div className="flex justify-between"><span className="text-zinc-400">{t('shift.openingCash')}</span><span className="tabular">{money(shift.opening_cash)}</span></div>
                                    <div className="flex justify-between"><span className="text-zinc-400">{t('reports.totalSales')}</span><span className="tabular">{money(shift.stats?.total_sales || 0)}</span></div>
                                    <div className="flex justify-between font-semibold pt-2 border-t border-dark-border"><span>{t('reports.expectedCash')}</span><span className="tabular text-emerald-400">{money(shift.stats?.expected_cash || 0)}</span></div>
                                </div>
                            ) : (
                                <p className="py-6 text-center text-sm text-zinc-500">{t('dashboard.noDrawer')}</p>
                            )}
                        </div>
                    ) : (
                    <div className="card">
                        <h3 className="font-semibold mb-4 flex items-center gap-2"><Warehouse className="w-5 h-5 text-accent-primary" /> {t('dashboard.stockValue')}</h3>
                        <p className="text-3xl font-bold">{money(clothing.stockValue.retail)}</p>
                        <p className="text-sm text-zinc-400 mt-1">{t('dashboard.stockAtSellingPrice')}</p>
                        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                            <div className="p-3 rounded-lg bg-dark-tertiary">
                                <p className="text-zinc-400">{t('dashboard.stockAtCost')}</p>
                                <p className="font-semibold">{money(clothing.stockValue.cost)}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-dark-tertiary">
                                <p className="text-zinc-400">{t('dashboard.pieces')}</p>
                                <p className="font-semibold">{clothing.stockValue.units}</p>
                            </div>
                        </div>
                    </div>

                    )}

                    {/* Sales trend */}
                    <div className="card lg:col-span-2">
                        <h3 className="font-semibold mb-4">{t('dashboard.trend')}</h3>
                        {salesTrend.length > 0 ? (
                            <div className="h-56 ltr">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={salesTrend}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(113,113,122,0.25)" vertical={false} />
                                        <XAxis dataKey="date" stroke="#71717a" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false}
                                            tickFormatter={(value) => formatLocalDate(value, 'short')} />
                                        <YAxis stroke="#71717a" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} width={90}
                                            tickFormatter={(value) => money(value)} />
                                        <Tooltip cursor={{ fill: 'rgba(113,113,122,0.15)' }} contentStyle={tooltipStyle} itemStyle={{ color: 'rgb(var(--fg))' }}
                                            labelFormatter={(value) => formatLocalDate(value, 'date')}
                                            formatter={(value) => [money(value), t('dashboard.revenue')]} />
                                        <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={40} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-56 flex items-center justify-center text-zinc-500">{t('dashboard.noSales')}</div>
                        )}
                    </div>
                </div>

                {/* Best sellers */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="card">
                        <h3 className="font-semibold mb-4 flex items-center gap-2"><Shirt className="w-5 h-5 text-accent-primary" /> {t('dashboard.topProducts')}</h3>
                        <RankList
                            rows={topProducts.map(p => ({ ...p, quantity: p.total_quantity }))}
                            empty={t('dashboard.noSales')}
                            render={(p) => p.product_name}
                        />
                    </div>
                    <div className="card">
                        <h3 className="font-semibold mb-4 flex items-center gap-2"><Ruler className="w-5 h-5 text-accent-primary" /> {t('dashboard.topSizes')}</h3>
                        <RankList rows={clothing.topSizes} empty={t('dashboard.noSales')} render={(row) => sizeLabel(row.size)} />
                    </div>
                    <div className="card">
                        <h3 className="font-semibold mb-4 flex items-center gap-2"><Palette className="w-5 h-5 text-accent-primary" /> {t('dashboard.topColors')}</h3>
                        <RankList
                            rows={clothing.topColors}
                            empty={t('dashboard.noSales')}
                            render={(row) => (
                                <>
                                    <span className="w-3.5 h-3.5 rounded-full border border-zinc-600 shrink-0" style={{ background: colorHex(row) || '#3f3f46' }} />
                                    {colorName(row)}
                                </>
                            )}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Low stock variants */}
                    <div className="card">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-400" /> {t('dashboard.lowStock')}</h3>
                            {clothing.lowStock.length > 0 && (
                                <Button size="sm" variant="ghost" onClick={() => navigate('/inventory')}>{t('dashboard.seeAll')}</Button>
                            )}
                        </div>
                        {clothing.lowStock.length === 0 ? (
                            <p className="py-6 text-center text-sm text-zinc-500">{t('dashboard.noLowStock')}</p>
                        ) : (
                            <div className="space-y-2">
                                {clothing.lowStock.map((row, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2 text-sm p-2 rounded-lg bg-dark-tertiary/50">
                                        <div className="min-w-0">
                                            <p className="font-medium truncate">{row.product_name}</p>
                                            {(row.color || row.size) && <p className="text-xs text-zinc-400">{variantLabel(row)}</p>}
                                        </div>
                                        <span className={`font-bold shrink-0 ${row.stock_quantity <= 0 ? 'text-red-400' : 'text-amber-400'}`}>{row.stock_quantity}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Recent sales */}
                    <div className="card lg:col-span-2">
                        <h3 className="font-semibold mb-4">{t('dashboard.recentSales')}</h3>
                        {recentSales.length > 0 ? (
                            <div className="space-y-2">
                                {recentSales.map(sale => (
                                    <div key={sale.id} className="flex items-center justify-between p-3 rounded-lg bg-dark-tertiary/50">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-accent-primary/20 flex items-center justify-center">
                                                <ShoppingCart className="w-5 h-5 text-accent-primary" />
                                            </div>
                                            <div>
                                                <p className="font-medium ltr text-start">#{sale.receipt_number}</p>
                                                <p className="text-xs text-zinc-500">
                                                    {sale.employee_name} • {formatLocalDate(sale.created_at, 'time')}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="font-semibold text-green-400">{money(sale.total)}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="py-8 text-center text-zinc-500">
                                <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>{t('dashboard.noSalesToday')}</p>
                            </div>
                        )}
                        {paymentMethods.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-dark-border">
                                <p className="text-sm text-zinc-400 mb-2">{t('dashboard.paymentsMonth')}</p>
                                <div className="flex flex-wrap gap-2">
                                    {paymentMethods.map(m => (
                                        <span key={m.method} className="text-xs rounded-full bg-dark-tertiary px-3 py-1">
                                            {paymentLabel(m.method)} · {money(m.total)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
