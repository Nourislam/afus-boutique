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
import COMMUNES from '../../../electron/shared/communes.json';
import { resizeImageDataUrl } from '../../lib/imageResize';

// A link the website accepts: https, to the expected site (the others are left out of the website)
const LINK_HOSTS = {
    shopFacebook: ['facebook.com', 'fb.com'], shopInstagram: ['instagram.com'], shopTiktok: ['tiktok.com'],
    shopMapUrl: ['google.com', 'goo.gl', 'openstreetmap.org'],
};
export function linkProblem(key, value) {
    const v = String(value || '').trim();
    if (!v) return false;
    let url;
    try { url = new URL(v); } catch { return true; }
    const host = url.hostname.toLowerCase();
    return url.protocol !== 'https:' || !LINK_HOSTS[key].some(h => host === h || host.endsWith(`.${h}`));
}

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
    const hasSocial = !!(value.shopHours || value.shopFacebook || value.shopInstagram || value.shopTiktok || value.shopMapUrl);
    const [showSocial, setShowSocial] = useState(hasSocial);

    const set = (key, v) => onChange({ ...value, [key]: v });

    // Same text as before ("16 - الجزائر"), with the other language's name as a search hint
    const wilayas = useMemo(() => WILAYAS.map(w => ({
        value: `${w.code} - ${lang === 'ar' ? w.ar : w.fr}`,
        label: `${w.code} - ${lang === 'ar' ? w.ar : w.fr}`,
        hint: lang === 'ar' ? w.fr : w.ar,
    })), [lang]);

    // The communes of the chosen wilaya ("16 - الجزائر" -> 16), the other language's name as a hint
    const wilayaNumber = parseInt(value.businessWilaya, 10) || 0;
    const communes = useMemo(() => (COMMUNES[String(wilayaNumber)] || []).map(([latin, arabic]) => {
        const name = lang === 'ar' ? arabic : latin;
        return { value: name, label: name, hint: lang === 'ar' ? latin : arabic };
    }), [wilayaNumber, lang]);

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
        <div className="grid gap-6 xl:grid-cols-[minmax(140px,168px)_1fr] items-start">
            {/* The shop's own identity: its logo, or its initials */}
            <div className="flex xl:flex-col items-center xl:items-stretch gap-4">
                <p className="form-label hidden xl:block mb-0">{t('shop.logoOptional')}</p>
                <div className="w-28 h-28 xl:w-full xl:h-auto xl:aspect-square flex-none rounded-2xl border border-dark-border bg-white/95 flex items-center justify-center overflow-hidden">
                    {logoPreview
                        ? <img src={logoPreview} alt={t('shop.logo')} className="w-full h-full object-contain p-3" />
                        : <ShopLogo name={value.businessName} size={96} rounded="rounded-2xl" />}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                    <p className="form-label xl:hidden mb-0">{t('shop.logoOptional')}</p>
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
                    <div className="grid gap-x-4 gap-y-3 fit-grid">
                        <Input
                            label={t('shop.name')}
                            value={value.businessName || ''}
                            onChange={(e) => set('businessName', e.target.value)}
                            placeholder={t('shop.namePlaceholder')}
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
                        />
                    </div>
                </Section>

                <Section title={t('shop.groupAddress')}>
                    <div className="grid gap-x-4 gap-y-3 fit-grid">
                        <Combobox
                            label={t('shop.wilaya')}
                            value={value.businessWilaya || ''}
                            onChange={(v) => onChange({ ...value, businessWilaya: v, ...(parseInt(v, 10) !== wilayaNumber ? { businessCity: '' } : {}) })}
                            options={wilayas}
                            placeholder={t('shop.wilayaPlaceholder')}
                            emptyText={t('shop.wilayaNone')}
                        />
                        {communes.length ? (
                            <Combobox
                                label={t('shop.commune')}
                                value={value.businessCity || ''}
                                onChange={(v) => set('businessCity', v)}
                                options={value.businessCity && !communes.some(c => c.value === value.businessCity)
                                    ? [{ value: value.businessCity, label: value.businessCity }, ...communes] : communes}
                                placeholder={t('shop.communePlaceholder')}
                                emptyText={t('shop.wilayaNone')}
                            />
                        ) : (
                            <Input
                                label={t('shop.commune')}
                                value={value.businessCity || ''}
                                onChange={(e) => set('businessCity', e.target.value)}
                                placeholder={t('shop.communeFirst')}
                            />
                        )}
                        <Input
                            label={t('shop.address')}
                            value={value.businessAddress || ''}
                            onChange={(e) => set('businessAddress', e.target.value)}
                        />
                    </div>
                </Section>

                {/* Social pages, map and opening hours (shown on the shop's website) */}
                <div className="rounded-xl border border-dark-border" data-testid="shop-social">
                    <button
                        type="button"
                        onClick={() => setShowSocial(v => !v)}
                        className="w-full flex items-center gap-2 px-4 py-3 text-start text-sm font-medium text-zinc-300 hover:text-white"
                        aria-expanded={showSocial}
                        data-testid="shop-social-toggle"
                    >
                        <ChevronDown className={`w-4 h-4 flex-none transition-transform ${showSocial ? 'rotate-180' : ''}`} />
                        <span className="flex-1">{t('shop.groupSocial')}</span>
                        <span className="text-xs text-zinc-500 hidden xl:inline">{t('shop.socialHint')}</span>
                    </button>
                    {showSocial && (
                        <div className="px-4 pb-4 space-y-3">
                            <div className="grid gap-x-4 gap-y-3 fit-grid-sm">
                                <Input label="Facebook" value={value.shopFacebook || ''} onChange={(e) => set('shopFacebook', e.target.value)} error={linkProblem('shopFacebook', value.shopFacebook) ? t('shop.linkBad') : undefined} placeholder="https://facebook.com/…" className="ltr" maxLength={300} data-testid="shop-facebook" />
                                <Input label="Instagram" value={value.shopInstagram || ''} onChange={(e) => set('shopInstagram', e.target.value)} error={linkProblem('shopInstagram', value.shopInstagram) ? t('shop.linkBad') : undefined} placeholder="https://instagram.com/…" className="ltr" maxLength={300} data-testid="shop-instagram" />
                                <Input label="TikTok" value={value.shopTiktok || ''} onChange={(e) => set('shopTiktok', e.target.value)} error={linkProblem('shopTiktok', value.shopTiktok) ? t('shop.linkBad') : undefined} placeholder="https://tiktok.com/@…" className="ltr" maxLength={300} data-testid="shop-tiktok" />
                                <Input label={t('shop.mapUrl')} value={value.shopMapUrl || ''} onChange={(e) => set('shopMapUrl', e.target.value)} error={linkProblem('shopMapUrl', value.shopMapUrl) ? t('shop.linkBad') : undefined} placeholder="https://maps.app.goo.gl/…" className="ltr" maxLength={300} data-testid="shop-map" />
                            </div>
                            <TextArea
                                label={t('shop.hours')}
                                value={value.shopHours || ''}
                                onChange={(e) => set('shopHours', e.target.value)}
                                placeholder={t('shop.hoursPlaceholder')}
                                className="min-h-[60px]"
                                maxLength={800}
                                data-testid="shop-hours"
                            />
                        </div>
                    )}
                </div>

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
                            <div className="grid gap-x-4 gap-y-3 fit-grid-sm">
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
