import { NavLink } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
    LayoutDashboard, ShoppingCart, Package, Boxes, UserCog, BarChart3, Settings, LogOut, Percent, QrCode,
    History, CreditCard, FileText, LibraryBig, Users, Truck, PanelLeftClose, PanelLeftOpen,
    GraduationCap,
} from 'lucide-react';
import { useAuthStore, PERMISSIONS } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import { translateError } from '../../i18n/errors';
import ShiftSummaryDialog from '../shifts/ShiftSummaryDialog';
import { ShopLogo } from '../shop/ShopLogo';
import { toast } from '../ui/Toast';
import { SIMPLE_PATHS } from '../../lib/uiMode';
import { offerTabs } from '../../lib/modules';
import { useTrainingStore } from '../../stores/trainingStore';

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
            { path: '/customers', icon: Users, label: 'nav.customers', permission: PERMISSIONS.CUSTOMERS_VIEW, feature: 'customers' },
            { path: '/suppliers', icon: Truck, label: 'nav.suppliers', permission: PERMISSIONS.INVENTORY_VIEW, feature: 'suppliers' },
            { path: '/purchase-orders', icon: FileText, label: 'nav.purchases', permission: PERMISSIONS.INVENTORY_VIEW, feature: 'purchaseOrders' },
        ],
    },
    {
        id: 'grow',
        items: [
            // Promotions, packs and gift cards: shown while one of them is on and allowed
            { path: '/offers', icon: Percent, label: 'nav.offers', show: (features, can) => offerTabs(features, can).length > 0 },
        ],
    },
    {
        id: 'manage',
        items: [
            { path: '/employees', icon: UserCog, label: 'nav.employees', permission: PERMISSIONS.EMPLOYEES_VIEW },
            { path: '/reports', icon: BarChart3, label: 'nav.reports', permission: PERMISSIONS.REPORTS_VIEW },
        ],
    },
];

// Settings stays at the bottom in both modes: the mode is changed there
const SETTINGS_ITEM = { path: '/settings', icon: Settings, label: 'nav.settings', permission: PERMISSIONS.SETTINGS_VIEW };

