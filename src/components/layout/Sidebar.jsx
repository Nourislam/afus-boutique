import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard, ShoppingCart, Package, Boxes, UserCog, BarChart3, Settings, LogOut, Gift, Percent, QrCode,
    History, CreditCard, FileText, Sparkles, LibraryBig,
} from 'lucide-react';
import { useAuthStore, PERMISSIONS } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import ShiftSummaryDialog from '../shifts/ShiftSummaryDialog';

// Grouped menu. Brands, categories, suppliers and customers live together in
// "Catalogue"; promotions and packs together in "Offers".
const NAV_GROUPS = [
    {
        id: 'sell',
        items: [
            { path: '/', icon: LayoutDashboard, label: 'nav.dashboard', permission: PERMISSIONS.DASHBOARD_VIEW },
            { path: '/pos', icon: ShoppingCart, label: 'nav.sales', permission: PERMISSIONS.POS_VIEW },
            { path: '/transactions', icon: History, label: 'nav.transactions', permission: PERMISSIONS.POS_VIEW },
            { path: '/credit-sales', icon: CreditCard, label: 'nav.credit', permission: PERMISSIONS.CUSTOMERS_VIEW, feature: 'credit' },
        ],
    },
    {
        id: 'stock',
        items: [
            { path: '/products', icon: Package, label: 'nav.products', permission: PERMISSIONS.PRODUCTS_VIEW },
            { path: '/inventory', icon: Boxes, label: 'nav.inventory', permission: PERMISSIONS.INVENTORY_VIEW },
            { path: '/labels', icon: QrCode, label: 'nav.labels', permission: PERMISSIONS.PRODUCTS_VIEW },
            { path: '/catalog', icon: LibraryBig, label: 'nav.catalog', permission: PERMISSIONS.PRODUCTS_VIEW },
            { path: '/purchase-orders', icon: FileText, label: 'nav.purchases', permission: PERMISSIONS.INVENTORY_VIEW },
        ],
    },
    {
        id: 'grow',
        items: [
            { path: '/offers', icon: Percent, label: 'nav.offers', permission: PERMISSIONS.PROMOTIONS_VIEW, anyFeature: ['promotions', 'bundles'] },
            { path: '/gift-cards', icon: Gift, label: 'nav.giftCards', permission: PERMISSIONS.GIFT_CARDS_VIEW, feature: 'giftCards' },
            { path: '/ai-chat', icon: Sparkles, label: 'nav.ai', permission: PERMISSIONS.DASHBOARD_VIEW, feature: 'ai' },
        ],
    },
    {
        id: 'manage',
        items: [
            { path: '/employees', icon: UserCog, label: 'nav.employees', permission: PERMISSIONS.EMPLOYEES_VIEW },
            { path: '/reports', icon: BarChart3, label: 'nav.reports', permission: PERMISSIONS.REPORTS_VIEW },
            { path: '/settings', icon: Settings, label: 'nav.settings', permission: PERMISSIONS.SETTINGS_VIEW },
        ],
    },
];

export function Sidebar() {
    const { currentEmployee, logout, hasPermission } = useAuthStore();
    const [currentShiftId, setCurrentShiftId] = useState(null);
    const [showShiftSummary, setShowShiftSummary] = useState(false);
    const { t } = useT();
    const features = useSettingsStore(state => state.settings.features);

    useEffect(() => {
        if (!currentEmployee) return undefined;
        let cancelled = false;
        const check = () => window.electronAPI.shifts.getCurrent(currentEmployee.id)
            .then(shift => { if (!cancelled) setCurrentShiftId(shift?.id || null); })
            .catch(() => { });
        check();
        // A shift can be opened from the sales screen after login
        window.addEventListener('pos:shift-changed', check);
        return () => { cancelled = true; window.removeEventListener('pos:shift-changed', check); };
    }, [currentEmployee]);

    const visible = (item) => hasPermission(item.permission)
        && (!item.feature || features?.[item.feature])
        && (!item.anyFeature || item.anyFeature.some(f => features?.[f] !== false));

    // Leaving with an open cash drawer always goes through the closing screen
    const handleLogout = () => {
        if (currentShiftId) setShowShiftSummary(true);
        else logout();
    };

    return (
        <aside className="w-56 flex-none bg-dark-secondary border-e border-dark-border flex flex-col">
            <div className="px-3 py-3 border-b border-dark-border">
                <div className="flex items-center gap-2.5 px-1">
                    <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center flex-none">
                        <span className="text-white font-semibold">{currentEmployee?.name?.charAt(0) || '?'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{currentEmployee?.name || t('role.user')}</p>
                        <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                            {t(`role.${currentEmployee?.role || 'cashier'}`)}
                            {currentShiftId && <span className="inline-flex items-center gap-1 text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{t('shift.open')}</span>}
                        </p>
                    </div>
                </div>
            </div>

            <nav className="flex-1 px-2 py-2 overflow-y-auto no-scrollbar">
                {NAV_GROUPS.map((group, gi) => {
                    const items = group.items.filter(visible);
                    if (items.length === 0) return null;
                    return (
                        <div key={group.id} className={gi > 0 ? 'mt-2 pt-2 border-t border-dark-border/60' : ''}>
                            {items.map(item => (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
                                    end={item.path === '/'}
                                    className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                                >
                                    <item.icon className="w-[18px] h-[18px] flex-none" />
                                    <span className="truncate">{t(item.label)}</span>
                                </NavLink>
                            ))}
                        </div>
                    );
                })}
            </nav>

            <div className="p-2 border-t border-dark-border space-y-0.5">
                {/* One button: with an open cash drawer it goes through counting and closing */}
                <button onClick={handleLogout} className="sidebar-item w-full text-red-300 hover:text-red-200 hover:bg-red-500/10">
                    <LogOut className="w-[18px] h-[18px] flip-rtl flex-none" />
                    <span className="truncate">{currentShiftId ? t('nav.closeAndLogout') : t('nav.logout')}</span>
                </button>
            </div>

            {showShiftSummary && currentShiftId && (
                <ShiftSummaryDialog
                    shiftId={currentShiftId}
                    mode="logout"
                    onClose={() => setShowShiftSummary(false)}
                    onLogout={({ keptOpen = false } = {}) => {
                        // Closing the drawer always logs out (keptOpen: short break)
                        setShowShiftSummary(false);
                        if (!keptOpen) setCurrentShiftId(null);
                        logout();
                    }}
                />
            )}
        </aside>
    );
}
