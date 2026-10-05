import { useEffect, useMemo, useState } from 'react';
import { translateError } from '../../i18n/errors';
import { ImagePlus, Trash2, ChevronDown } from 'lucide-react';
import { Input, TextArea } from '../ui/Input';
import { Combobox } from '../ui/Combobox';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { ShopLogo } from '../shop/ShopLogo';
import { useT } from '../../i18n';
import { WILAYAS } from '../../data/wilayas';
import { resizeImageDataUrl } from '../../lib/imageResize';

function Section({ title, children }) {
    return (
        <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2.5">{title}</h3>
            {children}
        </section>
    );
}

/**
 * Shop identity fields: name, logo, contact details. Used by the first-launch
 * setup and by Settings > Shop. `value` is the store_config object.
 * The logo is optional: without one, the initials of the shop name are used.
 */
export function ShopInfoForm({ value, onChange }) {
    const [logoPreview, setLogoPreview] = useState(null);
    const [uploading, setUploading] = useState(false);
    const { t, lang } = useT();
    const hasMore = !!(value.businessRc || value.businessTaxId || value.businessNis || value.businessAi || value.shopDescription);
    const [showMore, setShowMore] = useState(hasMore);

    const set = (key, v) => onChange({ ...value, [key]: v });

    // Same text as before ("16 - الجزائر"), with the other language's name as a search hint
    const wilayas = useMemo(() => WILAYAS.map(w => ({
        value: `${w.code} - ${lang === 'ar' ? w.ar : w.fr}`,
        label: `${w.code} - ${lang === 'ar' ? w.ar : w.fr}`,
        hint: lang === 'ar' ? w.fr : w.ar,
    })), [lang]);

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
        <div className="grid gap-6 md:grid-cols-[minmax(140px,168px)_1fr] items-start">
            {/* The shop's own identity: its logo, or its initials */}
            <div className="flex md:flex-col items-center md:items-stretch gap-4">
                <p className="form-label hidden md:block mb-0">{t('shop.logoOptional')}</p>
                <div className="w-28 h-28 md:w-full md:h-auto md:aspect-square flex-none rounded-2xl border border-dark-border bg-white/95 flex items-center justify-center overflow-hidden">
                    {logoPreview
                        ? <img src={logoPreview} alt={t('shop.logo')} className="w-full h-full object-contain p-3" />
                        : <ShopLogo name={value.businessName} size={96} rounded="rounded-2xl" />}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                    <p className="form-label md:hidden mb-0">{t('shop.logoOptional')}</p>
                    <div className="flex gap-2">
                        <label className={`btn btn-secondary px-3 py-2 text-sm flex-1 justify-center cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
                            <ImagePlus className="w-4 h-4" />
                            <span className="truncate">{uploading ? t('common.saving') : (logoPreview ? t('shop.changeLogo') : t('shop.chooseLogo'))}</span>
                            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml" onChange={handleLogoSelect} className="hidden" />
                        </label>
                        {logoPreview && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => set('shopLogo', '')} title={t('shop.removeLogo')} aria-label={t('shop.removeLogo')}>
                                <Trash2 className="w-4 h-4 text-red-400" />
                            </Button>
                        )}
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">{logoPreview ? t('shop.logoHint') : t('shop.logoFallback')}</p>
                </div>
            </div>

            <div className="space-y-5 min-w-0">
                <Section title={t('shop.groupShop')}>
                    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Input
                            label={t('shop.name')}
                            value={value.businessName || ''}
                            onChange={(e) => set('businessName', e.target.value)}
                            placeholder={t('shop.namePlaceholder')}
                            containerClassName="sm:col-span-2"
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
                            inputMode="tel"
                        />
                        <Input
                            label={t('shop.email')}
                            type="email"
                            value={value.businessEmail || ''}
                            onChange={(e) => set('businessEmail', e.target.value)}
                            className="ltr"
                            containerClassName="sm:col-span-1 lg:col-span-2"
                        />
                    </div>
                </Section>

                <Section title={t('shop.groupAddress')}>
                    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Combobox
                            label={t('shop.wilaya')}
                            value={value.businessWilaya || ''}
                            onChange={(v) => set('businessWilaya', v)}
                            options={wilayas}
                            placeholder={t('shop.wilayaPlaceholder')}
                            emptyText={t('shop.wilayaNone')}
                        />
                        <Input
                            label={t('shop.city')}
                            value={value.businessCity || ''}
                            onChange={(e) => set('businessCity', e.target.value)}
                        />
                        <Input
                            label={t('shop.address')}
                            value={value.businessAddress || ''}
                            onChange={(e) => set('businessAddress', e.target.value)}
                            containerClassName="sm:col-span-2 lg:col-span-1"
                        />
                    </div>
                </Section>

                {/* Legal numbers and description: only for the shops that need them */}
                <div className="rounded-xl border border-dark-border">
                    <button
                        type="button"
                        onClick={() => setShowMore(v => !v)}
                        className="w-full flex items-center gap-2 px-4 py-3 text-start text-sm font-medium text-zinc-300 hover:text-white"
                        aria-expanded={showMore}
                    >
                        <ChevronDown className={`w-4 h-4 flex-none transition-transform ${showMore ? 'rotate-180' : ''}`} />
                        <span className="flex-1">{t('shop.groupMore')}</span>
                        <span className="text-xs text-zinc-500 hidden xl:inline">{t('shop.legalHint')}</span>
                    </button>
                    {showMore && (
                        <div className="px-4 pb-4 space-y-3">
                            <div className="grid gap-x-4 gap-y-3 grid-cols-2 lg:grid-cols-4">
                                <Input label={t('shop.rc')} value={value.businessRc || ''} onChange={(e) => set('businessRc', e.target.value)} className="ltr" />
                                <Input label={t('shop.nif')} value={value.businessTaxId || ''} onChange={(e) => set('businessTaxId', e.target.value)} className="ltr" />
                                <Input label={t('shop.nis')} value={value.businessNis || ''} onChange={(e) => set('businessNis', e.target.value)} className="ltr" />
                                <Input label={t('shop.ai')} value={value.businessAi || ''} onChange={(e) => set('businessAi', e.target.value)} className="ltr" />
                            </div>
                            <TextArea
                                label={t('shop.description')}
                                value={value.shopDescription || ''}
                                onChange={(e) => set('shopDescription', e.target.value)}
                                placeholder={t('common.optional')}
                                className="min-h-[60px]"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ShopInfoForm;
