import { useState, useEffect } from 'react';
import { ShoppingBag, Link, Unlink, RefreshCw, Check, X, AlertTriangle, ChevronRight, Store, Plus, Trash2, ArrowLeftRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { toast } from '../ui/Toast';

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
            toast.error('Failed to load e-commerce connections');
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
                toast.error(`${field.label} is required`);
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
                    toast.success(`Connected to ${result.testResult.details?.shopName || platform.name}!`);
                } else {
                    toast.warning(`Connection saved, but test failed: ${result.testResult?.message}`);
                }
                await loadConnections();
                setShowAddModal(false);
                setFormData({});
                setSelectedPlatform(null);
            } else {
                toast.error(result.message || 'Failed to add connection');
            }
        } catch (error) {
            console.error('Failed to add connection:', error);
            toast.error('Failed to add connection');
        } finally {
            setConnecting(false);
        }
    };

    const handleRemoveConnection = async (connectionId) => {
        if (!confirm('Are you sure you want to remove this connection? All product mappings will be lost.')) {
            return;
        }

        try {
            await window.electronAPI.ecommerce.removeConnection(connectionId);
            toast.success('Connection removed');
            await loadConnections();
        } catch (error) {
            toast.error('Failed to remove connection');
        }
    };

    const handleSync = async (connectionId) => {
        setSyncing(prev => ({ ...prev, [connectionId]: true }));
        try {
            const result = await window.electronAPI.ecommerce.sync(connectionId);
            if (result.success) {
                toast.success(`Sync complete! Pushed: ${result.results?.pushed || 0}, Pulled: ${result.results?.pulled || 0}`);
            } else {
                toast.error(result.message || 'Sync failed');
            }
            await loadConnections();
        } catch (error) {
            toast.error('Sync failed');
        } finally {
            setSyncing(prev => ({ ...prev, [connectionId]: false }));
        }
    };

    const handleTestConnection = async (connectionId) => {
        setSyncing(prev => ({ ...prev, [connectionId]: true }));
        try {
            const result = await window.electronAPI.ecommerce.testConnection(connectionId);
            if (result.success) {
                toast.success(`Connection successful: ${result.message}`);
            } else {
                toast.error(`Test failed: ${result.message}`);
            }
        } catch (error) {
            toast.error('Test failed');
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
            toast.error('Failed to load product mappings');
        }
    };

    const handleAutoMap = async () => {
        if (!selectedConnection) return;
        
        setAutoMapping(true);
        try {
            const result = await window.electronAPI.ecommerce.autoMapProducts(selectedConnection.id);
            if (result.success) {
                toast.success(`Auto-mapped ${result.results?.mapped || 0} products by SKU`);
                // Reload mappings
                const [mappingsData, unmappedData] = await Promise.all([
                    window.electronAPI.ecommerce.getMappings(selectedConnection.id),
                    window.electronAPI.ecommerce.getUnmappedProducts(selectedConnection.id)
                ]);
                setMappings(mappingsData || []);
                setUnmappedProducts(unmappedData || []);
            } else {
                toast.error('Auto-mapping failed');
            }
        } catch (error) {
            toast.error('Auto-mapping failed');
        } finally {
            setAutoMapping(false);
        }
    };

    const handleDeleteMapping = async (mappingId) => {
        try {
            await window.electronAPI.ecommerce.deleteMapping(mappingId);
            toast.success('Mapping removed');
            setMappings(prev => prev.filter(m => m.id !== mappingId));
        } catch (error) {
            toast.error('Failed to remove mapping');
        }
    };

    const formatLastSync = (dateStr) => {
        if (!dateStr) return 'Never';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = (now - date) / 1000 / 60; // minutes
        
        if (diff < 1) return 'Just now';
        if (diff < 60) return `${Math.floor(diff)} min ago`;
        if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
        return date.toLocaleDateString();
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
                        <h3 className="font-semibold">E-commerce Integrations</h3>
                        <p className="text-sm text-zinc-400">Connect your online stores for two-way inventory sync</p>
                    </div>
                </div>
                <Button onClick={() => setShowAddModal(true)}>
                    <Plus className="w-4 h-4" />
                    Add Connection
                </Button>
            </div>

            {/* Info Banner */}
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-200 text-sm">
                <p className="font-semibold flex items-center gap-2 mb-1">
                    <ArrowLeftRight className="w-4 h-4" />
                    Two-Way Sync
                </p>
                <p className="opacity-80">
                    Products are matched by SKU. When stock changes in POS, it pushes to your online stores. 
                    Changes from online stores are pulled during sync. Newest value wins on conflicts.
                </p>
            </div>

            {/* Connections List */}
            {connections.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                    <Store className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No e-commerce stores connected yet.</p>
                    <p className="text-sm mt-1">Click &ldquo;Add Connection&rdquo; to get started.</p>
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
                                                    Connected
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-sm text-red-400">
                                                    <X className="w-4 h-4" />
                                                    Disconnected
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
                                                    Error
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
                                                Mappings
                                            </Button>
                                            <Button 
                                                size="sm" 
                                                variant="secondary"
                                                onClick={() => handleSync(conn.id)}
                                                loading={syncing[conn.id]}
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                                Sync Now
                                            </Button>
                                            <Button 
                                                size="sm" 
                                                variant="ghost"
                                                onClick={() => handleTestConnection(conn.id)}
                                            >
                                                Test
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
            <Modal isOpen={showAddModal} onClose={() => { setShowAddModal(false); setSelectedPlatform(null); setFormData({}); }} title="Add E-commerce Connection">
                <ModalBody>
                    {!selectedPlatform ? (
                        <div className="grid gap-4">
                            <p className="text-zinc-400 mb-2">Select a platform to connect:</p>
                            {Object.entries(PLATFORMS).map(([key, platform]) => (
                                <button
                                    key={key}
                                    onClick={() => setSelectedPlatform(key)}
                                    className={`p-4 rounded-lg border-2 text-left transition-all hover:border-zinc-600 ${platform.borderColor} ${platform.bgColor} bg-opacity-10`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Store className={`w-6 h-6 ${platform.color}`} />
                                            <div>
                                                <div className="font-semibold">{platform.name}</div>
                                                <div className="text-sm text-zinc-500">{platform.description}</div>
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
                                        View Setup Guide →
                                    </a>
                                </div>
                            </div>

                            {PLATFORMS[selectedPlatform].fields.map(field => (
                                <Input
                                    key={field.key}
                                    label={field.label}
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
                        {selectedPlatform ? 'Back' : 'Cancel'}
                    </Button>
                    {selectedPlatform && (
                        <Button onClick={handleAddConnection} loading={connecting}>
                            <Link className="w-4 h-4" />
                            Connect
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
                                <h4 className="font-medium">Auto-Map by SKU</h4>
                                <p className="text-sm text-zinc-500">Automatically match products with the same SKU</p>
                            </div>
                            <Button onClick={handleAutoMap} loading={autoMapping} variant="secondary">
                                <ArrowLeftRight className="w-4 h-4" />
                                Auto-Map Products
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
                                    No products mapped yet. Use Auto-Map or manually map products.
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
                                    All products with SKUs are mapped!
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {unmappedProducts.slice(0, 10).map(product => (
                                        <div key={product.id} className="flex items-center justify-between p-3 bg-dark-tertiary rounded-lg">
                                            <div>
                                                <div className="font-medium">{product.name}</div>
                                                <div className="text-sm text-zinc-500">
                                                    SKU: {product.sku || 'No SKU'} | Stock: {product.stock_quantity}
                                                </div>
                                            </div>
                                            <span className="text-sm text-amber-400">
                                                {product.sku ? 'Not found on platform' : 'Needs SKU'}
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
                        Close
                    </Button>
                </ModalFooter>
            </Modal>
        </div>
    );
}
