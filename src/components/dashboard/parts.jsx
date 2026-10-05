import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useT } from '../../i18n';
import { formatMoney } from '../../i18n/format';

/** Money that stays left-to-right inside Arabic text. */
export function Money({ value, className = '' }) {
    const { lang } = useT();
    return <bdi className={`tabular ${className}`}>{formatMoney(value, { lang })}</bdi>;
}

/** A card answering one question: title, optional action on the side, content. */
export function Section({ title, icon: Icon, action, children, className = '' }) {
    return (
        <section className={`card flex flex-col gap-3 min-w-0 ${className}`}>
            <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold flex items-center gap-2 min-w-0">
                    {Icon && <Icon className="w-5 h-5 text-indigo-300 flex-none" />}
                    <span className="break-words">{title}</span>
                </h2>
                {action}
            </div>
            {children}
        </section>
    );
}

/** One of the three figures at the top: a label, a big number and one line under it. */
export function Tile({ icon: Icon, label, value, children, testId }) {
    return (
        <div className="card flex flex-col gap-1 min-w-0 py-4" data-testid={testId}>
            <p className="text-sm text-zinc-400 flex items-center gap-2 min-w-0">
                {Icon && <Icon className="w-4 h-4 flex-none text-indigo-300" />}
                <span className="break-words">{label}</span>
            </p>
            <p className="text-2xl xl:text-3xl font-bold leading-tight break-words">{value}</p>
            {children && <div className="text-[13px] text-zinc-400 min-w-0">{children}</div>}
        </div>
    );
}

/**
 * "More than yesterday by 6 000 DA": the comparison in money, in words.
 * against: 'yesterday' | 'lastWeek' | 'lastMonth'
 */
export function CompareLine({ cmp, against }) {
    const { t } = useT();
    if (!cmp || cmp.direction === 'none') return null;
    const Icon = cmp.direction === 'up' ? TrendingUp : cmp.direction === 'down' ? TrendingDown : Minus;
    return (
        <span className={`inline-flex items-center gap-1.5 ${cmp.direction === 'up' ? 'text-emerald-300' : 'text-zinc-400'}`}>
            <Icon className="w-4 h-4 flex-none flip-rtl" />
            <span>{t(`dash.cmp.${against}.${cmp.direction}`, { amount: formatMoney(cmp.diff) })}</span>
        </span>
    );
}

/** Small tabs inside a card. */
export function MiniTabs({ tabs, value, onChange }) {
    return (
        <div className="segmented self-start max-w-full overflow-x-auto no-scrollbar" role="tablist">
            {tabs.map(tab => (
                <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id} className={`whitespace-nowrap ${value === tab.id ? 'active' : ''}`} onClick={() => onChange(tab.id)}>
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

/** A list line: main text, details under it, and what to do on the side. */
export function Row({ children, aside }) {
    return (
        <li className="flex items-center justify-between gap-3 py-2.5 min-w-0">
            <div className="min-w-0 flex-1">{children}</div>
            {aside && <div className="flex-none flex items-center gap-2">{aside}</div>}
        </li>
    );
}

export function Empty({ children, good = false }) {
    return <p className={`py-4 text-sm text-center ${good ? 'text-emerald-300' : 'text-zinc-500'}`}>{children}</p>;
}

export function Spinner() {
    return <div className="flex justify-center py-8"><div className="w-7 h-7 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}
