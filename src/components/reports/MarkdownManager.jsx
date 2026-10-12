import { useCallback, useEffect, useState } from 'react';
import { Check, X, TrendingDown, Award } from 'lucide-react';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { Section, Money, Spinner, Empty, Row } from '../dashboard/parts';
import { translateError } from '../../i18n/errors';
import { formatDate } from '../../i18n/format';
import { useT } from '../../i18n';

const VERDICT_STYLE = {
    worked: 'bg-emerald-500/15 text-emerald-300',
    some: 'bg-sky-500/15 text-sky-300',
    no: 'bg-red-500/15 text-red-300',
    early: 'bg-zinc-500/20 text-zinc-400',
};

/**
 * Markdown manager: discount steps (10 %, 20 %, 30 %) suggested on the
 * articles that do not sell. Nothing is applied until the owner approves a
 * line (a 14-day promotion on that article); a refused line comes back in
 * 14 days at the earliest. Under it: did each approved markdown work?
 * money: purchase prices (a step under the purchase price is flagged).
 */
export default function MarkdownManager({ money, canDecide }) {
    const { t } = useT();
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(null);

    const load = useCallback(() => {
        window.electronAPI.insights.markdowns()
            .then(setData)
            .catch(() => setData({ suggestions: [], results: [] }));
    }, []);
    useEffect(() => { load(); }, [load]);

    const decide = async (row, approve) => {
        setBusy(row.product_id);
        try {
            await window.electronAPI.insights.markdownDecide({
                productId: row.product_id, percent: row.step, approve,
                name: t('markdown.promoName', { n: row.step, name: row.name }),
            });
            toast.success(approve ? t('markdown.approved', { n: row.step }) : t('markdown.refused'));
            load();
        } catch (error) {
            toast.error(translateError(error));
        } finally {
            setBusy(null);
        }
    };

    if (!data) return <Spinner />;
    return (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4" data-testid="markdowns">
            <Section title={t('markdown.title')} icon={TrendingDown}>
                <p className="text-xs text-zinc-500">{t('markdown.hint')}</p>
                {data.suggestions.length === 0 ? <Empty good>{t('markdown.none')}</Empty> : (
                    <ul className="divide-y divide-dark-border" data-testid="markdown-suggestions">
                        {data.suggestions.map(row => (
                            <Row key={row.product_id} aside={canDecide && (
                                <>
                                    <Button size="sm" onClick={() => decide(row, true)} loading={busy === row.product_id} data-testid={`markdown-approve-${row.product_id}`}>
                                        <Check className="w-4 h-4" /> {t('markdown.approve', { n: row.step })}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => decide(row, false)} disabled={busy === row.product_id} data-testid={`markdown-refuse-${row.product_id}`} aria-label={t('markdown.refuse')} title={t('markdown.refuse')}>
                                        <X className="w-4 h-4" />
                                    </Button>
                                </>
                            )}>
                                <p className="font-medium truncate flex items-center gap-2">
                                    <span className="truncate">{row.name}</span>
                                    <span className="badge bg-amber-500/15 text-amber-300 flex-none"><span dir="ltr">-{row.step}%</span></span>
                                </p>
                                <p className="text-xs text-zinc-500">
                                    {t('markdown.why', { stock: row.stock, sold: row.sold, rate: Math.round(row.rate) })}
                                    {row.previous_step && <> · {t('markdown.after', { n: row.previous_step })}</>}
                                </p>
                                <p className="text-xs mt-0.5">
                                    <span className="line-through text-zinc-500"><Money value={row.price} /></span>{' → '}<Money value={row.new_price} className="font-semibold" />
                                    {money && row.below_cost && <span className="text-red-300"> · {t('markdown.belowCost')}</span>}
                                </p>
                            </Row>
                        ))}
                    </ul>
                )}
            </Section>

            <Section title={t('markdown.results')} icon={Award}>
                <p className="text-xs text-zinc-500">{t('markdown.resultsHint')}</p>
                {data.results.length === 0 ? <Empty>{t('markdown.noResults')}</Empty> : (
                    <ul className="divide-y divide-dark-border" data-testid="markdown-results">
                        {data.results.map(row => (
                            <Row key={row.id} aside={(
                                <span className={`badge whitespace-nowrap ${VERDICT_STYLE[row.verdict]}`} data-testid={`markdown-verdict-${row.product_id}`}>{t(`markdown.verdict.${row.verdict}`)}</span>
                            )}>
                                <p className="font-medium truncate flex items-center gap-2">
                                    <span className="truncate">{row.name || '—'}</span>
                                    <span className="badge bg-dark-tertiary text-zinc-300 flex-none"><span dir="ltr">-{row.percent}%</span></span>
                                    {row.running && <span className="badge bg-indigo-500/15 text-indigo-300 flex-none">{t('markdown.running')}</span>}
                                </p>
                                <p className="text-xs text-zinc-500">
                                    {t('markdown.dates', { from: formatDate(row.started_at), to: formatDate(row.ends_at) })}
                                </p>
                                <p className="text-xs text-zinc-400">
                                    {t('markdown.pace', { before: row.rate_before, during: row.rate_during, sold: row.sold })} · <Money value={row.revenue} />
                                </p>
                            </Row>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
}
