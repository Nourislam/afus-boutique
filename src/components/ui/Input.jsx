import { useT } from '../../i18n';
import { forwardRef } from 'react';
import { Search } from 'lucide-react';

export const Input = forwardRef(({
    label,
    error,
    icon: Icon,
    className = '',
    containerClassName = '',
    ...props
}, ref) => {
    return (
        <div className={`form-group ${containerClassName}`}>
            {label && <label className="form-label">{label}</label>}
            <div className="relative">
                {Icon && (
                    <div className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-500">
                        <Icon className="w-5 h-5" />
                    </div>
                )}
                <input
                    ref={ref}
                    className={`input ${Icon ? 'ps-10' : ''} ${error ? 'border-red-500 focus:border-red-500' : ''} ${className}`}
                    {...props}
                />
            </div>
            {error && <p className="form-error">{error}</p>}
        </div>
    );
});

Input.displayName = 'Input';

export function SearchInput({ value, onChange, placeholder, className = '' }) {
    const { t } = useT();
    return (
        <div className={`relative ${className}`}>
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder || t('common.search')}
                className="input ps-10"
            />
        </div>
    );
}

export function TextArea({ label, error, className = '', ...props }) {
    return (
        <div className="form-group">
            {label && <label className="form-label">{label}</label>}
            <textarea
                className={`input min-h-[100px] resize-none ${error ? 'border-red-500' : ''} ${className}`}
                {...props}
            />
            {error && <p className="form-error">{error}</p>}
        </div>
    );
}
