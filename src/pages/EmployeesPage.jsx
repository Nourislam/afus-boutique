import { t } from '../i18n';
import { formatDate as formatLocalDate, formatMoney } from '../i18n/format';
import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, UserCog, Shield, ShieldCheck, User, Clock, Receipt, ShoppingBag, Banknote } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { formatDuration } from '../components/shifts/ShiftSummaryDialog';
import { Button } from '../components/ui/Button';
import { Input, SearchInput } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeader, EmptyState } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { toast } from '../components/ui/Toast';
import { useAuthStore } from '../stores/authStore';
import { v4 as uuid } from 'uuid';
import { format } from 'date-fns';
import { ExcelImport } from '../components/ui/ExcelImport';
import { FileSpreadsheet } from 'lucide-react';

const roleIcons = {
    admin: ShieldCheck,
    manager: Shield,
    cashier: User,
};

const roleColors = {
    admin: 'bg-red-500/15 text-red-300',
    manager: 'bg-amber-500/15 text-amber-300',
    cashier: 'bg-sky-500/15 text-sky-300',
};

const PERIODS = ['today', 'week', 'month'];

/** Start and end of today, the last 7 days or the current month (local time). */
function periodRange(period) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (period === 'week') start.setDate(start.getDate() - 6);
    if (period === 'month') start.setDate(1);
    return { start, end };
}

const signedMoney = (n) => (Math.abs(n || 0) < 0.01 ? formatMoney(0) : `${n > 0 ? '+' : '−'}${formatMoney(Math.abs(n))}`);
const diffTone = (n) => (Math.abs(n || 0) < 0.01 ? 'text-emerald-400' : n > 0 ? 'text-amber-300' : 'text-rose-400');

function Stat({ label, value, tone = '' }) {
    return (
        <div className="px-2 py-2.5 border-dark-border [&:nth-child(3n+2)]:border-x [&:nth-child(n+4)]:border-t">
            <div className={`text-sm font-semibold tabular truncate ${tone}`}>{value}</div>
            <div className="text-[11px] text-zinc-500 truncate">{label}</div>
        </div>
    );
}

