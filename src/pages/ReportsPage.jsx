import { t } from '../i18n';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Banknote, Euro, PoundSterling, JapaneseYen, IndianRupee, Coins, ShoppingCart, Calendar, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Card, StatCard } from '../components/ui/Card';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeader } from '../components/ui/Table';
import { toast } from '../components/ui/Toast';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
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
            case 'yesterday':
                const yesterday = subDays(now, 1);
                return { startDate: getDateString(startOfDay(yesterday)), endDate: getDateString(endOfDay(yesterday)) };
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

    const [currency, setCurrency] = useState('USD');

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const settings = await window.electronAPI.settings.getAll();
                let parsed = { ...settings };
                if (settings.store_config) {
                    const config = typeof settings.store_config === 'string'
                        ? JSON.parse(settings.store_config)
                        : settings.store_config;
                    parsed = { ...parsed, ...config };
                }
                if (parsed.currency) setCurrency(parsed.currency);
            } catch (e) { console.error(e); }
        };
        fetchSettings();
    }, []);

    const formatCurrency = (amount) => {
        return formatMoney(amount || 0);
    };

    const getCurrencyIcon = () => {
        switch (currency) {
            case 'USD': return Banknote;
            case 'EUR': return Euro;
            case 'GBP': return PoundSterling;
            case 'JPY': return JapaneseYen;
            case 'INR': return IndianRupee;
            default: return Coins;
        }
    };

    const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6'];

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-dark-border">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">{t('reports.title')}</h1>
                        <p className="text-zinc-500">{t('reports.subtitle')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Select
                            value={dateRange}
                            onChange={setDateRange}
                            options={dateRanges()}
                            className="w-48"
                        />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {/* Tabs */}
                <div className="flex items-center gap-4 mb-6 border-b border-dark-border pb-1">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                            activeTab === 'overview' ? 'text-accent-primary' : 'text-zinc-400 hover:text-white'
                        }`}
                    >
                        {t('reports.overview')}
                        {activeTab === 'overview' && (
                            <div className="absolute bottom-[-5px] start-0 end-0 h-0.5 bg-accent-primary rounded-full" />
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('shifts')}
                        className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                            activeTab === 'shifts' ? 'text-accent-primary' : 'text-zinc-400 hover:text-white'
                        }`}
                    >
                        {t('reports.shifts')}
                        {activeTab === 'shifts' && (
                            <div className="absolute bottom-[-5px] start-0 end-0 h-0.5 bg-accent-primary rounded-full" />
                        )}
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : activeTab === 'overview' ? (
                    <div className="space-y-6">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <StatCard
                                label={t('reports.revenue')}
                                value={formatCurrency(stats.total_revenue)}
                                icon={getCurrencyIcon()}
                                color="success"
                            />
                            <StatCard
                                label={t('reports.profit')}
                                value={formatCurrency(stats.total_profit)}
                                icon={TrendingUp}
                                color="success"
                            />
                            <StatCard
                                label={t('reports.margin')}
                                value={`${stats.total_revenue > 0 ? ((stats.total_profit / stats.total_revenue) * 100).toFixed(1) : 0}%`}
                                icon={BarChart3}
                                color="primary"
                            />
                            <StatCard
                                label={t('reports.transactions')}
                                value={stats.total_transactions}
                                icon={ShoppingCart}
                                color="primary"
                            />
                            <StatCard
                                label={t('reports.average')}
                                value={formatCurrency(stats.average_sale)}
                                icon={TrendingUp}
                                color="primary"
                            />
                            <StatCard
                                label={t('reports.tax')}
                                value={formatCurrency(stats.total_tax)}
                                icon={getCurrencyIcon()}
                                color="warning"
                            />
                        </div>

                        {/* Charts Row 1 */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Sales Over Time */}
                            <Card>
                                <h3 className="font-semibold mb-4">{t('reports.overTime')}</h3>
                                {salesByDate.length > 0 ? (
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={salesByDate}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                                                <XAxis dataKey="dateLabel" stroke="#71717a" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                                                <YAxis stroke="#71717a" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: '#1a1a1a',
                                                        border: '1px solid #27272a',
                                                        borderRadius: '8px',
                                                    }}
                                                    formatter={(value) => formatCurrency(value)}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="revenue"
                                                    name="Revenue"
                                                    stroke="#6366f1"
                                                    strokeWidth={2}
                                                    dot={{ fill: '#6366f1', strokeWidth: 2 }}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="profit"
                                                    name="Profit"
                                                    stroke="#10b981"
                                                    strokeWidth={2}
                                                    dot={{ fill: '#10b981', strokeWidth: 2 }}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="h-72 flex items-center justify-center text-zinc-500">
                                        {t('reports.noSales')}
                                    </div>
                                )}
                            </Card>

                            {/* Transactions by Day */}
                            <Card>
                                <h3 className="font-semibold mb-4">{t('reports.daily')}</h3>
                                {salesByDate.length > 0 ? (
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={salesByDate}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                                                <XAxis dataKey="dateLabel" stroke="#71717a" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                                                <YAxis stroke="#71717a" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: '#1a1a1a',
                                                        border: '1px solid #27272a',
                                                        borderRadius: '8px',
                                                    }}
                                                />
                                                <Bar dataKey="transactions" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="h-72 flex items-center justify-center text-zinc-500">
                                        {t('reports.noTx')}
                                    </div>
                                )}
                            </Card>
                        </div>

                        {/* Charts Row 2 */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Sales by Category */}
                            <Card>
                                <h3 className="font-semibold mb-4">{t('reports.byCategory')}</h3>
                                {categoryData.length > 0 ? (
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={categoryData}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={50}
                                                    outerRadius={80}
                                                >
                                                    {categoryData.map((entry, index) => (
                                                        <Cell key={index} fill={entry.color || COLORS[index % COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: '#1a1a1a',
                                                        border: '1px solid #27272a',
                                                        borderRadius: '8px',
                                                    }}
                                                    formatter={(value) => formatCurrency(value)}
                                                />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="h-64 flex items-center justify-center text-zinc-500">
                                        {t('reports.noCategory')}
                                    </div>
                                )}
                            </Card>

                            {/* Payment Methods */}
                            <Card>
                                <h3 className="font-semibold mb-4">{t('reports.payments')}</h3>
                                {paymentMethods.length > 0 ? (
                                    <div className="space-y-3">
                                        {paymentMethods.map((method, index) => (
                                            <div key={method.method} className="flex items-center justify-between p-3 rounded-lg bg-dark-tertiary">
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        className="w-3 h-3 rounded-full"
                                                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                                    />
                                                    <span className="font-medium">{paymentLabel(method.method)}</span>
                                                </div>
                                                <div className="text-end">
                                                    <p className="font-semibold">{formatCurrency(method.total)}</p>
                                                    <p className="text-xs text-zinc-400">{t('reports.saleCount', { n: method.count })}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-64 flex items-center justify-center text-zinc-500">
                                        {t('reports.noPayments')}
                                    </div>
                                )}
                            </Card>

                            {/* Top Products */}
                            <Card className="lg:col-span-1">
                                <h3 className="font-semibold mb-4">{t('reports.topProducts')}</h3>
                                {topProducts.length > 0 ? (
                                    <div className="space-y-2 max-h-64 overflow-y-auto">
                                        {topProducts.map((product, index) => (
                                            <div
                                                key={product.product_id}
                                                className="flex items-center justify-between p-2 rounded-lg hover:bg-dark-tertiary transition-colors"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold
                            ${index < 3 ? 'bg-accent-primary text-white' : 'bg-dark-tertiary text-zinc-400'}
                          `}>
                                                        {index + 1}
                                                    </span>
                                                    <span className="truncate max-w-32">{product.product_name}</span>
                                                </div>
                                                <div className="text-end">
                                                    <p className="font-medium">{product.total_quantity}</p>
                                                    <p className="text-xs text-zinc-400">{formatCurrency(product.total_revenue)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-64 flex items-center justify-center text-zinc-500">
                                        {t('reports.noProducts')}
                                    </div>
                                )}
                            </Card>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <Card>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold">{t('reports.shifts')}</h3>
                            </div>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableHeader>{t('reports.start')}</TableHeader>
                                        <TableHeader>{t('reports.end')}</TableHeader>
                                        <TableHeader>{t('tx.employee')}</TableHeader>
                                        <TableHeader>{t('shift.openingCash')}</TableHeader>
                                        <TableHeader>{t('reports.totalSales')}</TableHeader>
                                        <TableHeader>{t('pay.cash')}</TableHeader>
                                        <TableHeader>{t('pay.card')}</TableHeader>
                                        <TableHeader>{t('pay.transferShort')}</TableHeader>
                                        <TableHeader>{t('pay.credit')}</TableHeader>
                                        <TableHeader>{t('pay.giftCard')}</TableHeader>
                                        <TableHeader>{t('reports.expectedCash')}</TableHeader>
                                        <TableHeader>{t('reports.closingCash')}</TableHeader>
                                        <TableHeader>{t('reports.diff')}</TableHeader>
                                        <TableHeader>{t('customers.notes')}</TableHeader>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {shiftData.length > 0 ? (
                                        shiftData.map((shift) => (
                                            <TableRow key={shift.id}>
                                                <TableCell className="whitespace-nowrap">
                                                    <div>{formatLocalDate(shift.start_time, 'datetime')}</div>
                                                </TableCell>
                                                <TableCell className="whitespace-nowrap">
                                                    {shift.end_time ? (
                                                        <div>{formatLocalDate(shift.end_time, 'datetime')}</div>
                                                    ) : (
                                                        <span className="text-accent-primary font-medium">{t('status.active')}</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>{shift.employee_name}</TableCell>
                                                <TableCell>{formatCurrency(shift.stats?.opening_cash || shift.opening_cash || 0)}</TableCell>
                                                <TableCell>{formatCurrency(shift.stats?.total_sales || 0)}</TableCell>
                                                <TableCell className="text-emerald-400">{formatCurrency(shift.stats?.total_cash_sales || 0)}</TableCell>
                                                <TableCell className="text-blue-400">{formatCurrency(shift.stats?.total_card_sales || 0)}</TableCell>
                                                <TableCell className="text-sky-400">{formatCurrency(shift.stats?.total_transfer_sales || 0)}</TableCell>
                                                <TableCell className="text-amber-400">{formatCurrency(shift.stats?.total_credit_sales || 0)}</TableCell>
                                                <TableCell className="text-purple-400">{formatCurrency(shift.stats?.total_gift_card_sales || 0)}</TableCell>
                                                <TableCell>{formatCurrency(shift.stats?.expected_cash || 0)}</TableCell>
                                                <TableCell>{shift.end_time ? formatCurrency(shift.closing_cash || 0) : '-'}</TableCell>
                                                <TableCell>
                                                    {shift.end_time ? (
                                                        <span className={(shift.closing_cash - (shift.stats?.expected_cash || 0)) < 0 ? 'text-red-500' : 'text-green-500'}>
                                                            {formatCurrency((shift.closing_cash || 0) - (shift.stats?.expected_cash || 0))}
                                                        </span>
                                                    ) : '-'}
                                                </TableCell>
                                                <TableCell className="max-w-[200px] truncate" title={shift.notes}>{shift.notes || '-'}</TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={14} className="h-24 text-center">
                                                {t('reports.noShifts')}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
}
