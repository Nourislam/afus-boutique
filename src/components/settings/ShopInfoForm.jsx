import { useEffect, useState } from 'react';
import { translateError } from '../../i18n/errors';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Input, TextArea } from '../ui/Input';
import { toast } from '../ui/Toast';
import { useT } from '../../i18n';
import { wilayaOptions } from '../../data/wilayas';
import { resizeImageDataUrl } from '../../lib/imageResize';

/**
 * Shop identity fields: name, logo, contact details. Used by the first-launch
 * setup and by Settings > Shop. `value` is the store_config object.
 */
export function ShopInfoForm({ value, onChange, requireLogo = false }) {
    const [logoPreview, setLogoPreview] = useState(null);
    const [uploading, setUploading] = useState(false);
    const { t, lang } = useT();

    const set = (key, v) => onChange({ ...value, [key]: v });

    useEffect(() => {
        let cancelled = false;
        if (!value.shopLogo) {
            setLogoPreview(null);
            return undefined;
        }
        window.electronAPI.images.get(value.shopLogo).then((data) => {
            if (!cancelled) setLogoPreview(data || null);
        });
        return () => { cancelled = true; };
    }, [value.shopLogo]);

    const handleLogoSelect = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            toast.error(t('shop.logoTooBig'));
            return;
        }
        const reader = new FileReader();
        reader.onload = async (event) => {
            setUploading(true);
            try {
                // PNG keeps the logo's transparency; 600 px is enough for tickets and labels
                const base64Data = await resizeImageDataUrl(event.target.result, { maxSize: 600, type: 'image/png' });
                const result = await window.electronAPI.images.saveLogo({
                    base64Data,
                    originalName: file.name,
                });
                if (!result.success) throw new Error(result.error || t('shop.logoSaveFailed'));
                onChange({ ...value, shopLogo: result.fileName });
            } catch (error) {
                toast.error(translateError(error));
            } finally {
                setUploading(false);
            }
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className="grid grid-cols-3 gap-6">
            <div className="col-span-1">
                <label className="form-label mb-2 block">{t('shop.logo')}{requireLogo ? ' *' : ''}</label>
                <div className="aspect-square bg-dark-tertiary rounded-xl border-2 border-dashed border-zinc-600 hover:border-zinc-500 relative flex items-center justify-center overflow-hidden">
                    {logoPreview ? (
                        <>
                            <img src={logoPreview} alt={t('shop.logo')} className="w-full h-full object-contain p-2 bg-white" />
                            <button
                                type="button"
                                onClick={() => set('shopLogo', '')}
                                className="absolute top-2 end-2 p-1 bg-red-500 rounded-full hover:bg-red-600"
                                title={t('shop.removeLogo')}
                            >
                                <Trash2 className="w-4 h-4 text-white" />
                            </button>
                        </>
                    ) : (
                        <label className="cursor-pointer flex flex-col items-center p-4 text-center w-full h-full justify-center">
                            <ImagePlus className="w-10 h-10 text-zinc-500 mb-2" />
                            <span className="text-sm text-zinc-400">{uploading ? t('common.saving') : t('products.clickUpload')}</span>
                            <span className="text-xs text-zinc-500 mt-1">{t('products.imageHint')}</span>
                            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml" onChange={handleLogoSelect} className="hidden" />
                        </label>
                    )}
                </div>
                <p className="text-xs text-zinc-500 mt-2">{t('shop.logoHint')}</p>
            </div>

            <div className="col-span-2 grid grid-cols-2 gap-4 content-start">
                <Input
                    label={t('shop.name')}
                    value={value.businessName || ''}
                    onChange={(e) => set('businessName', e.target.value)}
                    placeholder={t('shop.namePlaceholder')}
                    containerClassName="col-span-2"
                />
                <Input
                    label={t('shop.owner')}
                    value={value.ownerName || ''}
                    onChange={(e) => set('ownerName', e.target.value)}
                />
                <Input
                    label={t('shop.phone')}
                    value={value.businessPhone || ''}
                    onChange={(e) => set('businessPhone', e.target.value)}
                    placeholder="05 / 06 / 07 …"
                    className="ltr"
                />
                <Input
                    label={t('shop.address')}
                    value={value.businessAddress || ''}
                    onChange={(e) => set('businessAddress', e.target.value)}
                    containerClassName="col-span-2"
                />
                <Input
                    label={t('shop.wilaya')}
                    value={value.businessWilaya || ''}
                    onChange={(e) => set('businessWilaya', e.target.value)}
                    list="wilaya-list"
                    placeholder={t('shop.wilayaPlaceholder')}
                />
                <datalist id="wilaya-list">
                    {wilayaOptions(lang).map(w => <option key={w} value={w} />)}
                </datalist>
                <Input
                    label={t('shop.city')}
                    value={value.businessCity || ''}
                    onChange={(e) => set('businessCity', e.target.value)}
                />
                <Input
                    label={t('shop.email')}
                    type="email"
                    value={value.businessEmail || ''}
                    onChange={(e) => set('businessEmail', e.target.value)}
                    className="ltr"
                    containerClassName="col-span-2"
                />
                <div className="col-span-2">
                    <p className="form-label mb-1">{t('shop.legal')}</p>
                    <p className="text-xs text-zinc-500 mb-2">{t('shop.legalHint')}</p>
                    <div className="grid grid-cols-2 gap-3">
                        <Input label={t('shop.rc')} value={value.businessRc || ''} onChange={(e) => set('businessRc', e.target.value)} className="ltr" />
                        <Input label={t('shop.nif')} value={value.businessTaxId || ''} onChange={(e) => set('businessTaxId', e.target.value)} className="ltr" />
                        <Input label={t('shop.nis')} value={value.businessNis || ''} onChange={(e) => set('businessNis', e.target.value)} className="ltr" />
                        <Input label={t('shop.ai')} value={value.businessAi || ''} onChange={(e) => set('businessAi', e.target.value)} className="ltr" />
                    </div>
                </div>
                <div className="col-span-2">
                    <TextArea
                        label={t('shop.description')}
                        value={value.shopDescription || ''}
                        onChange={(e) => set('shopDescription', e.target.value)}
                        placeholder={t('common.optional')}
                        className="min-h-[70px]"
                    />
                </div>
            </div>
        </div>
    );
}

export default ShopInfoForm;
