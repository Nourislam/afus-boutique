import { useState, useEffect } from 'react';
import { Check, ChevronRight, ChevronLeft, Store, User, Percent, Printer, Sparkles, WifiOff } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { toast } from './ui/Toast';
import { currencies as CURRENCIES } from '../data/currencies';
import { v4 as uuid } from 'uuid';
import { ShopInfoForm } from './settings/ShopInfoForm';
import { PrinterSettingsForm } from './settings/PrinterSettingsForm';
import { ShopLogo } from './shop/ShopLogo';
import { APP_NAME } from '../lib/appInfo';
import {
    DEFAULT_SHOP, DEFAULT_PRINTER_SETTINGS, DEFAULT_SCANNER_SETTINGS, DEFAULT_SKU_SETTINGS, LANGUAGES,
    saveShopConfiguration,
} from '../lib/shopSettings';

const STEPS = [
    { id: 'welcome', title: 'Welcome', icon: Sparkles },
    { id: 'shop', title: 'Shop', icon: Store },
    { id: 'admin', title: 'Administrator', icon: User },
    { id: 'money', title: 'Currency & tax', icon: Percent },
    { id: 'printing', title: 'Receipts & labels', icon: Printer },
    { id: 'complete', title: 'Done', icon: Check },
];

/**
 * First-launch shop setup. Everything is stored locally in the SQLite
 * settings table; no account, activation or internet connection is used.
 * Shown only while `setup_completed` is not true.
 */
