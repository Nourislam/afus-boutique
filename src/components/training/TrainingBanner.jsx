import { useEffect, useState } from 'react';
import { GraduationCap, ListChecks, LogOut, CheckCircle2, AlertCircle, RotateCcw, X } from 'lucide-react';
import { useT } from '../../i18n';
import { toast } from '../ui/Toast';
import { translateError } from '../../i18n/errors';
import { useTrainingStore } from '../../stores/trainingStore';
import { useCartStore } from '../../stores/cartStore';
import { EXERCISES, exerciseState } from '../../lib/trainingExercises';
import TrainingPicker from './TrainingPicker';

const GLOW = 'training-glow';

function clearGlow() {
    document.querySelectorAll(`.${GLOW}`).forEach(el => el.classList.remove(GLOW));
}

/**
 * The training bar: always visible while training mode is on, so nobody
 * mistakes the copy for the real shop. It also guides the running exercise:
 * the step to do, the part of the screen lit up, passed or not.
 * compact: on the login screen (no exercise guidance there).
 */
export default function TrainingBanner({ compact = false }) {
    const { t } = useT();
    const { active, current, base, done, pickerOpen, load, stop, openPicker, startExercise, finishExercise, closeExercise } = useTrainingStore();
    const [state, setState] = useState(null);

    useEffect(() => {
        load();
        if (compact) return;
        try {
            const notice = sessionStorage.getItem('training_notice');
            if (notice) {
                sessionStorage.removeItem('training_notice');
                toast.success(t(notice === 'started' ? 'training.started' : 'training.stopped'));
            }
        } catch { /* storage unavailable */ }
    }, [load, compact, t]);

    const exercise = EXERCISES.find(e => e.id === current) || null;

    // Follow the exercise: what happened in the training copy and on screen
    useEffect(() => {
        if (!active || !exercise || compact) { setState(null); clearGlow(); return undefined; }
        let cancelled = false;
        const tick = async () => {
            let progress = null;
            try { progress = await window.electronAPI.training.progress(); } catch { return; }
            if (cancelled) return;
            const cart = useCartStore.getState();
            const ctx = {
                hash: window.location.hash,
                cart: { items: cart.items, customer: cart.customer },
                progress, base,
                has: (selector) => !!document.querySelector(selector),
            };
            const next = exerciseState(exercise, ctx);
            setState(next);
            if (next.finished && !done.includes(exercise.id)) finishExercise(exercise.id);
            clearGlow();
            if (!next.finished && !next.failed) {
                const target = exercise.steps[next.step]?.target;
                if (target) document.querySelector(target)?.classList.add(GLOW);
            }
        };
        tick();
        const timer = setInterval(tick, 800);
        return () => { cancelled = true; clearInterval(timer); clearGlow(); };
    }, [active, exercise, base, done, compact, finishExercise]);

    if (!active) return null;

    const leave = async () => {
        if (!confirm(t('training.exitConfirm'))) return;
        try { await stop(); } catch (e) { toast.error(translateError(e)); }
    };

    const total = exercise?.steps.length || 0;
    const stepIndex = state ? Math.min(state.step, total - 1) : 0;

    return (
        <>
            <div data-testid="training-banner" role="status"
                className="shrink-0 bg-amber-500 text-zinc-950 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="flex items-center gap-2 font-bold min-w-0">
                    <GraduationCap className="w-5 h-5 shrink-0" />
                    <span>{t('training.banner')}</span>
                </span>

                {!compact && exercise && state && (
                    <span data-testid="training-step" className="flex items-center gap-2 rounded-lg bg-zinc-950/10 px-3 py-1 min-w-0">
                        <span className="font-semibold">{t(`training.ex.${exercise.id}.title`)}:</span>
                        {state.finished ? (
                            <span className="flex items-center gap-1 font-semibold text-emerald-900">
                                <CheckCircle2 className="w-4 h-4" /> {t('training.success')}
                            </span>
                        ) : state.failed ? (
                            <span className="flex items-center gap-1 font-semibold text-red-900" role="alert">
                                <AlertCircle className="w-4 h-4" /> {t('training.failed')} — {t(`training.fail.${state.failed}`)}
                            </span>
                        ) : (
                            <>
                                <span className="text-xs opacity-80 whitespace-nowrap">{t('training.stepOf', { n: stepIndex + 1, total })}</span>
                                <span>{t(`training.step.${exercise.steps[stepIndex].id}`)}</span>
                            </>
                        )}
                        {(state.finished || state.failed) && (
                            <button type="button" onClick={() => startExercise(exercise.id)} data-testid="training-again"
                                className="flex items-center gap-1 underline font-semibold">
                                <RotateCcw className="w-3.5 h-3.5" /> {t('training.again')}
                            </button>
                        )}
                        <button type="button" onClick={closeExercise} aria-label={t('training.hide')} title={t('training.hide')} className="opacity-70 hover:opacity-100">
                            <X className="w-4 h-4" />
                        </button>
                    </span>
                )}

                {!compact && (
                    <span className="ms-auto flex items-center gap-2">
                        <button type="button" onClick={() => openPicker(true)} data-testid="training-exercises"
                            className="flex items-center gap-1.5 rounded-lg bg-zinc-950 text-amber-300 px-3 py-1 font-semibold hover:bg-zinc-800">
                            <ListChecks className="w-4 h-4" /> {t('training.exercises')} <span className="tabular">{done.length}/{EXERCISES.length}</span>
                        </button>
                        <button type="button" onClick={leave} data-testid="training-exit"
                            className="flex items-center gap-1.5 rounded-lg border border-zinc-950 px-3 py-1 font-semibold hover:bg-amber-400">
                            <LogOut className="w-4 h-4" /> {t('training.exit')}
                        </button>
                    </span>
                )}
            </div>
            {!compact && pickerOpen && <TrainingPicker />}
        </>
    );
}
