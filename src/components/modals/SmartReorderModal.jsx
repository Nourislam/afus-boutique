import { t } from '../../i18n';
import { formatMoney } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { toast } from '../ui/Toast';
import { AlertTriangle, PackagePlus } from 'lucide-react';

export default function SmartReorderModal({ isOpen, onClose, onComplete }) {
    const [lowStockItems, setLowStockItems] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [selectedItems, setSelectedItems] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadLowStock();
            setSelectedItems(new Set());
        }
    }, [isOpen]);

    const loadLowStock = async () => {
        setLoading(true);
        try {
            const [lowStockData, suppliersData] = await Promise.all([
                window.electronAPI.reports.getLowStock(),
                window.electronAPI.suppliers.getAll()
            ]);

            console.log('DEBUG SmartReorder: Loaded suppliers:', suppliersData);

            // Add recommended reorder quantity (up to max_stock or +10 if not set)
            const processed = lowStockData.map(item => ({
                ...item,
                reorder_qty: item.max_stock_level ? (item.max_stock_level - item.stock_quantity) : 10,
                // If supplier is missing, keep it null for user selection
                supplier_id: item.supplier_id || '',
                supplier_name: item.supplier_name || ''
            }));

            setLowStockItems(processed);
            setSuppliers(suppliersData);
            // Select all by default
            setSelectedItems(new Set(processed.map(i => i.id)));
        } catch (error) {
            console.error('Failed to load data:', error);
            toast.error(t('reorder.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const toggleItem = (id) => {
        const newSet = new Set(selectedItems);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedItems(newSet);
    };

    const updateReorderQty = (id, qty) => {
        setLowStockItems(prev => prev.map(item =>
            item.id === id ? { ...item, reorder_qty: parseInt(qty) || 0 } : item
        ));
    };

    const updateSupplier = (id, supplierId) => {
        const supplier = suppliers.find(s => s.id === supplierId);
        setLowStockItems(prev => prev.map(item =>
            item.id === id ? {
                ...item,
                supplier_id: supplierId,
                supplier_name: supplier ? supplier.name : ''
            } : item
        ));
    };

    const handleGenerate = async () => {
        const itemsToOrder = lowStockItems.filter(i => selectedItems.has(i.id));
        if (itemsToOrder.length === 0) return toast.error(t('reorder.noneSelected'));

        setGenerating(true);
        try {
            // Group by Supplier
            const suppliers = {};
            itemsToOrder.forEach(item => {
                const supplierId = item.supplier_id || 'unknown';
                if (!suppliers[supplierId]) {
                    suppliers[supplierId] = {
                        supplier_id: item.supplier_id,
                        supplier_name: item.supplier_name || t('po.unknownSupplier'),
                        items: []
                    };
                }
                suppliers[supplierId].items.push({
                    product_id: item.id,
                    product_name: item.name,
                    quantity: item.reorder_qty,
                    unit_cost: item.cost || 0,
                    total_cost: item.reorder_qty * (item.cost || 0)
                });
            });

            // Create POs
            let count = 0;
            for (const key in suppliers) {
                const group = suppliers[key];
                if (!group.supplier_id) continue; // Skip items with no supplier

                const poData = {
                    supplier_id: group.supplier_id,
                    supplier_name: group.supplier_name,
                    po_number: 'PO-AUTO-' + Date.now() + '-' + count,
                    expected_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // +7 days
                    items: group.items,
                    subtotal: group.items.reduce((s, i) => s + i.total_cost, 0),
                    tax_amount: 0,
                    total: group.items.reduce((s, i) => s + i.total_cost, 0),
                    status: 'draft',
                    notes: t('reorder.autoNote')
                };

                await window.electronAPI.purchaseOrders.create(poData);
                count++;
            }

            toast.success(`${count} Purchase Orders Generated`);
            onComplete();
            onClose();
        } catch (error) {
            console.error('Failed to generate POs:', error);
            toast.error(t('reorder.failed'));
        } finally {
            setGenerating(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('reorder.title')} size="xl">
            <ModalBody>
                {loading ? (
                    <div className="text-center py-8 text-zinc-500">{t('reorder.scanning')}</div>
                ) : lowStockItems.length === 0 ? (
                    <div className="text-center py-8 text-green-500">
                        <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>{t('reorder.healthy')}</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-200 p-3 rounded-lg flex items-start gap-3 text-sm">
                            <AlertTriangle className="w-5 h-5 shrink-0" />
                            <div>
                                <p className="font-bold">{t('reorder.engine')}</p>
                                <p>{t('reorder.found', { n: lowStockItems.length })}</p>
                            </div>
                        </div>

                        <div className="bg-dark-secondary rounded-lg border border-dark-border max-h-[400px] overflow-y-auto overflow-x-visible">
                            <table className="w-full text-start text-sm">
                                <thead className="bg-dark-tertiary text-zinc-400 sticky top-0">
                                    <tr>
                                        <th className="p-3 w-10">
                                            <input
                                                type="checkbox"
                                                checked={selectedItems.size === lowStockItems.length}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedItems(new Set(lowStockItems.map(i => i.id)));
                                                    else setSelectedItems(new Set());
                                                }}
                                                className="rounded border-zinc-600 bg-zinc-700"
                                            />
                                        </th>
                                        <th className="p-3">{t('inventory.product')}</th>
                                        <th className="p-3">{t('po.supplier')}</th>
                                        <th className="p-3 text-center">{t('reorder.levels')}</th>
                                        <th className="p-3 w-24 text-center">{t('reorder.qty')}</th>
                                        <th className="p-3 text-end">{t('reorder.cost')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-dark-border">
                                    {lowStockItems.map(item => (
                                        <tr key={item.id} className="hover:bg-zinc-800/50">
                                            <td className="p-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedItems.has(item.id)}
                                                    onChange={() => toggleItem(item.id)}
                                                    className="rounded border-zinc-600 bg-zinc-700"
                                                />
                                            </td>
                                            <td className="p-3 font-medium text-white">{item.name}</td>
                                            <td className="p-3 text-zinc-400 text-xs">
                                                {item.supplier_name ? (
                                                    // If already has supplier, just show text (simplify)
                                                    <span>{item.supplier_name}</span>
                                                ) : (
                                                    // Custom styled dropdown
                                                    <Select
                                                        className="min-w-[150px]"
                                                        value={item.supplier_id}
                                                        onChange={(val) => updateSupplier(item.id, val)}
                                                        options={[{ label: t('reorder.selectSupplier'), value: '' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
                                                        placeholder={t('reorder.selectSupplier')}
                                                    />
                                                )}
                                            </td>
                                            <td className="p-3 text-center font-mono text-xs">
                                                <span className="text-red-400 font-bold">{item.stock_quantity}</span>
                                                <span className="text-zinc-500"> / {item.min_stock_level} / {item.max_stock_level || '-'}</span>
                                            </td>
                                            <td className="p-3">
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    className="h-8 text-center"
                                                    value={item.reorder_qty}
                                                    onChange={(e) => updateReorderQty(item.id, e.target.value)}
                                                />
                                            </td>
                                            <td className="p-3 text-end text-zinc-400">
                                                {formatMoney(((item.cost || 0) * item.reorder_qty))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </ModalBody>
            <ModalFooter>
                <div className="flex-1 text-xs text-zinc-500">
                    {t('reorder.selectedN', { n: selectedItems.size })}
                </div>
                <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                <Button onClick={handleGenerate} loading={generating} disabled={selectedItems.size === 0}>
                    <PackagePlus className="w-4 h-4 me-2" />
                    {t('reorder.generate')}
                </Button>
            </ModalFooter>
        </Modal>
    );
}

import { CheckCircle } from 'lucide-react';
