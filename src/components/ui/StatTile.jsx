/**
 * One figure at the top of a screen: an icon, what it is (up to two lines,
 * never cut in the middle of a word) and the number (never broken).
 * The same look on every screen.
 */
export function StatTile({ icon: Icon, label, value, sub, tone = '', iconTone = 'bg-indigo-500/15 text-indigo-300', testId }) {
    return (
        <div className="card p-4 flex items-center gap-3 min-w-0" data-testid={testId}>
            {Icon && (
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-none ${iconTone}`}>
                    <Icon className="w-5 h-5" />
                </span>
            )}
            <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-400 leading-snug line-clamp-2" title={typeof label === 'string' ? label : undefined}>{label}</p>
                <p className={`text-lg xl:text-xl font-bold whitespace-nowrap ${tone}`}>{value}</p>
                {sub && <p className="text-xs text-zinc-500 leading-snug">{sub}</p>}
            </div>
        </div>
    );
}

export default StatTile;
