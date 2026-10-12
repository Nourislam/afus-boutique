import { BACKUP_OLD_DAYS } from './dashboard';

const DAY = 24 * 60 * 60 * 1000;

/**
 * What to remind the owner about the backups, or null when all is well.
 * status: { demo, training, lastBackupAt, external: { ok } | null }
 */
export function backupReminder(status, now = new Date()) {
    if (!status || status.demo || status.training) return null;
    if (!status.lastBackupAt) return { key: 'dash.alert.noBackup' };
    const days = Math.floor((now.getTime() - new Date(status.lastBackupAt).getTime()) / DAY);
    if (days >= BACKUP_OLD_DAYS) return { key: 'dash.alert.oldBackup', params: { n: days } };
    if (status.external && status.external.ok === false) return { key: 'dash.alert.externalBackup' };
    return null;
}
