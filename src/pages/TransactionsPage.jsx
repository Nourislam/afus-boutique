import { t } from '../i18n';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseTicketCode } from '../lib/ticketCode';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import { Search, Eye, History, RefreshCw, Undo2, ArrowLeftRight } from 'lucide-react';
import ReceiptPreviewModal from '../components/modals/ReceiptPreviewModal';
import ReturnModal from '../components/modals/ReturnModal';
import ExchangeModal from '../components/modals/ExchangeModal';
import ReturnDetailsModal from '../components/modals/ReturnDetailsModal';
import { toast } from '../components/ui/Toast';

// The whole history is loaded; rows are drawn a page at a time while scrolling
const PAGE = 200;
const STATUS_KEYS = {
    completed: 'status.completed', refunded: 'status.refunded', partially_refunded: 'status.partially_refunded',
    cancelled: 'status.cancelled', voided: 'status.voided', pending: 'status.pending',
};
const statusLabel = (status) => (STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status);

export default function TransactionsPage() {
    const { currentEmployee: user } = useAuthStore();
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
    const [shown, setShown] = useState(PAGE);
    const moreRef = useRef(null);
    // ?ticket=<number>: a ticket QR scanned on the sales screen
    const [params, setParams] = useSearchParams();
    useEffect(() => {
        const ticket = params.get('ticket');
        if (!ticket) return;
        setSearchQuery(ticket);
        setParams({}, { replace: true });
    }, [params, setParams]);
    // A ticket QR scanned in the search box gives its number
    const search = (value) => setSearchQuery(parseTicketCode(value) || value);

    // Sales come from the main process a page at a time (3 years of tickets
    // stay fast); the search runs there on the whole history
    const [filteredTransactions, setFilteredTransactions] = useState([]);
    const [salesTotal, setSalesTotal] = useState(0);
    const [filteredReturns, setFilteredReturns] = useState([]);
    const loadingMore = useRef(false);
    const searchRef = useRef('');

    const loadSales = async (offset = 0) => {
        const search = searchRef.current.trim();
        const [rows, total] = await Promise.all([
            window.electronAPI.sales.getAll({ search, limit: PAGE, offset }),
            offset === 0 ? window.electronAPI.sales.count({ search }) : Promise.resolve(null),
        ]);
        // An answer for an older search is dropped
        if (search !== searchRef.current.trim()) return;
        if (total !== null) setSalesTotal(total);
        setFilteredTransactions(prev => (offset === 0 ? rows : [...prev, ...rows]));
    };

    const loadTransactions = async () => {
        setLoading(true);
        try {
            await loadSales(0);
            const returnsData = await window.electronAPI.returns.getAll();
            setReturnsList(returnsData);
        } catch (error) {
            console.error('Failed to load data:', error);
            toast.error(t('tx.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTransactions();
    }, [user, activeTab]);

    // A new search: the first page again, a moment after the last key
    useEffect(() => {
        searchRef.current = searchQuery;
        const timer = setTimeout(() => { loadSales(0).catch(() => toast.error(t('tx.loadFailed'))); }, 250);
        const query = searchQuery.trim().toLowerCase();
        setFilteredReturns(!query ? returnsList : returnsList.filter(r =>
            r.return_number.toLowerCase().includes(query) ||
            r.receipt_number?.toLowerCase().includes(query) ||
            (r.employee_name && r.employee_name.toLowerCase().includes(query))
        ));
        return () => clearTimeout(timer);
    }, [searchQuery, returnsList]);

    // A new search or tab starts again from the top
    useEffect(() => { setShown(PAGE); }, [searchQuery, activeTab]);

    const salesMore = filteredTransactions.length < salesTotal;
    // Next rows when the end of the table comes into view
    useEffect(() => {
        const node = moreRef.current;
        if (!node) return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some(e => e.isIntersecting)) return;
            if (activeTab !== 'sales') { setShown(n => n + PAGE); return; }
            if (loadingMore.current || !salesMore) return;
            loadingMore.current = true;
            loadSales(filteredTransactions.length).finally(() => { loadingMore.current = false; });
        }, { rootMargin: '400px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [filteredTransactions, filteredReturns, activeTab, shown, salesMore]);

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

    const canReturn = (sale) => sale.status === 'completed' || sale.status === 'partially_refunded';
    const SALE_STYLE = {
        completed: 'bg-emerald-500/15 text-emerald-300', refunded: 'bg-red-500/15 text-red-300',
        partially_refunded: 'bg-amber-500/15 text-amber-300',
    };
    // Date on one line, hour under it (never cut in the middle)
    const dateCell = (value) => (
        <span className="whitespace-nowrap">
            <span className="block">{formatLocalDate(value, 'date')}</span>
            <span className="block text-xs text-zinc-500">{formatLocalDate(value, 'time')}</span>
        </span>
    );

    return (
        <div className="page">
            <PageHeader
                icon={History}
                title={t('tx.title')}
                subtitle={user?.role === 'admin' ? t('tx.subtitleAll') : t('tx.subtitleMine')}
                actions={(
                    <Button variant="secondary" onClick={loadTransactions} data-testid="tx-refresh">
                        <RefreshCw className="w-4 h-4" /> {t('common.refresh')}
                    </Button>
                )}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <div className="segmented" role="tablist">
                        {[['sales', t('tx.sales')], ['returns', t('tx.returns')]].map(([id, label]) => (
                            <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>
                        ))}
                    </div>
                    <div className="relative flex-1 min-w-[240px] max-w-md">
                        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                        <Input
                            placeholder={activeTab === 'sales' ? t('tx.searchSales') : t('tx.searchReturns')}
                            value={searchQuery}
                            onChange={(e) => search(e.target.value)}
                            className="ps-10"
                        />
                    </div>
                </div>
            </PageHeader>

            <div className="page-body">
                <div className="table-container">
                    {activeTab === 'sales' ? (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{t('tx.receiptNo')}</th>
                                    <th>{t('tx.date')}</th>
                                    <th>{t('tx.customer')}</th>
                                    <th className="hidden xl:table-cell">{t('tx.employee')}</th>
                                    <th className="text-end">{t('pos.total')}</th>
                                    <th>{t('inventory.status')}</th>
                                    <th className="text-end">{t('inventory.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-zinc-500">{t('tx.loadingSales')}</td></tr>
                                ) : filteredTransactions.length === 0 ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-zinc-500">{t('tx.noSales')}</td></tr>
                                ) : (
                                    filteredTransactions.map((sale) => (
                                        <tr key={sale.id}>
                                            <td className="font-mono text-[13px] text-accent-primary whitespace-nowrap">{sale.receipt_number}</td>
                                            <td className="text-zinc-300">{dateCell(sale.created_at)}</td>
                                            <td>
                                                <span dir="auto" className="block font-medium line-clamp-2 break-words">{sale.customer_name || t('tx.walkIn')}</span>
                                                <span className="block xl:hidden text-xs text-zinc-500">{sale.employee_name || t('tx.unknown')}</span>
                                            </td>
                                            <td className="hidden xl:table-cell text-zinc-300">{sale.employee_name || t('tx.unknown')}</td>
                                            <td className="text-end font-semibold whitespace-nowrap">{formatCurrency(sale.total)}</td>
                                            <td><span className={`badge ${SALE_STYLE[sale.status] || 'bg-zinc-500/20 text-zinc-400'}`}>{statusLabel(sale.status)}</span></td>
                                            <td className="text-end">
                                                <div className="flex flex-wrap justify-end gap-1.5">
                                                    <Button size="sm" variant="secondary" onClick={() => handleViewReceipt(sale.id)}>
                                                        <Eye className="w-4 h-4" /> {t('tx.view')}
                                                    </Button>
                                                    {canReturn(sale) && (
                                                        <Button size="sm" variant="secondary" onClick={() => { setSaleToReturn(sale); setShowReturnModal(true); }}>
                                                            <Undo2 className="w-4 h-4 text-red-300" /> {t('po.return')}
                                                        </Button>
                                                    )}
                                                    {canReturn(sale) && (
                                                        <Button size="sm" variant="secondary" onClick={() => setSaleToExchange(sale)} data-testid="exchange-btn">
                                                            <ArrowLeftRight className="w-4 h-4" /> {t('exchange.action')}
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
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{t('tx.returnNo')}</th>
                                    <th>{t('tx.origReceipt')}</th>
                                    <th>{t('tx.date')}</th>
                                    <th className="hidden xl:table-cell">{t('tx.employee')}</th>
                                    <th>{t('inventory.reason')}</th>
                                    <th className="text-end">{t('tx.refund')}</th>
                                    <th className="text-end">{t('inventory.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-zinc-500">{t('tx.loadingReturns')}</td></tr>
                                ) : filteredReturns.length === 0 ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-zinc-500">{t('tx.noReturns')}</td></tr>
                                ) : (
                                    filteredReturns.slice(0, shown).map((ret) => (
                                        <tr key={ret.id}>
                                            <td className="font-mono text-[13px] text-red-300 whitespace-nowrap">{ret.return_number}</td>
                                            <td className="font-mono text-[13px] text-zinc-400 whitespace-nowrap">{ret.receipt_number}</td>
                                            <td className="text-zinc-300">{dateCell(ret.created_at)}</td>
                                            <td className="hidden xl:table-cell text-zinc-300">{ret.employee_name || t('tx.unknown')}</td>
                                            <td className="text-zinc-300"><span className="line-clamp-2 break-words">{ret.reason === 'exchange' ? t('exchange.reason') : (ret.reason || '—')}</span></td>
                                            <td className="text-end font-semibold text-red-300 whitespace-nowrap">{formatCurrency(ret.total_refund)}</td>
                                            <td className="text-end">
                                                <Button size="sm" variant="secondary" onClick={() => { setSelectedReturn(ret); setShowReturnDetails(true); }}>
                                                    <Eye className="w-4 h-4" /> {t('tx.details')}
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    )}
                    {/* More rows load here as the list is scrolled (nothing is left out) */}
                    {(activeTab === 'sales' ? salesMore : filteredReturns.length > shown) && (
                        <div ref={moreRef} className="p-4 text-center text-sm text-zinc-500" data-testid="tx-more">
                            {t('tx.showing', activeTab === 'sales' ? { n: filteredTransactions.length, total: salesTotal } : { n: shown, total: filteredReturns.length })}
                        </div>
                    )}
                </div>
            </div>

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
