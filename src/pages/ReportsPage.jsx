import { t } from '../i18n';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Banknote, ShoppingCart, Shirt, RotateCcw, Percent } from 'lucide-react';
import { Select } from '../components/ui/Select';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/ui/Toast';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { paymentLabel } from '../lib/payments';

// Built on each render so the labels follow the interface language
const dateRanges = () => [
    { value: 'today', label: t('reports.today') },
    { value: 'yesterday', label: t('reports.yesterday') },
    { value: 'week', label: t('reports.week') },
    { value: 'last7', label: t('reports.last7') },
    { value: 'month', label: t('dashboard.month') },
    { value: 'last30', label: t('reports.last30') },
    { value: 'last3months', label: t('reports.last3months') },
];

export default function ReportsPage() {
    const [dateRange, setDateRange] = useState('month');
    const [stats, setStats] = useState({
        total_transactions: 0,
        total_revenue: 0,
        average_sale: 0,
        total_tax: 0,
        total_profit: 0
    });
    const [salesByDate, setSalesByDate] = useState([]);
    const [topProducts, setTopProducts] = useState([]);
    const [categoryData, setCategoryData] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [shiftData, setShiftData] = useState([]);

    useEffect(() => {
        loadReportData();
    }, [dateRange]);

    const getDateString = (date) => {
        return date.toISOString().replace('T', ' ').slice(0, 19);
    };

    const getDateRange = () => {
        const now = new Date();

        switch (dateRange) {
            case 'today':
                return { startDate: getDateString(startOfDay(now)), endDate: getDateString(endOfDay(now)) };
            case 'yesterday': {
                const yesterday = subDays(now, 1);
                return { startDate: getDateString(startOfDay(yesterday)), endDate: getDateString(endOfDay(yesterday)) };
            }
            case 'week':
                return { startDate: getDateString(startOfWeek(now, { weekStartsOn: 1 })), endDate: getDateString(endOfWeek(now, { weekStartsOn: 1 })) };
            case 'last7':
                return { startDate: getDateString(startOfDay(subDays(now, 7))), endDate: getDateString(endOfDay(now)) };
            case 'month':
                return { startDate: getDateString(startOfMonth(now)), endDate: getDateString(endOfMonth(now)) };
            case 'last30':
                return { startDate: getDateString(startOfDay(subDays(now, 30))), endDate: getDateString(endOfDay(now)) };
            case 'last3months':
                return { startDate: getDateString(startOfMonth(subMonths(now, 2))), endDate: getDateString(endOfDay(now)) };
            default:
                return { startDate: getDateString(startOfMonth(now)), endDate: getDateString(endOfMonth(now)) };
        }
    };

    const loadReportData = async () => {
        setLoading(true);
        try {
            const range = getDateRange();

            // Stats
            let statsData = { total_transactions: 0, total_revenue: 0, average_sale: 0, total_tax: 0 };
            try {
                statsData = await window.electronAPI.sales.getStats(range);
            } catch (e) { console.error('Error fetching stats:', e); }

            // Sales by Date
            let salesData = [];
            try {
                salesData = await window.electronAPI.reports.salesByDate(range);
            } catch (e) { console.error('Error fetching salesByDate:', e); }

            // Top Products
            let topData = [];
            try {
                topData = await window.electronAPI.reports.topProducts({ ...range, limit: 10 });
            } catch (e) { console.error('Error fetching topProducts:', e); }

            // Category Data
            let categoryData = [];
            try {
                categoryData = await window.electronAPI.reports.salesByCategory(range);
            } catch (e) { console.error('Error fetching salesByCategory:', e); }

            // Payment Methods
            let paymentData = [];
            try {
                paymentData = await window.electronAPI.reports.paymentMethods(range);
            } catch (e) { console.error('Error fetching paymentMethods:', e); }

            // Shift Data
            let shiftHistory = [];
            try {
                shiftHistory = await window.electronAPI.shifts.getHistory(range);
            } catch (e) { console.error('Error fetching shiftHistory:', e); }

            setStats(statsData || { total_transactions: 0, total_revenue: 0, average_sale: 0, total_tax: 0 });
            setSalesByDate(salesData.map(d => ({
                ...d,
                dateLabel: formatLocalDate(d.date, 'short'),
            })));
            setTopProducts(topData);
            setCategoryData(categoryData.map(c => ({
                name: c.category_name || t('reports.uncategorized'),
                value: c.total_revenue,
                color: c.category_color || '#6b7280',
            })));
            setPaymentMethods(paymentData);
            setShiftData(shiftHistory);
        } catch (error) {
            console.error('Failed to load report data:', error);
            toast.error(t('reports.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => formatMoney(amount || 0);
    const tooltipStyle = { backgroundColor: '#131316', border: '1px solid #26262c', borderRadius: '8px' };
    const share = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0);
    const paymentsTotal = paymentMethods.reduce((sum, m) => sum + (m.total || 0), 0);
    const categoryTotal = categoryData.reduce((sum, c) => sum + (c.value || 0), 0);
    const topTotal = topProducts.reduce((sum, p) => sum + (p.total_revenue || 0), 0);
    const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#0ea5e9', '#a855f7', '#14b8a6', '#ef4444'];

    const kpis = [
        { icon: Banknote, label: t('reports.revenue'), value: formatCurrency(stats.total_revenue), sub: stats.total_refunds > 0 ? t('reports.netAfterReturns', { amount: formatCurrency(stats.net_revenue) }) : null, tone: 'text-white' },
        { icon: TrendingUp, label: t('reports.profit'), value: formatCurrency(stats.total_profit), sub: t('reports.marginN', { n: stats.margin_percent || 0 }), tone: stats.total_profit >= 0 ? 'text-emerald-400' : 'text-rose-400' },
        { icon: ShoppingCart, label: t('reports.transactions'), value: stats.total_transactions, sub: t('reports.avgTicket', { amount: formatCurrency(stats.average_sale) }) },
        { icon: Shirt, label: t('shift.pieces'), value: stats.items_sold || 0, sub: stats.total_transactions ? t('reports.perTicket', { n: ((stats.items_sold || 0) / stats.total_transactions).toFixed(1) }) : null },
        { icon: RotateCcw, label: t('reports.returns'), value: formatCurrency(stats.total_refunds), sub: t('reports.returnsCount', { n: stats.refunds_count || 0 }), tone: stats.total_refunds > 0 ? 'text-amber-300' : '' },
        { icon: Percent, label: t('reports.discounts'), value: formatCurrency(stats.total_discount), sub: stats.total_tax > 0 ? t('reports.tvaCollected', { amount: formatCurrency(stats.total_tax) }) : null },
    ];

    return (
        <div className="page">
            <PageHeader
                icon={BarChart3}
                title={t('reports.title')}
                subtitle={t('reports.subtitle')}
                actions={<Select value={dateRange} onChange={setDateRange} options={dateRanges()} className="w-48" />}
            >
                <div className="segmented">
                    {[['overview', t('reports.overview')], ['articles', t('reports.articlesTab')], ['shifts', t('reports.shifts')]].map(([id, label]) => (
                        <button key={id} type="button" className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>
                    ))}
                </div>
            </PageHeader>

            <div className="page-body">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : activeTab === 'overview' ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
                            {kpis.map(k => (
                                <div key={k.label} className="card p-4">
                                    <div className="text-xs text-zinc-500 flex items-center gap-1.5"><k.icon className="w-3.5 h-3.5" /> {k.label}</div>
                                    <div className={`text-xl font-bold mt-1 tabular truncate ${k.tone || ''}`}>{k.value}</div>
                                    {k.sub && <div className="text-xs text-zinc-500 mt-0.5 truncate">{k.sub}</div>}
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                            <Card className="xl:col-span-2">
                                <h3 className="font-semibold mb-4">{t('reports.overTime')}</h3>
                                {salesByDate.length > 0 ? (
                                    <div className="h-72" dir="ltr">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={salesByDate} margin={{ left: 8, right: 8 }}>
                                                <defs>
                                                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                                                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#26262c" vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                                                <YAxis stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} width={70} tickFormatter={(v) => new Intl.NumberFormat('fr-DZ', { notation: 'compact' }).format(v)} />
                                                <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(value)} />
                                                <Area type="monotone" dataKey="revenue" name={t('reports.revenue')} stroke="#6366f1" strokeWidth={2} fill="url(#rev)" />
                                                <Area type="monotone" dataKey="profit" name={t('reports.profit')} stroke="#22c55e" strokeWidth={2} fill="transparent" />
                                                <Legend />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="h-72 flex items-center justify-center text-zinc-500">{t('reports.noSales')}</div>
                                )}
                            </Card>

                            <Card>
                                <h3 className="font-semibold mb-4">{t('reports.payments')}</h3>
                                {paymentMethods.length > 0 ? (
                                    <div className="space-y-3">
                                        {paymentMethods.map((method, index) => (
                                            <div key={method.method}>
                                                <div className="flex items-center justify-between text-sm mb-1">
                                                    <span className="font-medium">{paymentLabel(method.method)}</span>
                                                    <span className="tabular">{formatCurrency(method.total)} <span className="text-zinc-500">· {share(method.total, paymentsTotal)}%</span></span>
                                                </div>
                                                <div className="h-2 rounded-full bg-dark-tertiary overflow-hidden">
                                                    <div className="h-full rounded-full" style={{ width: `${share(method.total, paymentsTotal)}%`, backgroundColor: COLORS[index % COLORS.length] }} />
                                                </div>
                                                <p className="text-xs text-zinc-500 mt-0.5">{t('reports.saleCount', { n: method.count })}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-64 flex items-center justify-center text-zinc-500">{t('reports.noPayments')}</div>
                                )}
                            </Card>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            <Card>
                                <h3 className="font-semibold mb-4">{t('reports.byCategory')}</h3>
                                {categoryData.length > 0 ? (
                                    <div className="space-y-2.5">
                                        {categoryData.map((c, index) => (
                                            <div key={c.name} className="flex items-center gap-3 text-sm">
                                                <span className="w-32 truncate">{c.name}</span>
                                                <div className="flex-1 h-2.5 rounded-full bg-dark-tertiary overflow-hidden">
                                                    <div className="h-full rounded-full" style={{ width: `${share(c.value, categoryTotal)}%`, backgroundColor: c.color && c.color !== '#6b7280' ? c.color : COLORS[index % COLORS.length] }} />
                                                </div>
                                                <span className="w-32 text-end tabular">{formatCurrency(c.value)}</span>
                                                <span className="w-10 text-end text-zinc-500 tabular">{share(c.value, categoryTotal)}%</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-48 flex items-center justify-center text-zinc-500">{t('reports.noCategory')}</div>
                                )}
                            </Card>

                            <Card>
                                <h3 className="font-semibold mb-4">{t('reports.daily')}</h3>
                                {salesByDate.length > 0 ? (
                                    <div className="h-56" dir="ltr">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={salesByDate}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#26262c" vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                                                <YAxis stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} allowDecimals={false} />
                                                <Tooltip contentStyle={tooltipStyle} />
                                                <Bar dataKey="transactions" name={t('reports.transactions')} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="h-56 flex items-center justify-center text-zinc-500">{t('reports.noTx')}</div>
                                )}
                            </Card>
                        </div>
                    </div>
                ) : activeTab === 'articles' ? (
                    <Card className="p-0 overflow-x-auto">
                        <div className="px-4 py-3 border-b border-dark-border"><h3 className="font-semibold">{t('reports.topProducts')}</h3></div>
                        {topProducts.length > 0 ? (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th className="w-10">#</th>
                                        <th>{t('inventory.product')}</th>
                                        <th>{t('reports.qtySold')}</th>
                                        <th>{t('reports.revenue')}</th>
                                        <th className="w-1/3">{t('reports.share')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topProducts.map((product, index) => (
                                        <tr key={product.product_id || index}>
                                            <td><span className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold ${index < 3 ? 'bg-indigo-500 text-white' : 'bg-dark-tertiary text-zinc-400'}`}>{index + 1}</span></td>
                                            <td className="font-medium">{product.product_name}</td>
                                            <td className="tabular">{product.total_quantity}</td>
                                            <td className="tabular">{formatCurrency(product.total_revenue)}</td>
                                            <td>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-2 rounded-full bg-dark-tertiary overflow-hidden">
                                                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${share(product.total_revenue, topTotal)}%` }} />
                                                    </div>
                                                    <span className="text-xs text-zinc-500 w-9 text-end tabular">{share(product.total_revenue, topTotal)}%</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="h-48 flex items-center justify-center text-zinc-500">{t('reports.noProducts')}</div>
                        )}
                    </Card>
                ) : (
                    <div className="card p-0 overflow-x-auto">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{t('tx.employee')}</th>
                                    <th>{t('reports.start')}</th>
                                    <th>{t('reports.end')}</th>
                                    <th>{t('reports.totalSales')}</th>
                                    <th>{t('pay.cash')}</th>
                                    <th>{t('reports.otherPayments')}</th>
                                    <th>{t('reports.expectedCash')}</th>
                                    <th>{t('reports.closingCash')}</th>
                                    <th>{t('reports.diff')}</th>
                                    <th>{t('customers.notes')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shiftData.length > 0 ? shiftData.map((shift) => {
                                    const st = shift.stats || {};
                                    const other = (st.total_card_sales || 0) + (st.total_transfer_sales || 0) + (st.total_credit_sales || 0) + (st.total_gift_card_sales || 0);
                                    const diff = st.cash_difference;
                                    return (
                                        <tr key={shift.id}>
                                            <td className="font-medium">{shift.employee_name}</td>
                                            <td className="whitespace-nowrap">{formatLocalDate(shift.start_time, 'datetime')}</td>
                                            <td className="whitespace-nowrap">{shift.end_time ? formatLocalDate(shift.end_time, 'datetime') : <span className="badge bg-emerald-500/15 text-emerald-300">{t('shift.open')}</span>}</td>
                                            <td className="tabular">{formatCurrency(st.total_sales)}</td>
                                            <td className="tabular text-emerald-400">{formatCurrency(st.total_cash_sales)}</td>
                                            <td className="tabular">{formatCurrency(other)}</td>
                                            <td className="tabular">{formatCurrency(st.expected_cash)}</td>
                                            <td className="tabular">{shift.end_time ? formatCurrency(shift.closing_cash || 0) : '—'}</td>
                                            <td className={`tabular font-medium ${diff === null || diff === undefined ? '' : Math.abs(diff) < 0.01 ? 'text-emerald-400' : diff > 0 ? 'text-amber-300' : 'text-rose-400'}`}>
                                                {diff === null || diff === undefined ? '—' : formatCurrency(diff)}
                                            </td>
                                            <td className="max-w-[200px] truncate" title={shift.notes}>{shift.notes || '—'}</td>
                                        </tr>
                                    );
                                }) : (
                                    <tr><td colSpan={10} className="h-24 text-center text-zinc-500">{t('reports.noShifts')}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
