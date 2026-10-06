import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, GraduationCap, PackagePlus } from 'lucide-react';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { useTrainingStore } from '../../stores/trainingStore';

/**
 * A shop that has never sold: how the first sale goes, in three short steps,
 * and the offer to try it first in training mode (nothing is kept there).
 * Shown in the empty ticket of the sales screen until the first real sale.
 */
export default function FirstSaleGuide() {
    const { t } = useT();
    const navigate = useNavigate();
    const trainingActive = useTrainingStore(state => state.active);
    const startTraining = useTrainingStore(state => state.start);
    const [steps, setSteps] = useState(null);
    const [starting, setStarting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        window.electronAPI.dashboard.firstSteps()
            .then(data => { if (!cancelled) setSteps(data); })
            .catch(() => { if (!cancelled) setSteps(null); });
        return () => { cancelled = true; };
    }, []);

    // Only before the first real sale (training has its own guide)
    if (!steps || steps.sales > 0 || trainingActive) return null;

    const practise = async () => {
        setStarting(true);
        try {
            await startTraining('sale');
        } catch (e) {
            if (!e?.cancelled) toast.error(translateError(e));
            setStarting(false);
        }
    };

    return (
        <div className="mt-4 w-full rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-start text-sm text-zinc-300" data-testid="first-sale-guide">
            <p className="font-semibold text-zinc-100 flex items-center gap-2"><Rocket className="w-4 h-4 text-indigo-300" /> {t('pos.first.title')}</p>
            <ol className="mt-2 space-y-1 list-decimal ps-5">
                <li>{t('pos.first.step1')}</li>
                <li>{t('pos.first.step2')}</li>
                <li>{t('pos.first.step3')}</li>
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
                {steps.products === 0 && (
                    <Button size="sm" onClick={() => navigate('/products')}><PackagePlus className="w-4 h-4" /> {t('dash.first.product')}</Button>
                )}
                <Button size="sm" variant="secondary" onClick={practise} loading={starting} data-testid="first-sale-training">
                    <GraduationCap className="w-4 h-4" /> {t('pos.first.practise')}
                </Button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">{t('training.startHint')}</p>
        </div>
    );
}
