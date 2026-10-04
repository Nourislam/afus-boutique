import { useState, useEffect } from 'react';
import { CreditCard, Banknote, FileText, Gift, Smartphone } from 'lucide-react';
import { useCartStore } from '../../stores/cartStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../ui/Toast';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { NumPad } from '../ui/NumPad';
import { DatePicker } from '../ui/DatePicker';
import { paymentLabel, quickCashAmounts } from '../../lib/payments';
import { formatMoney } from '../../i18n/format';
import { t } from '../../i18n';

/**
 * Payment: cash (amount received, change), card CIB/Edahabia, BaridiMob/CCP,
 * customer credit and gift cards, with split payments.
 */
export default function PaymentModal({ isOpen, onClose, total, onComplete }) {
    const features = useSettingsStore(state => state.settings.features);
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [cashAmount, setCashAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [creditInfo, setCreditInfo] = useState(null);
    const [loadingCredit, setLoadingCredit] = useState(false);
    const [dueDate, setDueDate] = useState('');

    // Gift Card States
    const [giftCardCode, setGiftCardCode] = useState('');
    const [giftCardBalance, setGiftCardBalance] = useState(null);
    const [giftCardError, setGiftCardError] = useState(null);
    const [checkingGiftCard, setCheckingGiftCard] = useState(false);

    // Split Payments
    const [splitPayments, setSplitPayments] = useState([]);

    const paidAmount = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    const remainingDue = total - paidAmount;

    // Auto-complete if fully paid (handled in render/effect, or check in addPayment)

    const cart = useCartStore();

    useEffect(() => {
        if (isOpen) {
            loadCustomers();
            // If cart already has a customer selected, use that
            if (cart.customer) {
                setSelectedCustomer(cart.customer);
                if (paymentMethod === 'credit') {
                    loadCreditInfo(cart.customer.id);
                }
            }
        }
    }, [isOpen]);

    useEffect(() => {
        if (selectedCustomer && paymentMethod === 'credit') {
            loadCreditInfo(selectedCustomer.id);
            // Default due date: 30 days from now
            const date = new Date();
            date.setDate(date.getDate() + 30);
            setDueDate(date.toISOString().split('T')[0]);
        } else {
            setCreditInfo(null);
        }
    }, [selectedCustomer, paymentMethod]);

    const loadCustomers = async () => {
        try {
            const data = await window.electronAPI.customers.getAll();
            setCustomers(data);
        } catch (error) {
            console.error('Failed to load customers:', error);
        }
    };

    const loadCreditInfo = async (customerId) => {
        setLoadingCredit(true);
        try {
            const info = await window.electronAPI.customerCredit.getCreditInfo(customerId);
            setCreditInfo(info);
        } catch (error) {
            console.error('Failed to load credit info:', error);
            setCreditInfo(null);
        } finally {
            setLoadingCredit(false);
        }
    };

    const checkGiftCardBalance = async () => {
        if (!giftCardCode) return;
        setCheckingGiftCard(true);
        setGiftCardError(null);
        try {
            const card = await window.electronAPI.giftCards.getByCode(giftCardCode);
            if (card && card.is_active) {
                setGiftCardBalance(card.current_balance);
                if (card.current_balance < remainingDue) {
                    // Just informational, allowing partial payment now
                }
            } else {
                setGiftCardError(t('pos.giftInvalid'));
                setGiftCardBalance(null);
            }
        } catch {
            setGiftCardError(t('pos.giftCheckFailed'));
        } finally {
            setCheckingGiftCard(false);
        }
    };

    const formatCurrency = (amount) => {
        return formatMoney(amount);
    };

    const cashValue = parseFloat(cashAmount) || 0;
    const change = cashValue - remainingDue;

    const filteredCustomers = customers.filter(c =>
        c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.phone?.includes(customerSearch) ||
        c.email?.toLowerCase().includes(customerSearch.toLowerCase())
    ).slice(0, 5);

    const canProcessCredit = () => {
        if (!selectedCustomer) return false;
        if (!creditInfo) return false;
        if (!creditInfo.credit_enabled) return false;
        if (creditInfo.available_credit < remainingDue) return false;
        return true;
    };

    const handlePayment = async () => {
        // Handle Partial Gift Card
        if (paymentMethod === 'gift_card') {
            if (!giftCardBalance) return;

            const amountToPay = Math.min(giftCardBalance, remainingDue);

            // Add to split payments
            const newPayment = {
                method: 'gift_card',
                amount: amountToPay,
                reference: giftCardCode
            };

            const newSplit = [...splitPayments, newPayment];
            setSplitPayments(newSplit);

            // Check if fully paid
            if (amountToPay >= remainingDue - 0.01) { // float tolerance
                // Fully paid
                await onComplete(newSplit, null, null);
            } else {
                // Partially paid
                setGiftCardCode('');
                setGiftCardBalance(null);
                setPaymentMethod('cash');
                toast.success(t('pos.giftApplied', { amount: formatCurrency(amountToPay) }));
            }
            return;
        }

        if (paymentMethod === 'cash' && cashValue < remainingDue) {
            toast.error(t('pos.insufficientCash'));
            return;
        }

        if (paymentMethod === 'credit') {
            if (!selectedCustomer) {
                toast.error(t('pos.selectCustomerCredit'));
                return;
            }
            if (!creditInfo?.credit_enabled) {
                toast.error(t('pos.noCreditEnabled'));
                return;
            }
            if (creditInfo.available_credit < remainingDue) {
                toast.error(t('pos.creditLimit'));
                return;
            }
        }

        setLoading(true);
        try {
            const finalPayment = {
                method: paymentMethod,
                // For cash: record the SALE amount (what stays in drawer), not the tendered amount
                amount: remainingDue,
                // Cash keeps the amount handed over, printed on the receipt with the change
                reference: paymentMethod === 'cash' ? JSON.stringify({ tendered: cashValue }) : null
            };

            const allPayments = [...splitPayments, finalPayment];

            // For credit sales, set the customer on cart before processing
            if (paymentMethod === 'credit' && selectedCustomer) {
                cart.setCustomer(selectedCustomer);
            }

            await onComplete(allPayments, paymentMethod === 'credit' ? selectedCustomer : null, dueDate);
            resetForm();
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setCashAmount('');
        setPaymentMethod('cash');
        setSelectedCustomer(null);
        setCreditInfo(null);
        setGiftCardCode('');
        setGiftCardBalance(null);
        setGiftCardError(null);
        setSplitPayments([]);
    };

    const quickCashValues = quickCashAmounts(remainingDue);
    const methods = [
        { id: 'cash', icon: Banknote, label: t('pay.cash'), active: 'border-accent-primary bg-accent-primary/10' },
        { id: 'card', icon: CreditCard, label: t('pay.cardCib'), active: 'border-accent-primary bg-accent-primary/10' },
        { id: 'transfer', icon: Smartphone, label: t('pay.transferShort'), active: 'border-accent-primary bg-accent-primary/10' },
        ...(features?.credit !== false ? [{ id: 'credit', icon: FileText, label: t('pay.credit'), active: 'border-amber-500 bg-amber-500/10' }] : []),
        ...(features?.giftCards ? [{ id: 'gift_card', icon: Gift, label: t('pay.giftCard'), active: 'border-purple-500 bg-purple-500/10' }] : []),
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('pos.payment')} size="lg">
            <ModalBody>
                <div className="grid grid-cols-2 gap-6">
                    {/* Payment Method Selection */}
                    <div className="space-y-4">
                        <p className="text-sm text-zinc-400">{t('pos.paymentMethod')}</p>
                        <div className="grid grid-cols-3 gap-2">
                            {methods.map(m => (
                                <button
                                    key={m.id}
                                    onClick={() => setPaymentMethod(m.id)}
                                    className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2
                                        ${paymentMethod === m.id ? m.active : 'border-dark-border hover:border-zinc-600'}`}
                                >
                                    <m.icon className="w-5 h-5" />
                                    <span className="text-xs font-medium text-center">{m.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Total Display */}
                        <div className="p-6 rounded-xl bg-dark-tertiary text-center">
                            {splitPayments.length > 0 && (
                                <div className="mb-4 space-y-2">
                                    <p className="text-sm text-zinc-400">{t('pos.paymentsApplied')}</p>
                                    {splitPayments.map((p, i) => (
                                        <div key={i} className="flex justify-between text-sm px-4 py-2 bg-dark-secondary rounded-lg">
                                            <span>{paymentLabel(p.method)}</span>
                                            <span className="font-medium text-green-400">{formatCurrency(p.amount)}</span>
                                        </div>
                                    ))}
                                    <div className="h-px bg-dark-border my-2" />
                                </div>
                            )}
                            <p className="text-sm text-zinc-400 mb-1">
                                {splitPayments.length > 0 ? t('pos.remaining') : t('pos.totalAmount')}
                            </p>
                            <p className="text-4xl font-bold text-accent-primary">
                                {formatCurrency(remainingDue)}
                            </p>
                        </div>

                        {/* Gift Card Input */}
                        {paymentMethod === 'gift_card' && (
                            <div className="space-y-3">
                                <p className="text-sm text-zinc-400">{t('pos.scanGift')}</p>
                                <div className="flex gap-2">
                                    <Input
                                        value={giftCardCode}
                                        onChange={(e) => setGiftCardCode(e.target.value)}
                                        placeholder={t('pos.scanOrEnter')}
                                        className="flex-1"
                                        data-scan-passthrough
                                        autoFocus
                                    />
                                    <Button onClick={checkGiftCardBalance} disabled={!giftCardCode || checkingGiftCard}>
                                        {checkingGiftCard ? t('pos.checking') : t('pos.check')}
                                    </Button>
                                </div>
                                {giftCardError && (
                                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                                        {giftCardError}
                                    </div>
                                )}
                                {giftCardBalance !== null && !giftCardError && (
                                    <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                                        <p className="text-sm text-purple-300">{t('pos.availableBalance')}</p>
                                        <p className="text-2xl font-bold text-purple-400">{formatCurrency(giftCardBalance)}</p>
                                        {giftCardBalance < total && (
                                            <p className="text-xs text-red-400 mt-2">{t('pos.insufficientGift')}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Credit Sale - Customer Selection */}
                        {paymentMethod === 'credit' && (
                            <div className="space-y-3">
                                <p className="text-sm text-zinc-400">{t('pos.selectCustomer')}</p>
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder={t('pos.searchCustomer')}
                                        value={selectedCustomer ? selectedCustomer.name : customerSearch}
                                        onChange={(e) => {
                                            setCustomerSearch(e.target.value);
                                            setSelectedCustomer(null);
                                            setShowCustomerDropdown(true);
                                        }}
                                        onFocus={() => setShowCustomerDropdown(true)}
                                        className="input w-full"
                                    />
                                    {showCustomerDropdown && customerSearch && filteredCustomers.length > 0 && (
                                        <div className="absolute z-10 w-full mt-1 bg-dark-secondary border border-dark-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                            {filteredCustomers.map(customer => (
                                                <button
                                                    key={customer.id}
                                                    onClick={() => {
                                                        setSelectedCustomer(customer);
                                                        setCustomerSearch('');
                                                        setShowCustomerDropdown(false);
                                                    }}
                                                    className="w-full px-4 py-3 text-start hover:bg-dark-tertiary flex items-center justify-between"
                                                >
                                                    <div>
                                                        <p className="font-medium">{customer.name}</p>
                                                        <p className="text-xs text-zinc-500">{customer.phone || customer.email}</p>
                                                    </div>
                                                    {customer.credit_enabled ? (
                                                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">{t('pos.creditOk')}</span>
                                                    ) : null}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Credit Info Display */}
                                {selectedCustomer && (
                                    <div className={`p-4 rounded-xl ${creditInfo?.credit_enabled ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                                        {loadingCredit ? (
                                            <p className="text-center text-zinc-400">{t('pos.loadingCredit')}</p>
                                        ) : creditInfo ? (
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-zinc-400">{t('pos.creditStatus')}</span>
                                                    <span className={`text-sm font-medium ${creditInfo.credit_enabled ? 'text-green-400' : 'text-red-400'}`}>
                                                        {creditInfo.credit_enabled ? t('pos.enabled') : t('pos.notEnabled')}
                                                    </span>
                                                </div>
                                                {creditInfo.credit_enabled && (
                                                    <>
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-sm text-zinc-400">{t('pos.creditLimitLabel')}</span>
                                                            <span className="font-medium">{formatCurrency(creditInfo.credit_limit)}</span>
                                                        </div>
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-sm text-zinc-400">{t('pos.currentBalance')}</span>
                                                            <span className="font-medium text-amber-400">{formatCurrency(creditInfo.credit_balance)}</span>
                                                        </div>
                                                        <div className="flex justify-between items-center pt-2 border-t border-dark-border">
                                                            <span className="text-sm font-medium">{t('pos.availableCredit')}</span>
                                                            <span className={`font-bold ${creditInfo.available_credit >= total ? 'text-green-400' : 'text-red-400'}`}>
                                                                {formatCurrency(creditInfo.available_credit)}
                                                            </span>
                                                        </div>

                                                        <div className="flex justify-between items-center pt-2">
                                                            <span className="text-sm text-zinc-400">{t('pos.dueDate')}</span>
                                                            <div className="w-40">
                                                                <DatePicker
                                                                    value={dueDate}
                                                                    onChange={setDueDate}
                                                                    className="w-full"
                                                                />
                                                            </div>
                                                        </div>
                                                        {creditInfo.available_credit < total && (
                                                            <p className="text-xs text-red-400 mt-2">
                                                                {t('pos.insufficientCredit')}
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-center text-zinc-400">{t('pos.noCreditInfo')}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {paymentMethod === 'cash' && (
                            <>
                                {/* Quick Cash Buttons */}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setCashAmount(String(Math.round(remainingDue * 100) / 100))}
                                        className="flex-1 py-2 rounded-lg bg-accent-primary/20 text-accent-primary font-medium hover:bg-accent-primary/30 transition-colors"
                                    >
                                        {t('pos.exact')}
                                    </button>
                                    {quickCashValues.map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setCashAmount(val.toString())}
                                            className="flex-1 py-2 rounded-lg bg-dark-tertiary hover:bg-zinc-700 font-medium transition-colors"
                                        >
                                            {formatCurrency(val)}
                                        </button>
                                    ))}
                                </div>

                                {/* Change Display */}
                                {cashValue > 0 && (
                                    <div className={`p-4 rounded-xl text-center ${change >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                                        <p className="text-sm text-zinc-400 mb-1">
                                            {change >= 0 ? t('pos.change') : t('pos.amountDue')}
                                        </p>
                                        <p className={`text-2xl font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {formatCurrency(Math.abs(change))}
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Numpad / Right Side */}
                    {paymentMethod === 'cash' && (
                        <div>
                            <p className="text-sm text-zinc-400 mb-4">{t('pos.cashReceived')}</p>
                            <div className="p-4 rounded-xl bg-dark-tertiary mb-4">
                                <p className="text-3xl font-bold text-end font-mono">
                                    {formatCurrency(parseFloat(cashAmount) || 0)}
                                </p>
                            </div>
                            <NumPad
                                value={cashAmount}
                                onChange={setCashAmount}
                                onEnter={handlePayment}
                            />
                        </div>
                    )}

                    {(paymentMethod === 'card' || paymentMethod === 'transfer') && (
                        <div className="flex items-center justify-center">
                            <div className="text-center">
                                {paymentMethod === 'card'
                                    ? <CreditCard className="w-20 h-20 mx-auto mb-4 text-zinc-600" />
                                    : <Smartphone className="w-20 h-20 mx-auto mb-4 text-zinc-600" />}
                                <p className="text-zinc-400">{paymentMethod === 'card' ? t('pos.cardReady') : t('pos.transferReady')}</p>
                            </div>
                        </div>
                    )}

                    {paymentMethod === 'credit' && (
                        <div className="flex items-center justify-center">
                            <div className="text-center">
                                <FileText className="w-20 h-20 mx-auto mb-4 text-amber-500/50" />
                                <p className="text-zinc-400">
                                    {selectedCustomer
                                        ? canProcessCredit()
                                            ? t('pos.creditReady')
                                            : t('pos.creditCannot')
                                        : t('pos.selectCustomerContinue')}
                                </p>
                                {selectedCustomer && canProcessCredit() && (
                                    <p className="text-sm text-amber-400 mt-2">
                                        {t('pos.invoiceAuto')}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {paymentMethod === 'gift_card' && (
                        <div className="flex items-center justify-center">
                            <div className="text-center">
                                <Gift className="w-20 h-20 mx-auto mb-4 text-purple-500/50" />
                                <p className="text-zinc-400">
                                    {giftCardBalance !== null
                                        ? t('pos.giftBalance', { amount: formatCurrency(giftCardBalance) })
                                        : t('pos.scanToCheck')}
                                </p>
                                {giftCardBalance !== null && giftCardBalance < remainingDue && (
                                    <p className="text-sm text-amber-400 mt-2">
                                        {t('pos.partialAvailable')}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t('common.cancel')}
                </Button>
                <Button
                    variant={paymentMethod === 'credit' ? 'primary' : paymentMethod === 'gift_card' ? 'primary' : 'success'}
                    loading={loading}
                    onClick={handlePayment}
                    disabled={
                        (paymentMethod === 'cash' && cashValue < remainingDue) ||
                        (paymentMethod === 'credit' && !canProcessCredit()) ||
                        (paymentMethod === 'gift_card' && !giftCardBalance)
                    }
                >
                    {paymentMethod === 'credit' ? t('pos.createCredit') :
                        paymentMethod === 'gift_card' ? (giftCardBalance < remainingDue ? t('pos.applyPartial') : t('pos.redeemGift')) :
                            t('pos.complete')}
                </Button>
            </ModalFooter>
        </Modal>
    );
}


