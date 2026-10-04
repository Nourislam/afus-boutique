import { t } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';
import { formatMoney } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Mail, Printer, FileText } from 'lucide-react';
import { toast } from '../ui/Toast';

export default function QuoteDetailsModal({ isOpen, onClose, quote }) {
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (quote && isOpen) {
            fetchDetails();
            // Pre-fill email if customer info available in quote object (if we had it)
            // But we might need to rely on details fetch
        }
    }, [quote, isOpen]);

    useEffect(() => {
        if (details?.customer_email) {
            setEmail(details.customer_email);
        }
    }, [details]);

    const fetchDetails = async () => {
        setLoading(true);
        try {
            const data = await window.electronAPI.quotations.getById(quote.id);
            // Fetch customer email if not in details
            if (data.customer_id) {
                const customer = await window.electronAPI.customers.getById(data.customer_id);
                if (customer?.email) {
                    data.customer_email = customer.email;
                }
            }
            setDetails(data);
        } catch (error) {
            console.error('Failed to load quote details:', error);
            toast.error(t('quote.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handleSendEmail = async () => {
        if (!email) {
            toast.error(t('receipt.enterEmail'));
            return;
        }

        setSending(true);
        try {
            const result = await window.electronAPI.email.sendQuotation({
                to: email,
                quote: details
            });

            if (result.success) {
                toast.success(t('quote.emailed'));
                // Optional: onClose(); 
            } else {
                toast.error(result.message || t('receipt.emailFailed'));
            }
        } catch (error) {
            console.error('Email failed:', error);
            toast.error(t('receipt.emailFailed'));
        } finally {
            setSending(false);
        }
    };

    const formatCurrency = (val) => formatMoney(val);
    const formatDate = (dateString) => formatLocalDate(dateString, 'datetime');

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Quotation #${quote?.quote_number}`} size="lg">
            <ModalBody>
                {loading ? (
                    <div className="p-8 text-center text-zinc-500">{t('po.loadingDetails')}</div>
                ) : details ? (
                    <div className="space-y-6">
                        {/* Header */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('tx.customer')}</p>
                                <p className="font-medium">{details.customer_name || t('tx.walkIn')}</p>
                                {details.customer_email && <p className="text-xs text-zinc-500">{details.customer_email}</p>}
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('quote.createdBy')}</p>
                                <p className="font-medium">{details.employee_name || t('tx.unknown')}</p>
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('tx.date')}</p>
                                <p className="font-medium">{formatDate(details.created_at)}</p>
                            </div>
                            <div className="p-3 bg-dark-tertiary rounded-lg">
                                <p className="text-zinc-400">{t('inventory.status')}</p>
                                <p className="font-medium uppercase">{details.status}</p>
                            </div>
                        </div>

                        {/* Items */}
                        <div className="border border-dark-border rounded-lg overflow-hidden">
                            <table className="w-full text-start text-sm">
                                <thead className="bg-dark-tertiary text-zinc-400">
                                    <tr>
                                        <th className="p-3">{t('inventory.product')}</th>
                                        <th className="p-3 text-center">{t('credit.qty')}</th>
                                        <th className="p-3 text-end">{t('qr.price')}</th>
                                        <th className="p-3 text-end">{t('pos.total')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-dark-border">
                                    {details.items?.map((item, idx) => (
                                        <tr key={idx}>
                                            <td className="p-3 font-medium">{item.product_name}</td>
                                            <td className="p-3 text-center">{item.quantity}</td>
                                            <td className="p-3 text-end">{formatCurrency(item.unit_price)}</td>
                                            <td className="p-3 text-end">{formatCurrency(item.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-dark-tertiary font-bold">
                                    <tr>
                                        <td colSpan="3" className="p-3 text-end">{t('pos.total')}</td>
                                        <td className="p-3 text-end text-accent-primary">{formatCurrency(details.total)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Actions */}
                        <div className="bg-dark-tertiary/50 p-4 rounded-lg flex flex-col md:flex-row gap-4 items-end md:items-center justify-between">
                            <div className="w-full md:w-auto flex-1">
                                <label className="block text-xs text-zinc-400 mb-1">{t('quote.emailCustomer')}</label>
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="customer@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="h-9 text-sm"
                                    />
                                    <Button size="sm" onClick={handleSendEmail} loading={sending}>
                                        <Mail className="w-4 h-4 me-2" />
                                        {t('receipt.send')}
                                    </Button>
                                </div>
                            </div>
                            <Button variant="secondary" size="sm" onClick={() => window.electronAPI.quotations.print(details)}>
                                <Printer className="w-4 h-4 me-2" />
                                {t('common.print')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="p-8 text-center text-zinc-500">{t('po.detailsError')}</div>
                )}
            </ModalBody>
            <ModalFooter>
                <Button variant="outline" onClick={() => window.electronAPI.quotations.savePdf(details)}>
                    <FileText className="w-4 h-4 me-2" />
                    {t('gift.savePdf')}
                </Button>
                <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
            </ModalFooter>
        </Modal>
    );
}
