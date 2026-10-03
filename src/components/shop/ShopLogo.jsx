import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';

const cache = new Map();

/**
 * Shows the shop logo configured in Shop Settings (stored locally in the
 * images folder), or a neutral icon when there is none.
 */
export function ShopLogo({ fileName, size = 24, className = '', rounded = 'rounded-lg' }) {
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
        return <img src={src} alt="Shop logo" style={style} className={`object-contain ${rounded} ${className}`} />;
    }
    return (
        <div style={style} className={`${rounded} bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center ${className}`}>
            <Store size={Math.round(size * 0.6)} className="text-white" />
        </div>
    );
}

export default ShopLogo;
