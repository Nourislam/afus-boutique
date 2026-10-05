const path = require('path');
const fs = require('fs');
const { app, nativeImage } = require('electron');

/*
 * Images are resized with Electron's nativeImage: no native library to ship
 * for each processor (x64, ia32, arm64). nativeImage reads PNG and JPEG on
 * every system; the interface turns any other format (WebP, GIF, BMP, ...)
 * into PNG/JPEG before sending it (src/lib/imageResize.js). If an image still
 * cannot be read, the original file is kept and the reason is logged.
 */

/** Width and height that fit in a max × max box, keeping the proportions (never enlarged). */
function fitWithin(width, height, max) {
    const scale = Math.min(1, max / Math.max(width || 1, height || 1));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Decode, resize and encode an image.
 * @param {Electron.NativeImage} image
 * @returns {Buffer} JPEG (quality 85) or PNG bytes
 */
function encodeResized(image, maxSize, format) {
    if (!image || image.isEmpty()) throw new Error('Unsupported or damaged image');
    const size = image.getSize();
    const target = fitWithin(size.width, size.height, maxSize);
    const resized = target.width === size.width && target.height === size.height
        ? image
        : image.resize({ width: target.width, height: target.height, quality: 'best' });
    return format === 'png' ? resized.toPNG() : resized.toJPEG(85);
}

function logFallback(what, error) {
    console.warn(`[images] ${what}: kept the original file (${error && error.message ? error.message : error})`);
}

// Get the images directory path
function getImagesDir() {
    const userDataPath = app.getPath('userData');
    const imagesDir = path.join(userDataPath, 'images');

    // Create directory if it doesn't exist
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    return imagesDir;
}

// Generate unique filename
function generateFileName(originalName) {
    const timestamp = Date.now();
    const ext = path.extname(originalName) || '.jpg';
    return `${timestamp}${ext}`;
}

// Save image from base64 data
async function saveImage(base64Data, originalName = 'image.jpg') {
    try {
        const imagesDir = getImagesDir();
        const fileName = generateFileName(originalName);
        const filePath = path.join(imagesDir, fileName);

        // Remove data URL prefix if present
        const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Content, 'base64');

        // Resized to 800 px and saved as JPEG
        try {
            const jpeg = encodeResized(nativeImage.createFromBuffer(buffer), 800, 'jpeg');
            fs.writeFileSync(filePath.replace(path.extname(filePath), '.jpg'), jpeg);

            return {
                success: true,
                fileName: fileName.replace(path.extname(fileName), '.jpg'),
                filePath: filePath.replace(path.extname(filePath), '.jpg'),
            };
        } catch (error) {
            logFallback(`product image ${originalName}`, error);
            fs.writeFileSync(filePath, buffer);
            return {
                success: true,
                fileName,
                filePath,
            };
        }
    } catch (error) {
        console.error('Failed to save image:', error);
        return { success: false, error: error.message };
    }
}

// Save image from file path (copy file)
async function saveImageFromPath(sourcePath) {
    try {
        const imagesDir = getImagesDir();
        const fileName = generateFileName(path.basename(sourcePath));
        const filePath = path.join(imagesDir, fileName);

        // Resized to 800 px and saved as JPEG
        try {
            const jpeg = encodeResized(nativeImage.createFromPath(sourcePath), 800, 'jpeg');
            fs.writeFileSync(filePath.replace(path.extname(filePath), '.jpg'), jpeg);

            return {
                success: true,
                fileName: fileName.replace(path.extname(fileName), '.jpg'),
                filePath: filePath.replace(path.extname(filePath), '.jpg'),
            };
        } catch (error) {
            logFallback(`image ${sourcePath}`, error);
            fs.copyFileSync(sourcePath, filePath);
            return {
                success: true,
                fileName,
                filePath,
            };
        }
    } catch (error) {
        console.error('Failed to save image from path:', error);
        return { success: false, error: error.message };
    }
}

// Delete image
function deleteImage(fileName) {
    try {
        const imagesDir = getImagesDir();
        const filePath = path.join(imagesDir, fileName);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return { success: true };
        }

        return { success: true, message: 'File not found' };
    } catch (error) {
        console.error('Failed to delete image:', error);
        return { success: false, error: error.message };
    }
}

// Get image path for display
function getImagePath(fileName) {
    if (!fileName) return null;
    const imagesDir = getImagesDir();
    const filePath = path.join(imagesDir, fileName);

    if (fs.existsSync(filePath)) {
        return filePath;
    }

    return null;
}

// Get image as base64 for display in renderer
function getImageBase64(fileName) {
    try {
        const filePath = getImagePath(fileName);
        if (!filePath) return null;

        const buffer = fs.readFileSync(filePath);
        const rawExt = (path.extname(fileName).slice(1) || 'jpeg').toLowerCase();
        const ext = rawExt === 'svg' ? 'svg+xml' : rawExt === 'jpg' ? 'jpeg' : rawExt;
        const base64 = buffer.toString('base64');
        return `data:image/${ext};base64,${base64}`;
    } catch (error) {
        console.error('Failed to get image base64:', error);
        return null;
    }
}

/**
 * Save the shop logo. Kept as PNG (transparency matters for logos on receipts
 * and labels) and limited to 600 px.
 */
async function saveLogo(base64Data, originalName = 'logo.png') {
    try {
        const match = /^data:image\/(png|jpe?g|webp|gif|bmp|svg\+xml);base64,/i.exec(base64Data || '');
        if (!match) return { success: false, error: 'Unsupported image format (use PNG or JPG)' };
        const buffer = Buffer.from(base64Data.slice(match[0].length), 'base64');
        if (buffer.length > 5 * 1024 * 1024) return { success: false, error: 'Logo must be smaller than 5 MB' };

        const imagesDir = getImagesDir();
        const fileName = `logo-${Date.now()}.png`;
        const filePath = path.join(imagesDir, fileName);
        try {
            fs.writeFileSync(filePath, encodeResized(nativeImage.createFromBuffer(buffer), 600, 'png'));
            return { success: true, fileName, filePath };
        } catch (error) {
            // e.g. an SVG logo sent as is: keep the original bytes and extension
            logFallback(`logo ${originalName}`, error);
            const ext = match[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
            const rawName = `logo-${Date.now()}.${ext}`;
            fs.writeFileSync(path.join(imagesDir, rawName), buffer);
            return { success: true, fileName: rawName, filePath: path.join(imagesDir, rawName), originalName };
        }
    } catch (error) {
        console.error('Failed to save logo:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    fitWithin,
    getImagesDir,
    saveImage,
    saveLogo,
    saveImageFromPath,
    deleteImage,
    getImagePath,
    getImageBase64,
};
