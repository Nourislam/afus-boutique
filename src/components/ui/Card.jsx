import { t } from '../../i18n';
export function Card({ children, className = '', onClick }) {
    return (
        <div
            className={`card ${onClick ? 'cursor-pointer hover:border-accent-primary transition-colors' : ''} ${className}`}
            onClick={onClick}
        >
            {children}
        </div>
    );
}

export function StatCard({ label, value, icon: Icon, trend, trendValue, color = 'primary' }) {
    const colorClasses = {
        primary: 'text-indigo-400',
        success: 'text-green-400',
        warning: 'text-amber-400',
        danger: 'text-red-400',
    };

    return (
        <div className="card">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-zinc-400 mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
                </div>
                {Icon && (
                    <div className={`p-3 rounded-lg bg-${color === 'primary' ? 'indigo' : color}-500/10`}>
                        <Icon className={`w-6 h-6 ${colorClasses[color]}`} />
                    </div>
                )}
            </div>
            {trend && (
                <div className="mt-3 flex items-center gap-1 text-sm">
                    <span className={trend === 'up' ? 'text-green-400' : 'text-red-400'}>
                        {trend === 'up' ? '↑' : '↓'} {trendValue}
                    </span>
                    <span className="text-zinc-500">{t('dashboard.vsLast')}</span>
                </div>
            )}
        </div>
    );
}
