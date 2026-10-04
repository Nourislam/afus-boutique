import { t } from '../../i18n';
import { useEffect, useState } from 'react';

/**
 * Renders the QR code for an identifier. The SVG is generated locally in the
 * main process (bwip-js), exactly as it will be printed on labels.
 */
export function QrPreview({ value, size = 96, className = '' }) {
    const [svg, setSvg] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        setError('');
        if (!value) {
            setSvg('');
            return undefined;
        }
        window.electronAPI.labels.qrSvg(value)
            .then((markup) => { if (!cancelled) setSvg(markup); })
            .catch((e) => { if (!cancelled) setError(e.message || t('products.qrFailed')); });
        return () => { cancelled = true; };
    }, [value]);

    if (error) return <div className={`text-xs text-red-400 ${className}`}>{error}</div>;
    if (!svg) return <div style={{ width: size, height: size }} className={`bg-zinc-800 rounded ${className}`} />;

    // The SVG comes from bwip-js in our own main process, not from user input
    return (
        <div
            style={{ width: size, height: size }}
            className={`bg-white p-1 rounded [&>svg]:w-full [&>svg]:h-full ${className}`}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

export default QrPreview;
