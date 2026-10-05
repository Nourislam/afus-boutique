import { useT } from '../../i18n';

const variants = {
    primary: 'badge-primary',
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    default: 'bg-zinc-700 text-zinc-300',
};

export function Badge({ children, variant = 'default', className = '' }) {
    return (
        <span className={`badge ${variants[variant]} ${className}`}>
            {children}
        </span>
    );
}

const STATUS_VARIANTS = {
    active: 'success',
    inactive: 'danger',
    completed: 'success',
    pending: 'warning',
    cancelled: 'danger',
    'low-stock': 'warning',
    'in-stock': 'success',
    'out-of-stock': 'danger',
};

export function StatusBadge({ status }) {
    const { t } = useT();
    const key = `status.${status}`;
    const label = t(key);
    return <Badge variant={STATUS_VARIANTS[status] || 'default'}>{label === key ? status : label}</Badge>;
}
