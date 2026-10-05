import { Percent, PackageOpen, Gift } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { HubPage } from '../components/layout/HubPage';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useT } from '../i18n';
import { offerTabs } from '../lib/modules';
import PromotionsPage from './PromotionsPage';
import BundlesPage from './BundlesPage';
import GiftCardsPage from './GiftCardsPage';

/**
 * Promotions (discounts, soldes), packs and gift cards on one screen. Only
 * the modules turned on in Settings › Modules have a tab; with none of them,
 * there is no Offers screen at all.
 */
export default function OffersPage() {
    const { t, lang } = useT();
    const { hasPermission } = useAuthStore();
    const features = useSettingsStore(state => state.settings.features) || {};
    const all = {
        promotions: { id: 'promotions', label: t('promo.tab'), icon: Percent, element: <PromotionsPage /> },
        packs: { id: 'packs', label: t('bundles.title'), icon: PackageOpen, element: <BundlesPage /> },
        giftCards: { id: 'giftCards', label: t('nav.giftCards'), icon: Gift, element: <GiftCardsPage /> },
    };
    const tabs = offerTabs(features, hasPermission).map(id => all[id]);
    if (tabs.length === 0) return <Navigate to="/" replace />;
    // The subtitle names only the offers that are on
    const subtitle = tabs.map(tab => tab.label).join(lang === 'ar' ? '، ' : ', ');
    return <HubPage icon={Percent} title={t('nav.offers')} subtitle={subtitle} tabs={tabs} />;
}
