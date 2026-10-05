import { LibraryBig, Tags, Shirt, Truck, Users, Palette, Ruler } from 'lucide-react';
import { HubPage } from '../components/layout/HubPage';
import { useAuthStore } from '../stores/authStore';
import { useT } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';
import { catalogModuleTabs } from '../lib/modules';
import BrandsPage from './BrandsPage';
import CategoriesPage from './CategoriesPage';
import SuppliersPage from './SuppliersPage';
import CustomersPage from './CustomersPage';
import { ColorsPage, SizesPage } from './ColorsSizesPage';

/** Brands, clothing categories, colours, sizes, suppliers and customers on one screen. */
export default function CatalogPage() {
    const { t, lang } = useT();
    const { hasPermission } = useAuthStore();
    // Suppliers and customers are modules (Settings › Modules)
    const moduleTabs = catalogModuleTabs(useSettingsStore(state => state.settings.features) || {}, hasPermission);
    const tabs = [
        { id: 'brands', label: t('brands.title'), icon: Tags, element: <BrandsPage /> },
        { id: 'categories', label: t('categories.title'), icon: Shirt, element: <CategoriesPage /> },
        { id: 'colors', label: t('catalogCustom.colorsTab'), icon: Palette, element: <ColorsPage /> },
        { id: 'sizes', label: t('catalogCustom.sizesTab'), icon: Ruler, element: <SizesPage /> },
        ...(moduleTabs.includes('suppliers') ? [{ id: 'suppliers', label: t('suppliers.title'), icon: Truck, element: <SuppliersPage /> }] : []),
        ...(moduleTabs.includes('customers') ? [{ id: 'customers', label: t('customers.title'), icon: Users, element: <CustomersPage /> }] : []),
    ];
    // The subtitle names only the tabs that are there
    const subtitle = tabs.map(tab => tab.label).join(lang === 'ar' ? '، ' : ', ');
    return <HubPage icon={LibraryBig} title={t('nav.catalog')} subtitle={subtitle} tabs={tabs} />;
}
