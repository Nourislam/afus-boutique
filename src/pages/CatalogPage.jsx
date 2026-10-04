import { LibraryBig, Tags, Shirt, Truck, Users, Palette, Ruler } from 'lucide-react';
import { HubPage } from '../components/layout/HubPage';
import { useAuthStore, PERMISSIONS } from '../stores/authStore';
import { useT } from '../i18n';
import BrandsPage from './BrandsPage';
import CategoriesPage from './CategoriesPage';
import SuppliersPage from './SuppliersPage';
import CustomersPage from './CustomersPage';
import { ColorsPage, SizesPage } from './ColorsSizesPage';

/** Brands, clothing categories, colours, sizes, suppliers and customers on one screen. */
export default function CatalogPage() {
    const { t } = useT();
    const { hasPermission } = useAuthStore();
    const tabs = [
        { id: 'brands', label: t('brands.title'), icon: Tags, element: <BrandsPage /> },
        { id: 'categories', label: t('categories.title'), icon: Shirt, element: <CategoriesPage /> },
        { id: 'colors', label: t('catalogCustom.colorsTab'), icon: Palette, element: <ColorsPage /> },
        { id: 'sizes', label: t('catalogCustom.sizesTab'), icon: Ruler, element: <SizesPage /> },
        ...(hasPermission(PERMISSIONS.INVENTORY_VIEW) ? [{ id: 'suppliers', label: t('suppliers.title'), icon: Truck, element: <SuppliersPage /> }] : []),
        ...(hasPermission(PERMISSIONS.CUSTOMERS_VIEW) ? [{ id: 'customers', label: t('customers.title'), icon: Users, element: <CustomersPage /> }] : []),
    ];
    return <HubPage icon={LibraryBig} title={t('nav.catalog')} subtitle={t('catalog.subtitle')} tabs={tabs} />;
}
