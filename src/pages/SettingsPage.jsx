import { useState, useEffect } from 'react';
import { Building, Receipt, Percent, Database, Save, Download, Upload, Mail, Cloud, Lock, CheckCircle, Printer, ScanLine, Hash } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, TextArea } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Tabs } from '../components/ui/Tabs';
import { toast } from '../components/ui/Toast';
import { useAuthStore } from '../stores/authStore';
import { currencies } from '../data/currencies';
import { ShopInfoForm } from '../components/settings/ShopInfoForm';
import { PrinterSettingsForm } from '../components/settings/PrinterSettingsForm';
import { ScannerSettingsForm } from '../components/settings/ScannerSettingsForm';
import { DEFAULT_SHOP, LANGUAGES, loadShopConfiguration, saveShopConfiguration } from '../lib/shopSettings';
import { useSettingsStore } from '../stores/settingsStore';
import { SystemLogs } from '../components/settings/SystemLogs';
import { EcommerceSettings } from '../components/settings/EcommerceSettings';


const baseTabs = [
    { id: 'business', label: 'Shop' },
    { id: 'tax', label: 'Tax & Currency' },
    { id: 'receipt', label: 'Receipt' },
    { id: 'printers', label: 'Printers & Labels' },
    { id: 'scanner', label: 'Scanner' },
    { id: 'sku', label: 'SKU / QR' },
    { id: 'mail', label: 'Email Settings' },
    { id: 'cloud', label: 'Sync' },
    { id: 'ecommerce', label: 'E-commerce' },
    { id: 'backup', label: 'Backup' },
];

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState('business');
    const [settings, setSettings] = useState({
        businessName: '',
        businessAddress: '',
        businessPhone: '',
        businessEmail: '',
        taxRate: 10,
        taxName: 'Tax',
        taxType: 'exclusive', // 'exclusive' or 'inclusive'
        currency: 'USD',
        currencySymbol: '$',
        receiptHeader: '',
        receiptFooter: '',
        email_host: 'smtp.gmail.com',
        email_port: 587,
        email_secure: false,
        sync_provider: 'none', // only 'none' (local) is available
        sync_interval: '0', // 0 = Realtime/Instant, 5, 15, 30, 60
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    // Printer, label, scanner and SKU configuration (separate settings keys)
    const [printers, setPrinters] = useState(null);
    const [labels, setLabels] = useState({});
    const [scanner, setScanner] = useState(null);
    const [sku, setSku] = useState(null);
    const [appInfo, setAppInfo] = useState(null);
    const reloadStoreSettings = useSettingsStore(state => state.loadSettings);



    const { isAdmin } = useAuthStore();
    const tabs = isAdmin ? [...baseTabs, { id: 'logs', label: 'System Logs' }] : baseTabs;



    // Load initial settings
    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const data = await window.electronAPI.settings.getAll();

            // Parse nested JSON settings
            let parsedSettings = { ...data };

            if (data.store_config) {
                try {
                    const storeConfig = typeof data.store_config === 'string'
                        ? JSON.parse(data.store_config)
                        : data.store_config;
                    parsedSettings = { ...parsedSettings, ...storeConfig };
                } catch (e) { console.error('Failed to parse store_config', e); }
            }



            if (data.email_settings) {
                try {
                    const emailConfig = typeof data.email_settings === 'string'
                        ? JSON.parse(data.email_settings)
                        : data.email_settings;
                    parsedSettings = {
                        ...parsedSettings,
                        email_host: emailConfig.host,
                        email_port: emailConfig.port,
                        email_user: emailConfig.user,
                        email_password: emailConfig.pass,
                        email_secure: emailConfig.secure
                    };
                } catch (e) { console.error('Failed to parse email_settings', e); }
            }

            if (data.sync_settings) {
                try {
                    const syncConfig = typeof data.sync_settings === 'string'
                        ? JSON.parse(data.sync_settings)
                        : data.sync_settings;
                    parsedSettings = {
                        ...parsedSettings,
                        sync_provider: syncConfig.provider || 'none',
                        sync_interval: syncConfig.interval || '0'
                    };
                } catch (e) { console.error('Failed to parse sync_settings', e); }
            }

            setSettings(prev => ({ ...prev, ...DEFAULT_SHOP, ...parsedSettings }));

            const config = await loadShopConfiguration();
            setPrinters(config.printers);
            setLabels(config.labels);
            setScanner(config.scanner);
            setSku(config.sku);
            window.electronAPI.app.getInfo().then(setAppInfo).catch(() => { });
        } catch (error) {
            toast.error('Failed to load settings');
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Group settings into JSON blobs
            if (!String(settings.businessName || '').trim()) {
                toast.error('The shop name cannot be empty');
                setSaving(false);
                return;
            }
            const storeConfig = {};
            for (const key of Object.keys(DEFAULT_SHOP)) storeConfig[key] = settings[key];
            storeConfig.poSignatureName = settings.poSignatureName || '';
            storeConfig.poSignatureTitle = settings.poSignatureTitle || '';
            storeConfig.poSignatureImage = settings.poSignatureImage || '';

            const emailConfig = {
                host: settings.email_host,
                port: settings.email_port,
                user: settings.email_user,
                pass: settings.email_password,
                secure: settings.email_secure,
            };

            const syncConfig = {
                provider: settings.sync_provider,
                interval: settings.sync_interval
            };

            // Save structured data
            await window.electronAPI.settings.set({ key: 'email_settings', value: emailConfig });
            await window.electronAPI.settings.set({ key: 'sync_settings', value: syncConfig });
            await saveShopConfiguration({ shop: storeConfig, printers, labels, scanner, sku });
            await reloadStoreSettings();

            console.log('Settings saved successfully');
            toast.success('Settings saved');
        } catch (error) {
            console.error('Save failed:', error);
            toast.error('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };


    const handleExport = async () => {
        try {
            const result = await window.electronAPI.backup.create();
            if (result.success) {
                toast.success('Backup exported successfully');
            } else if (!result.canceled) {
                toast.error(`Export failed: ${result.error}`);
            }
        } catch (error) {
            toast.error('Failed to export backup');
            console.error(error);
        }
    };

    const handleImport = async () => {
        try {
            const result = await window.electronAPI.backup.restore();
            if (result.success) {
                toast.success('Backup restored successfully');
                setTimeout(() => window.location.reload(), 2000);
            } else if (!result.canceled) {
                toast.error(`Import failed: ${result.error}`);
            }
        } catch (error) {
            toast.error('Failed to import backup');
            console.error(error);
        }
    };

    const handleReset = async () => {
        try {
            const result = await window.electronAPI.backup.reset();
            if (result.success) {
                toast.success('Database reset successfully');
                setTimeout(() => window.location.reload(), 2000);
            } else {
                toast.error(`Reset failed: ${result.error}`);
            }
        } catch (error) {
            toast.error('Failed to reset database');
            console.error(error);
        }
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-dark-border">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Settings</h1>
                        <p className="text-zinc-500">Configure your POS system</p>
                    </div>
                    <Button onClick={handleSave} loading={saving}>
                        <Save className="w-4 h-4" />
                        Save Changes
                    </Button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto">
                    <Tabs tabs={tabs} defaultTab={activeTab} onChange={setActiveTab} />

                    <div className="mt-6">
                        {activeTab === 'business' && (
                            <Card className="space-y-6">
                                <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                    <div className="p-3 rounded-lg bg-accent-primary/20">
                                        <Building className="w-6 h-6 text-accent-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">Shop information</h3>
                                        <p className="text-sm text-zinc-400">Name, logo and contact details used on receipts, labels and the sales screen</p>
                                    </div>
                                </div>
                                <ShopInfoForm value={settings} onChange={(next) => setSettings(next)} />
                            </Card>
                        )}

                        {activeTab === 'tax' && (
                            <Card className="space-y-6">
                                <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                    <div className="p-3 rounded-lg bg-amber-500/20">
                                        <Percent className="w-6 h-6 text-amber-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">Tax Settings</h3>
                                        <p className="text-sm text-zinc-400">Configure tax rates and currency</p>
                                    </div>
                                </div>

                                <div className="grid gap-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="Tax Name"
                                            value={settings.taxName}
                                            onChange={(e) => handleChange('taxName', e.target.value)}
                                            placeholder="VAT, GST, Sales Tax"
                                        />
                                        <Select
                                            label="Tax Type"
                                            value={settings.taxType}
                                            onChange={(value) => handleChange('taxType', value)}
                                            options={[
                                                { value: 'exclusive', label: 'Exclusive (Added to price)' },
                                                { value: 'inclusive', label: 'Inclusive (Included in price)' },
                                            ]}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="Default Tax Rate (%)"
                                            type="number"
                                            step="0.1"
                                            value={settings.taxRate}
                                            onChange={(e) => handleChange('taxRate', parseFloat(e.target.value) || 0)}
                                            placeholder="10"
                                        />
                                        <Select
                                            label="Currency"
                                            value={settings.currency}
                                            onChange={(value) => {
                                                const selected = currencies.find(c => c.code === value);
                                                handleChange('currency', value);
                                                if (selected) {
                                                    handleChange('currencySymbol', selected.symbol);
                                                }
                                            }}
                                            options={currencies.map(c => ({
                                                value: c.code,
                                                label: `${c.code} - ${c.name} (${c.symbol})`
                                            }))}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="Currency Symbol"
                                            value={settings.currencySymbol}
                                            onChange={(e) => handleChange('currencySymbol', e.target.value)}
                                            placeholder="$"
                                        />
                                        <Select
                                            label="Default language for documents"
                                            value={settings.defaultLanguage || 'en'}
                                            onChange={(value) => handleChange('defaultLanguage', value)}
                                            options={LANGUAGES}
                                        />
                                    </div>
                                </div>
                            </Card>
                        )}

                        {activeTab === 'mail' && (
                            <Card className="space-y-6">
                                <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                    <div className="p-3 rounded-lg bg-indigo-500/20">
                                        <Mail className="w-6 h-6 text-indigo-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">Email Settings</h3>
                                        <p className="text-sm text-zinc-400">Configure SMTP for sending receipts</p>
                                    </div>
                                </div>

                                <div className="grid gap-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="SMTP Host"
                                            value={settings.email_host || ''}
                                            onChange={(e) => handleChange('email_host', e.target.value)}
                                            placeholder="smtp.gmail.com"
                                        />
                                        <Input
                                            label="SMTP Port"
                                            type="number"
                                            value={settings.email_port || ''}
                                            onChange={(e) => handleChange('email_port', e.target.value)}
                                            placeholder="587"
                                        />
                                    </div>
                                    <Input
                                        label="SMTP User / Email"
                                        value={settings.email_user || ''}
                                        onChange={(e) => handleChange('email_user', e.target.value)}
                                        placeholder="your-email@gmail.com"
                                    />
                                    <Input
                                        label="SMTP Password / App Password"
                                        type="password"
                                        value={settings.email_password || ''}
                                        onChange={(e) => handleChange('email_password', e.target.value)}
                                        placeholder="App Password"
                                    />
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="secure"
                                            checked={settings.email_secure || false}
                                            onChange={(e) => handleChange('email_secure', e.target.checked)}
                                            className="w-4 h-4 rounded bg-dark-tertiary border-dark-border"
                                        />
                                        <label htmlFor="secure" className="text-sm text-zinc-300">Use Secure Connection (SSL/TLS)</label>
                                    </div>
                                    <p className="text-xs text-zinc-500 ml-6">
                                        For Gmail/Outlook on Port 587: <strong>Uncheck</strong> this. <br />
                                        For Port 465: <strong>Check</strong> this.
                                    </p>

                                    <div className="pt-4 border-t border-dark-border">
                                        <Button
                                            variant="secondary"
                                            onClick={async () => {
                                                setSaving(true);
                                                try {
                                                    // Save email settings properly
                                                    const emailConfig = {
                                                        host: settings.email_host,
                                                        port: settings.email_port,
                                                        user: settings.email_user,
                                                        pass: settings.email_password,
                                                        secure: settings.email_secure,
                                                    };

                                                    await window.electronAPI.settings.set({
                                                        key: 'email_settings',
                                                        value: JSON.stringify(emailConfig)
                                                    });

                                                    // Test connection
                                                    const result = await window.electronAPI.email.testConnection({
                                                        smtp_host: settings.email_host,
                                                        smtp_port: parseInt(settings.email_port),
                                                        smtp_user: settings.email_user,
                                                        smtp_pass: settings.email_password,
                                                        smtp_secure: settings.email_secure
                                                    });

                                                    if (result.success) {
                                                        toast.success('Settings saved and connection verified!');
                                                    } else {
                                                        toast.error(`Settings saved but connection failed: ${result.message}`);
                                                        console.error('SMTP Error:', result.message);
                                                    }
                                                } catch (e) {
                                                    toast.error('Failed to save settings');
                                                    console.error(e);
                                                } finally {
                                                    setSaving(false);
                                                }
                                            }}
                                        >
                                            Save & Test Connection
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        )}


                        {activeTab === 'cloud' && (
                            <Card className="space-y-6">
                                <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                    <div className="p-3 rounded-lg bg-sky-500/20">
                                        <Cloud className="w-6 h-6 text-sky-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">Data &amp; synchronization</h3>
                                        <p className="text-sm text-zinc-400">How this POS stores its data</p>
                                    </div>
                                </div>
                                <div className="p-4 rounded-xl border-2 border-accent-primary bg-accent-primary/10">
                                    <div className="flex items-center justify-between mb-2">
                                        <Lock className="w-5 h-5 text-zinc-300" />
                                        <CheckCircle className="w-5 h-5 text-accent-primary" />
                                    </div>
                                    <div className="font-semibold">Local mode (active)</div>
                                    <div className="text-sm text-zinc-400 mt-1">
                                        All products, sales, customers and settings are stored in a database on this computer.
                                        The POS works without internet and without any account.
                                    </div>
                                    {appInfo && (
                                        <div className="text-xs text-zinc-500 mt-3 font-mono break-all">{appInfo.databasePath}</div>
                                    )}
                                </div>
                                <div className="p-4 rounded-lg bg-dark-tertiary border border-dark-border text-sm text-zinc-400 space-y-2">
                                    <p className="font-medium text-zinc-300">Online store (future)</p>
                                    <p>
                                        An online store can later be connected through a secure synchronization service. The website will
                                        never access this computer&apos;s database directly; this POS will remain the main record of stock and sales.
                                    </p>
                                    <p>No synchronization service is configured. Use the Backup tab to keep copies of your data.</p>
                                </div>
                            </Card>
                        )}

                        {activeTab === 'printers' && printers && (
                            <Card className="space-y-6">
                                <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                    <div className="p-3 rounded-lg bg-violet-500/20">
                                        <Printer className="w-6 h-6 text-violet-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">Printers &amp; labels</h3>
                                        <p className="text-sm text-zinc-400">Receipt printer, QR label printer and label layout (sizes in millimetres)</p>
                                    </div>
                                </div>
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
                                <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                    <div className="p-3 rounded-lg bg-emerald-500/20">
                                        <ScanLine className="w-6 h-6 text-emerald-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">Barcode / QR scanner</h3>
                                        <p className="text-sm text-zinc-400">Standard USB scanners (keyboard mode) work without drivers or internet</p>
                                    </div>
                                </div>
                                <ScannerSettingsForm value={scanner} onChange={setScanner} />
                            </Card>
                        )}

                        {activeTab === 'sku' && sku && (
                            <Card className="space-y-6">
                                <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                    <div className="p-3 rounded-lg bg-amber-500/20">
                                        <Hash className="w-6 h-6 text-amber-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">SKU &amp; QR identifiers</h3>
                                        <p className="text-sm text-zinc-400">How automatic SKUs are built for product variants</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <Input
                                        label="Prefix (optional)"
                                        value={sku.prefix}
                                        onChange={(e) => setSku({ ...sku, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) })}
                                        placeholder="e.g. BA"
                                    />
                                    <Select
                                        label="Separator"
                                        value={sku.separator}
                                        onChange={(v) => setSku({ ...sku, separator: v })}
                                        options={[{ value: '-', label: 'Dash ( - )' }, { value: '_', label: 'Underscore ( _ )' }, { value: '.', label: 'Dot ( . )' }]}
                                    />
                                    <Select
                                        label="Number digits"
                                        value={String(sku.digits)}
                                        onChange={(v) => setSku({ ...sku, digits: parseInt(v, 10) })}
                                        options={[{ value: '2', label: '2 (01)' }, { value: '3', label: '3 (001)' }, { value: '4', label: '4 (0001)' }]}
                                    />
                                </div>
                                <div className="p-4 rounded-lg bg-dark-tertiary text-sm space-y-2">
                                    <p>Example for “T-Shirt”, colour Black, size M:</p>
                                    <p className="font-mono text-lg text-accent-primary">
                                        {`${sku.prefix || ''}TSH${sku.separator}BLK${sku.separator}M${sku.separator}${'1'.padStart(sku.digits, '0')}`}
                                    </p>
                                    <p className="text-zinc-400">
                                        SKUs are generated once, when a variant is created, and are never reused. The QR code printed on a
                                        label contains only this identifier (not the price or stock), so prices can change without reprinting labels.
                                        Allowed characters: A–Z, 0–9, “-”, “_” and “.”.
                                    </p>
                                </div>
                            </Card>
                        )}

                        {activeTab === 'ecommerce' && (
                            <Card className="p-6">
                                <EcommerceSettings />
                            </Card>
                        )}

                        {activeTab === 'receipt' && (
                            <Card className="space-y-6">
                                <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                    <div className="p-3 rounded-lg bg-green-500/20">
                                        <Receipt className="w-6 h-6 text-green-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">Receipt Customization</h3>
                                        <p className="text-sm text-zinc-400">Customize your receipt appearance</p>
                                    </div>
                                </div>

                                <div className="grid gap-4">
                                    <TextArea
                                        label="Receipt Header Message"
                                        value={settings.receiptHeader}
                                        onChange={(e) => handleChange('receiptHeader', e.target.value)}
                                        placeholder="Thank you for shopping with us!"
                                    />
                                    <TextArea
                                        label="Receipt Footer Message"
                                        value={settings.receiptFooter}
                                        onChange={(e) => handleChange('receiptFooter', e.target.value)}
                                        placeholder="Please come again! Returns accepted within 30 days."
                                    />

                                    {/* Purchase Order Signature Section */}
                                    <div className="pt-4 border-t border-dark-border">
                                        <h4 className="font-medium text-zinc-300 mb-3">Purchase Order Signature</h4>
                                        <p className="text-sm text-zinc-500 mb-4">Upload a signature image and enter signatory details for Purchase Order PDFs.</p>

                                        {/* Signature Image Upload */}
                                        <div className="mb-4">
                                            <label className="block text-sm font-medium text-zinc-300 mb-2">Signature Image</label>
                                            <div className="flex items-center gap-4">
                                                <div className="w-48 h-24 border-2 border-dashed border-dark-border rounded-lg flex items-center justify-center bg-dark-tertiary overflow-hidden">
                                                    {settings.poSignatureImage ? (
                                                        <img
                                                            src={`app://${settings.poSignatureImage}`}
                                                            alt="Signature"
                                                            className="max-w-full max-h-full object-contain"
                                                        />
                                                    ) : (
                                                        <span className="text-zinc-500 text-sm">No signature</span>
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        onClick={async () => {
                                                            try {
                                                                const result = await window.electronAPI.dialog.selectImage();
                                                                if (result.success && result.fileName) {
                                                                    handleChange('poSignatureImage', result.fileName);
                                                                    toast.success('Signature image uploaded');
                                                                } else if (!result.canceled) {
                                                                    toast.error('Failed to upload image');
                                                                }
                                                            } catch (error) {
                                                                toast.error('Failed to select image');
                                                            }
                                                        }}
                                                    >
                                                        <Upload className="w-4 h-4 mr-2" />
                                                        Upload Image
                                                    </Button>
                                                    {settings.poSignatureImage && (
                                                        <Button
                                                            size="sm"
                                                            variant="danger"
                                                            onClick={async () => {
                                                                try {
                                                                    await window.electronAPI.images.delete(settings.poSignatureImage);
                                                                    handleChange('poSignatureImage', '');
                                                                    toast.success('Signature image removed');
                                                                } catch (error) {
                                                                    toast.error('Failed to remove image');
                                                                }
                                                            }}
                                                        >
                                                            Remove
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                            <p className="text-xs text-zinc-500 mt-2">Recommended: PNG with transparent background, 300x100 pixels</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <Input
                                                label="Signatory Name"
                                                value={settings.poSignatureName || ''}
                                                onChange={(e) => handleChange('poSignatureName', e.target.value)}
                                                placeholder="John Doe"
                                            />
                                            <Input
                                                label="Signatory Title"
                                                value={settings.poSignatureTitle || ''}
                                                onChange={(e) => handleChange('poSignatureTitle', e.target.value)}
                                                placeholder="Purchasing Manager"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Receipt Preview */}
                                <div>
                                    <h4 className="text-sm font-medium text-zinc-400 mb-3">Preview</h4>
                                    <div className="bg-white text-black p-6 rounded-lg max-w-xs mx-auto text-center text-sm">
                                        <h3 className="font-bold text-lg mb-1">{settings.businessName || 'Business Name'}</h3>
                                        <p className="text-gray-600 text-xs mb-2">{settings.businessAddress || 'Business Address'}</p>
                                        <p className="text-gray-600 text-xs mb-4">{settings.businessPhone || 'Phone'}</p>
                                        <div className="border-t border-b border-gray-300 py-2 my-2">
                                            <p className="italic text-gray-600">{settings.receiptHeader || 'Header message'}</p>
                                        </div>
                                        <div className="text-left my-4 space-y-1">
                                            <div className="flex justify-between">
                                                <span>Sample Item x1</span>
                                                <span>{settings.currencySymbol}10.00</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Another Item x2</span>
                                                <span>{settings.currencySymbol}20.00</span>
                                            </div>
                                        </div>
                                        <div className="border-t border-gray-300 pt-2 text-left">
                                            <div className="flex justify-between">
                                                <span>Subtotal</span>
                                                <span>{settings.currencySymbol}30.00</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Tax ({settings.taxRate}%)</span>
                                                <span>{settings.currencySymbol}3.00</span>
                                            </div>
                                            <div className="flex justify-between font-bold mt-1">
                                                <span>Total</span>
                                                <span>{settings.currencySymbol}33.00</span>
                                            </div>
                                        </div>
                                        <div className="border-t border-gray-300 py-2 mt-4">
                                            <p className="italic text-gray-600">{settings.receiptFooter || 'Footer message'}</p>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        )}

                        {activeTab === 'backup' && (
                            <div className="space-y-4">
                                <Card className="space-y-6">
                                    <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                        <div className="p-3 rounded-lg bg-blue-500/20">
                                            <Database className="w-6 h-6 text-blue-400" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold">Database Backup</h3>
                                            <p className="text-sm text-zinc-400">Export and import your POS data</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 rounded-lg bg-dark-tertiary">
                                            <h4 className="font-medium mb-2">Export Data</h4>
                                            <p className="text-sm text-zinc-400 mb-4">
                                                Create a backup of all your products, customers, sales, and settings.
                                            </p>
                                            <Button variant="secondary" onClick={handleExport}>
                                                <Download className="w-4 h-4" />
                                                Export Backup
                                            </Button>
                                        </div>
                                        <div className="p-4 rounded-lg bg-dark-tertiary">
                                            <h4 className="font-medium mb-2">Import Data</h4>
                                            <p className="text-sm text-zinc-400 mb-4">
                                                Restore data from a previous backup file.
                                            </p>
                                            <Button variant="secondary" onClick={handleImport}>
                                                <Upload className="w-4 h-4" />
                                                Import Backup
                                            </Button>
                                        </div>
                                    </div>
                                </Card>

                                <Card>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="font-medium">Reset Database</h4>
                                            <p className="text-sm text-zinc-400">
                                                Clear all data and start fresh. This cannot be undone.
                                            </p>
                                        </div>
                                        <Button
                                            variant="danger"
                                            onClick={() => setShowResetConfirm(true)}
                                        >
                                            Reset All Data
                                        </Button>
                                    </div>
                                </Card>

                                <Card>
                                    <h4 className="font-medium mb-4">System Information</h4>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="p-3 rounded-lg bg-dark-tertiary">
                                            <p className="text-zinc-400">App Version</p>
                                            <p className="font-medium">{appInfo?.version || '-'}</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-dark-tertiary">
                                            <p className="text-zinc-400">Database (local SQLite)</p>
                                            <p className="font-medium font-mono text-xs break-all">{appInfo?.databasePath || 'SQLite'}</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-dark-tertiary">
                                            <p className="text-zinc-400">Platform</p>
                                            <p className="font-medium">Electron</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-dark-tertiary">
                                            <p className="text-zinc-400">Framework</p>
                                            <p className="font-medium">React + Vite</p>
                                        </div>
                                    </div>
                                </Card>
                            </div>
                        )}

                        {activeTab === 'logs' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="flex justify-between items-center">
                                    <h2 className="text-xl font-bold">System Logs (Audit Trail)</h2>
                                </div>
                                <SystemLogs />
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {/* Reset Confirmation */}
            <ConfirmDialog
                isOpen={showResetConfirm}
                onClose={() => setShowResetConfirm(false)}
                onConfirm={handleReset}
                title="Reset Database"
                message="Are you sure you want to reset the database? This will delete ALL data including products, sales, and customers. This action cannot be undone."
                confirmText="Reset Everything"
                variant="danger"
            />
        </div >
    );
}
