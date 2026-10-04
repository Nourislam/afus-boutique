import { useState, useEffect } from 'react';
import { Check, ChevronRight, ChevronLeft, Store, User, Percent, Printer, Languages, WifiOff, Shirt } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { toast } from './ui/Toast';
import { v4 as uuid } from 'uuid';
import { ShopInfoForm } from './settings/ShopInfoForm';
import { PrinterSettingsForm } from './settings/PrinterSettingsForm';
import { ShopLogo } from './shop/ShopLogo';
import { TitleBar } from './layout/TitleBar';
import { LANGUAGES, setLanguage, useT } from '../i18n';
import { CATEGORY_SUGGESTIONS, DEFAULT_CATEGORY_CODES, categoryName } from '../lib/clothing';
import {
    DEFAULT_SHOP, DEFAULT_PRINTER_SETTINGS, DEFAULT_SCANNER_SETTINGS, DEFAULT_SKU_SETTINGS,
    saveShopConfiguration,
} from '../lib/shopSettings';

const STEPS = [
    { id: 'welcome', title: 'setup.step.language', icon: Languages },
    { id: 'shop', title: 'setup.step.shop', icon: Store },
    { id: 'admin', title: 'setup.step.admin', icon: User },
    { id: 'money', title: 'setup.step.tax', icon: Percent },
    { id: 'printing', title: 'setup.step.printing', icon: Printer },
    { id: 'complete', title: 'setup.step.done', icon: Check },
];

/**
 * First-launch shop setup. Everything is stored locally in the SQLite
 * settings table; no account, activation or internet connection is used.
 * Shown only while `setup_completed` is not true.
 */
