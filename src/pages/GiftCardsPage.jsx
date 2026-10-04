import { t } from '../i18n';
import { translateError } from '../i18n/errors';
import { formatDate as formatLocalDate } from '../i18n/format';
import { formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { Gift, Plus, Search, CreditCard, RefreshCw, History, Trash2, Calendar, User, Banknote, Printer as PrinterIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal, ModalBody } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { toast } from '../components/ui/Toast';
import { useAuthStore, PERMISSIONS } from '../stores/authStore';
import { v4 as uuid } from 'uuid';
import { PermissionGate } from '../components/auth/PermissionGate';
import GiftCardPrintModal from '../components/modals/GiftCardPrintModal';
import { useSettingsStore } from '../stores/settingsStore';

export default function GiftCardsPage() {
    const [giftCards, setGiftCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showReloadModal, setShowReloadModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [selectedCard, setSelectedCard] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [printCard, setPrintCard] = useState(null);
    const { currentEmployee } = useAuthStore();
    const { loadSettings } = useSettingsStore();

    const [formData, setFormData] = useState({
        initial_balance: '',
        expires_at: '',
        customer_id: '',
    });
    const [reloadAmount, setReloadAmount] = useState('');
    const [customers, setCustomers] = useState([]);

    useEffect(() => {
        loadGiftCards();
        loadCustomers();
        loadSettings();
    }, []);

    const loadGiftCards = async () => {
        try {
            const data = await window.electronAPI.giftCards.getAll();
            setGiftCards(data);
        } catch (error) {
            console.error('Failed to load gift cards:', error);
            toast.error(t('gift.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const loadCustomers = async () => {
        try {
            const data = await window.electronAPI.customers.getAll();
            setCustomers(data);
        } catch (error) {
            console.error('Failed to load customers:', error);
        }
    };

    const generateCode = async () => {
        try {
            const code = await window.electronAPI.giftCards.generateCode();
            return code;
        } catch (error) {
            console.error('Failed to generate code:', error);
            return `GC-${Date.now()}`;
        }
    };

    const handleCreate = async () => {
        if (!formData.initial_balance || parseFloat(formData.initial_balance) <= 0) {
            toast.error(t('credit.validAmount'));
            return;
        }

        try {
            const code = await generateCode();
            const giftCard = {
                id: uuid(),
                code,
                initial_balance: parseFloat(formData.initial_balance),
                current_balance: parseFloat(formData.initial_balance),
                customer_id: formData.customer_id || null,
                is_active: true,
                expires_at: formData.expires_at || null,
                created_by: currentEmployee?.id,
            };

            await window.electronAPI.giftCards.create(giftCard);
            toast.success(`Gift card created! Code: ${code}`);
            setShowCreateModal(false);
            setFormData({ initial_balance: '', expires_at: '', customer_id: '' });
            loadGiftCards();

            // Open print modal immediately
            setPrintCard(giftCard);
        } catch (error) {
            toast.error(t('gift.createFailed'));
            console.error(error);
        }
    };

    const handleReload = async () => {
        if (!reloadAmount || parseFloat(reloadAmount) <= 0) {
            toast.error(t('credit.validAmount'));
            return;
        }

        try {
            await window.electronAPI.giftCards.reload({
                giftCardId: selectedCard.id,
                amount: parseFloat(reloadAmount),
                employeeId: currentEmployee?.id,
            });
            toast.success(t('gift.reloaded'));
            setShowReloadModal(false);
            setReloadAmount('');
            setSelectedCard(null);
            loadGiftCards();
        } catch (error) {
            toast.error(translateError(error) || t('gift.reloadFailed'));
            console.error(error);
        }
    };

    const handleViewHistory = async (card) => {
        setSelectedCard(card);
        try {
            const data = await window.electronAPI.giftCards.getTransactions(card.id);
            setTransactions(data);
            setShowHistoryModal(true);
        } catch (error) {
            toast.error(t('gift.txFailed'));
            console.error(error);
        }
    };

    const handleToggleActive = async (card) => {
        try {
            await window.electronAPI.giftCards.update({
                ...card,
                is_active: !card.is_active,
            });
            toast.success(card.is_active ? t('gift.deactivated') : t('gift.activated'));
            loadGiftCards();
        } catch (error) {
            toast.error(t('gift.updateFailed'));
            console.error(error);
        }
    };

    const filteredCards = giftCards.filter(card =>
        card.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (card.customer_name && card.customer_name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const formatCurrency = (amount) => {
        return formatMoney(amount || 0);
    };
    const formatDate = (date) => date ? formatLocalDate(date, 'date') : t('gift.noExpiry');

    const totalBalance = giftCards.reduce((sum, card) => sum + (card.is_active ? card.current_balance : 0), 0);
    const activeCards = giftCards.filter(card => card.is_active).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col p-6 gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <Gift className="w-7 h-7 text-indigo-500" />
                        {t('gift.title')}
                    </h1>
                    <p className="text-zinc-400 mt-1">{t('gift.subtitle')}</p>
                </div>
                <PermissionGate permission={PERMISSIONS.GIFT_CARDS_CREATE}>
                    <Button onClick={() => setShowCreateModal(true)}>
                        <Plus className="w-4 h-4" />
                        {t('gift.create')}
                    </Button>
                </PermissionGate>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="card flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                        <CreditCard className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{giftCards.length}</p>
                        <p className="text-zinc-400 text-sm">{t('gift.total')}</p>
                    </div>
                </div>
                <div className="card flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                        <Gift className="w-6 h-6 text-green-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{activeCards}</p>
                        <p className="text-zinc-400 text-sm">{t('gift.active')}</p>
                    </div>
                </div>
                <div className="card flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                        <Banknote className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold">{formatCurrency(totalBalance)}</p>
                        <p className="text-zinc-400 text-sm">{t('gift.totalBalance')}</p>
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="max-w-md">
                <Input
                    icon={Search}
                    placeholder={t('gift.search')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            {/* Gift Cards Grid */}
            <div className="flex-1 overflow-auto">
                {filteredCards.length === 0 ? (
                    <div className="text-center py-12 text-zinc-400">
                        <Gift className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>{t('gift.none')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredCards.map(card => (
                            <div
                                key={card.id}
                                className={`card p-5 relative ${!card.is_active ? 'opacity-60' : ''}`}
                            >
                                {/* Card Header */}
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.is_active ? 'bg-gradient-to-br from-indigo-500 to-purple-500' : 'bg-zinc-700'}`}>
                                            <Gift className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <p className="font-mono text-sm font-medium">{card.code}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${card.is_active ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400'}`}>
                                                {card.is_active ? t('status.active') : t('status.inactive')}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Balance */}
                                <div className="mb-4">
                                    <p className="text-xs text-zinc-500 mb-1">{t('gift.balance')}</p>
                                    <p className="text-3xl font-bold text-indigo-400">
                                        {formatCurrency(card.current_balance)}
                                    </p>
                                    <p className="text-xs text-zinc-500 mt-1">
                                        {t('gift.initialN', { amount: formatCurrency(card.initial_balance) })}
                                    </p>
                                </div>

                                {/* Details */}
                                <div className="space-y-2 text-sm text-zinc-400 mb-4">
                                    {card.customer_name && (
                                        <div className="flex items-center gap-2">
                                            <User className="w-4 h-4" />
                                            <span>{card.customer_name}</span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        <span>{t('gift.expiresN', { date: formatDate(card.expires_at) })}</span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => { setSelectedCard(card); setShowReloadModal(true); }}
                                        disabled={!card.is_active}
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        {t('gift.reload')}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleViewHistory(card)}
                                    >
                                        <History className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleToggleActive(card)}
                                    >
                                        <Trash2 className={`w-4 h-4 ${card.is_active ? 'text-red-400' : 'text-green-400'}`} />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setPrintCard(card)}
                                        title={t('gift.print')}
                                    >
                                        <PrinterIcon className="w-4 h-4 text-zinc-400" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {
                showCreateModal && (
                    <Modal isOpen={true} title={t('gift.create')} onClose={() => setShowCreateModal(false)}>
                        <ModalBody>
                            <div className="space-y-4">
                                <Input
                                    label={t('gift.initial')}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="50.00"
                                    value={formData.initial_balance}
                                    onChange={(e) => setFormData({ ...formData, initial_balance: e.target.value })}
                                />
                                <Input
                                    label={t('gift.expiry')}
                                    type="date"
                                    value={formData.expires_at}
                                    onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
                                />
                                <div className="form-group">
                                    <Select
                                        label={t('gift.assign')}
                                        value={formData.customer_id}
                                        onChange={(value) => setFormData({ ...formData, customer_id: value })}
                                        placeholder={t('gift.noCustomer')}
                                        options={[
                                            { value: '', label: t('gift.noCustomer') },
                                            ...customers.map(c => ({ value: c.id, label: c.name }))
                                        ]}
                                    />
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <Button variant="secondary" className="flex-1" onClick={() => setShowCreateModal(false)}>
                                        {t('common.cancel')}
                                    </Button>
                                    <Button className="flex-1" onClick={handleCreate}>
                                        {t('gift.createCard')}
                                    </Button>
                                </div>
                            </div>
                        </ModalBody>
                    </Modal>
                )
            }

            {/* Reload Modal */}
            {
                showReloadModal && selectedCard && (
                    <Modal isOpen={true} title={t('gift.reloadTitle')} onClose={() => { setShowReloadModal(false); setSelectedCard(null); }}>
                        <ModalBody>
                            <div className="space-y-4">
                                <div className="text-center p-4 bg-zinc-800 rounded-lg">
                                    <p className="font-mono text-lg font-medium">{selectedCard.code}</p>
                                    <p className="text-zinc-400 mt-2">{t('gift.balanceColon')} <span className="text-indigo-400 font-bold">{formatCurrency(selectedCard.current_balance)}</span></p>
                                </div>
                                <Input
                                    label={t('gift.reloadAmount')}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="25.00"
                                    value={reloadAmount}
                                    onChange={(e) => setReloadAmount(e.target.value)}
                                />
                                <div className="flex gap-3 pt-4">
                                    <Button variant="secondary" className="flex-1" onClick={() => { setShowReloadModal(false); setSelectedCard(null); }}>
                                        {t('common.cancel')}
                                    </Button>
                                    <Button className="flex-1" onClick={handleReload}>
                                        {t('gift.reload')}
                                    </Button>
                                </div>
                            </div>
                        </ModalBody>
                    </Modal>
                )
            }

            {/* History Modal */}
            {
                showHistoryModal && selectedCard && (
                    <Modal isOpen={true} title={`Transaction History - ${selectedCard.code}`} onClose={() => { setShowHistoryModal(false); setSelectedCard(null); }} size="lg">
                        <ModalBody>
                            <div className="space-y-4">
                                {transactions.length === 0 ? (
                                    <p className="text-center text-zinc-400 py-8">{t('gift.noTx')}</p>
                                ) : (
                                    <div className="max-h-96 overflow-auto space-y-2">
                                        {transactions.map(tx => (
                                            <div key={tx.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tx.type === 'reload' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                                                        {tx.type === 'reload' ? (
                                                            <Plus className="w-4 h-4 text-green-400" />
                                                        ) : (
                                                            <Banknote className="w-4 h-4 text-red-400" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium">{tx.type === 'reload' ? t('gift.reload') : tx.type === 'redeem' ? t('gift.redeem') : tx.type}</p>
                                                        <p className="text-xs text-zinc-500">
                                                            {formatLocalDate(tx.created_at, 'datetime')}
                                                            {tx.employee_name && ` • ${tx.employee_name}`}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="text-end">
                                                    <p className={`font-bold ${tx.type === 'reload' ? 'text-green-400' : 'text-red-400'}`}>
                                                        {tx.type === 'reload' ? '+' : '-'}{formatCurrency(tx.amount)}
                                                    </p>
                                                    <p className="text-xs text-zinc-500">
                                                        {t('pos.giftBalance', { amount: formatCurrency(tx.balance_after) })}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </ModalBody>
                    </Modal>
                )
            }

            {/* Print Modal */}
            {
                printCard && (
                    <GiftCardPrintModal
                        isOpen={true}
                        onClose={() => setPrintCard(null)}
                        giftCard={printCard}
                    />
                )
            }
        </div >
    );
}
