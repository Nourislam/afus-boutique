import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Boxes,
    Users,
    UserCog,
    BarChart3,
    Settings,
    LogOut,
    Gift,
    PackageOpen,
    Percent,
    QrCode,
    History,
    CreditCard,
    FileText,
    Truck,
    DollarSign,
    Sparkles
} from 'lucide-react';
import { useAuthStore, PERMISSIONS } from '../../stores/authStore';
import { useState, useEffect } from 'react';
import ShiftSummaryDialog from '../shifts/ShiftSummaryDialog';

const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard', permission: PERMISSIONS.DASHBOARD_VIEW },
    { path: '/pos', icon: ShoppingCart, label: 'POS', permission: PERMISSIONS.POS_VIEW },
    { path: '/transactions', icon: History, label: 'Transactions', permission: PERMISSIONS.POS_VIEW },

    { path: '/products', icon: Package, label: 'Products', permission: PERMISSIONS.PRODUCTS_VIEW },
    { path: '/inventory', icon: Boxes, label: 'Inventory', permission: PERMISSIONS.INVENTORY_VIEW },
    { path: '/suppliers', icon: Truck, label: 'Suppliers', permission: PERMISSIONS.INVENTORY_VIEW },
    { path: '/purchase-orders', icon: FileText, label: 'Purchase Orders', permission: PERMISSIONS.INVENTORY_VIEW },
    { path: '/customers', icon: Users, label: 'Customers', permission: PERMISSIONS.CUSTOMERS_VIEW },
    { path: '/credit-sales', icon: CreditCard, label: 'Credit Sales', permission: PERMISSIONS.CUSTOMERS_VIEW },
    { path: '/gift-cards', icon: Gift, label: 'Gift Cards', permission: PERMISSIONS.GIFT_CARDS_VIEW },
    { path: '/bundles', icon: PackageOpen, label: 'Bundles', permission: PERMISSIONS.BUNDLES_VIEW },
    { path: '/promotions', icon: Percent, label: 'Promotions', permission: PERMISSIONS.PROMOTIONS_VIEW },
    { path: '/barcode-labels', icon: QrCode, label: 'QR Labels', permission: PERMISSIONS.PRODUCTS_VIEW },
    { path: '/employees', icon: UserCog, label: 'Employees', permission: PERMISSIONS.EMPLOYEES_VIEW },
    { path: '/reports', icon: BarChart3, label: 'Reports', permission: PERMISSIONS.REPORTS_VIEW },
    { path: '/ai-chat', icon: Sparkles, label: 'AI Assistant', permission: PERMISSIONS.DASHBOARD_VIEW },
    { path: '/settings', icon: Settings, label: 'Settings', permission: PERMISSIONS.SETTINGS_VIEW },
];

export function Sidebar() {
    const { currentEmployee, logout, hasPermission } = useAuthStore();
    const [currentShiftId, setCurrentShiftId] = useState(null);
    const [showShiftSummary, setShowShiftSummary] = useState(false);

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
    const visibleNavItems = navItems.filter(item => hasPermission(item.permission));

    return (
        <aside className="w-64 bg-dark-secondary border-r border-dark-border flex flex-col">
            {/* User Info */}
            <div className="p-4 border-b border-dark-border">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center">
                        <span className="text-white font-semibold">
                            {currentEmployee?.name?.charAt(0) || 'U'}
                        </span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{currentEmployee?.name || 'User'}</p>
                        <p className="text-xs text-zinc-500 capitalize">{currentEmployee?.role || 'Cashier'}</p>
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
                        <span>{item.label}</span>
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
                        <DollarSign className="w-5 h-5" />
                        <span>Close Shift</span>
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
                    <span>Logout</span>
                </button>
            </div>
        </aside>
    );
}