export default function SetupWizard({ onComplete }) {
    const { t, lang } = useT();
    const [currentStep, setCurrentStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [createdAdmin, setCreatedAdmin] = useState(null);

    const [shop, setShop] = useState({ ...DEFAULT_SHOP, defaultLanguage: lang });
    const [admin, setAdmin] = useState({ name: '', pin: '', confirmPin: '' });
    const [printers, setPrinters] = useState(DEFAULT_PRINTER_SETTINGS);
    const [labels, setLabels] = useState({ template: 'roll-40x30' });

    useEffect(() => {
        // Keep anything that is already saved (e.g. after restoring a backup)
        window.electronAPI.settings.get('store_config').then((saved) => {
            if (saved && typeof saved === 'object') setShop(prev => ({ ...prev, ...saved, defaultLanguage: prev.defaultLanguage }));
        }).catch(() => { });
    }, []);

    const setShopField = (key, value) => setShop(prev => ({ ...prev, [key]: value }));

    const chooseLanguage = (value) => {
        setShopField('defaultLanguage', value);
        // Saved with the rest of the setup at the end
        setLanguage(value, { persist: false });
    };

    const validateStep = (step) => {
        switch (STEPS[step].id) {
            case 'shop':
                if (!shop.businessName.trim()) {
                    toast.error(t('setup.shopNameRequired'));
                    return false;
                }
                if (!shop.shopLogo) {
                    toast.error(t('setup.logoRequired'));
                    return false;
                }
                return true;
            case 'admin':
                if (!admin.name.trim()) {
                    toast.error(t('setup.adminNameRequired'));
                    return false;
                }
                if (!/^\d{4}$/.test(admin.pin)) {
                    toast.error(t('setup.pinFormat'));
                    return false;
                }
                if (admin.pin !== admin.confirmPin) {
                    toast.error(t('setup.pinMismatch'));
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

    // Ready-made clothing categories in the chosen language (only on an empty catalogue)
    const createDefaultCategories = async () => {
        const existing = await window.electronAPI.categories.getAll();
        if (existing.length > 0) return;
        for (const code of DEFAULT_CATEGORY_CODES) {
            const entry = CATEGORY_SUGGESTIONS.find(c => c.code === code);
            if (!entry) continue;
            await window.electronAPI.categories.create({ id: uuid(), name: categoryName(entry, shop.defaultLanguage), color: entry.color });
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
                shop: { ...shop, currency: 'DZD', currencySymbol: 'DA', taxRate: parseFloat(shop.taxRate) || 0 },
                printers,
                labels,
                scanner: DEFAULT_SCANNER_SETTINGS,
                sku: DEFAULT_SKU_SETTINGS,
            });
            await createDefaultCategories();
            await setLanguage(shop.defaultLanguage);
            await window.electronAPI.settings.set({ key: 'setup_completed', value: 'true' });

            setCreatedAdmin({ id: adminEmployee.id, name: adminEmployee.name, role: 'admin' });
            toast.success(t('setup.saved'));
            setCurrentStep(STEPS.length - 1);
        } catch (error) {
            console.error('Setup error:', error);
            toast.error(t('setup.saveFailed', { error: error.message }));
        } finally {
            setLoading(false);
        }
    };

    const renderStepContent = () => {
        switch (STEPS[currentStep].id) {
            case 'welcome':
                return (
                    <div className="text-center py-6">
                        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                            <Shirt className="w-12 h-12 text-white" />
                        </div>
                        <h2 className="text-3xl font-bold mb-2">{t('setup.welcome', { app: t('app.name') })}</h2>
                        <p className="text-zinc-400 text-lg max-w-md mx-auto">{t('setup.welcomeText')}</p>

                        <p className="form-label mt-8 mb-3">{t('setup.chooseLanguage')}</p>
                        <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto">
                            {LANGUAGES.map(l => (
                                <button
                                    key={l.value}
                                    type="button"
                                    onClick={() => chooseLanguage(l.value)}
                                    className={`rounded-xl border-2 py-4 text-lg font-semibold transition-all
                                        ${shop.defaultLanguage === l.value ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-dark-border text-zinc-300 hover:border-zinc-500'}`}
                                >
                                    {l.label}
                                </button>
                            ))}
                        </div>

                        <div className="mt-8 space-y-3 text-start max-w-sm mx-auto">
                            {['setup.check.shop', 'setup.check.admin', 'setup.check.printing'].map(key => (
                                <div key={key} className="flex items-center gap-3 text-zinc-300">
                                    <Check className="w-5 h-5 text-green-500 shrink-0" /><span>{t(key)}</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-8 inline-flex items-center gap-2 text-sm text-zinc-500">
                            <WifiOff className="w-4 h-4" />
                            {t('setup.offline')}
                        </div>
                    </div>
                );

            case 'shop':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-2">{t('setup.shopTitle')}</h2>
                        <p className="text-sm text-zinc-400 mb-4">{t('setup.shopText')}</p>
                        <ShopInfoForm value={shop} onChange={setShop} requireLogo />
                    </div>
                );

            case 'admin':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-2">{t('setup.adminTitle')}</h2>
                        <p className="text-sm text-zinc-400 mb-4">{t('setup.adminText')}</p>
                        <Input
                            label={t('setup.adminName')}
                            value={admin.name}
                            onChange={(e) => setAdmin(prev => ({ ...prev, name: e.target.value }))}
                            placeholder={t('setup.adminNamePlaceholder')}
                        />
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label={t('setup.pin')}
                                type="password"
                                inputMode="numeric"
                                className="ltr"
                                value={admin.pin}
                                onChange={(e) => setAdmin(prev => ({ ...prev, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                            />
                            <Input
                                label={t('setup.confirmPin')}
                                type="password"
                                inputMode="numeric"
                                className="ltr"
                                value={admin.confirmPin}
                                onChange={(e) => setAdmin(prev => ({ ...prev, confirmPin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                            />
                        </div>
                    </div>
                );

            case 'money':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-2">{t('setup.taxTitle')}</h2>
                        <div className="rounded-lg bg-dark-tertiary px-4 py-3 text-sm">
                            <span className="text-zinc-400">{t('settings.currency')} : </span>
                            <span className="font-semibold">{t('settings.currencyDzd')}</span>
                        </div>
                        <p className="text-sm text-zinc-400">{t('setup.taxText')}</p>
                        <div className="grid grid-cols-3 gap-4">
                            <Input
                                label={t('settings.taxName')}
                                value={shop.taxName}
                                onChange={(e) => setShopField('taxName', e.target.value)}
                                placeholder="TVA"
                            />
                            <Input
                                label={t('settings.taxRate')}
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={shop.taxRate}
                                onChange={(e) => setShopField('taxRate', e.target.value)}
                            />
                            <Select
                                label={t('settings.prices')}
                                value={shop.taxType}
                                onChange={(v) => setShopField('taxType', v)}
                                options={[
                                    { value: 'inclusive', label: t('settings.taxInclusive') },
                                    { value: 'exclusive', label: t('settings.taxExclusive') },
                                ]}
                            />
                        </div>
                    </div>
                );

            case 'printing':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-2">{t('setup.printingTitle')}</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label={t('settings.receiptHeader')}
                                value={shop.receiptHeader}
                                onChange={(e) => setShopField('receiptHeader', e.target.value)}
                            />
                            <Input
                                label={t('settings.receiptFooter')}
                                value={shop.receiptFooter}
                                onChange={(e) => setShopField('receiptFooter', e.target.value)}
                                placeholder={t('settings.receiptFooterDefault')}
                            />
                        </div>
                        <PrinterSettingsForm
                            printers={printers}
                            onPrintersChange={setPrinters}
                            labels={labels}
                            onLabelsChange={setLabels}
                            compact
                        />
                        <p className="text-xs text-zinc-500">{t('setup.printingHint')}</p>
                    </div>
                );

            case 'complete':
                return (
                    <div className="text-center py-8">
                        <div className="mx-auto mb-6 w-fit">
                            <ShopLogo fileName={shop.shopLogo} size={96} rounded="rounded-2xl" />
                        </div>
                        <h2 className="text-3xl font-bold mb-4">{t('setup.ready', { shop: shop.businessName })}</h2>
                        <p className="text-zinc-400 text-lg max-w-md mx-auto mb-8">{t('setup.readyText')}</p>
                        <div className="bg-zinc-800/50 rounded-lg p-6 max-w-sm mx-auto">
                            <div className="space-y-2 text-sm text-start">
                                <div className="flex justify-between gap-4"><span className="text-zinc-400">{t('setup.step.admin')}</span><span>{admin.name}</span></div>
                                <div className="flex justify-between gap-4"><span className="text-zinc-400">{t('settings.language')}</span><span>{LANGUAGES.find(l => l.value === shop.defaultLanguage)?.label}</span></div>
                                <div className="flex justify-between gap-4"><span className="text-zinc-400">{t('settings.taxName')}</span><span>{shop.taxRate || 0}% ({shop.taxType === 'exclusive' ? t('settings.taxExclusive') : t('settings.taxInclusive')})</span></div>
                                <div className="flex justify-between gap-4"><span className="text-zinc-400">{t('printers.receipt')}</span><span className="truncate">{printers.receipt.printerName || t('printers.askEveryTime')}</span></div>
                                <div className="flex justify-between gap-4"><span className="text-zinc-400">{t('printers.label')}</span><span className="truncate">{printers.label.printerName || t('printers.askEveryTime')}</span></div>
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
        <div className="h-screen flex flex-col bg-dark-primary">
            <TitleBar bare />
            <div className="flex-1 overflow-y-auto flex items-start justify-center p-6">
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
                                    title={t(step.title)}
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
                                    <ChevronLeft className="w-4 h-4 me-1 flip-rtl" />
                                    {t('common.back')}
                                </Button>
                            )}
                        </div>
                        {!isLast ? (
                            <Button onClick={handleNext} loading={loading}>
                                {currentStep === STEPS.length - 2 ? t('setup.finish') : t('common.next')}
                                <ChevronRight className="w-4 h-4 ms-1 flip-rtl" />
                            </Button>
                        ) : (
                            <Button onClick={() => onComplete?.(createdAdmin)}>
                                {t('setup.start')}
                                <ChevronRight className="w-4 h-4 ms-1 flip-rtl" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
            </div>
        </div>
    );
}
