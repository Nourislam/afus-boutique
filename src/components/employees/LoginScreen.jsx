import { useState, useEffect } from 'react';
import { PinPad } from '../ui/NumPad';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../ui/Toast';
import { TitleBar } from '../layout/TitleBar';
import { useSettingsStore } from '../../stores/settingsStore';
import { ShopLogo } from '../shop/ShopLogo';
import { APP_NAME } from '../../lib/appInfo';
import OpeningCashDialog from '../shifts/OpeningCashDialog';

export default function LoginScreen() {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [showOpeningCash, setShowOpeningCash] = useState(false);
    const { login } = useAuthStore();
    const { settings } = useSettingsStore();

    useEffect(() => {
        loadEmployees();
    }, []);

    const loadEmployees = async () => {
        try {
            const data = await window.electronAPI.employees.getAll();
            setEmployees(data.filter(e => e.is_active));
        } catch (error) {
            console.error('Failed to load employees:', error);
        }
    };

    const performLogin = async (employeeId, enteredPin) => {
         try {
            const result = await login(employeeId, enteredPin);
            if (!result.success) {
                toast.error(result.error || 'Invalid PIN');
            }
         } catch (error) {
             toast.error('Login failed');
         }
    };

    const handleLogin = async (enteredPin) => {
        if (!selectedEmployee) return;

        setLoading(true);
        try {
            // 1. Verify credentials first
            const verified = await window.electronAPI.employees.verifyPin({ 
                id: selectedEmployee.id, 
                pin: enteredPin 
            });

            if (!verified) {
                toast.error('Invalid PIN');
                setPin('');
                setLoading(false);
                return;
            }

            // 2. Check for active shift
            const activeShift = await window.electronAPI.shifts.getCurrent(selectedEmployee.id);
            
            if (activeShift) {
                // Shift active, proceed to login
                await performLogin(selectedEmployee.id, enteredPin);
            } else {
                // No active shift, show opening cash dialog
                setPin(enteredPin); // Keep PIN for final login
                setShowOpeningCash(true);
            }
        } catch (error) {
            console.error('Login error:', error);
            toast.error('Login failed');
            setPin('');
        } finally {
            setLoading(false);
        }
    };

    const handleOpeningCashSuccess = async (shift) => {
        setShowOpeningCash(false);
        // Login with stored pin
        await performLogin(selectedEmployee.id, pin);
    };

    if (selectedEmployee) {
        return (
            <div className="h-screen w-screen flex flex-col bg-dark-primary">
                <TitleBar />
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                    <div className="w-full max-w-md">
                        {/* Back button */}
                        <button
                            onClick={() => {
                                setSelectedEmployee(null);
                                setPin('');
                            }}
                            className="mb-8 text-zinc-400 hover:text-white transition-colors flex items-center gap-2"
                        >
                            ← Back to employees
                        </button>

                        {/* Selected employee */}
                        <div className="text-center mb-8">
                            <div className="w-20 h-20 rounded-full gradient-primary mx-auto mb-4 flex items-center justify-center">
                                <span className="text-3xl font-bold text-white">
                                    {selectedEmployee.name.charAt(0)}
                                </span>
                            </div>
                            <h2 className="text-xl font-semibold">{selectedEmployee.name}</h2>
                            <p className="text-zinc-500 capitalize">{selectedEmployee.role}</p>
                        </div>

                        {/* PIN Entry */}
                        <div className="card p-6">
                            <p className="text-center text-zinc-400 mb-6">Enter your PIN</p>
                            <PinPad
                                value={pin}
                                onChange={setPin}
                                onEnter={handleLogin}
                                pinLength={4}
                            />
                        </div>
                    </div>
                </div>
                
                {showOpeningCash && (
                    <OpeningCashDialog 
                        employee={selectedEmployee}
                        onSuccess={handleOpeningCashSuccess}
                        onCancel={() => {
                            setShowOpeningCash(false);
                            setPin('');
                        }}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-dark-primary">
            <TitleBar />
            <div className="flex-1 flex flex-col items-center justify-center p-8">
                <div className="mb-12 text-center">
                    <div className="mx-auto mb-4 w-fit">
                        <ShopLogo fileName={settings.shopLogo} size={80} rounded="rounded-2xl" />
                    </div>
                    <h1 className="text-3xl font-bold mb-2">{settings.businessName || APP_NAME}</h1>
                    <p className="text-zinc-500">Select your profile to login</p>
                </div>

                {/* Employee Grid */}
                <div className="w-full max-w-2xl">
                    {employees.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-zinc-400 mb-2">No employees found</p>
                            <p className="text-zinc-500 text-sm">
                                Restore a backup or reset the shop setup to create an administrator.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {employees.map(employee => (
                                <button
                                    key={employee.id}
                                    onClick={() => setSelectedEmployee(employee)}
                                    className="card p-6 text-center hover:border-accent-primary hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-200 group"
                                >
                                    <div className="w-16 h-16 rounded-full bg-dark-tertiary mx-auto mb-3 flex items-center justify-center group-hover:bg-accent-primary transition-colors">
                                        <span className="text-2xl font-semibold text-zinc-400 group-hover:text-white transition-colors">
                                            {employee.name.charAt(0)}
                                        </span>
                                    </div>
                                    <p className="font-medium truncate">{employee.name}</p>
                                    <p className="text-xs text-zinc-500 capitalize">{employee.role}</p>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

