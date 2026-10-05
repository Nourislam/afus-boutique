import { useState } from 'react';

/**
 * Tabs. Controlled with `value` + `onChange`, or uncontrolled with
 * `defaultTab`. variant: 'pills' (default) or 'underline'.
 * tabs: [{ id, label, icon?, count? }]
 */
export function Tabs({ tabs, value, defaultTab, onChange, variant = 'pills', className = '' }) {
    const [internal, setInternal] = useState(defaultTab || tabs[0]?.id);
    const active = value ?? internal;

    const select = (id) => {
        if (value === undefined) setInternal(id);
        onChange?.(id);
    };

    if (variant === 'underline') {
        return (
            <div className={`flex items-center gap-1 overflow-x-auto no-scrollbar border-b border-dark-border ${className}`} role="tablist">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active === tab.id}
                        onClick={() => select(tab.id)}
                        className={`relative flex items-center gap-2 px-3 h-10 text-sm font-medium whitespace-nowrap transition-colors
                            ${active === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'}`}
                    >
                        {tab.icon && <tab.icon className="w-4 h-4" />}
                        {tab.label}
                        {tab.count !== undefined && <span className="badge bg-dark-tertiary text-zinc-400">{tab.count}</span>}
                        {active === tab.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-400" />}
                    </button>
                ))}
            </div>
        );
    }

    return (
        <div className={`w-full overflow-x-auto no-scrollbar ${className}`}>
            <div className="segmented min-w-max" role="tablist">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active === tab.id}
                        onClick={() => select(tab.id)}
                        className={`flex items-center gap-2 ${active === tab.id ? 'active' : ''}`}
                    >
                        {tab.icon && <tab.icon className="w-4 h-4" />}
                        {tab.label}
                        {tab.count !== undefined && <span className="text-xs text-zinc-500">{tab.count}</span>}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function TabsContainer({ children }) {
    return <div className="space-y-4">{children}</div>;
}

export function TabPanel({ children, isActive }) {
    if (!isActive) return null;
    return <div className="animate-fade-in">{children}</div>;
}
