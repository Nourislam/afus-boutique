import { useT } from '../../i18n';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from './Button';

export function ConfirmDialog({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    cancelText,
    variant = 'danger', // danger, warning, info
}) {
    const { t } = useT();
    if (!isOpen) return null;
    title = title || t('common.confirmTitle');
    message = message || t('common.confirmMessage');
    confirmText = confirmText || t('common.confirm');
    cancelText = cancelText || t('common.cancel');

    const icons = {
        danger: <AlertTriangle className="w-10 h-10 text-red-400" />,
        warning: <AlertTriangle className="w-10 h-10 text-amber-400" />,
        info: <Info className="w-10 h-10 text-blue-400" />,
    };

    const buttonVariants = {
        danger: 'danger',
        warning: 'primary',
        info: 'primary',
    };

    const iconBg = {
        danger: 'bg-red-500/20',
        warning: 'bg-amber-500/20',
        info: 'bg-blue-500/20',
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-md animate-scale-in p-6"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex flex-col items-center text-center">
                    {/* Icon */}
                    <div className={`w-16 h-16 rounded-full ${iconBg[variant]} flex items-center justify-center mb-4`}>
                        {icons[variant]}
                    </div>

                    {/* Title */}
                    <h2 className="text-xl font-semibold mb-2">{title}</h2>

                    {/* Message */}
                    <p className="text-zinc-400 mb-6">{message}</p>

                    {/* Buttons */}
                    <div className="flex gap-3 w-full">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={onClose}
                        >
                            {cancelText}
                        </Button>
                        <Button
                            variant={buttonVariants[variant]}
                            className="flex-1"
                            onClick={() => {
                                onConfirm();
                                onClose();
                            }}
                        >
                            {confirmText}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
