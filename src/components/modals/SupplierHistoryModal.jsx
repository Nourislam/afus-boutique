import { t } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';
import { formatMoney } from '../../i18n/format';
import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ArrowUpRight, ArrowDownLeft, FileText, Banknote, RefreshCcw } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';

export default function SupplierHistoryModal({ isOpen, onClose, supplier }) {
    const [history, setHistory] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (isOpen && supplier) {
            fetchHistory();
        }
    }, [isOpen, supplier]);

    const fetchHistory = async () => {
        setIsLoading(true);
        try {
            const data = await window.electronAPI.suppliers.getHistory(supplier.id);
            setHistory(data);
        } catch (error) {
            console.error('Failed to fetch supplier history:', error);
        } finally {
            setIsLoading(false);
        }
    };

    if (!supplier) return null;

    // Helper to format currency
    const formatCurrency = (amount) => {
        return formatMoney(amount);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`History: ${supplier.name}`}>
            <ModalBody>
                <div className="space-y-6">
                    {/* Summary Card */}
                    <div className="bg-dark-tertiary p-4 rounded-lg flex justify-between items-center border border-dark-border">
                        <div>
                            <p className="text-zinc-400 text-sm">{t('supplierHistory.due')}</p>
                            <p className="text-2xl font-bold text-white">
                                {formatCurrency(supplier.balance || 0)}
                            </p>
                        </div>
                        <div className="text-end">
                            <p className="text-zinc-400 text-sm">{t('customers.contact')}</p>
                            <p className="text-white font-medium">{supplier.contact_person || t('po.na')}</p>
                        </div>
                    </div>

                    {/* Timeline */}
                    <div className="max-h-[60vh] overflow-y-auto pe-2 space-y-3">
                        {isLoading ? (
                            <div className="text-center py-8 text-zinc-500">{t('supplierHistory.loading')}</div>
                        ) : history.length === 0 ? (
                            <div className="text-center py-8 text-zinc-500">{t('supplierHistory.none')}</div>
                        ) : (
                            history.map((item, index) => (
                                <div key={index} className="flex gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 
                                            ${item.type === 'purchase_order' ? 'border-blue-500/20 bg-blue-500/10 text-blue-500' :
                                                item.type === 'payment' ? 'border-green-500/20 bg-green-500/10 text-green-500' :
                                                    'border-amber-500/20 bg-amber-500/10 text-amber-500' // return
                                            }`}>
                                            {item.type === 'purchase_order' && <FileText className="w-4 h-4" />}
                                            {item.type === 'payment' && <Banknote className="w-4 h-4" />}
                                            {item.type === 'return' && <RefreshCcw className="w-4 h-4" />}
                                        </div>
                                        {index < history.length - 1 && <div className="w-0.5 h-full bg-dark-border mt-2" />}
                                    </div>
                                    <div className="flex-1 pb-6">
                                        <div className="bg-dark-tertiary/50 p-3 rounded-lg border border-dark-border">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-semibold capitalize text-sm">
                                                    {item.type.replace('_', ' ')}
                                                </h4>
                                                <span className="text-xs text-zinc-500">
                                                    {formatLocalDate(item.date, 'datetime')}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm text-zinc-300">
                                                        {item.reference ? item.reference : `ID: ${item.id.slice(0, 8)}`}
                                                    </p>
                                                    {item.payment_status && (
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${item.payment_status === 'paid' ? 'border-green-500/30 text-green-500' :
                                                                item.payment_status === 'partial' ? 'border-amber-500/30 text-amber-500' :
                                                                    'border-red-500/30 text-red-500'
                                                            }`}>
                                                            {item.payment_status.toUpperCase()}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className={`font-mono font-medium ${item.type === 'purchase_order' ? 'text-red-400' : 'text-green-400'
                                                    }`}>
                                                    {item.type === 'purchase_order' ? '+' : '-'} {formatCurrency(item.amount)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <Button onClick={onClose}>{t('common.close')}</Button>
            </ModalFooter>
        </Modal>
    );
}
