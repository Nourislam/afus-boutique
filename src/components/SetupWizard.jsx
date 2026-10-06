import { useState, useEffect } from 'react';
import { translateError } from '../i18n/errors';
import { Check, ChevronRight, ChevronLeft, Store, User, Percent, Printer, Languages, WifiOff, FlaskConical, ScanLine } from 'lucide-react';
import { AfusLogo } from './brand/AfusLogo';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { toast } from './ui/Toast';
import { v4 as uuid } from 'uuid';
import { ShopInfoForm } from './settings/ShopInfoForm';
import { PrinterSettingsForm, PrintTestPanel, Panel } from './settings/PrinterSettingsForm';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
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
            // Opens the session in the main process for the new owner (PIN checked there)
            await window.electronAPI.employees.verifyPin({ id: adminEmployee.id, pin: admin.pin });

            await saveShopConfiguration({
                shop: { ...shop, currency: 'DZD', currencySymbol: 'DA', taxRate: parseFloat(shop.taxRate) || 0 },
                printers,
                labels,
                scanner: DEFAULT_SCANNER_SETTINGS,
                sku: DEFAULT_SKU_SETTINGS,
            });
            await createDefaultCategories();
            await setLanguage(shop.defaultLanguage);
            // A new shop starts with the simple menu (full mode in Settings › Modules)
            await window.electronAPI.settings.set({ key: 'ui_mode', value: 'simple' });
            await window.electronAPI.settings.set({ key: 'setup_completed', value: 'true' });

            setCreatedAdmin({ id: adminEmployee.id, name: adminEmployee.name, role: 'admin' });
            toast.success(t('setup.saved'));
            setCurrentStep(STEPS.length - 1);
        } catch (error) {
            console.error('Setup error:', error);
            toast.error(t('setup.saveFailed', { error: translateError(error) }));
        } finally {
            setLoading(false);
        }
    };

    const renderStepContent = () => {
        switch (STEPS[currentStep].id) {
            case 'welcome':
                return (
                    <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] items-center">
                        <div>
                        <h2 className="text-3xl font-bold mb-2">{t('setup.welcome', { app: t('app.name') })}</h2>
                        <p className="text-zinc-400 text-lg">{t('setup.welcomeText')}</p>

                        <p className="form-label mt-8 mb-3">{t('setup.chooseLanguage')}</p>
                        <div className="grid grid-cols-3 gap-3">
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
                        </div>

                        <div className="rounded-2xl bg-dark-tertiary/60 border border-dark-border p-5">
                            <p className="text-sm font-semibold text-zinc-300 mb-4">{t('setup.whatWeSet')}</p>
                            <div className="space-y-3">
                                {['setup.check.shop', 'setup.check.admin', 'setup.check.printing'].map(key => (
                                    <div key={key} className="flex items-start gap-3 text-zinc-300">
                                        <Check className="w-5 h-5 text-green-500 shrink-0 mt-0.5" /><span>{t(key)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );

            case 'shop':
                return (
                    <div>
                        <h2 className="text-2xl font-bold mb-1">{t('setup.shopTitle')}</h2>
                        <p className="text-sm text-zinc-400 mb-4">{t('setup.shopText')}</p>
                        <ShopInfoForm value={shop} onChange={setShop} />
                    </div>
                );

            case 'admin':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold mb-2">{t('setup.adminTitle')}</h2>
                        <p className="text-sm text-zinc-400 mb-4">{t('setup.adminText')}</p>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Input
                            label={t('setup.adminName')}
                            value={admin.name}
                            onChange={(e) => setAdmin(prev => ({ ...prev, name: e.target.value }))}
                            placeholder={t('setup.adminNamePlaceholder')}
                            containerClassName="sm:col-span-2 lg:col-span-1"
                        />
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
                        {/* Optional checks: nothing here blocks the setup (devices can be plugged in later) */}
                        <Panel icon={FlaskConical} title={t('setup.check.title')} hint={t('setup.check.hint')}>
                            <PrintTestPanel printers={printers} layout={labels} shop={shop} only={['receipt']} />
                            <ScannerCheck />
                        </Panel>
                        <p className="text-xs text-zinc-500">{t('setup.printingHint')}</p>
                    </div>
                );

            case 'complete':
                return (
                    <div className="text-center">
                        <div className="mx-auto mb-5 w-fit">
                            <ShopLogo fileName={shop.shopLogo} name={shop.businessName} size={96} rounded="rounded-2xl" />
                        </div>
                        <h2 className="text-3xl font-bold mb-3">{t('setup.ready', { shop: shop.businessName })}</h2>
                        <p className="text-zinc-400 text-lg max-w-md mx-auto mb-6">{t('setup.readyText')}</p>
                        <div className="bg-zinc-800/50 rounded-xl p-6 max-w-md mx-auto">
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
            <div className="flex-1 min-h-0 flex justify-center p-4 lg:p-6">
                <div className="w-full max-w-6xl min-h-0 lg:h-[min(46rem,100%)] lg:my-auto flex flex-col lg:flex-row gap-4 lg:gap-6">
                    {/* The program: Afus Boutique identity and the steps */}
                    <aside className="lg:w-60 flex-none flex lg:flex-col gap-4 lg:gap-6 rounded-2xl border border-dark-border bg-dark-secondary/60 p-4 lg:p-5">
                        <div className="flex items-center gap-3 min-w-0">
                            <AfusLogo size={40} title={t('app.name')} />
                            <div className="min-w-0 hidden sm:block">
                                <p className="font-bold leading-tight truncate">{t('app.name')}</p>
                                <p className="text-xs text-zinc-500 leading-snug">{t('app.tagline')}</p>
                            </div>
                        </div>

                        <ol className="flex-1 flex lg:flex-col items-center lg:items-stretch justify-end lg:justify-start gap-1.5 lg:gap-1 min-w-0">
                            {STEPS.map((step, index) => {
                                const Icon = step.icon;
                                const isActive = index === currentStep;
                                const isCompleted = index < currentStep;
                                return (
                                    <li key={step.id} title={t(step.title)}
                                        className={`flex items-center gap-3 rounded-xl lg:px-3 lg:py-2 ${isActive ? 'lg:bg-indigo-500/10' : ''}`}
                                        aria-current={isActive ? 'step' : undefined}>
                                        <span className={`w-8 h-8 rounded-full flex-none flex items-center justify-center transition-all
                                            ${isCompleted ? 'bg-green-500 text-white' : ''}
                                            ${isActive ? 'bg-indigo-500 text-white ring-4 ring-indigo-500/25' : ''}
                                            ${!isActive && !isCompleted ? 'bg-zinc-800 text-zinc-500' : ''}`}>
                                            {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                                        </span>
                                        <span className={`hidden lg:block text-sm truncate ${isActive ? 'text-white font-semibold' : isCompleted ? 'text-zinc-300' : 'text-zinc-500'}`}>
                                            {t(step.title)}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>

                        <p className="hidden lg:flex items-start gap-2 text-xs text-zinc-500 leading-relaxed">
                            <WifiOff className="w-4 h-4 flex-none mt-0.5" />
                            {t('setup.offline')}
                        </p>
                    </aside>

                    {/* The step: scrolls inside the card only if the window is small; the buttons stay visible */}
                    <section className="card !p-0 flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                        <div className={`flex-1 min-h-0 overflow-y-auto p-5 xl:p-8 ${['welcome', 'complete'].includes(STEPS[currentStep].id) ? 'flex flex-col justify-center' : ''}`}>
                            <p className="text-xs font-medium text-indigo-300 mb-2 lg:hidden">
                                {t('setup.stepOf', { n: currentStep + 1, total: STEPS.length })} · {t(STEPS[currentStep].title)}
                            </p>
                            {renderStepContent()}
                        </div>

                        <div className="flex-none flex items-center justify-between gap-3 px-5 xl:px-8 py-3 xl:py-4 border-t border-dark-border bg-dark-secondary/40">
                            <div>
                                {currentStep > 0 && !isLast && (
                                    <Button variant="secondary" size="lg" onClick={() => setCurrentStep(prev => prev - 1)}>
                                        <ChevronLeft className="w-5 h-5 flip-rtl" />
                                        {t('common.back')}
                                    </Button>
                                )}
                            </div>
                            <span className="hidden sm:block text-xs text-zinc-500">{t('setup.stepOf', { n: currentStep + 1, total: STEPS.length })}</span>
                            {!isLast ? (
                                <Button size="lg" onClick={handleNext} loading={loading} className="min-w-[10rem] justify-center">
                                    {currentStep === STEPS.length - 2 ? t('setup.finish') : t('common.next')}
                                    <ChevronRight className="w-5 h-5 flip-rtl" />
                                </Button>
                            ) : (
                                <Button size="lg" onClick={() => onComplete?.(createdAdmin)} className="min-w-[10rem] justify-center">
                                    {t('setup.start')}
                                    <ChevronRight className="w-5 h-5 flip-rtl" />
                                </Button>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

/** Scan any code: shows it, to check the scanner is plugged in (never required). */
function ScannerCheck() {
    const { t } = useT();
    const [last, setLast] = useState('');
    useBarcodeScanner((code) => setLast(code));
    return (
        <div className="flex items-center gap-3 rounded-lg border border-dark-border px-3 py-2.5" data-testid="setup-scanner-check">
            <ScanLine className="w-5 h-5 text-zinc-400 flex-none" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t('setup.check.scanner')}</p>
                <p className={`text-xs break-words ${last ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {last ? t('setup.check.scanned', { code: last }) : t('setup.check.scanHint')}
                </p>
            </div>
        </div>
    );
}
