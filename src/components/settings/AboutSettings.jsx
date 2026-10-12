import { useEffect, useState } from 'react';
import { Info, KeyRound, RefreshCw, LifeBuoy, FileText, FolderOpen, CheckCircle, AlertTriangle, Store } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { formatSize } from './BackupSettings';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';

const LICENSE_TONE = { valid: 'text-emerald-400', expired: 'text-amber-400', invalid: 'text-red-400', none: 'text-zinc-400', not_configured: 'text-zinc-500' };

/**
 * Settings › About: the version, the reseller's support contacts, the
 * offline licence (never blocks the shop), updates and the support file.
 */
export function AboutSettings() {
    const { t } = useT();
    const [info, setInfo] = useState(null);
    const [key, setKey] = useState('');
    const [update, setUpdate] = useState(null);
    const [checking, setChecking] = useState(false);

    const [demoData, setDemoData] = useState(null);
    const [confirmDemo, setConfirmDemo] = useState(false);
    const load = () => {
        window.electronAPI.support.about().then(setInfo).catch(() => setInfo(null));
        window.electronAPI.demo?.data?.().then(setDemoData).catch(() => setDemoData(null));
    };
    useEffect(() => { load(); }, []);
    // The demo shop's data is kept until the owner deletes it here
    const deleteDemo = async () => {
        setConfirmDemo(false);
        try {
            await window.electronAPI.demo.discard();
            toast.success(t('about.demoDeleted'));
            load();
        } catch (error) { toast.error(translateError(error)); }
    };

    const saveKey = async () => {
        try {
            const result = await window.electronAPI.support.setLicense(key);
            if (result.status === 'valid') { toast.success(t('about.licenseSaved')); setKey(''); load(); } else toast.error(t(`about.license.${result.status}`));
        } catch (error) { toast.error(translateError(error)); }
    };
    const check = async () => {
        setChecking(true);
        try { setUpdate(await window.electronAPI.support.checkUpdate()); } catch { setUpdate({ error: 'UPDATE_UNREACHABLE' }); } finally { setChecking(false); }
    };
    const bundle = async () => {
        try {
            const result = await window.electronAPI.support.bundle();
            if (result?.success) toast.success(t('about.bundleSaved'));
        } catch (error) { toast.error(translateError(error)); }
    };

    if (!info) return null;
    const status = info.license?.status || 'not_configured';
    const contacts = [info.supportPhone, info.supportEmail, info.supportWebsite].filter(Boolean);
    return (
        <div className="space-y-4" data-testid="about">
            <Card className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2"><Info className="w-5 h-5 text-indigo-300" /> {t('about.title')}</h3>
                <p className="text-sm">{t('about.version', { version: info.version })}</p>
                {info.reseller && <p className="text-sm text-zinc-400">{t('about.reseller', { name: info.reseller })}</p>}
            </Card>

            <Card className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2"><LifeBuoy className="w-5 h-5 text-sky-300" /> {t('about.support')}</h3>
                {contacts.length ? (
                    <ul className="text-sm space-y-1">{contacts.map(c => <li key={c} className="ltr" dir="ltr">{c}</li>)}</ul>
                ) : <p className="text-sm text-zinc-500">{t('about.noContacts')}</p>}
                <p className="text-xs text-zinc-500">{t('about.bundleHint')}</p>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={bundle} data-testid="support-bundle"><FileText className="w-4 h-4" /> {t('about.bundle')}</Button>
                    <Button variant="ghost" onClick={() => window.electronAPI.support.openLogs()}><FolderOpen className="w-4 h-4" /> {t('about.logs')}</Button>
                </div>
            </Card>

            <Card className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2"><KeyRound className="w-5 h-5 text-amber-300" /> {t('about.licenseTitle')}</h3>
                <p className={`text-sm ${LICENSE_TONE[status]}`} data-testid="license-status">
                    {t(`about.license.${status}`)}
                    {info.license?.license?.shop && <> — <bdi>{info.license.license.shop}</bdi></>}
                </p>
                <p className="text-xs text-zinc-500">{t('about.licenseNeverBlocks')}</p>
                {status !== 'not_configured' && (
                    <div className="flex flex-wrap items-end gap-2">
                        <Input label={t('about.licenseKey')} value={key} onChange={(e) => setKey(e.target.value)} className="font-mono ltr" containerClassName="flex-1 min-w-[16rem]" />
                        <Button onClick={saveKey} disabled={!key.trim()}>{t('common.save')}</Button>
                    </div>
                )}
            </Card>

            {demoData?.exists && (
                <Card className="space-y-3" data-testid="demo-data">
                    <h3 className="font-semibold flex items-center gap-2"><Store className="w-5 h-5 text-orange-300" /> {t('about.demoTitle')}</h3>
                    <p className="text-sm text-zinc-400">{t('about.demoText', { size: formatSize(demoData.bytes) })}</p>
                    <Button variant="danger" onClick={() => setConfirmDemo(true)} data-testid="demo-delete">{t('about.demoDelete')}</Button>
                    <ConfirmDialog isOpen={confirmDemo} onClose={() => setConfirmDemo(false)} onConfirm={deleteDemo}
                        title={t('about.demoDelete')} message={t('about.demoConfirm')} confirmText={t('common.delete')} variant="danger" />
                </Card>
            )}

            <Card className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2"><RefreshCw className="w-5 h-5 text-emerald-300" /> {t('about.updates')}</h3>
                {!info.updatesConfigured ? (
                    <p className="text-sm text-zinc-500">{t('about.updatesNotConfigured')}</p>
                ) : (
                    <>
                        <Button variant="secondary" onClick={check} loading={checking}><RefreshCw className="w-4 h-4" /> {t('about.checkUpdates')}</Button>
                        {update && (update.error ? (
                            <p className="text-sm text-amber-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {t('about.updateUnreachable')}</p>
                        ) : update.available ? (
                            <div className="space-y-2">
                                <p className="text-sm text-emerald-400">{t('about.updateAvailable', { version: update.version })}</p>
                                {update.notes && <p className="text-xs text-zinc-400 whitespace-pre-line">{update.notes}</p>}
                                {update.url && <Button onClick={() => window.electronAPI.support.openUpdate(update.url)}>{t('about.download')}</Button>}
                                <p className="text-xs text-zinc-500">{t('about.updateHint')}</p>
                            </div>
                        ) : (
                            <p className="text-sm text-emerald-400 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {t('about.upToDate')}</p>
                        ))}
                    </>
                )}
            </Card>
        </div>
    );
}

export default AboutSettings;
