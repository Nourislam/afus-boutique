import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/Button';
import { MiniTabs, Money, Spinner, Empty } from '../dashboard/parts';
import { seasonLabel } from '../../lib/clothing';
import { clearanceLink } from '../../lib/listFilters';
import { useT } from '../../i18n';
import { useVizColors } from '../../lib/vizColors';

const BY = ['season', 'collection'];
const CLEARANCE_PERCENT = 30;

/**
 * Season / collection from start to end: bought, sold, left, profit. The
 * "end-of-season clearance" button only opens a prefilled promotion on the
 * articles that still have pieces: the owner checks it and saves it.
 * money: purchase prices and profit (the owner only).
 */
export default function SeasonReport({ money, canDiscount }) {
    const { t } = useT();
    const navigate = useNavigate();
    const [by, setBy] = useState('season');
    const [data, setData] = useState(null);
    const [open, setOpen] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setData(null);
        window.electronAPI.insights.season({ by })
            .then(r => { if (!cancelled) setData(r); })
            .catch(() => { if (!cancelled) setData({ rows: [], total: {} }); });
        return () => { cancelled = true; };
    }, [by]);

    const label = (key) => (by === 'season' ? seasonLabel(key) : key);
    const clear = (row) => navigate(clearanceLink({
        ids: row.clearance,
        name: t('season.clearanceName', { name: label(row.key) }),
        percent: CLEARANCE_PERCENT,
    }));

    return (
        <div className="space-y-4" data-testid="season-report">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <MiniTabs value={by} onChange={(id) => { setBy(id); setOpen(null); }} tabs={BY.map(id => ({ id, label: t(`season.by.${id}`) }))} />
                <p className="text-xs text-zinc-500 max-w-xl">{t('season.hint')}</p>
            </div>
            {!data ? <Spinner /> : data.rows.length === 0 ? <div className="card"><Empty>{t(`season.none.${by}`)}</Empty></div> : (
                <>
                <SellThroughChart rows={data.rows} label={label} />
                <div className="card p-0 overflow-x-auto">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{t(`season.by.${by}`)}</th>
                                <th className="hidden xl:table-cell">{t('season.bought')}</th>
                                <th>{t('season.sold')}</th>
                                <th>{t('season.left')}</th>
                                <th className="hidden xl:table-cell">{t('season.rate')}</th>
                                <th>{t('season.revenue')}</th>
                                {money && <th>{t('season.profit')}</th>}
                                <th className="w-px" />
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.map(row => (
                                <SeasonRow key={row.key} row={row} label={label(row.key)} money={money} canDiscount={canDiscount}
                                    open={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)} onClear={() => clear(row)} />
                            ))}
                            <tr className="font-semibold bg-dark-tertiary/40">
                                <td>{t('season.total')}</td>
                                <td className="tabular hidden xl:table-cell">{data.total.bought}{money && <div className="text-xs text-zinc-500 font-normal"><Money value={data.total.bought_cost} /></div>}</td>
                                <td className="tabular">{data.total.sold}</td>
                                <td className="tabular">{data.total.stock}</td>
                                <td className="tabular hidden xl:table-cell"><bdi>{data.total.rate === null ? '—' : `${Math.round(data.total.rate)} %`}</bdi></td>
                                <td><Money value={data.total.revenue} /></td>
                                {money && <td><Money value={data.total.profit} /></td>}
                                <td />
                            </tr>
                        </tbody>
                    </table>
                </div>
                </>
            )}
        </div>
    );
}

/**
 * For each season: the part of what was bought that sold (filled) over all
 * of it (the track). One measure, so one colour; the numbers are written
 * beside each bar (the table under it has the details).
 */
function SellThroughChart({ rows, label }) {
    const { t } = useT();
    const viz = useVizColors();
    return (
        <section className="card space-y-3" data-testid="season-chart">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{t('season.chartTitle')}</h3>
                <div className="flex items-center gap-4 text-xs text-zinc-400">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: viz.series[0] }} />{t('season.sold')}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: viz.track }} />{t('season.left')}</span>
                </div>
            </div>
            <ul className="space-y-3">
                {rows.map(row => {
                    const rate = row.rate === null ? 0 : Math.max(0, Math.min(100, row.rate));
                    return (
                        <li key={row.key} className="grid grid-cols-[minmax(7.5rem,10rem)_1fr_auto] items-center gap-3 text-sm"
                            title={`${label(row.key)} · ${t('season.chartSold', { sold: row.sold, total: row.bought })}`}>
                            <span dir="auto" className="font-medium leading-tight">{label(row.key)}</span>
                            <span className="h-3 rounded-full overflow-hidden" style={{ background: viz.track }} aria-hidden="true">
                                <span className="block h-full rounded-full" style={{ width: `${rate}%`, background: viz.series[0] }} />
                            </span>
                            <span className="text-xs text-zinc-400 whitespace-nowrap tabular">
                                <bdi className="font-semibold text-zinc-200">{Math.round(rate)} %</bdi> · {t('season.chartSold', { sold: row.sold, total: row.bought })}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function SeasonRow({ row, label, money, canDiscount, open, onToggle, onClear }) {
    const { t } = useT();
    const tone = row.rate === null ? '' : row.rate >= 70 ? 'text-emerald-300' : row.rate >= 40 ? 'text-amber-300' : 'text-red-300';
    return (
        <>
            <tr data-testid={`season-row-${row.key}`}>
                <td>
                    <button type="button" className="font-medium flex items-center gap-1.5 text-start" onClick={onToggle} aria-expanded={open}>
                        {open ? <ChevronUp className="w-4 h-4 flex-none" /> : <ChevronDown className="w-4 h-4 flex-none" />}
                        <span>{label}</span>
                    </button>
                    <div className="text-xs text-zinc-500">{t('season.articles', { n: row.articles })}</div>
                </td>
                <td className="tabular hidden xl:table-cell">{row.bought}{money && <div className="text-xs text-zinc-500"><Money value={row.bought_cost} /></div>}</td>
                <td className="tabular">{row.sold}{money && <div className="text-xs text-zinc-500"><Money value={row.sold_cost} /></div>}</td>
                <td className="tabular">{row.stock}{money && <div className="text-xs text-zinc-500"><Money value={row.stock_cost} /></div>}</td>
                <td className={`tabular font-semibold hidden xl:table-cell ${tone}`}><bdi>{row.rate === null ? '—' : `${Math.round(row.rate)} %`}</bdi></td>
                <td><Money value={row.revenue} /></td>
                {money && <td className={row.profit < 0 ? 'text-red-300' : ''}><Money value={row.profit} /></td>}
                <td>
                    {canDiscount && row.clearance.length > 0 && (
                        <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={onClear} data-testid={`season-clear-${row.key}`}>
                            <Tag className="w-4 h-4" /> {t('season.clearance')}
                        </Button>
                    )}
                </td>
            </tr>
            {open && (
                <tr>
                    <td colSpan={8} className="bg-dark-tertiary/30">
                        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                            {row.products.map(p => (
                                <li key={p.id} className="flex justify-between gap-3 min-w-0">
                                    <span className="truncate">{p.name}</span>
                                    <span className="text-zinc-400 tabular flex-none">{t('season.productLine', { sold: p.sold, left: p.stock })}</span>
                                </li>
                            ))}
                        </ul>
                    </td>
                </tr>
            )}
        </>
    );
}
