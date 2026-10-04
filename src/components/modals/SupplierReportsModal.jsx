import { t } from '../../i18n';
import { formatMoney } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { BarChart3, TrendingUp, Banknote, ListOrdered } from 'lucide-react';

export default function SupplierReportsModal({ isOpen, onClose }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            loadStats();
        }
    }, [isOpen]);

    const loadStats = async () => {
        setLoading(true);
        try {
            const data = await window.electronAPI.reports.getSupplierStats();
            setStats(data);
        } catch (error) {
            console.error('Failed to load stats:', error);
        } finally {
            setLoading(false);
        }
    };

    const StatCard = ({ title, value, icon: Icon, color }) => (
        <div className="bg-dark-secondary p-4 rounded-lg border border-dark-border flex items-center gap-4">
            <div className={`p-3 rounded-full bg-${color}-500/10 text-${color}-500`}>
                <Icon className="w-6 h-6" />
            </div>
            <div>
                <p className="text-zinc-400 text-sm">{title}</p>
                <h3 className="text-xl font-bold text-white">{value}</h3>
            </div>
        </div>
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('supplierReports.title')} size="xl">
            <ModalBody>
                {loading ? (
                    <div className="text-center py-12 text-zinc-500">{t('supplierReports.loading')}</div>
                ) : stats ? (
                    <div className="space-y-6">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <StatCard
                                title={t('supplierReports.orders')}
                                value={stats.summary.total_orders || 0}
                                icon={ListOrdered}
                                color="blue"
                            />
                            <StatCard
                                title={t('supplierReports.spend')}
                                value={formatMoney(stats.summary.total_purchased || 0)}
                                icon={Banknote}
                                color="green"
                            />
                            <StatCard
                                title={t('supplierReports.paid')}
                                value={formatMoney(stats.summary.total_paid || 0)}
                                icon={TrendingUp}
                                color="purple"
                            />
                        </div>

                        {/* Top Suppliers */}
                        <div>
                            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-zinc-400" />
                                {t('supplierReports.top')}
                            </h3>
                            <div className="bg-dark-secondary rounded-lg border border-dark-border overflow-hidden">
                                <table className="w-full text-start text-sm">
                                    <thead className="bg-dark-tertiary text-zinc-400">
                                        <tr>
                                            <th className="p-3">{t('supplierReports.rank')}</th>
                                            <th className="p-3">{t('po.supplier')}</th>
                                            <th className="p-3 text-center">{t('supplierReports.ordersCol')}</th>
                                            <th className="p-3 text-end">{t('supplierReports.spend')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-dark-border">
                                        {stats.topSuppliers.map((s, i) => (
                                            <tr key={i} className="hover:bg-zinc-800/50">
                                                <td className="p-3 text-zinc-500 w-12">#{i + 1}</td>
                                                <td className="p-3 font-medium text-white">{s.name}</td>
                                                <td className="p-3 text-center text-zinc-400">{s.order_count}</td>
                                                <td className="p-3 text-end font-mono text-green-400">
                                                    {formatMoney(s.total_spend)}
                                                </td>
                                            </tr>
                                        ))}
                                        {stats.topSuppliers.length === 0 && (
                                            <tr>
                                                <td colSpan="4" className="p-4 text-center text-zinc-500">{t('supplierReports.noData')}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-12 text-red-400">{t('common.loadFailed')}</div>
                )}
            </ModalBody>
            <ModalFooter>
                <Button onClick={onClose}>{t('common.close')}</Button>
            </ModalFooter>
        </Modal>
    );
}
