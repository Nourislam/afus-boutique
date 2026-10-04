import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Building, Receipt, Percent, Database, Save, Download, Upload, Mail, Lock, CheckCircle, Printer, ScanLine, Hash,
    Languages, Shirt, Tags, Users, ToggleRight, Globe, ScrollText, Settings as SettingsIcon,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, TextArea } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/ui/Toast';
import { useAuthStore } from '../stores/authStore';
import { ShopInfoForm } from '../components/settings/ShopInfoForm';
import { PrinterSettingsForm } from '../components/settings/PrinterSettingsForm';
import { ScannerSettingsForm } from '../components/settings/ScannerSettingsForm';
import { CategoryManagerModal } from '../components/products/CategoryManagerModal';
import { DEFAULT_SHOP, loadShopConfiguration, saveShopConfiguration } from '../lib/shopSettings';
import { DEFAULT_FEATURES, resolveFeatures } from '../lib/features';
import { COLORS, SIZE_SETS, colorName, sizeSetLabel } from '../lib/clothing';
import { useSettingsStore } from '../stores/settingsStore';
import { SystemLogs } from '../components/settings/SystemLogs';
import { EcommerceSettings } from '../components/settings/EcommerceSettings';
import { LANGUAGES, setLanguage, useT } from '../i18n';
import { formatMoney } from '../i18n/format';

const BASE_TABS = ['business', 'language', 'receipt', 'printers', 'scanner', 'sku', 'catalog', 'features', 'backup'];

// Settings sections, grouped like the shop thinks about them
const SECTION_GROUPS = [
    { id: 'shop', ids: ['business', 'language', 'receipt'] },
    { id: 'devices', ids: ['printers', 'scanner'] },
    { id: 'catalog', ids: ['catalog', 'sku'] },
    { id: 'app', ids: ['features', 'mail', 'ecommerce', 'backup', 'logs'] },
];

const SECTION_ICONS = {
    business: Building, language: Languages, receipt: Receipt, printers: Printer, scanner: ScanLine,
    sku: Hash, catalog: Shirt, features: ToggleRight, mail: Mail, ecommerce: Globe, backup: Database, logs: ScrollText,
};

