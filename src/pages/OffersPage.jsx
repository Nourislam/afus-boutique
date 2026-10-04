import { Percent, PackageOpen } from 'lucide-react';
import { HubPage } from '../components/layout/HubPage';
import { useSettingsStore } from '../stores/settingsStore';
import { useT } from '../i18n';
import PromotionsPage from './PromotionsPage';
import BundlesPage from './BundlesPage';

/** Promotions (discounts, soldes) and packs on one screen. */
export default function OffersPage() {
    const { t } = useT();
    const features = useSettingsStore(state => state.settings.features) || {};
    const tabs = [
        ...(features.promotions !== false ? [{ id: 'promotions', label: t('promo.tab'), icon: Percent, element: <PromotionsPage /> }] : []),
        ...(features.bundles !== false ? [{ id: 'packs', label: t('bundles.title'), icon: PackageOpen, element: <BundlesPage /> }] : []),
    ];
    if (tabs.length === 0) tabs.push({ id: 'promotions', label: t('promo.tab'), icon: Percent, element: <PromotionsPage /> });
    return <HubPage icon={Percent} title={t('nav.offers')} subtitle={t('offers.subtitle')} tabs={tabs} />;
}
