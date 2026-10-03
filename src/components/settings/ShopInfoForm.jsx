import { useEffect, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Input, TextArea } from '../ui/Input';
import { toast } from '../ui/Toast';

/**
 * Shop identity fields: name, logo, contact details. Used by the first-launch
 * setup and by Settings > Shop. `value` is the store_config object.
 */
export function ShopInfoForm({ value, onChange, requireLogo = false }) {
    const [logoPreview, setLogoPreview] = useState(null);
    const [uploading, setUploading] = useState(false);

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
            toast.error('Logo must be smaller than 5 MB');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (event) => {
            setUploading(true);
            try {
                const result = await window.electronAPI.images.saveLogo({
                    base64Data: event.target.result,
                    originalName: file.name,
                });
                if (!result.success) throw new Error(result.error || 'Could not save logo');
                onChange({ ...value, shopLogo: result.fileName });
            } catch (error) {
                toast.error(error.message);
            } finally {
                setUploading(false);
            }
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className="grid grid-cols-3 gap-6">
            <div className="col-span-1">
                <label className="form-label mb-2 block">Shop logo{requireLogo ? ' *' : ''}</label>
                <div className="aspect-square bg-dark-tertiary rounded-xl border-2 border-dashed border-zinc-600 hover:border-zinc-500 relative flex items-center justify-center overflow-hidden">
                    {logoPreview ? (
                        <>
                            <img src={logoPreview} alt="Shop logo" className="w-full h-full object-contain p-2 bg-white" />
                            <button
                                type="button"
                                onClick={() => set('shopLogo', '')}
                                className="absolute top-2 right-2 p-1 bg-red-500 rounded-full hover:bg-red-600"
                                title="Remove logo"
                            >
                                <Trash2 className="w-4 h-4 text-white" />
                            </button>
                        </>
                    ) : (
                        <label className="cursor-pointer flex flex-col items-center p-4 text-center w-full h-full justify-center">
                            <ImagePlus className="w-10 h-10 text-zinc-500 mb-2" />
                            <span className="text-sm text-zinc-400">{uploading ? 'Saving…' : 'Click to upload'}</span>
                            <span className="text-xs text-zinc-500 mt-1">PNG or JPG, up to 5 MB</span>
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoSelect} className="hidden" />
                        </label>
                    )}
                </div>
                <p className="text-xs text-zinc-500 mt-2">Printed on receipts and labels. A black logo on a white or transparent background prints best on thermal printers.</p>
            </div>

            <div className="col-span-2 grid grid-cols-2 gap-4 content-start">
                <Input
                    label="Shop name *"
                    value={value.businessName || ''}
                    onChange={(e) => set('businessName', e.target.value)}
                    placeholder="e.g. Boutique Amina"
                    containerClassName="col-span-2"
                />
                <Input
                    label="Owner / manager name"
                    value={value.ownerName || ''}
                    onChange={(e) => set('ownerName', e.target.value)}
                />
                <Input
                    label="Phone number"
                    value={value.businessPhone || ''}
                    onChange={(e) => set('businessPhone', e.target.value)}
                />
                <Input
                    label="Address"
                    value={value.businessAddress || ''}
                    onChange={(e) => set('businessAddress', e.target.value)}
                    containerClassName="col-span-2"
                />
                <Input
                    label="Wilaya / city"
                    value={value.businessCity || ''}
                    onChange={(e) => set('businessCity', e.target.value)}
                />
                <Input
                    label="Email"
                    type="email"
                    value={value.businessEmail || ''}
                    onChange={(e) => set('businessEmail', e.target.value)}
                />
                <Input
                    label="Tax / registration number (optional, printed on receipts)"
                    value={value.businessTaxId || ''}
                    onChange={(e) => set('businessTaxId', e.target.value)}
                    containerClassName="col-span-2"
                />
                <div className="col-span-2">
                    <TextArea
                        label="Shop description"
                        value={value.shopDescription || ''}
                        onChange={(e) => set('shopDescription', e.target.value)}
                        placeholder="Optional"
                        className="min-h-[70px]"
                    />
                </div>
            </div>
        </div>
    );
}

export default ShopInfoForm;
