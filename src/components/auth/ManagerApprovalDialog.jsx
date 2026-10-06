import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { useT } from '../../i18n';
import { useApprovalStore } from '../../stores/approvalStore';

/** Asks a manager (or the owner) to type their PIN. Mounted once in the app. */
export default function ManagerApprovalDialog() {
    const { t } = useT();
    const request = useApprovalStore(state => state.request);
    const finish = useApprovalStore(state => state.finish);
    const [managers, setManagers] = useState([]);
    const [employeeId, setEmployeeId] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        if (!request) return;
        setPin(''); setError('');
        window.electronAPI.employees.getAll().then(rows => {
            const list = (rows || []).filter(e => ['admin', 'manager'].includes(String(e.role).toLowerCase()));
            setManagers(list);
            setEmployeeId(list[0]?.id || '');
        }).catch(() => setManagers([]));
    }, [request]);

    if (!request) return null;

    const approve = async () => {
        if (!employeeId || !pin) return;
        setChecking(true);
        try {
            const result = await window.electronAPI.auth.approve({ employeeId, pin });
            if (result?.ok) finish({ employeeId, pin });
            else { setError(t('approval.wrongPin')); setPin(''); }
        } catch {
            setError(t('approval.wrongPin'));
        } finally {
            setChecking(false);
        }
    };

    return (
        <Modal isOpen onClose={() => finish(null)} title={t('approval.title')} size="sm">
            <ModalBody>
                <div className="space-y-4" data-testid="manager-approval">
                    <p className="text-sm text-amber-300 flex gap-2"><ShieldCheck className="w-5 h-5 flex-none" /> <span>{request.message}</span></p>
                    {managers.length === 0 ? <p className="text-sm text-red-400">{t('approval.noManager')}</p> : (
                        <>
                            <Select label={t('approval.who')} value={employeeId} onChange={setEmployeeId}
                                options={managers.map(m => ({ value: m.id, label: m.name }))} />
                            <div className="form-group">
                                <label className="form-label" htmlFor="approval-pin">{t('approval.pin')}</label>
                                <input id="approval-pin" type="password" inputMode="numeric" autoFocus maxLength={6} value={pin}
                                    onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') approve(); }}
                                    className="input text-center tracking-[0.5em] ltr" />
                            </div>
                            {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
                        </>
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                <Button variant="secondary" onClick={() => finish(null)}>{t('common.cancel')}</Button>
                <Button onClick={approve} loading={checking} disabled={!pin || !employeeId}>{t('approval.confirm')}</Button>
            </ModalFooter>
        </Modal>
    );
}