function SectionHeader({ icon: Icon, color, title, text }) {
    return (
        <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
            <div className={`p-3 rounded-lg ${color}`}>
                <Icon className="w-6 h-6" />
            </div>
            <div>
                <h3 className="font-semibold">{title}</h3>
                {text && <p className="text-sm text-zinc-400">{text}</p>}
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const { t, lang } = useT();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('business');
    const [settings, setSettings] = useState({
        ...DEFAULT_SHOP,
        email_host: 'smtp.gmail.com',
        email_port: 587,
        email_secure: false,
    });
    const [features, setFeatures] = useState(resolveFeatures());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showCategories, setShowCategories] = useState(false);
    const [categories, setCategories] = useState([]);

    // Printer, label, scanner and SKU configuration (separate settings keys)
    const [printers, setPrinters] = useState(null);
    const [labels, setLabels] = useState({});
    const [scanner, setScanner] = useState(null);
    const [sku, setSku] = useState(null);
    const [appInfo, setAppInfo] = useState(null);
    const reloadStoreSettings = useSettingsStore(state => state.loadSettings);

    const { isAdmin } = useAuthStore();
    const tabIds = [
        ...BASE_TABS.slice(0, -1),
        ...(features.email ? ['mail'] : []),
        ...(features.ecommerce ? ['ecommerce'] : []),
        'backup',
        ...(isAdmin() ? ['logs'] : []),
    ];

    useEffect(() => {
        loadSettings();
    }, []);

    const loadCategories = async () => {
        try { setCategories(await window.electronAPI.categories.getAll()); } catch { /* shown empty */ }
    };

    const loadSettings = async () => {
        try {
            const data = await window.electronAPI.settings.getAll();
            const parse = (value) => {
                if (!value) return {};
                if (typeof value !== 'string') return value;
                try { return JSON.parse(value) || {}; } catch { return {}; }
            };

            const storeConfig = parse(data.store_config);
            const emailConfig = parse(data.email_settings);
            setSettings(prev => ({
                ...prev,
                ...storeConfig,
                email_host: emailConfig.host ?? prev.email_host,
                email_port: emailConfig.port ?? prev.email_port,
                email_user: emailConfig.user,
                email_password: emailConfig.pass,
                email_secure: emailConfig.secure ?? prev.email_secure,
            }));
            setFeatures(resolveFeatures(parse(data.features)));

            const config = await loadShopConfiguration();
            setPrinters(config.printers);
            setLabels(config.labels);
            setScanner(config.scanner);
            setSku(config.sku);
            window.electronAPI.app.getInfo().then(setAppInfo).catch(() => { });
            loadCategories();
        } catch (error) {
            toast.error(t('common.loadFailed'));
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const emailConfig = () => ({
        host: settings.email_host,
        port: settings.email_port,
        user: settings.email_user,
        pass: settings.email_password,
        secure: settings.email_secure,
    });

    const handleSave = async () => {
        if (!String(settings.businessName || '').trim()) {
            toast.error(t('setup.shopNameRequired'));
            return;
        }
        setSaving(true);
        try {
            const storeConfig = {};
            for (const key of Object.keys(DEFAULT_SHOP)) storeConfig[key] = settings[key];
            // The application works in Algerian dinars only
            storeConfig.currency = 'DZD';
            storeConfig.currencySymbol = 'DA';
            storeConfig.taxRate = parseFloat(settings.taxRate) || 0;
            storeConfig.defaultLanguage = lang;
            storeConfig.poSignatureName = settings.poSignatureName || '';
            storeConfig.poSignatureTitle = settings.poSignatureTitle || '';
            storeConfig.poSignatureImage = settings.poSignatureImage || '';

            if (features.email) await window.electronAPI.settings.set({ key: 'email_settings', value: emailConfig() });
            await window.electronAPI.settings.set({ key: 'features', value: features });
            await saveShopConfiguration({ shop: storeConfig, printers, labels, scanner, sku });
            await reloadStoreSettings();
            toast.success(t('settings.saved'));
        } catch (error) {
            console.error('Save failed:', error);
            toast.error(t('settings.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const chooseLanguage = async (value) => {
        try {
            await setLanguage(value);
            handleChange('defaultLanguage', value);
        } catch (error) {
            toast.error(t('settings.saveFailed'));
            console.error(error);
        }
    };

    const testEmail = async () => {
        setSaving(true);
        try {
            await window.electronAPI.settings.set({ key: 'email_settings', value: emailConfig() });
            const result = await window.electronAPI.email.testConnection({
                smtp_host: settings.email_host,
                smtp_port: parseInt(settings.email_port, 10),
                smtp_user: settings.email_user,
                smtp_pass: settings.email_password,
                smtp_secure: settings.email_secure,
            });
            if (result.success) toast.success(t('settings.email.ok'));
            else toast.error(t('settings.email.failed', { error: result.message }));
        } catch (e) {
            toast.error(t('settings.saveFailed'));
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const handleExport = async () => {
        try {
            const result = await window.electronAPI.backup.create();
            if (result.success) toast.success(t('settings.backup.exported'));
            else if (!result.canceled) toast.error(t('settings.backup.exportFailed', { error: result.error }));
        } catch (error) {
            toast.error(t('settings.backup.exportFailed', { error: error.message }));
        }
    };

    const handleImport = async () => {
        try {
            const result = await window.electronAPI.backup.restore();
            if (result.success) {
                toast.success(t('settings.backup.restored'));
                setTimeout(() => window.location.reload(), 2000);
            } else if (!result.canceled) {
                toast.error(t('settings.backup.restoreFailed', { error: result.error }));
            }
        } catch (error) {
            toast.error(t('settings.backup.restoreFailed', { error: error.message }));
        }
    };

    const handleReset = async () => {
        try {
            const result = await window.electronAPI.backup.reset();
            if (result.success) {
                toast.success(t('settings.backup.resetDone'));
                setTimeout(() => window.location.reload(), 2000);
            } else {
                toast.error(t('settings.backup.resetFailed', { error: result.error }));
            }
        } catch (error) {
            toast.error(t('settings.backup.resetFailed', { error: error.message }));
        }
    };

    const selectSignature = async () => {
        try {
            const result = await window.electronAPI.dialog.selectImage();
            if (result.success && result.fileName) handleChange('poSignatureImage', result.fileName);
            else if (!result.canceled) toast.error(t('products.imageSaveFailed'));
        } catch {
            toast.error(t('products.imageSaveFailed'));
        }
    };

    const removeSignature = async () => {
        try {
            await window.electronAPI.images.delete(settings.poSignatureImage);
            handleChange('poSignatureImage', '');
        } catch {
            toast.error(t('common.error'));
        }
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const money = (amount) => formatMoney(amount, { lang });
    const sampleTotal = 4500;
    const sampleTax = settings.taxType === 'exclusive'
        ? Math.round(sampleTotal * (parseFloat(settings.taxRate) || 0)) / 100
        : 0;

    return (
        <div className="page">
            <PageHeader
                icon={SettingsIcon}
                title={t('nav.settings')}
                subtitle={t('settings.subtitle')}
                actions={(
                    <Button onClick={handleSave} loading={saving}>
                        <Save className="w-4 h-4" /> {t('common.saveChanges')}
                    </Button>
                )}
            />

            <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                {/* Sections */}
                <nav className="md:w-56 flex-none border-b md:border-b-0 md:border-e border-dark-border p-2 md:p-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto no-scrollbar">
                    {SECTION_GROUPS.map(group => {
                        const ids = group.ids.filter(id => tabIds.includes(id));
                        if (!ids.length) return null;
                        return (
                            <div key={group.id} className="flex md:flex-col gap-1 md:mb-3">
                                <p className="hidden md:block px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{t(`settings.group.${group.id}`)}</p>
                                {ids.map(id => {
                                    const Icon = SECTION_ICONS[id] || ToggleRight;
                                    return (
                                        <button key={id} type="button" onClick={() => setActiveTab(id)}
                                            title={t(`settings.tab.${id}`)} className={`sidebar-item whitespace-nowrap ${activeTab === id ? 'active' : ''}`}>
                                            <Icon className="w-4 h-4 flex-none" />
                                            <span className="truncate">{t(`settings.tab.${id}`)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </nav>

                <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
                    <div className="max-w-5xl">
                        {activeTab === 'business' && (
                            <Card className="space-y-6">
                                <SectionHeader icon={Building} color="bg-accent-primary/20 text-accent-primary" title={t('settings.shopTitle')} text={t('setup.shopText')} />
                                <ShopInfoForm value={settings} onChange={(next) => setSettings(next)} />
                            </Card>
                        )}

                        {activeTab === 'language' && (
                            <div className="space-y-4">
                                <Card className="space-y-6">
                                    <SectionHeader icon={Languages} color="bg-sky-500/20 text-sky-400" title={t('settings.language')} text={t('settings.languageText')} />
                                    <div className="grid grid-cols-3 gap-3">
                                        {LANGUAGES.map(l => (
                                            <button
                                                key={l.value}
                                                type="button"
                                                onClick={() => chooseLanguage(l.value)}
                                                className={`rounded-xl border-2 py-4 text-lg font-semibold transition-all
                                                    ${lang === l.value ? 'border-accent-primary bg-accent-primary/10 text-white' : 'border-dark-border text-zinc-300 hover:border-zinc-500'}`}
                                            >
                                                {l.label}
                                            </button>
                                        ))}
                                    </div>
                                </Card>
                                <Card className="space-y-6">
                                    <SectionHeader icon={Percent} color="bg-amber-500/20 text-amber-400" title={t('setup.taxTitle')} text={t('setup.taxText')} />
                                    <div className="rounded-lg bg-dark-tertiary px-4 py-3 text-sm">
                                        <span className="text-zinc-400">{t('settings.currency')} : </span>
                                        <span className="font-semibold">{t('settings.currencyDzd')}</span>
                                        <span className="text-zinc-500 ms-3 ltr inline-block">{money(2500)}</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <Input
                                            label={t('settings.taxName')}
                                            value={settings.taxName}
                                            onChange={(e) => handleChange('taxName', e.target.value)}
                                            placeholder="TVA"
                                        />
                                        <Input
                                            label={t('settings.taxRate')}
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={settings.taxRate}
                                            onChange={(e) => handleChange('taxRate', e.target.value)}
                                        />
                                        <Select
                                            label={t('settings.prices')}
                                            value={settings.taxType}
                                            onChange={(value) => handleChange('taxType', value)}
                                            options={[
                                                { value: 'inclusive', label: t('settings.taxInclusive') },
                                                { value: 'exclusive', label: t('settings.taxExclusive') },
                                            ]}
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        <span className="text-zinc-500">{t('settings.tvaPresets')}</span>
                                        {[0, 9, 19].map(rate => (
                                            <button key={rate} type="button" onClick={() => handleChange('taxRate', rate)}
                                                className={`px-3 h-8 rounded-full border tabular ${Number(settings.taxRate) === rate ? 'border-indigo-500 bg-indigo-500/15 text-white' : 'border-dark-border text-zinc-400 hover:text-white'}`}>
                                                {rate}%
                                            </button>
                                        ))}
                                        <span className="form-hint">{t('settings.tvaHint')}</span>
                                    </div>
                                </Card>
                            </div>
                        )}

                        {activeTab === 'receipt' && (
                            <Card className="space-y-6">
                                <SectionHeader icon={Receipt} color="bg-green-500/20 text-green-400" title={t('settings.receiptTitle')} text={t('settings.receiptText')} />
                                <div className="grid gap-4">
                                    <TextArea
                                        label={t('settings.receiptHeader')}
                                        value={settings.receiptHeader}
                                        onChange={(e) => handleChange('receiptHeader', e.target.value)}
                                    />
                                    <TextArea
                                        label={t('settings.receiptFooter')}
                                        value={settings.receiptFooter}
                                        onChange={(e) => handleChange('receiptFooter', e.target.value)}
                                        placeholder={t('settings.receiptFooterDefault')}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        {['settings.footer.exchange7', 'settings.footer.noReturn', 'settings.footer.keepTicket', 'settings.footer.thanks'].map(key => (
                                            <button key={key} type="button"
                                                onClick={() => handleChange('receiptFooter', [settings.receiptFooter, t(key)].filter(Boolean).join('\n'))}
                                                className="px-3 py-1.5 rounded-full border border-dark-border text-xs text-zinc-300 hover:border-indigo-500 hover:text-white">
                                                + {t(key)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Receipt preview */}
                                <div>
                                    <h4 className="text-sm font-medium text-zinc-400 mb-3">{t('products.preview')}</h4>
                                    <div className="bg-white text-black p-6 rounded-lg max-w-xs mx-auto text-center text-sm">
                                        <h3 className="font-bold text-lg mb-1">{settings.businessName || t('shop.name').replace(' *', '')}</h3>
                                        {settings.businessAddress && <p className="text-gray-600 text-xs">{settings.businessAddress}</p>}
                                        {(settings.businessCity || settings.businessWilaya) && (
                                            <p className="text-gray-600 text-xs">{[settings.businessCity, settings.businessWilaya].filter(Boolean).join(' — ')}</p>
                                        )}
                                        {settings.businessPhone && <p className="text-gray-600 text-xs ltr">{settings.businessPhone}</p>}
                                        {settings.receiptHeader && (
                                            <div className="border-t border-b border-gray-300 py-2 my-2">
                                                <p className="italic text-gray-600">{settings.receiptHeader}</p>
                                            </div>
                                        )}
                                        <div className="text-start my-4 space-y-1">
                                            <div className="flex justify-between gap-2">
                                                <span>T-shirt — {colorName('black')} / M × 1</span>
                                                <span className="ltr">{money(1500)}</span>
                                            </div>
                                            <div className="flex justify-between gap-2">
                                                <span>Jean — {colorName('navy')} / 40 × 1</span>
                                                <span className="ltr">{money(3000)}</span>
                                            </div>
                                        </div>
                                        <div className="border-t border-gray-300 pt-2 text-start">
                                            {sampleTax > 0 && (
                                                <div className="flex justify-between">
                                                    <span>{settings.taxName} ({settings.taxRate}%)</span>
                                                    <span className="ltr">{money(sampleTax)}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between font-bold mt-1">
                                                <span>{t('settings.preview.total')}</span>
                                                <span className="ltr">{money(sampleTotal + sampleTax)}</span>
                                            </div>
                                        </div>
                                        <div className="border-t border-gray-300 py-2 mt-4">
                                            <p className="italic text-gray-600">{settings.receiptFooter || t('settings.receiptFooterDefault')}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Purchase order signature */}
                                <div className="pt-4 border-t border-dark-border">
                                    <h4 className="font-medium text-zinc-300 mb-1">{t('settings.signature.title')}</h4>
                                    <p className="text-sm text-zinc-500 mb-4">{t('settings.signature.text')}</p>
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="w-48 h-24 border-2 border-dashed border-dark-border rounded-lg flex items-center justify-center bg-dark-tertiary overflow-hidden">
                                            {settings.poSignatureImage ? (
                                                <img src={`app://${settings.poSignatureImage}`} alt="" className="max-w-full max-h-full object-contain" />
                                            ) : (
                                                <span className="text-zinc-500 text-sm">{t('settings.signature.none')}</span>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <Button size="sm" variant="secondary" onClick={selectSignature}>
                                                <Upload className="w-4 h-4" /> {t('settings.signature.upload')}
                                            </Button>
                                            {settings.poSignatureImage && (
                                                <Button size="sm" variant="danger" onClick={removeSignature}>{t('common.delete')}</Button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label={t('settings.signature.name')}
                                            value={settings.poSignatureName || ''}
                                            onChange={(e) => handleChange('poSignatureName', e.target.value)}
                                        />
                                        <Input
                                            label={t('settings.signature.role')}
                                            value={settings.poSignatureTitle || ''}
                                            onChange={(e) => handleChange('poSignatureTitle', e.target.value)}
                                        />
                                    </div>
                                </div>
                            </Card>
                        )}

                        {activeTab === 'printers' && printers && (
                            <Card className="space-y-6">
                                <SectionHeader icon={Printer} color="bg-violet-500/20 text-violet-400" title={t('settings.tab.printers')} text={t('settings.printersText')} />
                                <PrinterSettingsForm
                                    printers={printers}
                                    onPrintersChange={setPrinters}
                                    labels={labels}
                                    onLabelsChange={setLabels}
                                />
                            </Card>
                        )}

                        {activeTab === 'scanner' && scanner && (
                            <Card className="space-y-6">
                                <SectionHeader icon={ScanLine} color="bg-emerald-500/20 text-emerald-400" title={t('settings.tab.scanner')} text={t('settings.scannerText')} />
                                <ScannerSettingsForm value={scanner} onChange={setScanner} />
                            </Card>
                        )}

                        {activeTab === 'sku' && sku && (
                            <Card className="space-y-6">
                                <SectionHeader icon={Hash} color="bg-amber-500/20 text-amber-400" title={t('settings.tab.sku')} text={t('settings.skuText')} />
                                <div className="grid grid-cols-3 gap-4">
                                    <Input
                                        label={t('settings.sku.prefix')}
                                        value={sku.prefix}
                                        className="ltr"
                                        onChange={(e) => setSku({ ...sku, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) })}
                                        placeholder="BA"
                                    />
                                    <Select
                                        label={t('settings.sku.separator')}
                                        value={sku.separator}
                                        onChange={(v) => setSku({ ...sku, separator: v })}
                                        options={[{ value: '-', label: '-' }, { value: '_', label: '_' }, { value: '.', label: '.' }]}
                                    />
                                    <Select
                                        label={t('settings.sku.digits')}
                                        value={String(sku.digits)}
                                        onChange={(v) => setSku({ ...sku, digits: parseInt(v, 10) })}
                                        options={[{ value: '2', label: '2 (01)' }, { value: '3', label: '3 (001)' }, { value: '4', label: '4 (0001)' }]}
                                    />
                                </div>
                                <div className="p-4 rounded-lg bg-dark-tertiary text-sm space-y-2">
                                    <p>{t('settings.sku.example', { color: colorName('black') })}</p>
                                    <p className="font-mono text-lg text-accent-primary ltr">
                                        {`${sku.prefix || ''}TSH${sku.separator}BLK${sku.separator}M${sku.separator}${'1'.padStart(sku.digits, '0')}`}
                                    </p>
                                    <p className="text-zinc-400">{t('settings.sku.explain')}</p>
                                </div>
                            </Card>
                        )}

                        {activeTab === 'catalog' && (
                            <div className="space-y-4">
                                <Card className="space-y-4">
                                    <SectionHeader icon={Shirt} color="bg-pink-500/20 text-pink-400" title={t('settings.tab.catalog')} text={t('settings.catalogText')} />
                                    <div className="grid grid-cols-3 gap-3">
                                        <Button variant="secondary" onClick={() => setShowCategories(true)}>
                                            <Shirt className="w-4 h-4" /> {t('products.manageCategories')} ({categories.length})
                                        </Button>
                                        <Button variant="secondary" onClick={() => navigate('/catalog?tab=brands')}>
                                            <Tags className="w-4 h-4" /> {t('brands.title')}
                                        </Button>
                                        <Button variant="secondary" onClick={() => navigate('/employees')}>
                                            <Users className="w-4 h-4" /> {t('nav.employees')}
                                        </Button>
                                    </div>
                                </Card>
                                <Card className="space-y-3">
                                    <h4 className="font-medium">{t('settings.colors')}</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {COLORS.map(c => (
                                            <span key={c.code} className="inline-flex items-center gap-2 rounded-full bg-dark-tertiary px-3 py-1 text-sm">
                                                <span className="w-3.5 h-3.5 rounded-full border border-zinc-600" style={{ background: c.hex }} />
                                                {colorName(c.code)}
                                            </span>
                                        ))}
                                    </div>
                                    <h4 className="font-medium pt-2">{t('settings.sizes')}</h4>
                                    <div className="space-y-2 text-sm">
                                        {SIZE_SETS.map(set => (
                                            <div key={set.code} className="flex gap-3">
                                                <span className="text-zinc-400 w-40 shrink-0">{sizeSetLabel(set)}</span>
                                                <span className="ltr text-zinc-200">{set.sizes.join(' · ')}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-zinc-500">{t('settings.colorsHint')}</p>
                                </Card>
                            </div>
                        )}

                        {activeTab === 'features' && (
                            <Card className="space-y-4">
                                <SectionHeader icon={ToggleRight} color="bg-indigo-500/20 text-indigo-400" title={t('settings.tab.features')} text={t('settings.featuresText')} />
                                {Object.keys(DEFAULT_FEATURES).map(key => (
                                    <label key={key} className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-lg bg-dark-tertiary">
                                        <input
                                            type="checkbox"
                                            checked={!!features[key]}
                                            onChange={(e) => setFeatures(prev => ({ ...prev, [key]: e.target.checked }))}
                                            className="mt-1 w-4 h-4 rounded bg-dark-tertiary border-dark-border"
                                        />
                                        <span>
                                            <span className="text-sm font-medium">{t(`settings.feature.${key}`)}</span>
                                            <span className="block text-xs text-zinc-500">{t(`settings.feature.${key}Hint`)}</span>
                                        </span>
                                    </label>
                                ))}
                                <p className="text-xs text-zinc-500">{t('settings.featuresSaveHint')}</p>
                            </Card>
                        )}

                        {activeTab === 'mail' && (
                            <Card className="space-y-6">
                                <SectionHeader icon={Mail} color="bg-indigo-500/20 text-indigo-400" title={t('settings.tab.mail')} text={t('settings.email.text')} />
                                <div className="grid gap-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input label={t('settings.email.host')} value={settings.email_host || ''} className="ltr"
                                            onChange={(e) => handleChange('email_host', e.target.value)} placeholder="smtp.gmail.com" />
                                        <Input label={t('settings.email.port')} type="number" value={settings.email_port || ''}
                                            onChange={(e) => handleChange('email_port', e.target.value)} placeholder="587" />
                                    </div>
                                    <Input label={t('settings.email.user')} value={settings.email_user || ''} className="ltr"
                                        onChange={(e) => handleChange('email_user', e.target.value)} />
                                    <Input label={t('settings.email.password')} type="password" value={settings.email_password || ''}
                                        onChange={(e) => handleChange('email_password', e.target.value)} />
                                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                                        <input type="checkbox" checked={settings.email_secure || false}
                                            onChange={(e) => handleChange('email_secure', e.target.checked)}
                                            className="w-4 h-4 rounded bg-dark-tertiary border-dark-border" />
                                        {t('settings.email.secure')}
                                    </label>
                                    <p className="text-xs text-zinc-500">{t('settings.email.secureHint')}</p>
                                    <div className="pt-4 border-t border-dark-border">
                                        <Button variant="secondary" onClick={testEmail}>{t('settings.email.test')}</Button>
                                    </div>
                                </div>
                            </Card>
                        )}

                        {activeTab === 'ecommerce' && (
                            <Card className="p-6">
                                <EcommerceSettings />
                            </Card>
                        )}

                        {activeTab === 'backup' && (
                            <div className="space-y-4">
                                <Card className="space-y-6">
                                    <SectionHeader icon={Database} color="bg-blue-500/20 text-blue-400" title={t('settings.backup.title')} text={t('settings.backup.text')} />
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 rounded-lg bg-dark-tertiary">
                                            <h4 className="font-medium mb-2">{t('settings.backup.export')}</h4>
                                            <p className="text-sm text-zinc-400 mb-4">{t('settings.backup.exportText')}</p>
                                            <Button variant="secondary" onClick={handleExport}>
                                                <Download className="w-4 h-4" /> {t('settings.backup.export')}
                                            </Button>
                                        </div>
                                        <div className="p-4 rounded-lg bg-dark-tertiary">
                                            <h4 className="font-medium mb-2">{t('settings.backup.restore')}</h4>
                                            <p className="text-sm text-zinc-400 mb-4">{t('settings.backup.restoreText')}</p>
                                            <Button variant="secondary" onClick={handleImport}>
                                                <Upload className="w-4 h-4" /> {t('settings.backup.restore')}
                                            </Button>
                                        </div>
                                    </div>
                                </Card>

                                <Card className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <Lock className="w-5 h-5 text-zinc-300" />
                                        <span className="font-semibold">{t('settings.db.local')}</span>
                                        <CheckCircle className="w-5 h-5 text-accent-primary ms-auto" />
                                    </div>
                                    <p className="text-sm text-zinc-400">{t('settings.db.localText')}</p>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="p-3 rounded-lg bg-dark-tertiary">
                                            <p className="text-zinc-400">{t('settings.db.version')}</p>
                                            <p className="font-medium ltr">{appInfo?.version || '-'}</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-dark-tertiary">
                                            <p className="text-zinc-400">{t('settings.db.file')}</p>
                                            <p className="font-medium font-mono text-xs break-all ltr">{appInfo?.databasePath || 'SQLite'}</p>
                                        </div>
                                    </div>
                                </Card>

                                <Card>
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <h4 className="font-medium">{t('settings.backup.reset')}</h4>
                                            <p className="text-sm text-zinc-400">{t('settings.backup.resetText')}</p>
                                        </div>
                                        <Button variant="danger" onClick={() => setShowResetConfirm(true)}>
                                            {t('settings.backup.resetButton')}
                                        </Button>
                                    </div>
                                </Card>
                            </div>
                        )}

                        {activeTab === 'logs' && (
                            <div className="space-y-6">
                                <h2 className="text-xl font-bold">{t('settings.tab.logs')}</h2>
                                <SystemLogs />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <CategoryManagerModal
                isOpen={showCategories}
                onClose={() => setShowCategories(false)}
                categories={categories}
                onSave={loadCategories}
            />

            <ConfirmDialog
                isOpen={showResetConfirm}
                onClose={() => setShowResetConfirm(false)}
                onConfirm={handleReset}
                title={t('settings.backup.reset')}
                message={t('settings.backup.resetConfirm')}
                confirmText={t('settings.backup.resetButton')}
                variant="danger"
            />
        </div>
    );
}
