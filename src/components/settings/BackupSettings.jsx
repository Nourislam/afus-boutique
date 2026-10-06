import { useEffect, useState } from 'react';
import {
    Database, Plus, Upload, FolderOpen, RotateCcw, Trash2, Download, Clock, User, Shield, FileInput, Lock, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';
import { formatDate } from '../../i18n/format';

const KIND_ICONS = { manual: User, auto: Clock, 'before-restore': Shield, imported: FileInput };
const KIND_STYLES = {
    manual: 'bg-indigo-500/15 text-indigo-300',
    auto: 'bg-emerald-500/15 text-emerald-300',
    'before-restore': 'bg-amber-500/15 text-amber-300',
    imported: 'bg-sky-500/15 text-sky-300',
};

/** 1 536 000 → "1.5 MB" */
export function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const ROWS = ['shopName', 'articles', 'pieces', 'sales', 'customers', 'employees', 'lastSale'];

/** Backup next to today's data, before it replaces it. */
function RestorePreview({ backup, onClose, onRestored }) {
    const { t } = useT();
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!backup) return;
        setInfo(null);
        setError('');
        window.electronAPI.backup.inspect(backup.name).then(setInfo).catch(err => setError(translateError(err)));
    }, [backup]);

    const value = (data, row) => {
        if (!data) return '…';
        if (row === 'lastSale') return data.lastSale ? formatDate(data.lastSale, 'datetime') : '—';
        if (row === 'shopName') return data.shopName || '—';
        return data[row] ?? '—';
    };
    const restore = async () => {
        setBusy(true);
        try {
            const result = await window.electronAPI.backup.restore(backup.name);
            if (!result.success) throw new Error(result.error);
            onRestored();
        } catch (err) {
            toast.error(t('settings.backup.restoreFailed', { error: translateError(err) }));
            setBusy(false);
        }
    };
    const invalid = info && !info.backup.valid;

    return (
        <Modal isOpen={!!backup} onClose={busy ? () => { } : onClose} title={t('backup.previewTitle')} size="lg">
            <ModalBody className="space-y-4">
                {backup && (
                    <p className="text-sm text-zinc-400">
                        {t('backup.previewOf', { date: formatDate(backup.createdAt, 'datetime'), size: `\u2066${formatSize(backup.size)}\u2069` })}
                    </p>
                )}
                {error && <p className="text-sm text-red-400">{error}</p>}
                {invalid ? (
                    <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                        <AlertTriangle className="w-4 h-4 flex-none" /> {t('backup.invalid')}
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-dark-border">
                        <table className="w-full text-sm">
                            <thead className="bg-dark-tertiary text-zinc-400">
                                <tr>
                                    <th className="text-start font-medium px-3 py-2" />
                                    <th className="text-start font-medium px-3 py-2">{t('backup.inBackup')}</th>
                                    <th className="text-start font-medium px-3 py-2">{t('backup.now')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-border">
                                {ROWS.map(row => (
                                    <tr key={row}>
                                        <td className="px-3 py-2 text-zinc-400">{t(`backup.row.${row}`)}</td>
                                        <td className="px-3 py-2 font-medium tabular"><bdi>{value(info?.backup, row)}</bdi></td>
                                        <td className="px-3 py-2 text-zinc-400 tabular"><bdi>{value(info?.current, row)}</bdi></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
                    <Shield className="w-4 h-4 mt-0.5 flex-none" /> {t('backup.restoreWarning')}
                </p>
            </ModalBody>
            <ModalFooter>
                <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
                <Button variant="danger" onClick={restore} loading={busy} disabled={!info || invalid}>
                    <RotateCcw className="w-4 h-4" /> {t('backup.restoreThis')}
                </Button>
            </ModalFooter>
        </Modal>
    );
}

/**
 * Settings › Backup: copies of the database kept in the data folder, with
 * their date and size; restore (after a preview), export to a USB key,
 * delete (after a confirmation), import from a file, and the optional daily
 * automatic copy.
 */
export function BackupSettings({ appInfo }) {
    const { t } = useT();
    const [data, setData] = useState(null);
    const [creating, setCreating] = useState(false);
    const [toRestore, setToRestore] = useState(null);
    const [toDelete, setToDelete] = useState(null);
    const [showReset, setShowReset] = useState(false);

    const load = async () => {
        try {
            setData(await window.electronAPI.backup.list());
        } catch (error) {
            toast.error(translateError(error));
        }
    };
    useEffect(() => { load(); }, []);

    const run = async (fn, okMessage) => {
        try {
            const result = await fn();
            if (result && result.success === false) {
                if (!result.canceled) toast.error(translateError(result.error));
                return null;
            }
            if (okMessage) toast.success(okMessage);
            await load();
            return result;
        } catch (error) {
            toast.error(translateError(error));
            return null;
        }
    };

    const create = async () => {
        setCreating(true);
        await run(() => window.electronAPI.backup.create(), t('settings.backup.exported'));
        setCreating(false);
    };
    const importFile = async () => {
        const result = await run(() => window.electronAPI.backup.import(), t('backup.imported'));
        // An imported file is only added: the shop sees what it holds before restoring it
        if (result?.backup) setToRestore(result.backup);
    };
    const exportCopy = (backup) => run(() => window.electronAPI.backup.export(backup.name), t('backup.exportedTo'));
    const remove = async () => {
        const backup = toDelete;
        setToDelete(null);
        await run(() => window.electronAPI.backup.delete(backup.name), t('backup.deleted'));
    };
    const saveAuto = async (patch) => {
        const next = { ...(data?.settings || {}), ...patch };
        setData(d => ({ ...d, settings: next }));
        await run(() => window.electronAPI.settings.set({ key: 'backup_settings', value: next }));
    };
    const reset = async () => {
        try {
            const result = await window.electronAPI.backup.reset();
            if (!result.success) throw new Error(result.error);
            toast.success(t('settings.backup.resetDone'));
            try { sessionStorage.removeItem('pos_auth'); } catch { /* ignore */ }
            setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
            toast.error(t('settings.backup.resetFailed', { error: translateError(error) }));
        }
    };

    const backups = data?.backups || [];
    const auto = data?.settings || {};

    // The demo shop never touches the shop's backups (checked again in the main process)
    if (data?.demo) {
        return (
            <Card className="border-orange-500/40">
                <p className="text-sm text-orange-200" data-testid="backup-demo-blocked">{t('demo.backupBlocked')}</p>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {/* Backups */}
            <Card className="space-y-4">
                <div className="flex flex-wrap items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center flex-none"><Database className="w-5 h-5" /></div>
                    <div className="flex-1 min-w-[12rem]">
                        <h3 className="font-semibold">{t('settings.backup.title')}</h3>
                        <p className="text-sm text-zinc-500">{t('backup.text')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={create} loading={creating}><Plus className="w-4 h-4" /> {t('backup.createNow')}</Button>
                        <Button variant="secondary" onClick={importFile}><Upload className="w-4 h-4" /> {t('backup.importFile')}</Button>
                        <Button variant="ghost" onClick={() => run(() => window.electronAPI.backup.openFolder())} title={data?.folder}>
                            <FolderOpen className="w-4 h-4" /> <span className="hidden sm:inline">{t('backup.openFolder')}</span>
                        </Button>
                    </div>
                </div>

                {data && backups.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-dark-border p-6 text-center text-sm text-zinc-500">{t('backup.none')}</div>
                ) : (
                    <ul className="rounded-lg border border-dark-border divide-y divide-dark-border">
                        {backups.map(backup => {
                            const Icon = KIND_ICONS[backup.kind] || User;
                            return (
                                <li key={backup.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                                    <Icon className="w-5 h-5 text-zinc-400 flex-none" />
                                    <div className="flex-1 min-w-[12rem]">
                                        <p className="text-sm font-medium"><bdi>{formatDate(backup.createdAt, 'long')}</bdi> · <bdi dir="ltr">{formatDate(backup.createdAt, 'time')}</bdi></p>
                                        <p className="text-xs text-zinc-500 flex flex-wrap items-center gap-2">
                                            <span className={`px-1.5 py-0.5 rounded ${KIND_STYLES[backup.kind] || ''}`}>{t(`backup.kind.${backup.kind}`)}</span>
                                            <bdi dir="ltr">{formatSize(backup.size)}</bdi>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button size="sm" variant="secondary" onClick={() => setToRestore(backup)}><RotateCcw className="w-4 h-4" /> {t('backup.restore')}</Button>
                                        <Button size="sm" variant="ghost" onClick={() => exportCopy(backup)} title={t('backup.export')} aria-label={t('backup.export')}><Download className="w-4 h-4" /></Button>
                                        <Button size="sm" variant="ghost" onClick={() => setToDelete(backup)} title={t('common.delete')} aria-label={t('common.delete')}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
                <p className="text-xs text-zinc-500">{t('backup.whereHint')}</p>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                {/* Daily automatic copy */}
                <Card className="space-y-3">
                    <div className="flex items-start gap-3">
                        <Clock className="w-5 h-5 text-emerald-400 mt-0.5 flex-none" />
                        <div className="flex-1 min-w-0">
                            <h4 className="font-semibold">{t('backup.autoTitle')}</h4>
                            <p className="text-xs text-zinc-500">{t('backup.autoText')}</p>
                        </div>
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer select-none rounded-lg border border-dark-border px-3 py-2.5 hover:border-zinc-600">
                        <input type="checkbox" checked={!!auto.autoDaily} onChange={(e) => saveAuto({ autoDaily: e.target.checked })}
                            className="w-4 h-4 rounded bg-dark-tertiary border-dark-border flex-none" />
                        <span className="text-sm">{t('backup.autoOn')}</span>
                    </label>
                    {auto.autoDaily && (
                        <Select
                            label={t('backup.keep')}
                            value={String(auto.keepAuto || 7)}
                            onChange={(v) => saveAuto({ keepAuto: parseInt(v, 10) })}
                            options={[7, 14, 30].map(n => ({ value: String(n), label: t('backup.keepN', { n }) }))}
                        />
                    )}
                </Card>

                {/* Where the data is */}
                <Card className="space-y-3">
                    <div className="flex items-center gap-3">
                        <Lock className="w-5 h-5 text-zinc-300 flex-none" />
                        <span className="font-semibold flex-1">{t('settings.db.local')}</span>
                        <CheckCircle className="w-5 h-5 text-accent-primary" />
                    </div>
                    <p className="text-xs text-zinc-500">{t('settings.db.localText')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        <span className="text-zinc-500">{t('settings.db.version')}</span>
                        <span className="font-medium ltr">{appInfo?.version || '-'}</span>
                        <span className="text-zinc-500">{t('settings.db.file')}</span>
                        <span className="font-mono text-xs break-all ltr">{appInfo?.databasePath || 'SQLite'}</span>
                    </div>
                </Card>
            </div>

            {/* Erase everything, kept apart */}
            <Card className="border-red-500/30">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                        <h4 className="font-medium text-red-300">{t('settings.backup.reset')}</h4>
                        <p className="text-sm text-zinc-400">{t('settings.backup.resetText')}</p>
                    </div>
                    <Button variant="danger" onClick={() => setShowReset(true)}>{t('settings.backup.resetButton')}</Button>
                </div>
            </Card>

            <RestorePreview
                backup={toRestore}
                onClose={() => setToRestore(null)}
                onRestored={() => {
                    setToRestore(null);
                    toast.success(t('settings.backup.restored'));
                    // The employees come from the restored data: log in again
                    try { sessionStorage.removeItem('pos_auth'); } catch { /* ignore */ }
                    setTimeout(() => window.location.reload(), 1500);
                }}
            />
            <ConfirmDialog
                isOpen={!!toDelete}
                onClose={() => setToDelete(null)}
                onConfirm={remove}
                title={t('backup.deleteTitle')}
                message={toDelete ? t('backup.deleteConfirm', { date: formatDate(toDelete.createdAt, 'datetime') }) : ''}
                confirmText={t('common.delete')}
                variant="danger"
            />
            <ConfirmDialog
                isOpen={showReset}
                onClose={() => setShowReset(false)}
                onConfirm={reset}
                title={t('settings.backup.reset')}
                message={t('settings.backup.resetConfirm')}
                confirmText={t('settings.backup.resetButton')}
                variant="danger"
            />
        </div>
    );
}

export default BackupSettings;
