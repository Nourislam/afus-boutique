import { useState, useEffect } from 'react';
import { loadCatalogCustomization } from './lib/clothing';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './components/layout/MainLayout';
import LoginScreen from './components/employees/LoginScreen';
import SetupWizard from './components/SetupWizard';
import POSPage from './pages/POSPage';
import ProductsPage from './pages/ProductsPage';
import InventoryPage from './pages/InventoryPage';
import EmployeesPage from './pages/EmployeesPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import AIChatPage from './pages/AIChatPage';
import DashboardPage from './pages/DashboardPage';
import GiftCardsPage from './pages/GiftCardsPage';
import TransactionsPage from './pages/TransactionsPage';

import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import CreditSalesPage from './pages/CreditSalesPage';
import CatalogPage from './pages/CatalogPage';
import OffersPage from './pages/OffersPage';
import LabelsPage from './pages/LabelsPage';
import { TitleBar } from './components/layout/TitleBar';
import { useAuthStore, PERMISSIONS } from './stores/authStore';
import { useSettingsStore } from './stores/settingsStore';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { Toaster, toast } from './components/ui/Toast';
import { useT, t as translate } from './i18n';

function App() {
    const { isAuthenticated, checkAuth, startSession } = useAuthStore();
    const { loadSettings } = useSettingsStore();
    const uiMode = useSettingsStore(state => state.settings.uiMode);
    const [isLoading, setIsLoading] = useState(true);
    const [showSetupWizard, setShowSetupWizard] = useState(false);
    // Subscribing to the language re-renders the whole tree when it changes
    const { t } = useT();

    useEffect(() => {
        // Everything is local: no account, activation or internet connection
        // is needed to open the POS.
        const init = async () => {
            try {
                await loadSettings();
                await loadCatalogCustomization();

                const settings = await window.electronAPI.settings.getAll();
                // Handle both string 'true' and boolean true
                const setupCompleted = settings.setup_completed === 'true' || settings.setup_completed === true;

                if (!setupCompleted) {
                    setShowSetupWizard(true);
                    return;
                }

                await checkAuth();
            } catch (error) {
                console.error('Init error:', error);
            } finally {
                setIsLoading(false);
            }
        };
        init();
        // Colours and sizes edited in the Catalogue apply everywhere at once
        window.addEventListener('pos:settings-changed', loadCatalogCustomization);
        // A saved printer that was removed or renamed: the job was sent through the
        // print dialog, and the shop is told where to choose the printer again
        const offMissing = window.electronAPI.printers?.onMissing?.(({ kind, name }) => {
            toast.warning(translate(kind === 'label' ? 'printing.missingLabel' : 'printing.missingReceipt', { name }), 8000);
        });
        return () => {
            window.removeEventListener('pos:settings-changed', loadCatalogCustomization);
            offMissing?.();
        };
    }, []);

    const handleSetupComplete = async (adminEmployee) => {
        await loadSettings();
        // The person who just set up the shop goes straight to the sales screen
        if (adminEmployee) startSession(adminEmployee);
        window.location.hash = '#/pos';
        setShowSetupWizard(false);
    };

    if (isLoading) {
        return (
            <div className="h-screen w-screen flex flex-col bg-dark-primary">
                <TitleBar bare />
                <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-zinc-400">{t('app.loading')}</p>
                </div>
                </div>
            </div>
        );
    }

    if (showSetupWizard) {
        return (
            <>
                <SetupWizard onComplete={handleSetupComplete} />
                <Toaster />
            </>
        );
    }

    if (!isAuthenticated) {
        return (
            <>
                <LoginScreen />
                <Toaster />
            </>
        );
    }

    return (
        <HashRouter>
            <MainLayout>
                <Routes>
                    <Route path="/" element={uiMode === 'simple'
                        // The simple menu has no dashboard: the sales screen is home
                        ? <Navigate to="/pos" replace />
                        : (
                            <ProtectedRoute permission={PERMISSIONS.DASHBOARD_VIEW}>
                                <DashboardPage />
                            </ProtectedRoute>
                        )} />
                    <Route path="/pos" element={
                        <ProtectedRoute permission={PERMISSIONS.POS_VIEW}>
                            <POSPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/products" element={
                        <ProtectedRoute permission={PERMISSIONS.PRODUCTS_VIEW}>
                            <ProductsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/brands" element={<Navigate to="/catalog?tab=brands" replace />} />
                    <Route path="/inventory" element={
                        <ProtectedRoute permission={PERMISSIONS.INVENTORY_VIEW}>
                            <InventoryPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/customers" element={<Navigate to="/catalog?tab=customers" replace />} />
                    <Route path="/suppliers" element={<Navigate to="/catalog?tab=suppliers" replace />} />
                    <Route path="/purchase-orders" element={
                        <ProtectedRoute permission={PERMISSIONS.INVENTORY_VIEW}>
                            <PurchaseOrdersPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/gift-cards" element={
                        <ProtectedRoute permission={PERMISSIONS.GIFT_CARDS_VIEW}>
                            <GiftCardsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/bundles" element={<Navigate to="/offers?tab=packs" replace />} />
                    <Route path="/transactions" element={
                        <ProtectedRoute permission={PERMISSIONS.POS_VIEW}>
                            <TransactionsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/credit-sales" element={
                        <ProtectedRoute permission={PERMISSIONS.CUSTOMERS_VIEW}>
                            <CreditSalesPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/promotions" element={<Navigate to="/offers?tab=promotions" replace />} />
                    <Route path="/employees" element={
                        <ProtectedRoute permission={PERMISSIONS.EMPLOYEES_VIEW}>
                            <EmployeesPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/reports" element={
                        <ProtectedRoute permission={PERMISSIONS.REPORTS_VIEW}>
                            <ReportsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/ai-chat" element={<AIChatPage />} />
                    <Route path="/settings" element={
                        <ProtectedRoute permission={PERMISSIONS.SETTINGS_VIEW}>
                            <SettingsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/barcode-labels" element={<Navigate to="/labels" replace />} />
                    <Route path="/barcode-generator" element={<Navigate to="/labels?tab=barcodes" replace />} />
                    <Route path="/catalog" element={
                        <ProtectedRoute permission={PERMISSIONS.PRODUCTS_VIEW}>
                            <CatalogPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/offers" element={
                        <ProtectedRoute permission={PERMISSIONS.PROMOTIONS_VIEW}>
                            <OffersPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/labels" element={
                        <ProtectedRoute permission={PERMISSIONS.PRODUCTS_VIEW}>
                            <LabelsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </MainLayout>
            <Toaster />
        </HashRouter>
    );
}

export default App;
