import { useEffect, useState } from 'react';
import { ImagePlus, Trash2, RefreshCw, ZoomIn, ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal, ModalBody } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { t } from '../../i18n';
import { resizeImageDataUrl } from '../../lib/imageResize';

export const MAX_IMAGES = 3;

const cache = new Map();
function useImageData(fileName) {
    const [src, setSrc] = useState(fileName ? cache.get(fileName) || null : null);
    useEffect(() => {
        let cancelled = false;
        if (!fileName) { setSrc(null); return undefined; }
        if (cache.has(fileName)) { setSrc(cache.get(fileName)); return undefined; }
        window.electronAPI.images.get(fileName).then((data) => {
            if (cancelled || !data) return;
            cache.set(fileName, data);
            setSrc(data);
        }).catch(() => { });
        return () => { cancelled = true; };
    }, [fileName]);
    return src;
}

/** Read a picked file, resize it (800 px, JPEG) and save it in the images folder. */
function savePicked(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve(null);
        if (file.size > 15 * 1024 * 1024) return reject(new Error(t('products.imageTooBig')));
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const base64Data = await resizeImageDataUrl(event.target.result, { maxSize: 800, type: 'image/jpeg', quality: 0.85 });
                const result = await window.electronAPI.images.save({ base64Data, originalName: file.name });
                if (!result?.success) throw new Error(t('products.imageSaveFailed'));
                cache.set(result.fileName, base64Data);
                resolve(result.fileName);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error(t('products.imageSaveFailed')));
        reader.readAsDataURL(file);
    });
}

function Slot({ fileName, index, main, onPick, onRemove, onPreview, busy }) {
    const src = useImageData(fileName);
    const pick = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onPick(file);
    };
    const size = main ? 'aspect-[4/5]' : 'aspect-square';
    if (!fileName) {
        return (
            <label className={`${size} rounded-xl border border-dashed border-zinc-600 hover:border-indigo-400 hover:bg-indigo-500/5 flex flex-col items-center justify-center gap-1 cursor-pointer text-zinc-500 hover:text-indigo-300 transition-colors ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
                <ImagePlus className={main ? 'w-7 h-7' : 'w-5 h-5'} />
                {main && <span className="text-xs text-center px-2">{t('products.addPhoto')}</span>}
                <input type="file" accept="image/*" className="hidden" onChange={pick} aria-label={t('products.addPhoto')} />
            </label>
        );
    }
    return (
        <div className={`${size} relative rounded-xl overflow-hidden border border-dark-border bg-dark-primary group`}>
            {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full animate-pulse bg-dark-tertiary" />}
            {main && <span className="absolute top-1.5 start-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white">{t('products.mainPhoto')}</span>}
            {/* Always visible on touch screens; on hover elsewhere */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 p-1 bg-gradient-to-t from-black/75 to-transparent opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                <button type="button" onClick={() => onPreview(index)} className="p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white" title={t('products.viewPhoto')} aria-label={t('products.viewPhoto')}>
                    <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <label className="p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white cursor-pointer" title={t('products.replacePhoto')}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <input type="file" accept="image/*" className="hidden" onChange={pick} aria-label={t('products.replacePhoto')} />
                </label>
                <button type="button" onClick={() => onRemove(index)} className="p-1.5 rounded-full bg-black/60 hover:bg-red-500 text-white" title={t('common.delete')} aria-label={t('common.delete')}>
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

function Preview({ images, index, onClose, onIndex }) {
    const src = useImageData(images[index]);
    if (index === null || index === undefined) return null;
    const many = images.length > 1;
    return (
        <Modal isOpen onClose={onClose} title={t('products.photoN', { n: index + 1, total: images.length })} size="lg">
            <ModalBody>
                <div className="relative flex items-center justify-center bg-black/40 rounded-lg min-h-[320px]">
                    {src && <img src={src} alt="" className="max-h-[65vh] max-w-full object-contain rounded" />}
                    {many && (
                        <>
                            <button type="button" onClick={() => onIndex((index - 1 + images.length) % images.length)} className="absolute start-2 p-2 rounded-full bg-black/60 text-white" aria-label="previous">
                                <ChevronLeft className="w-5 h-5 flip-rtl" />
                            </button>
                            <button type="button" onClick={() => onIndex((index + 1) % images.length)} className="absolute end-2 p-2 rounded-full bg-black/60 text-white" aria-label="next">
                                <ChevronRight className="w-5 h-5 flip-rtl" />
                            </button>
                        </>
                    )}
                </div>
            </ModalBody>
        </Modal>
    );
}

/**
 * The article's photos: optional, up to 3. The first one is the photo shown
 * in the sales screen and the lists; each can be viewed, replaced or removed.
 * images: [fileName, …]
 */
export function ProductImages({ images, onChange }) {
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState(null);
    const list = images.slice(0, MAX_IMAGES);

    const put = async (index, file) => {
        setBusy(true);
        try {
            const name = await savePicked(file);
            if (!name) return;
            const next = [...list];
            if (index < next.length) next[index] = name;
            else next.push(name);
            onChange(next.slice(0, MAX_IMAGES));
        } catch (error) {
            toast.error(error.message || t('products.imageSaveFailed'));
        } finally {
            setBusy(false);
        }
    };
    // The file stays on disk: another article may use it
    const remove = (index) => onChange(list.filter((_, i) => i !== index));

    const slots = [0, 1, 2].map(i => ({ index: i, fileName: list[i] || null }));
    // Only the next free place can be filled, so photos stay in order
    const canAdd = (i) => i <= list.length;

    return (
        <div className="space-y-2">
            <Slot {...slots[0]} main onPick={(f) => put(0, f)} onRemove={remove} onPreview={setPreview} busy={busy} />
            <div className="grid grid-cols-2 gap-2">
                {slots.slice(1).map(slot => (
                    canAdd(slot.index)
                        ? <Slot key={slot.index} {...slot} onPick={(f) => put(slot.index, f)} onRemove={remove} onPreview={setPreview} busy={busy} />
                        : <div key={slot.index} className="aspect-square rounded-xl border border-dashed border-dark-border/60" aria-hidden />
                ))}
            </div>
            <p className="text-[11px] text-zinc-500 text-center">{t('products.photosHint', { n: list.length, max: MAX_IMAGES })}</p>
            {preview !== null && <Preview images={list} index={preview} onClose={() => setPreview(null)} onIndex={setPreview} />}
        </div>
    );
}

export default ProductImages;
