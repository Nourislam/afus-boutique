import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Database, X } from 'lucide-react';
import { useT } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import { PERMISSIONS } from '../../lib/permissions';
import { backupReminder } from '../../lib/backupReminder';

/**
 * A slim bar for the owner when the data is not safe enough: no backup for a
 * week, or the second copy (USB key / other folder) failed. Shown on every
 * screen but the dashboard (which has the same alert), so a shop in the
 * simple menu (no dashboard) sees it too. Closed for this login only.
 */
export default function BackupReminder() {
    const { t } = useT();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const canSettings = useAuthStore(state => state.hasPermission(PERMISSIONS.SETTINGS_VIEW));
    const userId = useAuthStore(state => state.user?.id);
    const [reminder, setReminder] = useState(null);
    const [closed, setClosed] = useState(false);

    useEffect(() => { setClosed(false); }, [userId]);
    // Read again on each screen (a backup may have been made meanwhile)
    useEffect(() => {
        if (!canSettings || !window.electronAPI?.backup?.status) { setReminder(null); return; }
        window.electronAPI.backup.status().then(status => setReminder(backupReminder(status))).catch(() => setReminder(null));
    }, [canSettings, userId, pathname]);

    if (!reminder || closed || pathname === '/') return null;
    return (
        <div data-testid="backup-reminder" role="status"
            className="shrink-0 bg-amber-500/15 border-b border-amber-500/30 text-amber-200 px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Database className="w-4 h-4 shrink-0" />
            <span className="min-w-0">{t(reminder.key, reminder.params)}</span>
            <span className="ms-auto flex items-center gap-1">
                <button type="button" onClick={() => navigate('/settings?tab=backup')}
                    className="rounded-md bg-amber-500/20 px-2.5 py-0.5 font-semibold hover:bg-amber-500/30">{t(reminder.key === 'dash.alert.externalBackup' ? 'dash.do.checkBackup' : 'dash.do.backupNow')}</button>
                <button type="button" onClick={() => setClosed(true)} aria-label={t('common.close')} title={t('common.close')}
                    className="rounded-md p-1 hover:bg-amber-500/20"><X className="w-4 h-4" /></button>
            </span>
        </div>
    );
}
