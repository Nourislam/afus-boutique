import { QrCode, Barcode } from 'lucide-react';
import { HubPage } from '../components/layout/HubPage';
import { useT } from '../i18n';
import QrLabelsPage from './QrLabelsPage';
import BarcodeLabelPage from './BarcodeLabelPage';

/** Article labels (QR + optional barcode) and free barcodes. */
export default function LabelsPage() {
    const { t } = useT();
    const tabs = [
        { id: 'articles', label: t('labels.tabArticles'), icon: QrCode, element: <QrLabelsPage /> },
        { id: 'barcodes', label: t('labels.tabBarcodes'), icon: Barcode, element: <BarcodeLabelPage /> },
    ];
    return <HubPage icon={QrCode} title={t('nav.labels')} subtitle={t('labels.subtitle')} tabs={tabs} />;
}
