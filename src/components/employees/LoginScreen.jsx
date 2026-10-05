import { t } from '../../i18n';
import { useState, useEffect } from 'react';
import { PinPad } from '../ui/NumPad';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../ui/Toast';
import { TitleBar } from '../layout/TitleBar';
import { useSettingsStore } from '../../stores/settingsStore';
import { ShopLogo } from '../shop/ShopLogo';
import { AfusLogo } from '../brand/AfusLogo';
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
                toast.error(result.error || t('login.invalidPin'));
            }
         } catch {
             toast.error(t('login.failed'));
         }
    };

    const handleLogin = async (enteredPin) => {
        // Ignore a second Enter while the first PIN is being checked
        if (!selectedEmployee || loading) return;

        setLoading(true);
        try {
            // 1. Verify credentials first
            const verified = await window.electronAPI.employees.verifyPin({ 
                id: selectedEmployee.id, 
                pin: enteredPin 
            });

            if (!verified) {
                toast.error(t('login.invalidPin'));
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
            toast.error(t('login.failed'));
            setPin('');
        } finally {
            setLoading(false);
        }
    };

    const handleOpeningCashSuccess = async () => {
        setShowOpeningCash(false);
        // Login with stored pin
        await performLogin(selectedEmployee.id, pin);
    };

    // The program, small and apart from the shop's identity
    const poweredBy = (
        <div className="flex-none flex items-center justify-center gap-2 py-4 text-xs text-zinc-500">
            <AfusLogo size={16} />
            <span>{t('login.poweredBy', { app: t('app.name') })}</span>
        </div>
    );

    if (selectedEmployee) {
        return (
            <div className="h-screen w-screen flex flex-col bg-dark-primary">
                <TitleBar />
                <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6">
                    <div className="w-full max-w-3xl">
                        <button
                            onClick={() => {
                                setSelectedEmployee(null);
                                setPin('');
                            }}
                            className="mb-4 text-zinc-400 hover:text-white transition-colors flex items-center gap-2"
                        >
                            <span className="flip-rtl">←</span> {t('login.back')}
                        </button>

                        <div className="card !p-0 overflow-hidden grid md:grid-cols-[1fr_1.15fr]">
                            {/* Who is logging in, in which shop */}
                            <div className="flex flex-col items-center justify-center text-center gap-3 p-8 bg-dark-tertiary/40 md:border-e border-b md:border-b-0 border-dark-border">
                                <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center">
                                    <span className="text-3xl font-bold text-white">{selectedEmployee.name.charAt(0)}</span>
                                </div>
                                <div className="min-w-0 max-w-full">
                                    <h2 className="text-xl font-semibold truncate">{selectedEmployee.name}</h2>
                                    <p className="text-zinc-500">{t(`role.${selectedEmployee.role}`)}</p>
                                </div>
                                <div className="flex items-center gap-2 mt-2 text-sm text-zinc-400 min-w-0 max-w-full">
                                    <ShopLogo fileName={settings.shopLogo} name={settings.businessName} size={24} rounded="rounded-md" />
                                    <span className="truncate">{settings.businessName || t('app.name')}</span>
                                </div>
                            </div>

                            <div className="p-6 md:p-8">
                                <p className="text-center text-zinc-400 mb-6">{t('login.enterPin')}</p>
                                <PinPad
                                    value={pin}
                                    onChange={setPin}
                                    onEnter={handleLogin}
                                    pinLength={4}
                                />
                            </div>
                        </div>
                    </div>
                </div>
                {poweredBy}

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
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center p-6 lg:p-8">
                {/* The shop: its logo (or initials) and name */}
                <div className="mb-8 lg:mb-10 text-center max-w-full">
                    <div className="mx-auto mb-4 w-fit">
                        <ShopLogo fileName={settings.shopLogo} name={settings.businessName} size={84} rounded="rounded-2xl" />
                    </div>
                    <h1 className="text-3xl font-bold mb-2 break-words">{settings.businessName || t('app.name')}</h1>
                    <p className="text-zinc-500">{t('login.selectProfile')}</p>
                </div>

                {/* Employee Grid */}
                <div className="w-full max-w-4xl">
                    {employees.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-zinc-400 mb-2">{t('login.noEmployees')}</p>
                            <p className="text-zinc-500 text-sm">
                                {t('login.noEmployeesHint')}
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-wrap justify-center gap-4">
                            {employees.map(employee => (
                                <button
                                    key={employee.id}
                                    onClick={() => setSelectedEmployee(employee)}
                                    className="card w-[11.5rem] p-6 text-center hover:border-accent-primary hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-200 group"
                                >
                                    <div className="w-16 h-16 rounded-full bg-dark-tertiary mx-auto mb-3 flex items-center justify-center group-hover:bg-accent-primary transition-colors">
                                        <span className="text-2xl font-semibold text-zinc-400 group-hover:text-white transition-colors">
                                            {employee.name.charAt(0)}
                                        </span>
                                    </div>
                                    <p className="font-medium truncate">{employee.name}</p>
                                    <p className="text-xs text-zinc-500">{t(`role.${employee.role}`)}</p>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {poweredBy}
        </div>
    );
}
