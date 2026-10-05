import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useToastStore } from '../../stores/toastStore';

const iconMap = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
};

const colorMap = {
    success: 'bg-green-500/10 border-green-500/30 text-green-400',
    error: 'bg-red-500/10 border-red-500/30 text-red-400',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
};

export function Toast({ toast }) {
    const { removeToast } = useToastStore();
    const Icon = iconMap[toast.type] || Info;

    return (
        <div
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm animate-slide-up ${colorMap[toast.type]}`}
        >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <button
                onClick={() => removeToast(toast.id)}
                className="flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}

export function Toaster() {
    const { toasts } = useToastStore();

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 end-4 z-[100] flex flex-col gap-2 max-w-sm">
            {toasts.map(toast => (
                <Toast key={toast.id} toast={toast} />
            ))}
        </div>
    );
}

export const toast = {
    success: (message, duration) => useToastStore.getState().success(message, duration),
    error: (message, duration) => useToastStore.getState().error(message, duration),
    warning: (message, duration) => useToastStore.getState().warning(message, duration),
    info: (message, duration) => useToastStore.getState().info(message, duration),
    loading: (message) => useToastStore.getState().addToast(message, 'info', 0),
    dismiss: (id) => useToastStore.getState().removeToast(id),
};
