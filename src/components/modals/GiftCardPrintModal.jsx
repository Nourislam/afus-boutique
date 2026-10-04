import { t } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';
import { formatMoney } from '../../i18n/format';
import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Printer, Gift, Download, Mail } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../ui/Toast';

export default function GiftCardPrintModal({ isOpen, onClose, giftCard }) {
    const [barcodeImage, setBarcodeImage] = useState(null);
    const [showEmailInput, setShowEmailInput] = useState(false);
    const [email, setEmail] = useState('');
    const [sending, setSending] = useState(false);
    const { companySettings } = useAuthStore();

    useEffect(() => {
        if (giftCard) {
            generateBarcode();
            // Pre-fill email if customer attached
            if (giftCard.customer_email) setEmail(giftCard.customer_email);
        }
    }, [giftCard]);

    const generateBarcode = async () => {
        try {
            // Use 'code128' for alphanumeric codes
            const result = await window.electronAPI.barcode.generate({
                type: 'code128',
                data: giftCard.code,
                width: 300,
                height: 80,
                includeText: true,
                scale: 2,
                backgroundColor: '#ffffff',
                barcodeColor: '#000000'
            });

            if (result.success) {
                setBarcodeImage(result.image);
            }
        } catch (error) {
            console.error('Failed to generate barcode:', error);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const handleSavePdf = async () => {
        try {
            // Pass the barcode image data to the backend
            const path = await window.electronAPI.giftCards.savePdf({ ...giftCard, barcodeImage });
            if (path) toast.success(t('common.savedTo', { path }));
        } catch {
            toast.error(t('gift.pdfFailed'));
        }
    };

    const handleSendEmail = async () => {
        if (!email) return toast.error(t('gift.enterEmail'));
        setSending(true);
        try {
            await window.electronAPI.giftCards.sendEmail({ giftCard: { ...giftCard, barcodeImage }, email });
            toast.success(t('gift.emailSent'));
            setShowEmailInput(false);
        } catch (error) {
            console.error(error);
            toast.error(t('gift.emailFailed'));
        } finally {
            setSending(false);
        }
    };

    if (!giftCard) return null;

    const formatCurrency = (amount) => {
        return formatMoney(amount);
    };

    const modalTitle = giftCard.is_new ? t('gift.createdTitle') : t('gift.detailsTitle');

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="lg">
            <ModalBody>
                <div className="flex flex-col items-center space-y-6">
                    {/* Printable Area */}
                    <div className="printable-card w-full max-w-md mx-auto aspect-[1.586] rounded-xl overflow-hidden shadow-2xl relative bg-zinc-900 border border-zinc-700 text-white print:shadow-none print:border-none">
                        {/* Background Design */}
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 to-purple-800 opacity-90 transition-all duration-300"></div>

                        {/* Pattern Overlay (Optional) */}
                        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

                        {/* Content */}
                        <div className="relative h-full flex flex-col justify-between p-8 z-10">
                            {/* Header */}
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-2">
                                    <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                                        <Gift className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold tracking-wider uppercase">{t('pay.giftCard')}</h2>
                                        <p className="text-xs text-indigo-200 uppercase tracking-widest">{companySettings?.name || t('app.name')}</p>
                                    </div>
                                </div>
                                <div className="text-end">
                                    <h3 className="text-3xl font-bold text-white drop-shadow-md">
                                        {formatCurrency(giftCard.current_balance)}
                                    </h3>
                                </div>
                            </div>

                            {/* Middle Info */}
                            <div className="space-y-1">
                                <p className="text-xs text-indigo-200">{t('gift.number')}</p>
                                <p className="font-mono text-lg tracking-widest text-white">{giftCard.code}</p>
                            </div>

                            {/* Footer / Barcode */}
                            <div className="mt-auto pt-4">
                                <div className="bg-white p-3 rounded-lg shadow-lg flex justify-center items-center h-20">
                                    {barcodeImage ? (
                                        <img src={barcodeImage} alt={t('products.barcode')} className="h-full object-contain" />
                                    ) : (
                                        <div className="text-black text-xs">{t('gift.generating')}</div>
                                    )}
                                </div>
                                <div className="flex justify-between items-end mt-2">
                                    <p className="text-[10px] text-indigo-300">
                                        {giftCard.expires_at ? `Expires: ${formatLocalDate(giftCard.expires_at, 'date')}` : t('gift.noExpiration')}
                                    </p>
                                    <p className="text-[10px] text-indigo-300">{t('gift.terms')}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <p className="text-sm text-zinc-500 text-center no-print">
                        {t('gift.previewHint')} {t('gift.printerHint')}
                    </p>
                </div>

                {showEmailInput && (
                    <div className="max-w-md mx-auto mt-6 p-4 bg-zinc-800 rounded-lg no-print">
                        <h3 className="text-sm font-bold mb-2">{t('gift.sendEmail')}</h3>
                        <div className="flex gap-2">
                            <Input
                                placeholder="customer@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="flex-1"
                            />
                            <Button onClick={handleSendEmail} loading={sending}>
                                <Mail className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </ModalBody>
            <ModalFooter>
                <div className="flex justify-between w-full no-print">
                    <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={handlePrint}>
                            <Printer className="w-4 h-4 me-2" />
                            {t('common.print')}
                        </Button>
                        <Button variant="outline" onClick={() => setShowEmailInput(!showEmailInput)}>
                            <Mail className="w-4 h-4 me-2" />
                            {t('common.email')}
                        </Button>
                        <Button onClick={handleSavePdf}>
                            <Download className="w-4 h-4 me-2" />
                            {t('gift.savePdf')}
                        </Button>
                    </div>
                </div>
            </ModalFooter>

            {/* Print Styles */}
            <style>{`
                @media print {
                    body * {
                        visibility: hidden;
                    }
                    .printable-card, .printable-card * {
                        visibility: visible;
                    }
                    .printable-card {
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%) scale(1.5); /* Scale up for full page or adjust */
                        width: 100%;
                        max-width: 600px; /* Adjust based on paper size */
                        margin: 0;
                        border-radius: 0;
                        box-shadow: none;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .modal-overlay, .modal-content {
                        background: none !important;
                        box-shadow: none !important;
                        border: none !important;
                    }
                    /* Hide scrollbars */
                    ::-webkit-scrollbar {
                        display: none;
                    }
                }
            `}</style>
        </Modal>
    );
}
