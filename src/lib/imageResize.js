// Images chosen in the interface are decoded and resized here, with the
// browser's own decoders (PNG, JPEG, WebP, GIF, BMP, AVIF, SVG...), and sent
// to the main process as PNG or JPEG only: Electron's nativeImage reads those
// two formats on every system, so no native image library is needed.

/** Width and height that fit in a max × max box, keeping the proportions (never enlarged). */
export function fitWithin(width, height, max) {
    const scale = Math.min(1, max / Math.max(width || 1, height || 1));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image could not be read'));
        img.src = src;
    });
}

/**
 * @param {string} dataUrl image read with FileReader.readAsDataURL
 * @param {object} options { maxSize, type: 'image/jpeg' | 'image/png', quality }
 * @returns {Promise<string>} data URL (PNG or JPEG), or the original when it cannot be decoded
 */
export async function resizeImageDataUrl(dataUrl, { maxSize = 800, type = 'image/jpeg', quality = 0.85 } = {}) {
    try {
        const img = await loadImage(dataUrl);
        const naturalW = img.naturalWidth || maxSize;
        const naturalH = img.naturalHeight || maxSize;
        // A drawing (SVG) has no fixed size: draw it as large as allowed
        const isVector = /^data:image\/svg\+xml/i.test(dataUrl);
        const { width, height } = isVector
            ? fitWithin(naturalW * maxSize, naturalH * maxSize, maxSize)
            : fitWithin(naturalW, naturalH, maxSize);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // JPEG has no transparency: white background instead of black
        if (type === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
        }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL(type, quality);
    } catch (error) {
        // The main process keeps the original file in that case
        console.warn('[images] resize in the interface failed, sending the original:', error);
        return dataUrl;
    }
}
