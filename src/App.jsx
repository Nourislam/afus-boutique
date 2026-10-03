import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './components/layout/MainLayout';
import LoginScreen from './components/employees/LoginScreen';
import SetupWizard from './components/SetupWizard';
import POSPage from './pages/POSPage';
import ProductsPage from './pages/ProductsPage';
import InventoryPage from './pages/InventoryPage';
import CustomersPage from './pages/CustomersPage';
import EmployeesPage from './pages/EmployeesPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import AIChatPage from './pages/AIChatPage';
import DashboardPage from './pages/DashboardPage';
import GiftCardsPage from './pages/GiftCardsPage';
import BundlesPage from './pages/BundlesPage';
import PromotionsPage from './pages/PromotionsPage';
import BarcodeLabelPage from './pages/BarcodeLabelPage';
import QrLabelsPage from './pages/QrLabelsPage';
import TransactionsPage from './pages/TransactionsPage';

import SuppliersPage from './pages/SuppliersPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import CreditSalesPage from './pages/CreditSalesPage';
import { useAuthStore, PERMISSIONS } from './stores/authStore';
import { useSettingsStore } from './stores/settingsStore';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { Toaster } from './components/ui/Toast';
import { APP_NAME } from './lib/appInfo';

function App() {
    const { isAuthenticated, checkAuth, startSession } = useAuthStore();
    const { loadSettings } = useSettingsStore();
    const [isLoading, setIsLoading] = useState(true);
    const [showSetupWizard, setShowSetupWizard] = useState(false);

    useEffect(() => {
        // Everything is local: no account, activation or internet connection
        // is needed to open the POS.
        const init = async () => {
            try {
                await loadSettings();

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
            <div className="h-screen w-screen flex items-center justify-center bg-dark-primary">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-zinc-400">Loading {APP_NAME}...</p>
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
                    <Route path="/" element={
                        <ProtectedRoute permission={PERMISSIONS.DASHBOARD_VIEW}>
                            <DashboardPage />
                        </ProtectedRoute>
                    } />
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
                    <Route path="/inventory" element={
                        <ProtectedRoute permission={PERMISSIONS.INVENTORY_VIEW}>
                            <InventoryPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/customers" element={
                        <ProtectedRoute permission={PERMISSIONS.CUSTOMERS_VIEW}>
                            <CustomersPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/suppliers" element={
                        <ProtectedRoute permission={PERMISSIONS.INVENTORY_VIEW}>
                            <SuppliersPage />
                        </ProtectedRoute>
                    } />
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
                    <Route path="/bundles" element={
                        <ProtectedRoute permission={PERMISSIONS.BUNDLES_VIEW}>
                            <BundlesPage />
                        </ProtectedRoute>
                    } />
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
                    <Route path="/promotions" element={
                        <ProtectedRoute permission={PERMISSIONS.PROMOTIONS_VIEW}>
                            <PromotionsPage />
                        </ProtectedRoute>
                    } />
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
                    <Route path="/barcode-labels" element={
                        <ProtectedRoute permission={PERMISSIONS.PRODUCTS_VIEW}>
                            <QrLabelsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/barcode-generator" element={
                        <ProtectedRoute permission={PERMISSIONS.PRODUCTS_VIEW}>
                            <BarcodeLabelPage />
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
