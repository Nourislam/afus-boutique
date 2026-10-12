import { t } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { useState, useEffect } from 'react';
import { Modal, ModalBody } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { Printer, Mail, Download, FileText } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';

export default function ReceiptPreviewModal({ isOpen, onClose, sale }) {
    const [html, setHtml] = useState('');
    const [loading, setLoading] = useState(true);
    // Sending by e-mail only when the E-mail module is on
    const emailOn = useSettingsStore(state => !!state.settings.features?.email);
    const [email, setEmail] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [invoiceBusy, setInvoiceBusy] = useState('');
    // A4 invoice (office printer or PDF), from the data saved with the sale
    const runInvoice = async (kind) => {
        setInvoiceBusy(kind);
        try {
            if (kind === 'print') await window.electronAPI.invoices.print(sale.id);
            else {
                const path = await window.electronAPI.invoices.savePdf(sale.id);
                if (path) toast.success(t('invoice.saved'));
            }
        } catch (error) {
            toast.error(translateError(error));
        } finally {
            setInvoiceBusy('');
        }
    };
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen && sale) {
            loadHtml();
        } else {
            setHtml('');
        }
    }, [isOpen, sale]);

    const loadHtml = async () => {
        setLoading(true);
        try {
            const content = await window.electronAPI.receipts.getHtml(sale);
            setHtml(content);
        } catch (error) {
            console.error('Failed to load receipt:', error);
            toast.error(t('receipt.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = async () => {
        setPrinting(true);
        try {
            await window.electronAPI.receipts.print(sale);
            toast.success(t('receipt.printed'));
        } catch (error) {
            console.error('Print failed:', error);
            toast.error(t('receipt.printFailed'));
        } finally {
            setPrinting(false);
        }
    };

    const handleEmail = async () => {
        if (!email) {
            toast.error(t('receipt.enterEmail'));
            return;
        }
        setSendingEmail(true);
        try {
            await window.electronAPI.email.sendReceipt(sale, email);
            toast.success(t('receipt.sentTo', { email }));
        } catch (error) {
            console.error('Email failed:', error);
            toast.error(translateError(error) || t('receipt.emailFailed'));
        } finally {
            setSendingEmail(false);
        }
    };

    const handleSavePdf = async () => {
        setSaving(true);
        try {
            const path = await window.electronAPI.receipts.savePdf(sale);
            if (path) {
                toast.success(t('receipt.pdfSaved'));
            }
        } catch (error) {
            console.error('Save PDF failed:', error);
            toast.error(t('gift.pdfFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('receipt.title')} size="lg">
            <ModalBody>
                <div className="grid grid-cols-2 gap-6 h-[500px]">
                    {/* Preview Section - Using iframe to isolate styles */}
                    <div className="border border-dark-border rounded-lg bg-white overflow-hidden h-full">
                        {loading ? (
                            <div className="h-full flex items-center justify-center text-black">
                                {t('receipt.loading')}
                            </div>
                        ) : html ? (
                            <iframe
                                title={t('receipt.title')}
                                sandbox=""
                                srcDoc={html}
                                className="w-full h-full border-0"
                            />
                        ) : (
                            <div className="h-full flex items-center justify-center text-red-500">
                                {t('receipt.previewFailed')}
                            </div>
                        )}
                    </div>

                    {/* Actions Section */}
                    <div className="flex flex-col gap-4">
                        <div className="p-4 rounded-lg bg-dark-tertiary">
                            <h3 className="font-semibold mb-2">{t('inventory.actions')}</h3>
                            <Button
                                onClick={handlePrint}
                                loading={printing}
                                className="w-full justify-start mb-2"
                                size="lg"
                            >
                                <Printer className="w-5 h-5 me-2" />
                                {t('receipt.print')}
                            </Button>
                            <Button
                                onClick={handleSavePdf}
                                loading={saving}
                                className="w-full justify-start"
                                variant="outline"
                                size="lg"
                            >
                                <Download className="w-5 h-5 me-2" />
                                {t('receipt.savePdf')}
                            </Button>
                            {sale?.id && sale.id !== 'test' && (
                                <div className="grid grid-cols-2 gap-2 mt-2" data-testid="invoice-a4">
                                    <Button variant="secondary" onClick={() => runInvoice('print')} loading={invoiceBusy === 'print'}>
                                        <FileText className="w-4 h-4" /> {t('invoice.printA4')}
                                    </Button>
                                    <Button variant="secondary" onClick={() => runInvoice('pdf')} loading={invoiceBusy === 'pdf'}>
                                        <Download className="w-4 h-4" /> {t('invoice.pdf')}
                                    </Button>
                                </div>
                            )}
                        </div>

                        {emailOn && (
                        <div className="p-4 rounded-lg bg-dark-tertiary flex-1">
                            <h3 className="font-semibold mb-2">{t('receipt.email')}</h3>
                            <div className="space-y-3">
                                <Input
                                    label={t('receipt.customerEmail')}
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="customer@example.com"
                                />
                                <Button
                                    onClick={handleEmail}
                                    loading={sendingEmail}
                                    disabled={!email}
                                    variant="secondary"
                                    className="w-full"
                                >
                                    <Mail className="w-4 h-4 me-2" />
                                    {t('receipt.send')}
                                </Button>
                            </div>
                        </div>
                        )}

                        <Button variant="ghost" onClick={onClose} className="mt-auto">
                            {t('common.close')}
                        </Button>
                    </div>
                </div>
            </ModalBody>
        </Modal>
    );
}