/** Every drawer of the period: who, when, expected and counted cash. */
function DrawerHistory({ shifts }) {
    if (!shifts.length) return <p className="text-center text-zinc-500 py-12">{t('employees.noDrawers')}</p>;
    return (
        <div className="card p-0 overflow-x-auto">
            <table className="table">
                <thead>
                    <tr>
                        <th>{t('employees.employee')}</th>
                        <th>{t('employees.opened')}</th>
                        <th>{t('employees.closedAt')}</th>
                        <th>{t('employees.hoursWorked')}</th>
                        <th>{t('reports.totalSales')}</th>
                        <th>{t('shift.expectedCash')}</th>
                        <th>{t('shift.closingCash')}</th>
                        <th>{t('employees.cashDiff')}</th>
                    </tr>
                </thead>
                <tbody>
                    {shifts.map(shift => {
                        const stats = shift.stats || {};
                        const diff = stats.cash_difference;
                        return (
                            <tr key={shift.id}>
                                <td className="font-medium">{shift.employee_name}</td>
                                <td className="whitespace-nowrap">{formatLocalDate(shift.start_time, 'datetime')}</td>
                                <td className="whitespace-nowrap">{shift.end_time ? formatLocalDate(shift.end_time, 'datetime') : <span className="badge bg-emerald-500/15 text-emerald-300">{t('shift.open')}</span>}</td>
                                <td className="tabular">{formatDuration(stats.duration_minutes)}</td>
                                <td className="tabular">{formatMoney(stats.total_sales || 0)}</td>
                                <td className="tabular">{formatMoney(stats.expected_cash || 0)}</td>
                                <td className="tabular">{shift.closing_cash === null || shift.closing_cash === undefined ? '—' : formatMoney(shift.closing_cash)}</td>
                                <td className={`tabular font-medium ${diff === null || diff === undefined ? '' : diffTone(diff)}`}>{diff === null || diff === undefined ? '—' : signedMoney(diff)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default function EmployeesPage() {
    const [employees, setEmployees] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState('today');
    const [view, setView] = useState('team');
    const [activity, setActivity] = useState([]);
    const [history, setHistory] = useState([]);

    const { currentEmployee, isAdmin } = useAuthStore();

    const loadData = async () => {
        try {
            const { start, end } = periodRange(period);
            const range = { startDate: start.toISOString(), endDate: end.toISOString() };
            const [data, act, shifts] = await Promise.all([
                window.electronAPI.employees.getAll(),
                window.electronAPI.shifts.getActivity(range).catch(() => []),
                window.electronAPI.shifts.getHistory(range).catch(() => []),
            ]);
            setEmployees(data);
            setActivity(act);
            setHistory(shifts);
        } catch {
            toast.error(t('employees.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, [period]);

    const filteredEmployees = employees.filter(employee =>
        employee.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        employee.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleDelete = async (employee) => {
        if (employee.id === currentEmployee.id) {
            toast.error(t('employees.notSelf'));
            return;
        }

        if (confirm(t('employees.deleteConfirm', { name: employee.name }))) {
            try {
                await window.electronAPI.employees.delete(employee.id);
                toast.success(t('employees.deleted'));
                loadData();
            } catch (error) {
                toast.error(t('employees.deleteFailed'));
            }
        }
    };

    const handleExcelImport = async (records) => {
        let successCount = 0;
        for (const record of records) {
            try {
                await window.electronAPI.employees.create({
                    id: uuid(),
                    name: record.name,
                    email: record.email || null,
                    pin: record.pin ? String(record.pin) : '0000', // Default PIN if missing
                    role: record.role?.toLowerCase() || 'cashier',
                    is_active: true,
                });
                successCount++;
            } catch (error) {
                console.error('Failed to import employee:', record.name, error);
            }
        }
        toast.success(`Imported ${successCount} employees`);
        loadData();
    };

    const getRoleIcon = (role) => {
        const Icon = roleIcons[role] || User;
        return <Icon className="w-4 h-4" />;
    };

    const range = periodRange(period);
    const activityOf = (id) => activity.find(a => a.id === id) || {};
    const team = activity.reduce((acc, a) => ({
        minutes: acc.minutes + (a.minutes_worked || 0),
        sales: acc.sales + (a.sales_total || 0),
        tickets: acc.tickets + (a.sales_count || 0),
        difference: acc.difference + (a.cash_difference || 0),
    }), { minutes: 0, sales: 0, tickets: 0, difference: 0 });

    return (
        <div className="page">
            <PageHeader
                icon={UserCog}
                title={t('nav.employees')}
                subtitle={t('employees.subtitle')}
                actions={isAdmin() && (
                    <>
                        <Button variant="secondary" onClick={() => setShowImportModal(true)}>
                            <FileSpreadsheet className="w-4 h-4" /> {t('common.importExcel')}
                        </Button>
                        <Button onClick={() => { setEditingEmployee(null); setShowModal(true); }}>
                            <Plus className="w-4 h-4" /> {t('employees.add')}
                        </Button>
                    </>
                )}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <div className="segmented">
                        {['team', 'drawers'].map(id => (
                            <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>{t(`employees.view.${id}`)}</button>
                        ))}
                    </div>
                    <div className="segmented">
                        {PERIODS.map(id => (
                            <button key={id} type="button" className={period === id ? 'active' : ''} onClick={() => setPeriod(id)}>{t(`employees.period.${id}`)}</button>
                        ))}
                    </div>
                    {view === 'team' && (
                        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder={t('employees.search')} className="w-64 max-w-full" />
                    )}
                </div>
            </PageHeader>

            <div className="page-body space-y-4">
                {/* Team totals for the period */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                        [Clock, t('employees.hoursWorked'), formatDuration(team.minutes)],
                        [Receipt, t('reports.totalSales'), formatMoney(team.sales)],
                        [ShoppingBag, t('shift.tickets'), team.tickets],
                        [Banknote, t('employees.cashDiff'), signedMoney(team.difference), diffTone(team.difference)],
                    ].map(([Icon, label, value, tone]) => (
                        <div key={label} className="card p-4">
                            <div className="text-xs text-zinc-500 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {label}</div>
                            <div className={`text-xl font-bold mt-1 tabular ${tone || ''}`}>{value}</div>
                        </div>
                    ))}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-48">
                        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : view === 'drawers' ? (
                    <DrawerHistory shifts={history} />
                ) : filteredEmployees.length === 0 ? (
                    <EmptyState icon={UserCog} title={t('employees.none')} description={t('employees.addHint')} />
                ) : (
                    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                        {filteredEmployees.map(employee => {
                            const act = activityOf(employee.id);
                            const avg = act.sales_count ? act.sales_total / act.sales_count : 0;
                            return (
                                <div key={employee.id} className={`card p-0 overflow-hidden ${employee.id === currentEmployee.id ? 'ring-1 ring-indigo-500/60' : ''} ${employee.is_active ? '' : 'opacity-60'}`}>
                                    <div className="p-4 flex items-start gap-3">
                                        <div className="w-11 h-11 rounded-full bg-indigo-500/15 flex items-center justify-center flex-none">
                                            <span className="text-lg font-semibold text-indigo-300">{employee.name.charAt(0)}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold flex items-center gap-2 truncate">
                                                {employee.name}
                                                {employee.id === currentEmployee.id && <span className="text-xs text-indigo-300">{t('employees.you')}</span>}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                <span className={`badge ${roleColors[employee.role] || roleColors.cashier}`}>
                                                    {getRoleIcon(employee.role)} {t(`role.${employee.role}`)}
                                                </span>
                                                {!employee.is_active && <Badge variant="danger">{t('status.inactive')}</Badge>}
                                                {act.open_shift_start && (
                                                    <span className="badge bg-emerald-500/15 text-emerald-300">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {t('employees.drawerOpenSince', { time: formatLocalDate(act.open_shift_start, 'time') })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 border-t border-dark-border text-center">
                                        <Stat label={t('employees.hoursWorked')} value={formatDuration(act.minutes_worked)} />
                                        <Stat label={t('reports.totalSales')} value={formatMoney(act.sales_total || 0)} />
                                        <Stat label={t('shift.tickets')} value={act.sales_count || 0} />
                                        <Stat label={t('shift.pieces')} value={act.items_sold || 0} />
                                        <Stat label={t('employees.avgBasket')} value={formatMoney(avg)} />
                                        <Stat label={t('employees.cashDiff')} value={act.closed_shifts ? signedMoney(act.cash_difference) : '—'} tone={act.closed_shifts ? diffTone(act.cash_difference) : ''} />
                                    </div>
                                    {act.refunds_count > 0 && (
                                        <p className="px-4 py-2 text-xs text-zinc-500 border-t border-dark-border">
                                            {t('employees.refundsLine', { n: act.refunds_count, amount: formatMoney(act.refunds_total) })}
                                        </p>
                                    )}

                                    {isAdmin() && (
                                        <div className="flex items-center gap-2 px-4 py-2 border-t border-dark-border">
                                            <span className="text-xs text-zinc-500 flex-1 truncate">{t('employees.since', { date: formatLocalDate(employee.created_at, 'date') })}</span>
                                            <Button variant="ghost" size="sm" onClick={() => { setEditingEmployee(employee); setShowModal(true); }}>
                                                <Edit2 className="w-3.5 h-3.5" /> {t('common.edit')}
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => handleDelete(employee)} disabled={employee.id === currentEmployee.id}
                                                aria-label={t('common.delete')} className="text-red-300 hover:bg-red-500/10">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                <p className="text-xs text-zinc-500">{t('employees.activityHint', { from: formatLocalDate(range.start, 'date'), to: formatLocalDate(range.end, 'date') })}</p>
            </div>

            {/* Employee Form Modal */}
            <EmployeeFormModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                employee={editingEmployee}
                onSave={() => { loadData(); setShowModal(false); }}
                currentUser={currentEmployee}
            />

            {/* Excel Import Modal */}
            <ExcelImport
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                dataType="employees"
                onImport={handleExcelImport}
                title={t('employees.import')}
            />
        </div>
    );
}

function EmployeeFormModal({ isOpen, onClose, employee, onSave, currentUser }) {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        pin: '',
        confirmPin: '',
        role: 'cashier',
        is_active: true,
    });
    const [loading, setLoading] = useState(false);

    // Only administrators can create other administrators
    const canCreateAdmin = currentUser?.role === 'admin';

    useEffect(() => {
        if (employee) {
            setFormData({
                name: employee.name,
                email: employee.email || '',
                pin: '',
                confirmPin: '',
                role: employee.role,
                is_active: employee.is_active,
            });
        } else {
            setFormData({
                name: '',
                email: '',
                pin: '',
                confirmPin: '',
                role: 'cashier',
                is_active: true,
            });
        }
    }, [employee, isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.name) {
            toast.error(t('customers.nameRequired'));
            return;
        }

        if (!employee && !formData.pin) {
            toast.error(t('employees.pinRequired'));
            return;
        }

        if (formData.pin && formData.pin !== formData.confirmPin) {
            toast.error(t('setup.pinMismatch'));
            return;
        }

        if (formData.pin && formData.pin.length !== 4) {
            toast.error(t('employees.pinFormat'));
            return;
        }

        setLoading(true);
        try {
            const data = {
                id: employee?.id || uuid(),
                name: formData.name,
                email: formData.email || null,
                role: formData.role,
                is_active: formData.is_active,
            };

            if (formData.pin) {
                data.pin = formData.pin;
            }

            if (employee) {
                await window.electronAPI.employees.update(data);
                toast.success(t('employees.updated'));
            } else {
                await window.electronAPI.employees.create(data);
                toast.success(t('employees.created'));
            }
            onSave();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={employee ? t('employees.edit') : t('employees.add')} size="md">
            <form onSubmit={handleSubmit}>
                <ModalBody>
                    <div className="space-y-4">
                        <Input
                            label={t('setup.adminName')}
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder={t('employees.namePlaceholder')}
                        />
                        <Input
                            label={t('shop.email')}
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            placeholder="email@example.com"
                        />
                        <Select
                            label={t('employees.role')}
                            value={formData.role}
                            onChange={(value) => setFormData({ ...formData, role: value })}
                            options={[
                                { value: 'cashier', label: t('role.cashier') },
                                { value: 'manager', label: t('role.manager') },
                                { value: 'admin', label: t('role.admin'), disabled: !canCreateAdmin },
                            ]}
                        />
                        {!canCreateAdmin && (
                            <p className="text-xs text-zinc-500 mt-1">{t('employees.adminOnly')}</p>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label={employee ? t('employees.newPin') : t('employees.pin')}
                                type="password"
                                maxLength={4}
                                value={formData.pin}
                                onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })}
                                placeholder={t('employees.pinPlaceholder')}
                            />
                            <Input
                                label={t('employees.confirmPin')}
                                type="password"
                                maxLength={4}
                                value={formData.confirmPin}
                                onChange={(e) => setFormData({ ...formData, confirmPin: e.target.value.replace(/\D/g, '') })}
                                placeholder={t('employees.confirmPin')}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="is_active"
                                checked={formData.is_active}
                                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                className="w-4 h-4 rounded bg-dark-tertiary border-dark-border"
                            />
                            <label htmlFor="is_active" className="text-sm">{t('status.active')}</label>
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                    <Button type="submit" loading={loading}>
                        {employee ? t('employees.update') : t('employees.add')}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
