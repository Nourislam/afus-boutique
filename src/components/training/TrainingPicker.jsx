import { CheckCircle2 } from 'lucide-react';
import { Modal, ModalBody } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';
import { useTrainingStore } from '../../stores/trainingStore';
import { EXERCISES } from '../../lib/trainingExercises';

/** The five guided exercises: pick one, the bar then guides it step by step. */
export default function TrainingPicker() {
    const { t } = useT();
    const { done, openPicker, startExercise } = useTrainingStore();

    return (
        <Modal isOpen onClose={() => openPicker(false)} title={t('training.coachTitle')} size="lg">
            <ModalBody>
                <p className="text-sm text-zinc-400 mb-4">{t('training.coachHint')}</p>
                <ol className="space-y-2" data-testid="training-picker">
                    {EXERCISES.map((exercise, index) => {
                        const passed = done.includes(exercise.id);
                        return (
                            <li key={exercise.id} className="flex items-center gap-3 rounded-xl border border-dark-border p-3">
                                <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center font-bold ${passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-dark-tertiary'}`}>
                                    {passed ? <CheckCircle2 className="w-5 h-5" /> : index + 1}
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="block font-semibold">
                                        {t(`training.ex.${exercise.id}.title`)}
                                        {passed && <span className="ms-2 text-xs text-emerald-400">{t('training.doneMark')}</span>}
                                    </span>
                                    <span className="block text-sm text-zinc-400">{t(`training.ex.${exercise.id}.goal`)}</span>
                                </span>
                                <Button size="sm" variant={passed ? 'secondary' : 'primary'} onClick={() => startExercise(exercise.id)}
                                    data-testid={`training-start-${exercise.id}`}>
                                    {passed ? t('training.again') : t('training.startExercise')}
                                </Button>
                            </li>
                        );
                    })}
                </ol>
            </ModalBody>
        </Modal>
    );
}
