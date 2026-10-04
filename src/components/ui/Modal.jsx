import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Modal({ isOpen, onClose, title, children, size = 'md', showClose = true, closeOnOverlay = true }) {
    // Close on the overlay only when the click both starts and ends on it (a
    // text selection that ends outside the dialog must not close it)
    const downOnOverlay = useRef(false);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const sizeClasses = {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
        full: 'max-w-6xl',
    };

    return (
        <div
            className="modal-overlay"
            onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget; }}
            onClick={(e) => { if (closeOnOverlay && downOnOverlay.current && e.target === e.currentTarget) onClose?.(); }}
        >
            <div
                className={`modal-content ${sizeClasses[size]}`}
            >
                <div className="modal-header">
                    <h2 className="text-lg font-semibold truncate">{title}</h2>
                    {showClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 -me-2 rounded-lg hover:bg-dark-tertiary transition-colors"
                            aria-label="close"
                        >
                            <X className="w-5 h-5 text-zinc-400" />
                        </button>
                    )}
                </div>
                {children}
            </div>
        </div>
    );
}

export function ModalBody({ children, className = '' }) {
    return (
        <div className={`modal-body ${className}`}>
            {children}
        </div>
    );
}

export function ModalFooter({ children, className = '' }) {
    return (
        <div className={`modal-footer ${className}`}>
            {children}
        </div>
    );
}
