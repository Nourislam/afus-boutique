import { LibraryBig, Tags, Shirt, Palette, Ruler } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { HubPage } from '../components/layout/HubPage';
import { useT } from '../i18n';
import BrandsPage from './BrandsPage';
import CategoriesPage from './CategoriesPage';
import { ColorsPage, SizesPage } from './ColorsSizesPage';

/** Brands, clothing categories, colours and sizes on one screen (customers and suppliers have their own). */
export default function CatalogPage() {
    const { t, lang } = useT();
    const [params] = useSearchParams();
    // Old links to the customers / suppliers tabs open their own screens
    const moved = { customers: '/customers', suppliers: '/suppliers' }[params.get('tab')];
    const tabs = [
        { id: 'brands', label: t('brands.title'), icon: Tags, element: <BrandsPage /> },
        { id: 'categories', label: t('categories.title'), icon: Shirt, element: <CategoriesPage /> },
        { id: 'colors', label: t('catalogCustom.colorsTab'), icon: Palette, element: <ColorsPage /> },
        { id: 'sizes', label: t('catalogCustom.sizesTab'), icon: Ruler, element: <SizesPage /> },
    ];
    // The subtitle names only the tabs that are there
    const subtitle = tabs.map(tab => tab.label).join(lang === 'ar' ? '، ' : ', ');
    if (moved) return <Navigate to={moved} replace />;
    return <HubPage icon={LibraryBig} title={t('nav.catalog')} subtitle={subtitle} tabs={tabs} />;
}