export default function SetupWizard({ onComplete }) {
    const [currentStep, setCurrentStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [createdAdmin, setCreatedAdmin] = useState(null);

    const [shop, setShop] = useState({ ...DEFAULT_SHOP });
    const [admin, setAdmin] = useState({ name: '', pin: '', confirmPin: '' });
    const [printers, setPrinters] = useState(DEFAULT_PRINTER_SETTINGS);
    const [labels, setLabels] = useState({ template: 'roll-40x30' });

    useEffect(() => {
        // Keep anything that is already saved (e.g. after restoring a backup)
        window.electronAPI.settings.get('store_config').then((saved) => {
            if (saved && typeof saved === 'object') setShop(prev => ({ ...prev, ...saved }));
        }).catch(() => { });
    }, []);

    const setShopField = (key, value) => setShop(prev => ({ ...prev, [key]: value }));

    const handleCurrencyChange = (code) => {
        const currency = CURRENCIES.find(c => c.code === code);
        setShop(prev => ({ ...prev, currency: code, currencySymbol: currency ? currency.symbol : prev.currencySymbol }));
    };

    const validateStep = (step) => {
        switch (STEPS[step].id) {
            case 'shop':
                if (!shop.businessName.trim()) {
                    toast.error('Please enter the shop name');
                    return false;
                }
                if (!shop.shopLogo) {
                    toast.error('Please upload the shop logo');
                    return false;
                }
                return true;
            case 'admin':
                if (!admin.name.trim()) {
                    toast.error('Please enter the administrator name');
                    return false;
                }
                if (!/^\d{4}$/.test(admin.pin)) {
                    toast.error('The PIN must be exactly 4 digits');
                    return false;
                }
                if (admin.pin !== admin.confirmPin) {
                    toast.error('The PINs do not match');
                    return false;
                }
                return true;
            default:
                return true;
        }
    };

    const handleNext = async () => {
        if (!validateStep(currentStep)) return;
        if (currentStep === STEPS.length - 2) {
            await saveAll();
        } else {
            // Suggest the owner's name for the administrator
            if (STEPS[currentStep + 1].id === 'admin' && !admin.name && shop.ownerName) {
                setAdmin(prev => ({ ...prev, name: shop.ownerName }));
            }
            setCurrentStep(prev => prev + 1);
        }
    };

    const saveAll = async () => {
        setLoading(true);
        try {
            // A fresh install has no employees; deactivate any left over from
            // a reset so the new administrator is the only active account.
            const existingEmployees = await window.electronAPI.employees.getAll();
            for (const emp of existingEmployees) {
                await window.electronAPI.employees.delete(emp.id);
            }

            const adminEmployee = {
                id: uuid(),
                name: admin.name.trim(),
                email: shop.businessEmail || null,
                pin: admin.pin,
                role: 'admin',
                is_active: 1,
            };
            await window.electronAPI.employees.create(adminEmployee);

            await saveShopConfiguration({
                shop: { ...shop, taxRate: parseFloat(shop.taxRate) || 0 },
                printers,
                labels,
                scanner: DEFAULT_SCANNER_SETTINGS,
                sku: DEFAULT_SKU_SETTINGS,
            });
            await window.electronAPI.settings.set({ key: 'setup_completed', value: 'true' });

            setCreatedAdmin({ id: adminEmployee.id, name: adminEmployee.name, role: 'admin' });
            toast.success('Shop setup saved');
            setCurrentStep(STEPS.length - 1);
        } catch (error) {
            console.error('Setup error:', error);
            toast.error('Failed to save setup: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const renderStepContent = () => {
        switch (STEPS[currentStep].id) {
            case 'welcome':
                return (
                    <div className="text-center py-8">
                        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                            <Store className="w-12 h-12 text-white" />
                        </div>
                        <h2 className="text-3xl font-bold mb-4">Welcome to {APP_NAME}</h2>
                        <p className="text-zinc-400 text-lg max-w-md mx-auto">
                            Let&apos;s set up your shop. This takes about two minutes.
                        </p>
                        <div className="mt-8 space-y-3 text-left max-w-sm mx-auto">
                            <div className="flex items-center gap-3 text-zinc-300">
                                <Check className="w-5 h-5 text-green-500" /><span>Your shop name and logo</span>
                            </div>
                            <div className="flex items-center gap-3 text-zinc-300">
                                <Check className="w-5 h-5 text-green-500" /><span>An administrator PIN for this computer</span>
                            </div>
                            <div className="flex items-center gap-3 text-zinc-300">
                                <Check className="w-5 h-5 text-green-500" /><span>Currency, tax, receipt and label printers</span>
                            </div>
                        </div>
                        <div className="mt-8 inline-flex items-center gap-2 text-sm text-zinc-500">
                            <WifiOff className="w-4 h-4" />
                            No account or internet connection is needed. All data stays on this computer.
                        </div>
                    </div>
                );

            case 'shop':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-2">Your shop</h2>
                        <p className="text-sm text-zinc-400 mb-4">Shown on receipts, labels and the sales screen. You can change it later in Settings.</p>
                        <ShopInfoForm value={shop} onChange={setShop} requireLogo />
                    </div>
                );

            case 'admin':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-2">Administrator</h2>
                        <p className="text-sm text-zinc-400 mb-4">
                            The administrator can manage products, prices, employees and settings.
                            The PIN is used to unlock the POS on this computer.
                        </p>
                        <Input
                            label="Name *"
                            value={admin.name}
                            onChange={(e) => setAdmin(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Your name"
                        />
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="PIN (4 digits) *"
                                type="password"
                                inputMode="numeric"
                                value={admin.pin}
                                onChange={(e) => setAdmin(prev => ({ ...prev, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                            />
                            <Input
                                label="Confirm PIN *"
                                type="password"
                                inputMode="numeric"
                                value={admin.confirmPin}
                                onChange={(e) => setAdmin(prev => ({ ...prev, confirmPin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                            />
                        </div>
                    </div>
                );

            case 'money':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-6">Currency, tax and language</h2>
                        <Select
                            label="Currency"
                            value={shop.currency}
                            onChange={handleCurrencyChange}
                            options={CURRENCIES.map(c => ({ value: c.code, label: `${c.code} - ${c.name} (${c.symbol})` }))}
                        />
                        <div className="grid grid-cols-3 gap-4">
                            <Input
                                label="Tax name"
                                value={shop.taxName}
                                onChange={(e) => setShopField('taxName', e.target.value)}
                                placeholder="VAT / TVA"
                            />
                            <Input
                                label="Tax rate (%)"
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={shop.taxRate}
                                onChange={(e) => setShopField('taxRate', e.target.value)}
                            />
                            <Select
                                label="Prices"
                                value={shop.taxType}
                                onChange={(v) => setShopField('taxType', v)}
                                options={[
                                    { value: 'inclusive', label: 'Include tax' },
                                    { value: 'exclusive', label: 'Exclude tax (added at checkout)' },
                                ]}
                            />
                        </div>
                        <Select
                            label="Default language for documents"
                            value={shop.defaultLanguage}
                            onChange={(v) => setShopField('defaultLanguage', v)}
                            options={LANGUAGES}
                        />
                        <p className="text-xs text-zinc-500">The application interface is currently in English; this choice is stored for receipts and future translations.</p>
                    </div>
                );

            case 'printing':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-2">Receipts and labels</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="Receipt header (optional)"
                                value={shop.receiptHeader}
                                onChange={(e) => setShopField('receiptHeader', e.target.value)}
                            />
                            <Input
                                label="Receipt footer"
                                value={shop.receiptFooter}
                                onChange={(e) => setShopField('receiptFooter', e.target.value)}
                            />
                        </div>
                        <PrinterSettingsForm
                            printers={printers}
                            onPrintersChange={setPrinters}
                            labels={labels}
                            onLabelsChange={setLabels}
                            compact
                        />
                        <p className="text-xs text-zinc-500">Printers can be left on “Ask every time” and configured later in Settings.</p>
                    </div>
                );

            case 'complete':
                return (
                    <div className="text-center py-8">
                        <div className="mx-auto mb-6 w-fit">
                            <ShopLogo fileName={shop.shopLogo} size={96} rounded="rounded-2xl" />
                        </div>
                        <h2 className="text-3xl font-bold mb-4">{shop.businessName} is ready</h2>
                        <p className="text-zinc-400 text-lg max-w-md mx-auto mb-8">
                            You can change any of this later in Settings.
                        </p>
                        <div className="bg-zinc-800/50 rounded-lg p-6 max-w-sm mx-auto">
                            <div className="space-y-2 text-sm text-left">
                                <div className="flex justify-between"><span className="text-zinc-400">Administrator:</span><span>{admin.name}</span></div>
                                <div className="flex justify-between"><span className="text-zinc-400">Currency:</span><span>{shop.currency} ({shop.currencySymbol})</span></div>
                                <div className="flex justify-between"><span className="text-zinc-400">Tax:</span><span>{shop.taxRate || 0}% ({shop.taxType})</span></div>
                                <div className="flex justify-between"><span className="text-zinc-400">Receipt printer:</span><span className="truncate ml-4">{printers.receipt.printerName || 'Ask every time'}</span></div>
                                <div className="flex justify-between"><span className="text-zinc-400">Label printer:</span><span className="truncate ml-4">{printers.label.printerName || 'Ask every time'}</span></div>
                            </div>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    const isLast = currentStep === STEPS.length - 1;

    return (
        <div className="h-screen overflow-y-auto bg-dark-bg flex items-start justify-center p-6">
            <div className="w-full max-w-3xl my-auto">
                {/* Progress Steps */}
                <div className="flex items-center justify-between mb-8">
                    {STEPS.map((step, index) => {
                        const Icon = step.icon;
                        const isActive = index === currentStep;
                        const isCompleted = index < currentStep;
                        return (
                            <div key={step.id} className="flex items-center">
                                <div
                                    title={step.title}
                                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all
                                    ${isCompleted ? 'bg-green-500 text-white' : ''}
                                    ${isActive ? 'bg-indigo-500 text-white ring-4 ring-indigo-500/30' : ''}
                                    ${!isActive && !isCompleted ? 'bg-zinc-800 text-zinc-500' : ''}`}
                                >
                                    {isCompleted ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                                </div>
                                {index < STEPS.length - 1 && (
                                    <div className={`w-10 md:w-20 h-1 mx-1 ${isCompleted ? 'bg-green-500' : 'bg-zinc-800'}`} />
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="card p-8">
                    {renderStepContent()}

                    <div className="flex items-center justify-between mt-8 pt-6 border-t border-dark-border">
                        <div>
                            {currentStep > 0 && !isLast && (
                                <Button variant="secondary" onClick={() => setCurrentStep(prev => prev - 1)}>
                                    <ChevronLeft className="w-4 h-4 mr-1" />
                                    Back
                                </Button>
                            )}
                        </div>
                        {!isLast ? (
                            <Button onClick={handleNext} loading={loading}>
                                {currentStep === STEPS.length - 2 ? 'Finish setup' : 'Next'}
                                <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        ) : (
                            <Button onClick={() => onComplete?.(createdAdmin)}>
                                Open the POS
                                <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
