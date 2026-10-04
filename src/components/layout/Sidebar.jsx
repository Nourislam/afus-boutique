import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Package, Boxes, Users, UserCog, BarChart3, Settings, LogOut, Gift, PackageOpen, Percent, QrCode, History, CreditCard, FileText, Truck, Banknote, Sparkles, Tags } from 'lucide-react';
import { useAuthStore, PERMISSIONS } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import ShiftSummaryDialog from '../shifts/ShiftSummaryDialog';

const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'nav.dashboard', permission: PERMISSIONS.DASHBOARD_VIEW },
    { path: '/pos', icon: ShoppingCart, label: 'nav.sales', permission: PERMISSIONS.POS_VIEW },
    { path: '/transactions', icon: History, label: 'nav.transactions', permission: PERMISSIONS.POS_VIEW },
    { path: '/products', icon: Package, label: 'nav.products', permission: PERMISSIONS.PRODUCTS_VIEW },
    { path: '/brands', icon: Tags, label: 'nav.brands', permission: PERMISSIONS.PRODUCTS_VIEW },
    { path: '/inventory', icon: Boxes, label: 'nav.inventory', permission: PERMISSIONS.INVENTORY_VIEW },
    { path: '/barcode-labels', icon: QrCode, label: 'nav.labels', permission: PERMISSIONS.PRODUCTS_VIEW },
    { path: '/suppliers', icon: Truck, label: 'nav.suppliers', permission: PERMISSIONS.INVENTORY_VIEW },
    { path: '/purchase-orders', icon: FileText, label: 'nav.purchases', permission: PERMISSIONS.INVENTORY_VIEW },
    { path: '/customers', icon: Users, label: 'nav.customers', permission: PERMISSIONS.CUSTOMERS_VIEW },
    { path: '/credit-sales', icon: CreditCard, label: 'nav.credit', permission: PERMISSIONS.CUSTOMERS_VIEW, feature: 'credit' },
    { path: '/promotions', icon: Percent, label: 'nav.promotions', permission: PERMISSIONS.PROMOTIONS_VIEW, feature: 'promotions' },
    { path: '/bundles', icon: PackageOpen, label: 'nav.bundles', permission: PERMISSIONS.BUNDLES_VIEW, feature: 'bundles' },
    { path: '/gift-cards', icon: Gift, label: 'nav.giftCards', permission: PERMISSIONS.GIFT_CARDS_VIEW, feature: 'giftCards' },
    { path: '/employees', icon: UserCog, label: 'nav.employees', permission: PERMISSIONS.EMPLOYEES_VIEW },
    { path: '/reports', icon: BarChart3, label: 'nav.reports', permission: PERMISSIONS.REPORTS_VIEW },
    { path: '/ai-chat', icon: Sparkles, label: 'nav.ai', permission: PERMISSIONS.DASHBOARD_VIEW, feature: 'ai' },
    { path: '/settings', icon: Settings, label: 'nav.settings', permission: PERMISSIONS.SETTINGS_VIEW },
];

export function Sidebar() {
    const { currentEmployee, logout, hasPermission } = useAuthStore();
    const [currentShiftId, setCurrentShiftId] = useState(null);
    const [showShiftSummary, setShowShiftSummary] = useState(false);
    const { t } = useT();
    const features = useSettingsStore(state => state.settings.features);

    useEffect(() => {
        if (currentEmployee) {
            checkActiveShift();
        }
    }, [currentEmployee]);

    const checkActiveShift = async () => {
        try {
            const shift = await window.electronAPI.shifts.getCurrent(currentEmployee.id);
            if (shift) {
                setCurrentShiftId(shift.id);
            }
        } catch (error) {
            console.error('Failed to check active shift:', error);
        }
    };

    // Filter nav items based on user permissions
    // ...and on the optional modules enabled in Settings
    const visibleNavItems = navItems.filter(item => hasPermission(item.permission) && (!item.feature || features?.[item.feature]));

    return (
        <aside className="w-64 bg-dark-secondary border-e border-dark-border flex flex-col">
            {/* User Info */}
            <div className="p-4 border-b border-dark-border">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center">
                        <span className="text-white font-semibold">
                            {currentEmployee?.name?.charAt(0) || 'U'}
                        </span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{currentEmployee?.name || t('role.user')}</p>
                        <p className="text-xs text-zinc-500">{t(`role.${currentEmployee?.role || 'cashier'}`)}</p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {visibleNavItems.map(item => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                    >
                        <item.icon className="w-5 h-5" />
                        <span>{t(item.label)}</span>
                    </NavLink>
                ))}
            </nav>

            {/* Logout */}
            <div className="p-3 border-t border-dark-border space-y-1">
                {currentShiftId && (
                    <>
                    <button
                        onClick={() => setShowShiftSummary(true)}
                        className="sidebar-item w-full text-accent-primary hover:bg-accent-primary/10"
                    >
                        <Banknote className="w-5 h-5" />
                        <span>{t('nav.closeShift')}</span>
                    </button>
                    {showShiftSummary && (
                        <ShiftSummaryDialog
                            shiftId={currentShiftId}
                            onClose={() => setShowShiftSummary(false)}
                            onLogout={logout}
                        />
                    )}
                    </>
                )}
                
                <button
                    onClick={logout}
                    className="sidebar-item w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                    <LogOut className="w-5 h-5" />
                    <span>{t('nav.logout')}</span>
                </button>
            </div>
        </aside>
    );
}