// Open or closed menu, remembered on this computer only
const COLLAPSED_KEY = 'ui_sidebar_collapsed';
function readCollapsed() {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(value) {
    try { localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0'); } catch { /* kept for this session */ }
}

/** Name shown beside an icon while the menu is closed (also on keyboard focus). */
function useTooltip(enabled) {
    const [tip, setTip] = useState(null);
    useEffect(() => { if (!enabled) setTip(null); }, [enabled]);
    const show = (text) => (e) => {
        if (!enabled) return;
        const r = e.currentTarget.getBoundingClientRect();
        const rtl = document.documentElement.dir === 'rtl';
        setTip({ text, top: r.top + r.height / 2, x: rtl ? r.left - 8 : r.right + 8, rtl });
    };
    const hide = () => setTip(null);
    const props = (text) => (enabled ? { onMouseEnter: show(text), onMouseLeave: hide, onFocus: show(text), onBlur: hide, 'aria-label': text } : {});
    const node = tip && createPortal(
        <div role="tooltip" className="fixed z-[120] pointer-events-none px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap bg-zinc-900 text-white border border-zinc-700 shadow-lg"
            style={{ top: tip.top, left: tip.x, transform: `translate(${tip.rtl ? '-100%' : '0'}, -50%)` }}>
            {tip.text}
        </div>,
        document.body,
    );
    return { props, node };
}

export function Sidebar() {
    const { currentEmployee, logout, hasPermission } = useAuthStore();
    const [currentShiftId, setCurrentShiftId] = useState(null);
    const [showShiftSummary, setShowShiftSummary] = useState(false);
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const { t } = useT();
    const features = useSettingsStore(state => state.settings.features);
    const shopName = useSettingsStore(state => state.settings.businessName);
    const shopLogo = useSettingsStore(state => state.settings.shopLogo);
    const uiMode = useSettingsStore(state => state.settings.uiMode);
    const simple = uiMode === 'simple';
    const tooltip = useTooltip(collapsed);
    const trainingActive = useTrainingStore(state => state.active);
    const startTraining = useTrainingStore(state => state.start);
    const [startingTraining, setStartingTraining] = useState(false);

    // Training: a copy of the shop in memory (a cashier needs a manager's PIN)
    const enterTraining = async () => {
        setStartingTraining(true);
        try {
            await startTraining();
        } catch (e) {
            if (!e?.cancelled) toast.error(translateError(e));
            setStartingTraining(false);
        }
    };

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

    const visible = (item) => (!item.permission || hasPermission(item.permission))
        && (!item.feature || features?.[item.feature])
        && (!item.show || item.show(features || {}, hasPermission))
        && (!simple || SIMPLE_PATHS.includes(item.path));

    const toggleCollapsed = () => setCollapsed(value => {
        writeCollapsed(!value);
        return !value;
    });

    // Leaving with an open cash drawer always goes through the closing screen
    const handleLogout = () => {
        if (currentShiftId) setShowShiftSummary(true);
        else logout();
    };

    const roleName = t(`role.${currentEmployee?.role || 'cashier'}`);
    const shopLabel = shopName || t('shop.unnamed');
    const userName = currentEmployee?.name || t('role.user');
    const who = `${shopLabel} — ${userName} — ${roleName}`;
    const itemClass = (isActive) => `sidebar-item ${collapsed ? 'justify-center !px-0' : ''} ${isActive ? 'active' : ''}`;
    const navItem = (item) => (
        <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => itemClass(isActive)}
            {...tooltip.props(t(item.label))}
        >
            <item.icon className="w-[18px] h-[18px] flex-none" />
            <span className={collapsed ? 'sr-only' : 'truncate'}>{t(item.label)}</span>
        </NavLink>
    );
    const logoutLabel = currentShiftId ? t('nav.closeAndLogout') : t('nav.logout');

    return (
        <aside className={`${collapsed ? 'w-16' : 'w-56'} flex-none bg-dark-secondary border-e border-dark-border flex flex-col transition-[width] duration-200`}>
            {/* The shop and who is working. A click opens or closes the menu. */}
            <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                title={collapsed ? undefined : t('nav.collapse')}
                className="group relative px-3 py-3 border-b border-dark-border text-start hover:bg-dark-tertiary/50 transition-colors"
                {...tooltip.props(`${who} · ${t('nav.expand')}`)}
            >
                {collapsed ? (
                    <span className="flex flex-col items-center gap-1.5">
                        <ShopLogo fileName={shopLogo} name={shopName} size={36} maxWidth={44} rounded="rounded-md" />
                        {currentShiftId && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-label={t('shift.open')} />}
                    </span>
                ) : (
                    <span className="flex items-center gap-2.5 min-w-0" data-testid="sidebar-shop">
                        {/* The shop's own logo, once, in a fixed square (a wide logo fits inside) */}
                        <span className="w-10 h-10 flex-none flex items-center justify-center" data-testid="sidebar-logo">
                            <ShopLogo fileName={shopLogo} name={shopName} size={40} rounded="rounded-md" />
                        </span>
                        {/* Shop name, then who is working and their role */}
                        <span className="flex-1 min-w-0 leading-tight" data-testid="sidebar-info">
                            {/* dir="auto": an Arabic name in a French screen (or the reverse) is cut at its own end */}
                            <span dir="auto" className="block text-sm font-semibold truncate ltr:text-left rtl:text-right" title={shopLabel}>{shopLabel}</span>
                            <span className="flex items-center gap-1 mt-0.5 text-xs min-w-0" title={`${userName} — ${roleName}`}>
                                <span dir="auto" className="truncate min-w-0 text-zinc-300">{userName}</span>
                                <span className="flex-none text-zinc-500">— {roleName}</span>
                                {/* Open cash drawer: a dot */}
                                {currentShiftId && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-none" title={t('shift.open')} aria-label={t('shift.open')} />}
                            </span>
                        </span>
                    </span>
                )}
            </button>

            <nav className="flex-1 px-2 py-2 overflow-y-auto no-scrollbar">
                {NAV_GROUPS.map((group, gi) => {
                    const items = group.items.filter(visible);
                    if (items.length === 0) return null;
                    return (
                        <div key={group.id} className={gi > 0 ? 'mt-2 pt-2 border-t border-dark-border/60' : ''}>
                            {items.map(navItem)}
                        </div>
                    );
                })}
            </nav>

            <div className="p-2 border-t border-dark-border space-y-1">
                {!trainingActive && (
                    <button type="button" onClick={enterTraining} disabled={startingTraining} data-testid="nav-training"
                        className={`sidebar-item w-full text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 ${collapsed ? 'justify-center !px-0' : ''}`}
                        {...tooltip.props(t('training.startHint'))}>
                        <GraduationCap className="w-[18px] h-[18px] flex-none" />
                        <span className={collapsed ? 'sr-only' : 'truncate'}>{t('training.mode')}</span>
                    </button>
                )}
                {hasPermission(SETTINGS_ITEM.permission) && navItem(SETTINGS_ITEM)}
                {/* One button: with an open cash drawer it goes through counting and closing */}
                <button onClick={handleLogout} data-testid="nav-logout" className={`sidebar-item w-full text-red-300 hover:text-red-200 hover:bg-red-500/10 ${collapsed ? 'justify-center !px-0' : ''}`}
                    {...tooltip.props(logoutLabel)}>
                    <LogOut className="w-[18px] h-[18px] flip-rtl flex-none" />
                    <span className={collapsed ? 'sr-only' : 'truncate'}>{logoutLabel}</span>
                </button>
                {/* Open / close the menu (a click on the shop does it too) */}
                {collapsed ? (
                    <button type="button" onClick={toggleCollapsed} className="sidebar-item w-full justify-center !px-0 text-zinc-500" {...tooltip.props(t('nav.expand'))}>
                        <PanelLeftOpen className="w-[18px] h-[18px] flip-rtl" />
                    </button>
                ) : (
                    <button type="button" onClick={toggleCollapsed} className="sidebar-item w-full text-zinc-500" data-testid="nav-collapse">
                        <PanelLeftClose className="w-[18px] h-[18px] flip-rtl flex-none" />
                        <span className="truncate">{t('nav.collapse')}</span>
                    </button>
                )}
            </div>

            {tooltip.node}

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
