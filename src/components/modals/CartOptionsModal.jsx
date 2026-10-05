import { t } from '../../i18n';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Tabs } from '../ui/Tabs';
import { useCartStore } from '../../stores/cartStore';
import { useTaxEnabled } from '../../lib/useTaxEnabled';

export default function CartOptionsModal({ isOpen, onClose }) {
    const taxOn = useTaxEnabled();
    const cart = useCartStore();
    const [activeTab, setActiveTab] = useState('discount');

    // Local state to manage changes before applying
    const [discountValue, setDiscountValue] = useState(cart.discount);
    const [discountType, setDiscountType] = useState(cart.discountType); // 'fixed' or 'percent'
    const [serviceCharge, setServiceCharge] = useState(cart.serviceCharge);
    const [isTaxExempt, setIsTaxExempt] = useState(cart.taxExempt);
    const [coupon, setCoupon] = useState(cart.coupon);

    // Reset local state when modal opens
    useEffect(() => {
        if (isOpen) {
            setDiscountValue(cart.discount);
            setDiscountType(cart.discountType);
            setServiceCharge(cart.serviceCharge);
            setIsTaxExempt(cart.taxExempt);
            setCoupon(cart.coupon);
        }
    }, [isOpen, cart]);

    const handleSave = () => {
        cart.setDiscount(parseFloat(discountValue) || 0, discountType);
        cart.setServiceCharge(parseFloat(serviceCharge) || 0);
        cart.setTaxExempt(isTaxExempt);
        cart.setCoupon(coupon);
        onClose();
    };

    const tabs = [
        { id: 'discount', label: t('pos.discount') },
        { id: 'fees', label: t('cartOptions.fees') },
        // No TVA tab while TVA is turned off in Settings
        ...(taxOn ? [{ id: 'tax', label: t('pos.tax') }] : []),
    ];

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('cartOptions.title')}
            size="sm"
        >
            <ModalBody>
                <div className="mb-4">
                    <Tabs
                        tabs={tabs}
                        value={activeTab}
                        onChange={setActiveTab}
                    />
                </div>

                <div className="p-1">
                    {activeTab === 'discount' && (
                        <div className="space-y-4">
                            <div className="flex bg-dark-tertiary rounded-lg p-1">
                                <button
                                    onClick={() => setDiscountType('fixed')}
                                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${discountType === 'fixed'
                                        ? 'bg-accent-primary text-white'
                                        : 'text-zinc-400 hover:text-white'
                                        }`}
                                >
                                    {t('cartOptions.fixedDa')}
                                </button>
                                <button
                                    onClick={() => setDiscountType('percent')}
                                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${discountType === 'percent'
                                        ? 'bg-accent-primary text-white'
                                        : 'text-zinc-400 hover:text-white'
                                        }`}
                                >
                                    {t('cartOptions.percentShort')}
                                </button>
                            </div>
                            <Input
                                label={discountType === 'fixed' ? t('cartOptions.amount') : t('cartOptions.percent')}
                                type="number"
                                min="0"
                                value={discountValue}
                                onChange={(e) => setDiscountValue(e.target.value)}
                                placeholder="0"
                                autoFocus
                            />
                            <div className="pt-3 border-t border-dark-border">
                                <Input
                                    label={t('cartOptions.coupon')}
                                    value={coupon}
                                    onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                                    placeholder="AID2025"
                                    className="ltr font-mono"
                                    data-scan-passthrough
                                />
                                <p className="form-hint mt-1">{t('cartOptions.couponHint')}</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'fees' && (
                        <div className="space-y-4">
                            <Input
                                label={t('cartOptions.fee')}
                                type="number"
                                min="0"
                                value={serviceCharge}
                                onChange={(e) => setServiceCharge(e.target.value)}
                                placeholder="0.00"
                            />
                            <p className="text-xs text-zinc-500">
                                {t('cartOptions.feeHint')}
                            </p>
                        </div>
                    )}

                    {taxOn && activeTab === 'tax' && (
                        <div className="space-y-4 py-2">
                            <label className="flex items-center gap-3 p-4 bg-dark-tertiary rounded-lg cursor-pointer border border-transparent hover:border-zinc-700">
                                <input
                                    type="checkbox"
                                    checked={isTaxExempt}
                                    onChange={(e) => setIsTaxExempt(e.target.checked)}
                                    className="w-5 h-5 rounded border-zinc-600 bg-dark-bg text-accent-primary focus:ring-accent-primary"
                                />
                                <div>
                                    <span className="block font-medium">{t('cartOptions.exempt')}</span>
                                    <span className="text-xs text-zinc-500">{t('cartOptions.exemptHint')}</span>
                                </div>
                            </label>
                        </div>
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                <div className="flex justify-end gap-2 w-full">
                    <Button variant="secondary" onClick={onClose} className="flex-1">
                        {t('common.cancel')}
                    </Button>
                    <Button variant="primary" onClick={handleSave} className="flex-1">
                        {t('cartOptions.apply')}
                    </Button>
                </div>
            </ModalFooter>
        </Modal>
    );
}
