import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, UserCog, Shield, ShieldCheck, User } from 'lucide-react';
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
    admin: 'bg-red-500/20 text-red-400',
    manager: 'bg-amber-500/20 text-amber-400',
    cashier: 'bg-blue-500/20 text-blue-400',
};

export default function EmployeesPage() {
    const [employees, setEmployees] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [loading, setLoading] = useState(true);

    const { currentEmployee, isAdmin } = useAuthStore();

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const data = await window.electronAPI.employees.getAll();
            setEmployees(data);
        } catch (error) {
            toast.error('Failed to load employees');
        } finally {
            setLoading(false);
        }
    };

    const filteredEmployees = employees.filter(employee =>
        employee.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        employee.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleDelete = async (employee) => {
        if (employee.id === currentEmployee.id) {
            toast.error('Cannot delete yourself');
            return;
        }

        if (confirm(`Delete employee "${employee.name}"?`)) {
            try {
                await window.electronAPI.employees.delete(employee.id);
                toast.success('Employee deleted');
                loadData();
            } catch (error) {
                toast.error('Failed to delete employee');
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

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-dark-border">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">Employees</h1>
                        <p className="text-zinc-500">Manage staff and access levels</p>
                    </div>
                    {isAdmin() && (
                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={() => setShowImportModal(true)}>
                                <FileSpreadsheet className="w-4 h-4" />
                                Import Excel
                            </Button>
                            <Button onClick={() => {
                                setEditingEmployee(null);
                                setShowModal(true);
                            }}>
                                <Plus className="w-4 h-4" />
                                Add Employee
                            </Button>
                        </div>
                    )}
                </div>

                <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search employees..."
                    className="max-w-md"
                />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filteredEmployees.length === 0 ? (
                    <EmptyState
                        icon={UserCog}
                        title="No employees found"
                        description="Add employees to manage staff access"
                    />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredEmployees.map(employee => (
                            <div
                                key={employee.id}
                                className={`card ${employee.id === currentEmployee.id ? 'ring-2 ring-accent-primary' : ''}`}
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-accent-primary/20 flex items-center justify-center">
                                            <span className="text-lg font-semibold text-accent-primary">
                                                {employee.name.charAt(0)}
                                            </span>
                                        </div>
                                        <div>
                                            <p className="font-semibold flex items-center gap-2">
                                                {employee.name}
                                                {employee.id === currentEmployee.id && (
                                                    <span className="text-xs text-accent-primary">(You)</span>
                                                )}
                                            </p>
                                            <p className="text-sm text-zinc-400">{employee.email}</p>
                                        </div>
                                    </div>
                                    {!employee.is_active && (
                                        <Badge variant="danger">Inactive</Badge>
                                    )}
                                </div>

                                <div className="flex items-center gap-2 mb-4">
                                    <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[employee.role]}`}>
                                        {getRoleIcon(employee.role)}
                                        {employee.role.charAt(0).toUpperCase() + employee.role.slice(1)}
                                    </span>
                                </div>

                                <div className="text-sm text-zinc-500 mb-4">
                                    Joined {format(new Date(employee.created_at), 'MMM d, yyyy')}
                                </div>

                                {isAdmin() && (
                                    <div className="flex items-center gap-2 pt-4 border-t border-dark-border">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => { setEditingEmployee(employee); setShowModal(true); }}
                                        >
                                            <Edit2 className="w-3 h-3" />
                                            Edit
                                        </Button>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => handleDelete(employee)}
                                            disabled={employee.id === currentEmployee.id}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
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
                title="Import Employees"
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
            toast.error('Name is required');
            return;
        }

        if (!employee && !formData.pin) {
            toast.error('PIN is required for new employees');
            return;
        }

        if (formData.pin && formData.pin !== formData.confirmPin) {
            toast.error('PINs do not match');
            return;
        }

        if (formData.pin && formData.pin.length !== 4) {
            toast.error('PIN must be 4 digits');
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
                toast.success('Employee updated');
            } else {
                await window.electronAPI.employees.create(data);
                toast.success('Employee created');
            }
            onSave();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={employee ? 'Edit Employee' : 'Add Employee'} size="md">
            <form onSubmit={handleSubmit}>
                <ModalBody>
                    <div className="space-y-4">
                        <Input
                            label="Name *"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Employee name"
                        />
                        <Input
                            label="Email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            placeholder="email@example.com"
                        />
                        <Select
                            label="Role"
                            value={formData.role}
                            onChange={(value) => setFormData({ ...formData, role: value })}
                            options={[
                                { value: 'cashier', label: 'Cashier' },
                                { value: 'manager', label: 'Manager' },
                                { value: 'admin', label: 'Admin', disabled: !canCreateAdmin },
                            ]}
                        />
                        {!canCreateAdmin && (
                            <p className="text-xs text-zinc-500 mt-1">Only an administrator can create new administrators.</p>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label={employee ? 'New PIN (leave blank to keep)' : 'PIN *'}
                                type="password"
                                maxLength={4}
                                value={formData.pin}
                                onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })}
                                placeholder="4-digit PIN"
                            />
                            <Input
                                label="Confirm PIN"
                                type="password"
                                maxLength={4}
                                value={formData.confirmPin}
                                onChange={(e) => setFormData({ ...formData, confirmPin: e.target.value.replace(/\D/g, '') })}
                                placeholder="Confirm PIN"
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
                            <label htmlFor="is_active" className="text-sm">Active</label>
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button type="submit" loading={loading}>
                        {employee ? 'Update Employee' : 'Add Employee'}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
