import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';

const cache = new Map();

// Words that say "shop" and not which shop: skipped for the initials
const GENERIC_WORDS = new Set(['boutique', 'magasin', 'store', 'shop', 'showroom', 'bazar', 'بوتيك', 'محل', 'متجر', 'محلات', 'بازار']);

// The shop's own colours: warm and neutral tones, never the Afus blue/green,
// so a shop without a logo never looks like the program's mark
const SHOP_COLORS = [
    ['#b45309', '#f59e0b'], ['#be123c', '#fb7185'], ['#0f766e', '#2dd4bf'], ['#6d28d9', '#a78bfa'],
    ['#334155', '#94a3b8'], ['#9a3412', '#fb923c'], ['#86198f', '#e879f9'], ['#3f6212', '#a3e635'],
];

/** "Boutique Amina" → "A", "Zara Kids" → "ZK", "بوتيك أمينة" → "أ" */
export function shopInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    const meaningful = words.filter(w => !GENERIC_WORDS.has(w.toLowerCase()));
    const list = meaningful.length ? meaningful : words;
    if (!list.length) return '';
    // Arabic letters join together: one letter reads better
    if (/[؀-ۿ]/.test(list[0])) return list[0].charAt(0);
    return list.slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('');
}

function colorsFor(name) {
    let hash = 0;
    for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return SHOP_COLORS[hash % SHOP_COLORS.length];
}

/**
 * The shop's logo (stored locally in the images folder). Without a logo it
 * shows the initials of the shop name (`name`), or a neutral shop icon.
 */
export function ShopLogo({ fileName, name = '', size = 24, className = '', rounded = 'rounded-lg' }) {
    const [src, setSrc] = useState(fileName ? cache.get(fileName) || null : null);

    useEffect(() => {
        let cancelled = false;
        if (!fileName) {
            setSrc(null);
            return undefined;
        }
        if (cache.has(fileName)) {
            setSrc(cache.get(fileName));
            return undefined;
        }
        window.electronAPI?.images?.get(fileName)
            .then((data) => {
                if (cancelled || !data) return;
                cache.set(fileName, data);
                setSrc(data);
            })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [fileName]);

    const style = { width: size, height: size };

    if (src) {
        return <img src={src} alt={t('shop.logo')} style={style} className={`object-contain ${rounded} ${className}`} />;
    }
    const initials = shopInitials(name);
    if (initials) {
        const [from, to] = colorsFor(name);
        return (
            <div
                style={{ ...style, background: `linear-gradient(135deg, ${from}, ${to})`, fontSize: Math.max(11, Math.round(size * (initials.length > 1 ? 0.38 : 0.52))) }}
                className={`${rounded} flex items-center justify-center flex-none font-bold text-white leading-none select-none ${className}`}
                aria-label={name}
                role="img"
            >
                {initials}
            </div>
        );
    }
    return (
        <div style={style} className={`${rounded} bg-zinc-700 flex items-center justify-center flex-none ${className}`}>
            <Store size={Math.round(size * 0.55)} className="text-zinc-300" />
        </div>
    );
}

export default ShopLogo;
