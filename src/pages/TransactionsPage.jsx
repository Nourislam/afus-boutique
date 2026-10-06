import { t } from '../i18n';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Tabs } from '../components/ui/Tabs';
import { Search, Eye } from 'lucide-react';
import ReceiptPreviewModal from '../components/modals/ReceiptPreviewModal';
import ReturnModal from '../components/modals/ReturnModal';
import ExchangeModal from '../components/modals/ExchangeModal';
import ReturnDetailsModal from '../components/modals/ReturnDetailsModal';
import { toast } from '../components/ui/Toast';

export default function TransactionsPage() {
    const { currentEmployee: user } = useAuthStore();
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSale, setSelectedSale] = useState(null);
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [saleToReturn, setSaleToReturn] = useState(null);
    const [saleToExchange, setSaleToExchange] = useState(null);
    const [showReturnDetails, setShowReturnDetails] = useState(false);
    const [selectedReturn, setSelectedReturn] = useState(null);
    const [activeTab, setActiveTab] = useState('sales');
    const [returnsList, setReturnsList] = useState([]);

    // Pagination or filtered loading could be added here
    const [filteredTransactions, setFilteredTransactions] = useState([]);
    const [filteredReturns, setFilteredReturns] = useState([]);

    const loadTransactions = async () => {
        setLoading(true);
        try {
            // Sales
            const params = {};
            // if (user?.role !== 'admin') params.employeeId = user?.id; // Allow everyone to see all for now
            const salesData = await window.electronAPI.sales.getAll(params);
            setTransactions(salesData);
            setFilteredTransactions(salesData);

            // Returns
            // const returnsData = await window.electronAPI.returns.getAll(params);
            const returnsData = await window.electronAPI.returns.getAll(); // Show all returns
            // Filter returns by employee if needed? Usually returns are global or filtered by permission.
            setReturnsList(returnsData);
            setFilteredReturns(returnsData);
        } catch (error) {
            console.error('Failed to load data:', error);
            toast.error(t('tx.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTransactions();
    }, [user, activeTab]); // Reload when tab changes just in case, or just user

    useEffect(() => {
        if (!searchQuery) {
            setFilteredTransactions(transactions);
            setFilteredReturns(returnsList);
            return;
        }

        const query = searchQuery.toLowerCase();

        // Filter Sales
        const filteredSales = transactions.filter(tx =>
            tx.receipt_number.toLowerCase().includes(query) ||
            (tx.customer_name && tx.customer_name.toLowerCase().includes(query)) ||
            (tx.employee_name && tx.employee_name.toLowerCase().includes(query))
        );
        setFilteredTransactions(filteredSales);

        // Filter Returns
        const filteredRet = returnsList.filter(r =>
            r.return_number.toLowerCase().includes(query) ||
            r.receipt_number?.toLowerCase().includes(query) ||
            (r.employee_name && r.employee_name.toLowerCase().includes(query))
        );
        setFilteredReturns(filteredRet);

    }, [searchQuery, transactions, returnsList]);

    const handleViewReceipt = async (saleId) => {
        try {
            // Fetch full sale details including items and payments
            const fullSale = await window.electronAPI.sales.getById(saleId);
            if (fullSale) {
                setSelectedSale(fullSale);
                setShowReceiptModal(true);
            } else {
                toast.error(t('tx.notFound'));
            }
        } catch (error) {
            console.error('Failed to fetch sale details:', error);
            toast.error(t('tx.receiptFailed'));
        }
    };

    const formatCurrency = (amount) => {
        return formatMoney(amount);
    };

    const formatDate = (dateString) => {
        return formatLocalDate(dateString, 'datetime');
    };

    return (
        <div className="h-full flex flex-col gap-6 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">{t('tx.title')}</h1>
                    <p className="text-zinc-400">
                        {user?.role === 'admin' ? t('tx.subtitleAll') : t('tx.subtitleMine')}
                    </p>
                </div>
                <div className="flex gap-4">
                    <Button variant="outline" onClick={loadTransactions}>
                        {t('common.refresh')}
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <div className="w-full">
                <Tabs
                    tabs={[
                        { id: 'sales', label: t('tx.sales') },
                        { id: 'returns', label: t('tx.returns') }
                    ]}
                    defaultTab={activeTab}
                    onChange={setActiveTab}
                />
            </div>

            <Card className="flex-1 flex flex-col overflow-hidden">
                {/* Filters */}
                <div className="p-4 border-b border-dark-border flex gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <Input
                            placeholder={activeTab === 'sales' ? t('tx.searchSales') : t('tx.searchReturns')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="ps-10"
                        />
                    </div>
                </div>

                {/* Table Content */}
                <div className="flex-1 overflow-auto">
                    {activeTab === 'sales' ? (
                        <table className="w-full text-start border-collapse">
                            <thead className="sticky top-0 bg-dark-tertiary text-zinc-400 text-xs uppercase font-semibold">
                                <tr>
                                    <th className="p-4">{t('tx.receiptNo')}</th>
                                    <th className="p-4">{t('tx.date')}</th>
                                    <th className="p-4">{t('tx.customer')}</th>
                                    <th className="p-4">{t('tx.employee')}</th>
                                    <th className="p-4 text-end">{t('pos.total')}</th>
                                    <th className="p-4">{t('inventory.status')}</th>
                                    <th className="p-4 text-end">{t('inventory.actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-border">
                                {loading ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-zinc-500">{t('tx.loadingSales')}</td></tr>
                                ) : filteredTransactions.length === 0 ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-zinc-500">{t('tx.noSales')}</td></tr>
                                ) : (
                                    filteredTransactions.map((sale) => (
                                        <tr key={sale.id} className="hover:bg-dark-tertiary/50 transition-colors">
                                            <td className="p-4 font-mono text-accent-primary">{sale.receipt_number}</td>
                                            <td className="p-4 text-zinc-300">{formatDate(sale.created_at)}</td>
                                            <td className="p-4 text-white">{sale.customer_name || t('tx.walkIn')}</td>
                                            <td className="p-4 text-zinc-300">{sale.employee_name || t('tx.unknown')}</td>
                                            <td className="p-4 text-end font-medium text-white">{formatCurrency(sale.total)}</td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 rounded text-xs font-medium 
                                                    ${sale.status === 'completed' ? 'bg-green-500/10 text-green-400' :
                                                        sale.status === 'refunded' ? 'bg-red-500/10 text-red-400' :
                                                            sale.status === 'partially_refunded' ? 'bg-orange-500/10 text-orange-400' :
                                                                'bg-zinc-500/10 text-zinc-400'
                                                    }`}>
                                                    {sale.status.toUpperCase().replace('_', ' ')}
                                                </span>
                                            </td>
                                            <td className="p-4 text-end">
                                                <div className="flex justify-end gap-2">
                                                    <Button size="sm" variant="secondary" onClick={() => handleViewReceipt(sale.id)}>
                                                        <Eye className="w-4 h-4 me-2" /> {t('tx.view')}
                                                    </Button>
                                                    {(sale.status === 'completed' || sale.status === 'partially_refunded') && (
                                                        <Button size="sm" variant="danger" onClick={() => { setSaleToReturn(sale); setShowReturnModal(true); }}>
                                                            {t('po.return')}
                                                        </Button>
                                                    )}
                                                    {(sale.status === 'completed' || sale.status === 'partially_refunded') && (
                                                        <Button size="sm" variant="secondary" onClick={() => setSaleToExchange(sale)} data-testid="exchange-btn">
                                                            {t('exchange.action')}
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    ) : (
                        <table className="w-full text-start border-collapse">
                            <thead className="sticky top-0 bg-dark-tertiary text-zinc-400 text-xs uppercase font-semibold">
                                <tr>
                                    <th className="p-4">{t('tx.returnNo')}</th>
                                    <th className="p-4">{t('tx.origReceipt')}</th>
                                    <th className="p-4">{t('tx.date')}</th>
                                    <th className="p-4">{t('tx.employee')}</th>
                                    <th className="p-4">{t('inventory.reason')}</th>
                                    <th className="p-4 text-end">{t('tx.refund')}</th>
                                    <th className="p-4 text-end">{t('inventory.actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-border">
                                {loading ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-zinc-500">{t('tx.loadingReturns')}</td></tr>
                                ) : filteredReturns.length === 0 ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-zinc-500">{t('tx.noReturns')}</td></tr>
                                ) : (
                                    filteredReturns.map((ret) => (
                                        <tr key={ret.id} className="hover:bg-dark-tertiary/50 transition-colors">
                                            <td className="p-4 font-mono text-red-400">{ret.return_number}</td>
                                            <td className="p-4 font-mono text-zinc-400">{ret.receipt_number}</td>
                                            <td className="p-4 text-zinc-300">{formatDate(ret.created_at)}</td>
                                            <td className="p-4 text-zinc-300">{ret.employee_name || t('tx.unknown')}</td>
                                            <td className="p-4 text-zinc-300 italic">{ret.reason === 'exchange' ? t('exchange.reason') : (ret.reason || '-')}</td>
                                            <td className="p-4 text-end font-medium text-red-400">{formatCurrency(ret.total_refund)}</td>
                                            <td className="p-4 text-end">
                                                <Button size="sm" variant="secondary" onClick={() => { setSelectedReturn(ret); setShowReturnDetails(true); }}>
                                                    <Eye className="w-4 h-4 me-2" /> {t('tx.details')}
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>

            <ReceiptPreviewModal
                isOpen={showReceiptModal}
                onClose={() => {
                    setShowReceiptModal(false);
                    setSelectedSale(null);
                }}
                sale={selectedSale}
            />

            <ExchangeModal
                isOpen={!!saleToExchange}
                sale={saleToExchange}
                onClose={() => setSaleToExchange(null)}
                onDone={(result) => { loadTransactions(); handleViewReceipt(result.sale_id); }}
            />

            <ReturnModal
                isOpen={showReturnModal}
                onClose={() => {
                    setShowReturnModal(false);
                    setSaleToReturn(null);
                }}
                sale={saleToReturn}
                onReturnSuccess={() => {
                    loadTransactions(); // Refresh status
                }}
            />

            <ReturnDetailsModal
                isOpen={showReturnDetails}
                onClose={() => {
                    setShowReturnDetails(false);
                    setSelectedReturn(null);
                }}
                returnData={selectedReturn}
            />
        </div>
    );
}
