import { t } from '../i18n';
import { translateError } from '../i18n/errors';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import {
    Plus,
    FileText,
    Calendar,
    CheckCircle,
    Package,
    Mail
} from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/ui/Toast';
import { Input } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import CreatePurchaseOrderModal from '../components/modals/CreatePurchaseOrderModal';
import RecordSupplierPaymentModal from '../components/modals/RecordSupplierPaymentModal';
import CreatePurchaseReturnModal from '../components/modals/CreatePurchaseReturnModal';
import ReceiveStockModal from '../components/modals/ReceiveStockModal';
import AddSupplierInvoiceModal from '../components/modals/AddSupplierInvoiceModal';
import SmartReorderModal from '../components/modals/SmartReorderModal';
import SupplierReportsModal from '../components/modals/SupplierReportsModal';
import PurchaseOrderDetailsModal from '../components/modals/PurchaseOrderDetailsModal';
import { useSearchParams } from 'react-router-dom';
import { soldOutOrderLines } from '../lib/listFilters';
import { dashboardRanges } from '../lib/dashboard';
import { RefreshCcw, CreditCard, Trash2, Zap, BarChart3, Eye } from 'lucide-react';

export default function PurchaseOrdersPage() {
    const [orders, setOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [showPayModal, setShowPayModal] = useState(false);
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);
    const [showReorderModal, setShowReorderModal] = useState(false);
    const [showReportsModal, setShowReportsModal] = useState(false);

    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [selectedPO, setSelectedPO] = useState(null);
    const [emailPO, setEmailPO] = useState(null);
    const [emailAddress, setEmailAddress] = useState('');
    const { loadSettings } = useSettingsStore();
    const emailOn = useSettingsStore(state => !!state.settings.features?.email);

    useEffect(() => {
        fetchOrders();
        loadSettings();
    }, []);

    // "Order" from the home screen (?order=soldOut): a new order already holding the
    // colours/sizes sold out that sell. The address is cleared so coming back does not reopen it.
    const [searchParams, setSearchParams] = useSearchParams();
    const [initialItems, setInitialItems] = useState(null);
    useEffect(() => {
        if (searchParams.get('order') !== 'soldOut') return undefined;
        let cancelled = false;
        const open = (lines) => {
            if (cancelled) return;
            setInitialItems(lines);
            setShowCreateModal(true);
            setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('order'); return next; }, { replace: true });
        };
        Promise.all([
            window.electronAPI.dashboard.stock({ since30: dashboardRanges(new Date()).since30 }),
            window.electronAPI.products.getAll(),
        ]).then(([stock, products]) => open(soldOutOrderLines(stock?.outOfStock || [], products)))
            .catch(() => open(null));
        return () => { cancelled = true; };
    }, [searchParams, setSearchParams]);

    const fetchOrders = async () => {
        setIsLoading(true);
        try {
            const data = await window.electronAPI.purchaseOrders.getAll();
            setOrders(data);
        } catch (error) {
            console.error('Failed to fetch POs:', error);
            toast.error(t('po.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return formatMoney(amount || 0);
    };

    const handleDelete = async (poId) => {
        if (!confirm(t('po.deleteConfirm'))) return;
        try {
            await window.electronAPI.purchaseOrders.delete(poId);
            toast.success(t('po.deleted'));
            fetchOrders();
        } catch (error) {
            console.error(error);
            toast.error(translateError(error) || t('po.deleteFailed'));
        }
    };

    const handleReceiveStock = (poId) => {
        const po = orders.find(o => o.id === poId);
        if (po) {
            setSelectedPO(po);
            setShowReceiveModal(true);
        }
    };

    const handleViewDetails = (po) => {
        setSelectedPO(po);
        setShowDetailsModal(true);
    };

    const handleEmailClick = (po) => {
        setEmailPO(po);
        setEmailAddress(po.supplier_email || '');
        setShowEmailModal(true);
    };

    const handlePayClick = (po) => {
        setSelectedPO(po);
        setShowPayModal(true);
    };

    const handleReturnClick = (po) => {
        setSelectedPO(po);
        setShowReturnModal(true);
    };

    const handleSendEmail = async () => {
        if (!emailAddress) {
            toast.error(t('receipt.enterEmail'));
            return;
        }
        setShowEmailModal(false);
        toast.info(t('po.sending'));
        try {
            await window.electronAPI.email.sendPurchaseOrder({ to: emailAddress, po: emailPO });
            toast.success(t('po.sent'));
        } catch (error) {
            console.error('Email error:', error);
            toast.error(t('receipt.emailFailed'));
        }
    };

    const handleSavePdf = async (po) => {
        toast.info(t('po.generatingPdf'));
        try {
            const pdfPath = await window.electronAPI.purchaseOrders.savePdf(po);
            if (pdfPath) {
                toast.success(t('po.pdfSaved'));
            }
        } catch (error) {
            console.error('PDF error:', error);
            toast.error(t('po.pdfFailed'));
        }
    };

    // Translated state of an order and of its payment
    const stateLabel = (status) => (status === 'partial' ? t('po.state.partial') : t(`status.${status || 'draft'}`));
    const STATE_STYLE = { received: 'bg-emerald-500/15 text-emerald-300', partial: 'bg-sky-500/15 text-sky-300', sent: 'bg-indigo-500/15 text-indigo-300', draft: 'bg-zinc-500/20 text-zinc-300', cancelled: 'bg-zinc-500/20 text-zinc-500' };
    const PAY_STYLE = { paid: 'bg-emerald-500/15 text-emerald-300', partial: 'bg-amber-500/15 text-amber-300', unpaid: 'bg-red-500/15 text-red-300' };

    return (
        <div className="page">
            <PageHeader
                icon={FileText}
                title={t('po.title')}
                subtitle={t('po.subtitle')}
                actions={(
                    <>
                        <Button onClick={() => setShowReportsModal(true)} variant="secondary">
                            <BarChart3 className="w-4 h-4" />
                            {t('reports.title')}
                        </Button>
                        <Button onClick={() => setShowReorderModal(true)} variant="secondary">
                            <Zap className="w-4 h-4 text-amber-400" />
                            {t('po.smartReorder')}
                        </Button>
                        <Button onClick={() => setShowCreateModal(true)}>
                            <Plus className="w-4 h-4" />
                            {t('po.new')}
                        </Button>
                    </>
                )}
            />

            <div className="page-body">
                <div className="space-y-3">
                    {orders.map(po => (
                        <Card key={po.id} className="p-4" data-testid={`po-card-${po.po_number || po.id}`}>
                            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                                {/* Supplier, number and date */}
                                <div className="flex items-start gap-3 flex-1 min-w-[220px]">
                                    <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${po.status === 'received' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-indigo-500/10 text-indigo-300'}`}>
                                        <FileText className="w-5 h-5" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 dir="auto" className="font-semibold text-base leading-snug break-words line-clamp-2" title={po.supplier_name || ''}>{po.supplier_name || t('po.unknownSupplier')}</h3>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400 mt-0.5">
                                            <span className="flex items-center gap-1 whitespace-nowrap">
                                                <Package className="w-3.5 h-3.5" />
                                                <bdi>{po.po_number || po.id.slice(0, 8)}</bdi>
                                            </span>
                                            <span className="flex items-center gap-1 whitespace-nowrap">
                                                <Calendar className="w-3.5 h-3.5" />
                                                {formatLocalDate(po.created_at, 'date')}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Amount and states */}
                                <div className="flex items-center gap-4 flex-none">
                                    <div className="text-end">
                                        <p className="text-xs text-zinc-500">{t('pos.totalAmount')}</p>
                                        <p className="font-bold text-lg whitespace-nowrap">{formatCurrency(po.total)}</p>
                                        {po.amount_paid > 0 && po.payment_status !== 'paid' && (
                                            <p className="text-xs text-emerald-400 whitespace-nowrap">{t('po.paidN', { amount: formatCurrency(po.amount_paid) })}</p>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1 items-stretch">
                                        <span className={`badge justify-center whitespace-nowrap ${STATE_STYLE[po.status] || STATE_STYLE.draft}`} data-testid="po-state">{stateLabel(po.status)}</span>
                                        {po.payment_status && (
                                            <span className={`badge justify-center whitespace-nowrap ${PAY_STYLE[po.payment_status] || PAY_STYLE.unpaid}`}>{t(`status.${po.payment_status}`)}</span>
                                        )}
                                    </div>
                                </div>

                                {/* What can be done with it */}
                                <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto xl:flex-none justify-end">
                                    {po.status !== 'received' && (!po.amount_paid || po.amount_paid === 0) && (
                                        <Button size="sm" variant="ghost" onClick={() => handleDelete(po.id)} title={t('po.delete')} aria-label={t('po.delete')}>
                                            <Trash2 className="w-4 h-4 text-red-400" />
                                        </Button>
                                    )}
                                    <Button size="sm" variant="ghost" onClick={() => handleSavePdf(po)} title={t('gift.savePdf')} aria-label={t('gift.savePdf')}>
                                        <FileText className="w-4 h-4" />
                                    </Button>
                                    {emailOn && (
                                        <Button size="sm" variant="ghost" onClick={() => handleEmailClick(po)} title={t('po.email')} aria-label={t('po.email')}>
                                            <Mail className="w-4 h-4" />
                                        </Button>
                                    )}
                                    <Button size="sm" variant="ghost" onClick={() => handleViewDetails(po)} title={t('credit.view')} aria-label={t('credit.view')}>
                                        <Eye className="w-4 h-4" />
                                    </Button>
                                    {po.payment_status !== 'paid' && (
                                        <Button size="sm" variant="secondary" onClick={() => handlePayClick(po)}>
                                            <CreditCard className="w-4 h-4" />
                                            {t('po.pay')}
                                        </Button>
                                    )}
                                    {po.status === 'received' ? (
                                        <Button size="sm" variant="secondary" onClick={() => handleReturnClick(po)}>
                                            <RefreshCcw className="w-4 h-4" />
                                            {t('po.return')}
                                        </Button>
                                    ) : (
                                        <Button size="sm" variant="primary" onClick={() => handleReceiveStock(po.id)} data-testid="po-receive">
                                            <CheckCircle className="w-4 h-4" />
                                            {t('po.receive')}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </Card>
                    ))}

                    {orders.length === 0 && !isLoading && (
                        <div className="text-center py-12 text-zinc-500">
                            <p>{t('po.none')}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Create Order Modal */}
            <CreatePurchaseOrderModal
                isOpen={showCreateModal}
                initialItems={initialItems}
                onClose={() => { setShowCreateModal(false); setInitialItems(null); }}
                onComplete={() => {
                    fetchOrders();
                    setShowCreateModal(false);
                    setInitialItems(null);
                }}
            />

            {/* Email Modal */}
            <Modal isOpen={showEmailModal} onClose={() => setShowEmailModal(false)} title={t('po.sendTitle')}>
                <ModalBody>
                    <div className="space-y-4">
                        <p className="text-zinc-400">{t('po.sendText')}</p>
                        <Input
                            label={t('po.supplierEmail')}
                            type="email"
                            value={emailAddress}
                            onChange={(e) => setEmailAddress(e.target.value)}
                            placeholder="supplier@example.com"
                        />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setShowEmailModal(false)}>{t('common.cancel')}</Button>
                    <Button onClick={handleSendEmail}>
                        <Mail className="w-4 h-4 me-2" />
                        {t('receipt.send')}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Payment Modal */}
            <RecordSupplierPaymentModal
                isOpen={showPayModal}
                onClose={() => setShowPayModal(false)}
                onComplete={() => {
                    fetchOrders();
                    setShowPayModal(false);
                }}
                purchaseOrder={selectedPO}
            />

            {/* Return Modal */}
            <CreatePurchaseReturnModal
                isOpen={showReturnModal}
                onClose={() => setShowReturnModal(false)}
                onComplete={() => {
                    toast.success(t('po.returnDone'));
                    fetchOrders();
                    setShowReturnModal(false);
                }}
                purchaseOrder={selectedPO}
            />

            {/* Receive Stock Modal (GRN) */}
            <ReceiveStockModal
                isOpen={showReceiveModal}
                onClose={() => setShowReceiveModal(false)}
                onComplete={() => {
                    fetchOrders();
                    setShowReceiveModal(false);
                }}
                purchaseOrder={selectedPO}
            />

            {/* Add Invoice Modal (Phase 3) */}
            <AddSupplierInvoiceModal
                isOpen={showInvoiceModal}
                onClose={() => setShowInvoiceModal(false)}
                onComplete={() => {
                    fetchOrders();
                    setShowInvoiceModal(false);
                }}
                purchaseOrder={selectedPO}
            />

            {/* Smart Reorder Modal (Phase 4) */}
            <SmartReorderModal
                isOpen={showReorderModal}
                onClose={() => setShowReorderModal(false)}
                onComplete={() => {
                    fetchOrders();
                    setShowReorderModal(false);
                }}
            />

            {/* Reports Modal (Phase 4) */}
            <SupplierReportsModal
                isOpen={showReportsModal}
                onClose={() => setShowReportsModal(false)}
            />

            <PurchaseOrderDetailsModal
                isOpen={showDetailsModal}
                onClose={() => setShowDetailsModal(false)}
                purchaseOrder={selectedPO}
            />
        </div>
    );
}
