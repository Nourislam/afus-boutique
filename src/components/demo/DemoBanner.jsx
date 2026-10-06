import { useEffect, useState } from 'react';
import { Store, RotateCcw, LogOut } from 'lucide-react';
import { useT } from '../../i18n';
import { toast } from '../ui/Toast';
import { translateError } from '../../i18n/errors';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useDemoStore } from '../../stores/demoStore';

/**
 * The demo shop bar: on every screen while the demo shop is open, so its
 * sample data is never taken for the real shop. Start the demo again, or
 * leave it for the real shop (nothing is copied over).
 */
export default function DemoBanner() {
    const { t, lang } = useT();
    const { active, load, reset, exit } = useDemoStore();
    const [confirm, setConfirm] = useState(null); // 'reset' | 'exit'
    const [busy, setBusy] = useState(false);

    useEffect(() => { load(); }, [load]);

    if (!active) return null;

    const run = async () => {
        setBusy(true);
        try {
            if (confirm === 'reset') await reset(lang);
            else await exit();
        } catch (e) {
            toast.error(translateError(e));
            setBusy(false);
            setConfirm(null);
        }
    };

    return (
        <>
            <div data-testid="demo-banner" role="status"
                className="shrink-0 bg-orange-600 text-white px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="flex items-center gap-2 font-bold min-w-0">
                    <Store className="w-5 h-5 shrink-0" />
                    <span>{t('demo.banner')}</span>
                </span>
                <span className="ms-auto flex items-center gap-2">
                    <button type="button" onClick={() => setConfirm('reset')} disabled={busy} data-testid="demo-reset"
                        className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1 font-semibold hover:bg-white/25">
                        <RotateCcw className="w-4 h-4" /> {t('demo.reset')}
                    </button>
                    <button type="button" onClick={() => setConfirm('exit')} disabled={busy} data-testid="demo-exit"
                        className="flex items-center gap-1.5 rounded-lg bg-white text-orange-700 px-3 py-1 font-semibold hover:bg-orange-50">
                        <LogOut className="w-4 h-4 flip-rtl" /> {t('demo.exit')}
                    </button>
                </span>
            </div>
            <ConfirmDialog
                isOpen={!!confirm}
                onClose={() => { if (!busy) setConfirm(null); }}
                onConfirm={run}
                variant={confirm === 'reset' ? 'danger' : 'warning'}
                title={t(confirm === 'reset' ? 'demo.resetTitle' : 'demo.exitTitle')}
                message={t(confirm === 'reset' ? 'demo.resetText' : 'demo.exitText')}
                confirmText={t(confirm === 'reset' ? 'demo.resetConfirm' : 'demo.exitConfirm')}
            />
        </>
    );
}
