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

    return (
        <div className="h-full flex flex-col">
            <div className="p-6 border-b border-dark-border flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold mb-1">{t('po.title')}</h1>
                    <p className="text-zinc-400">{t('po.subtitle')}</p>
                </div>
                <div className="flex gap-3">
                    <Button onClick={() => setShowReportsModal(true)} variant="secondary" className="border-blue-500/20 text-blue-500 hover:bg-blue-500/10">
                        <BarChart3 className="w-5 h-5 me-2" />
                        {t('reports.title')}
                    </Button>
                    <Button onClick={() => setShowReorderModal(true)} variant="secondary" className="border-amber-500/20 text-amber-500 hover:bg-amber-500/10">
                        <Zap className="w-5 h-5 me-2" />
                        {t('po.smartReorder')}
                    </Button>
                    <Button onClick={() => setShowCreateModal(true)}>
                        <Plus className="w-5 h-5 me-2" />
                        {t('po.new')}
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-4">
                    {orders.map(po => (
                        <Card key={po.id} className="p-4">
                            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                                {/* Left: Icon + Info */}
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${po.status === 'received' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                        <FileText className="w-6 h-6" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="font-semibold text-lg truncate">{po.supplier_name || t('po.unknownSupplier')}</h3>
                                        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                                            <span className="flex items-center gap-1">
                                                <Package className="w-3 h-3" />
                                                #{po.po_number || po.id.slice(0, 8)}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                {formatLocalDate(po.created_at, 'date')}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Center: Amount + Status */}
                                <div className="flex items-center gap-6">
                                    <div className="text-end">
                                        <p className="text-xs text-zinc-500 uppercase tracking-wide">{t('pos.totalAmount')}</p>
                                        <p className="font-bold text-lg">{formatCurrency(po.total)}</p>
                                        {po.amount_paid > 0 && (
                                            <p className="text-xs text-green-400">{t('po.paidN', { amount: formatCurrency(po.amount_paid) })}</p>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1 items-center min-w-[80px]">
                                        <div className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${po.status === 'received' ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}>
                                            {po.status}
                                        </div>
                                        {po.payment_status && (
                                            <div className={`px-2 py-0.5 rounded-full text-[10px] uppercase border ${po.payment_status === 'paid' ? 'border-green-500/30 text-green-500' :
                                                po.payment_status === 'partial' ? 'border-amber-500/30 text-amber-500' :
                                                    'border-red-500/30 text-red-500'}`}>
                                                {po.payment_status}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Right: Action Buttons - Consistent Row */}
                                <div className="flex items-center gap-2 border-s border-dark-border ps-4">
                                    {/* Delete - only if not received and no payments */}
                                    {po.status !== 'received' && (!po.amount_paid || po.amount_paid === 0) && (
                                        <Button size="sm" variant="ghost" onClick={() => handleDelete(po.id)} title={t('po.delete')}>
                                            <Trash2 className="w-4 h-4 text-red-400 hover:text-red-300" />
                                        </Button>
                                    )}

                                    <Button size="sm" variant="ghost" onClick={() => handleSavePdf(po)} title={t('gift.savePdf')}>
                                        <FileText className="w-4 h-4" />
                                    </Button>
                                    {emailOn && (
                                        <Button size="sm" variant="ghost" onClick={() => handleEmailClick(po)} title={t('po.email')}>
                                            <Mail className="w-4 h-4" />
                                        </Button>
                                    )}
                                    <Button size="sm" variant="ghost" onClick={() => handleViewDetails(po)} title={t('credit.view')}>
                                        <Eye className="w-4 h-4" />
                                    </Button>

                                    <div className="w-px h-6 bg-dark-border mx-1" />

                                    {/* Pay Button - if not fully paid */}
                                    {po.payment_status !== 'paid' && (
                                        <Button size="sm" variant="secondary" onClick={() => handlePayClick(po)} title={t('credit.recordPayment')}>
                                            <CreditCard className="w-4 h-4 me-1.5" />
                                            {t('po.pay')}
                                        </Button>
                                    )}

                                    {/* Primary Status Action */}
                                    {po.status === 'received' ? (
                                        <Button size="sm" variant="secondary" onClick={() => handleReturnClick(po)}>
                                            <RefreshCcw className="w-4 h-4 me-1.5" />
                                            {t('po.return')}
                                        </Button>
                                    ) : (
                                        <Button size="sm" variant="primary" onClick={() => handleReceiveStock(po.id)}>
                                            <CheckCircle className="w-4 h-4 me-1.5" />
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
