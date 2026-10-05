import { useEffect, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { CategoryManager } from '../components/products/CategoryManagerModal';
import { toast } from '../components/ui/Toast';
import { useT } from '../i18n';
import { Shirt } from 'lucide-react';

/** Clothing categories (trousers, T-shirts, shoes…): add, rename, delete. */
export default function CategoriesPage() {
    const { t } = useT();
    const [categories, setCategories] = useState([]);

    const load = async () => {
        try { setCategories(await window.electronAPI.categories.getAll()); } catch { toast.error(t('common.loadFailed')); }
    };
    useEffect(() => { load(); }, []);

    return (
        <div className="page">
            <PageHeader icon={Shirt} title={t('categories.title')} subtitle={t('categories.subtitle')} />
            <div className="page-body">
                <div className="max-w-5xl">
                    <CategoryManager categories={categories} onSave={load} layout="grid" />
                </div>
            </div>
        </div>
    );
}
