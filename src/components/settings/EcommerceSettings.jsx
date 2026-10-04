import { t } from '../../i18n';
import { useState, useEffect } from 'react';
import { ShoppingBag, Link, Unlink, RefreshCw, Check, X, AlertTriangle, ChevronRight, Store, Plus, Trash2, ArrowLeftRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { formatDate as formatLocalDate } from '../../i18n/format';

// Platform configurations
const PLATFORMS = {
    shopify: {
        name: 'Shopify',
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        borderColor: 'border-green-500/30',
        description: 'Connect your Shopify store for real-time inventory sync',
        // Connects directly with a Shopify custom-app Admin API access token;
        // no third-party relay server is involved.
        fields: [
            { key: 'storeUrl', label: 'Store URL', placeholder: 'your-store.myshopify.com', type: 'text', required: true },
            { key: 'accessToken', label: 'Admin API access token', placeholder: 'shpat_xxxxxxxx', type: 'password', required: true },
        ],
        helpUrl: 'https://help.shopify.com/en/manual/apps/custom-apps'
    },
    woocommerce: {
        name: 'WooCommerce',
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/20',
        borderColor: 'border-purple-500/30',
        description: 'Sync inventory with your WooCommerce WordPress store',
        fields: [
            { key: 'storeUrl', label: 'Store URL', placeholder: 'https://your-store.com', type: 'text', required: true },
            { key: 'apiKey', label: 'Consumer Key', placeholder: 'ck_xxxxxxxx', type: 'text', required: true },
            { key: 'apiSecret', label: 'Consumer Secret', placeholder: 'cs_xxxxxxxx', type: 'password', required: true },
        ],
        helpUrl: 'https://woocommerce.com/document/woocommerce-rest-api/'
    }
};

export function EcommerceSettings() {
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState({});
    const [showAddModal, setShowAddModal] = useState(false);
    const [showMappingModal, setShowMappingModal] = useState(false);
    const [selectedPlatform, setSelectedPlatform] = useState(null);
    const [selectedConnection, setSelectedConnection] = useState(null);
    const [mappings, setMappings] = useState([]);
    const [unmappedProducts, setUnmappedProducts] = useState([]);
    const [formData, setFormData] = useState({});
    const [connecting, setConnecting] = useState(false);
    const [autoMapping, setAutoMapping] = useState(false);

    useEffect(() => {
        loadConnections();
    }, []);

    const loadConnections = async () => {
        try {
            const data = await window.electronAPI.ecommerce.getConnections();
            setConnections(data || []);
        } catch (error) {
            console.error('Failed to load connections:', error);
            toast.error(t('ecommerce.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handleAddConnection = async () => {
        if (!selectedPlatform) return;

        const platform = PLATFORMS[selectedPlatform];
        
        // Validate required fields
        for (const field of platform.fields) {
            if (field.required && !formData[field.key]) {
                toast.error(t('ecommerce.fieldRequired', { field: t(`ecommerce.field.${field.key}`) }));
                return;
            }
        }

        setConnecting(true);
        try {
            const result = await window.electronAPI.ecommerce.addConnection({
                platform: selectedPlatform,
                storeUrl: formData.storeUrl,
                apiKey: formData.apiKey,
                apiSecret: formData.apiSecret,
                accessToken: formData.accessToken,
            });

            if (result.success) {
                if (result.testResult?.success) {
                    toast.success(t('ecommerce.connected', { name: result.testResult.details?.shopName || platform.name }));
                } else {
                    toast.warning(t('ecommerce.savedTestFailed', { message: result.testResult?.message }));
                }
                await loadConnections();
                setShowAddModal(false);
                setFormData({});
                setSelectedPlatform(null);
            } else {
                toast.error(result.message || t('ecommerce.addFailed'));
            }
        } catch (error) {
            console.error('Failed to add connection:', error);
            toast.error(t('ecommerce.addFailed'));
        } finally {
            setConnecting(false);
        }
    };

    const handleRemoveConnection = async (connectionId) => {
        if (!confirm(t('ecommerce.removeConfirm'))) {
            return;
        }

        try {
            await window.electronAPI.ecommerce.removeConnection(connectionId);
            toast.success(t('ecommerce.removed'));
            await loadConnections();
        } catch (error) {
            toast.error(t('ecommerce.removeFailed'));
        }
    };

    const handleSync = async (connectionId) => {
        setSyncing(prev => ({ ...prev, [connectionId]: true }));
        try {
            const result = await window.electronAPI.ecommerce.sync(connectionId);
            if (result.success) {
                toast.success(t('ecommerce.syncDone', { pushed: result.results?.pushed || 0, pulled: result.results?.pulled || 0 }));
            } else {
                toast.error(result.message || t('ecommerce.syncFailed'));
            }
            await loadConnections();
        } catch (error) {
            toast.error(t('ecommerce.syncFailed'));
        } finally {
            setSyncing(prev => ({ ...prev, [connectionId]: false }));
        }
    };

    const handleTestConnection = async (connectionId) => {
        setSyncing(prev => ({ ...prev, [connectionId]: true }));
        try {
            const result = await window.electronAPI.ecommerce.testConnection(connectionId);
            if (result.success) {
                toast.success(t('ecommerce.testOk', { message: result.message }));
            } else {
                toast.error(t('ecommerce.testFailed', { message: result.message }));
            }
        } catch (error) {
            toast.error(t('ecommerce.testError'));
        } finally {
            setSyncing(prev => ({ ...prev, [connectionId]: false }));
        }
    };

    const openMappingModal = async (connection) => {
        setSelectedConnection(connection);
        setShowMappingModal(true);
        
        try {
            const [mappingsData, unmappedData] = await Promise.all([
                window.electronAPI.ecommerce.getMappings(connection.id),
                window.electronAPI.ecommerce.getUnmappedProducts(connection.id)
            ]);
            setMappings(mappingsData || []);
            setUnmappedProducts(unmappedData || []);
        } catch (error) {
            toast.error(t('ecommerce.mappingsFailed'));
        }
    };

    const handleAutoMap = async () => {
        if (!selectedConnection) return;
        
        setAutoMapping(true);
        try {
            const result = await window.electronAPI.ecommerce.autoMapProducts(selectedConnection.id);
            if (result.success) {
                toast.success(t('ecommerce.autoMapped', { n: result.results?.mapped || 0 }));
                // Reload mappings
                const [mappingsData, unmappedData] = await Promise.all([
                    window.electronAPI.ecommerce.getMappings(selectedConnection.id),
                    window.electronAPI.ecommerce.getUnmappedProducts(selectedConnection.id)
                ]);
                setMappings(mappingsData || []);
                setUnmappedProducts(unmappedData || []);
            } else {
                toast.error(t('ecommerce.autoMapFailed'));
            }
        } catch (error) {
            toast.error(t('ecommerce.autoMapFailed'));
        } finally {
            setAutoMapping(false);
        }
    };

    const handleDeleteMapping = async (mappingId) => {
        try {
            await window.electronAPI.ecommerce.deleteMapping(mappingId);
            toast.success(t('ecommerce.mappingRemoved'));
            setMappings(prev => prev.filter(m => m.id !== mappingId));
        } catch (error) {
            toast.error(t('ecommerce.mappingRemoveFailed'));
        }
    };

    const formatLastSync = (dateStr) => {
        if (!dateStr) return 'Never';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = (now - date) / 1000 / 60; // minutes
        
        if (diff < 1) return t('ecommerce.justNow');
        if (diff < 60) return t('ecommerce.minutesAgo', { n: Math.floor(diff) });
        if (diff < 1440) return t('ecommerce.hoursAgo', { n: Math.floor(diff / 60) });
        return formatLocalDate(date, 'date');
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-teal-500/20">
                        <ShoppingBag className="w-6 h-6 text-teal-400" />
                    </div>
                    <div>
                        <h3 className="font-semibold">{t('ecommerce.title')}</h3>
                        <p className="text-sm text-zinc-400">{t('ecommerce.subtitle')}</p>
                    </div>
                </div>
                <Button onClick={() => setShowAddModal(true)}>
                    <Plus className="w-4 h-4" />
                    {t('ecommerce.add')}
                </Button>
            </div>

            {/* Info Banner */}
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-200 text-sm">
                <p className="font-semibold flex items-center gap-2 mb-1">
                    <ArrowLeftRight className="w-4 h-4" />
                    {t('ecommerce.twoWay')}
                </p>
                <p className="opacity-80">
                    {t('ecommerce.syncText')}
                </p>
            </div>

            {/* Connections List */}
            {connections.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                    <Store className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>{t('ecommerce.none')}</p>
                    <p className="text-sm mt-1">{t('ecommerce.noneHint')}</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {connections.map(conn => {
                        const platform = PLATFORMS[conn.platform];
                        return (
                            <Card key={conn.id} className={`p-0 overflow-hidden ${platform?.borderColor}`}>
                                <div className="p-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${platform?.bgColor}`}>
                                                <Store className={`w-5 h-5 ${platform?.color}`} />
                                            </div>
                                            <div>
                                                <h4 className="font-semibold">{conn.store_name || platform?.name}</h4>
                                                <p className="text-sm text-zinc-500">{conn.store_url}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {conn.is_active ? (
                                                <span className="flex items-center gap-1 text-sm text-green-400">
                                                    <Check className="w-4 h-4" />
                                                    {t('ecommerce.connectedStatus')}
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-sm text-red-400">
                                                    <X className="w-4 h-4" />
                                                    {t('ecommerce.disconnected')}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-dark-border">
                                        <div className="flex items-center gap-4 text-sm text-zinc-500">
                                            <span>Last sync: {formatLastSync(conn.last_sync_at)}</span>
                                            {conn.last_sync_status === 'error' && (
                                                <span className="flex items-center gap-1 text-red-400">
                                                    <AlertTriangle className="w-4 h-4" />
                                                    {t('common.error')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button 
                                                size="sm" 
                                                variant="ghost"
                                                onClick={() => openMappingModal(conn)}
                                            >
                                                <Link className="w-4 h-4" />
                                                {t('ecommerce.mappings')}
                                            </Button>
                                            <Button 
                                                size="sm" 
                                                variant="secondary"
                                                onClick={() => handleSync(conn.id)}
                                                loading={syncing[conn.id]}
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                                {t('ecommerce.syncNow')}
                                            </Button>
                                            <Button 
                                                size="sm" 
                                                variant="ghost"
                                                onClick={() => handleTestConnection(conn.id)}
                                            >
                                                {t('ecommerce.test')}
                                            </Button>
                                            <Button 
                                                size="sm" 
                                                variant="ghost"
                                                className="text-red-400 hover:bg-red-500/10"
                                                onClick={() => handleRemoveConnection(conn.id)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Add Connection Modal */}
            <Modal isOpen={showAddModal} onClose={() => { setShowAddModal(false); setSelectedPlatform(null); setFormData({}); }} title={t('ecommerce.addTitle')}>
                <ModalBody>
                    {!selectedPlatform ? (
                        <div className="grid gap-4">
                            <p className="text-zinc-400 mb-2">{t('ecommerce.selectPlatform')}</p>
                            {Object.entries(PLATFORMS).map(([key, platform]) => (
                                <button
                                    key={key}
                                    onClick={() => setSelectedPlatform(key)}
                                    className={`p-4 rounded-lg border-2 text-start transition-all hover:border-zinc-600 ${platform.borderColor} ${platform.bgColor} bg-opacity-10`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Store className={`w-6 h-6 ${platform.color}`} />
                                            <div>
                                                <div className="font-semibold">{platform.name}</div>
                                                <div className="text-sm text-zinc-500">{t(`ecommerce.${key}Description`)}</div>
                                            </div>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-zinc-400" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 pb-4 border-b border-dark-border">
                                <Store className={`w-6 h-6 ${PLATFORMS[selectedPlatform].color}`} />
                                <div>
                                    <div className="font-semibold">{PLATFORMS[selectedPlatform].name}</div>
                                    <a 
                                        href={PLATFORMS[selectedPlatform].helpUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-accent-primary hover:underline"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            window.electronAPI.shell.openExternal(PLATFORMS[selectedPlatform].helpUrl);
                                        }}
                                    >
                                        {t('ecommerce.guide')}
                                    </a>
                                </div>
                            </div>

                            {PLATFORMS[selectedPlatform].fields.map(field => (
                                <Input
                                    key={field.key}
                                    label={t(`ecommerce.field.${field.key}`)}
                                    type={field.type}
                                    placeholder={field.placeholder}
                                    value={formData[field.key] || ''}
                                    onChange={(e) => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                                    required={field.required}
                                />
                            ))}

                        </div>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button variant="ghost" onClick={() => { 
                        if (selectedPlatform) {
                            setSelectedPlatform(null);
                            setFormData({});
                        } else {
                            setShowAddModal(false);
                        }
                    }}>
                        {selectedPlatform ? t('common.back') : t('common.cancel')}
                    </Button>
                    {selectedPlatform && (
                        <Button onClick={handleAddConnection} loading={connecting}>
                            <Link className="w-4 h-4" />
                            {t('ecommerce.connect')}
                        </Button>
                    )}
                </ModalFooter>
            </Modal>

            {/* Product Mapping Modal */}
            <Modal isOpen={showMappingModal} onClose={() => setShowMappingModal(false)} size="lg" title={`Product Mappings - ${selectedConnection?.store_name || PLATFORMS[selectedConnection?.platform]?.name}`}>
                <ModalBody className="max-h-[60vh] overflow-y-auto">
                    <div className="space-y-4">
                        {/* Auto-map button */}
                        <div className="flex items-center justify-between p-4 bg-dark-tertiary rounded-lg">
                            <div>
                                <h4 className="font-medium">{t('ecommerce.autoMapTitle')}</h4>
                                <p className="text-sm text-zinc-500">{t('ecommerce.autoMapText')}</p>
                            </div>
                            <Button onClick={handleAutoMap} loading={autoMapping} variant="secondary">
                                <ArrowLeftRight className="w-4 h-4" />
                                {t('ecommerce.autoMapButton')}
                            </Button>
                        </div>

                        {/* Mapped Products */}
                        <div>
                            <h4 className="font-medium mb-2 flex items-center gap-2">
                                <Check className="w-4 h-4 text-green-400" />
                                Mapped Products ({mappings.length})
                            </h4>
                            {mappings.length === 0 ? (
                                <p className="text-sm text-zinc-500 p-4 bg-dark-tertiary rounded-lg">
                                    {t('ecommerce.noMappings')}
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {mappings.slice(0, 10).map(mapping => (
                                        <div key={mapping.id} className="flex items-center justify-between p-3 bg-dark-tertiary rounded-lg">
                                            <div>
                                                <div className="font-medium">{mapping.product_name}</div>
                                                <div className="text-sm text-zinc-500">
                                                    SKU: {mapping.local_sku} → Remote: {mapping.remote_sku || mapping.remote_product_id}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm">
                                                    Local: {mapping.local_quantity} | Remote: {mapping.last_remote_quantity ?? '?'}
                                                </span>
                                                <Button 
                                                    size="sm" 
                                                    variant="ghost"
                                                    onClick={() => handleDeleteMapping(mapping.id)}
                                                >
                                                    <Unlink className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                    {mappings.length > 10 && (
                                        <p className="text-sm text-zinc-500 text-center">
                                            And {mappings.length - 10} more...
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Unmapped Products */}
                        <div>
                            <h4 className="font-medium mb-2 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                                Unmapped Products ({unmappedProducts.length})
                            </h4>
                            {unmappedProducts.length === 0 ? (
                                <p className="text-sm text-zinc-500 p-4 bg-dark-tertiary rounded-lg">
                                    {t('ecommerce.allMapped')}
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {unmappedProducts.slice(0, 10).map(product => (
                                        <div key={product.id} className="flex items-center justify-between p-3 bg-dark-tertiary rounded-lg">
                                            <div>
                                                <div className="font-medium">{product.name}</div>
                                                <div className="text-sm text-zinc-500">
                                                    SKU: {product.sku || t('barcode.noSku')} | Stock: {product.stock_quantity}
                                                </div>
                                            </div>
                                            <span className="text-sm text-amber-400">
                                                {product.sku ? t('ecommerce.notFound') : t('ecommerce.needsSku')}
                                            </span>
                                        </div>
                                    ))}
                                    {unmappedProducts.length > 10 && (
                                        <p className="text-sm text-zinc-500 text-center">
                                            And {unmappedProducts.length - 10} more...
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="ghost" onClick={() => setShowMappingModal(false)}>
                        {t('common.close')}
                    </Button>
                </ModalFooter>
            </Modal>
        </div>
    );
}
