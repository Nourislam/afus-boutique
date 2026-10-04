import { LibraryBig, Tags, Shirt, Truck, Users } from 'lucide-react';
import { HubPage } from '../components/layout/HubPage';
import { useAuthStore, PERMISSIONS } from '../stores/authStore';
import { useT } from '../i18n';
import BrandsPage from './BrandsPage';
import CategoriesPage from './CategoriesPage';
import SuppliersPage from './SuppliersPage';
import CustomersPage from './CustomersPage';

/** Brands, clothing categories, suppliers and customers on one screen. */
export default function CatalogPage() {
    const { t } = useT();
    const { hasPermission } = useAuthStore();
    const tabs = [
        { id: 'brands', label: t('brands.title'), icon: Tags, element: <BrandsPage /> },
        { id: 'categories', label: t('categories.title'), icon: Shirt, element: <CategoriesPage /> },
        ...(hasPermission(PERMISSIONS.INVENTORY_VIEW) ? [{ id: 'suppliers', label: t('suppliers.title'), icon: Truck, element: <SuppliersPage /> }] : []),
        ...(hasPermission(PERMISSIONS.CUSTOMERS_VIEW) ? [{ id: 'customers', label: t('customers.title'), icon: Users, element: <CustomersPage /> }] : []),
    ];
    return <HubPage icon={LibraryBig} title={t('nav.catalog')} subtitle={t('catalog.subtitle')} tabs={tabs} />;
}
