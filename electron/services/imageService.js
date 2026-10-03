const path = require('path');
const fs = require('fs');
const { app } = require('electron');

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

        // Try to use sharp for optimization (optional)
        try {
            const sharp = require('sharp');
            await sharp(buffer)
                .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toFile(filePath.replace(path.extname(filePath), '.jpg'));

            return {
                success: true,
                fileName: fileName.replace(path.extname(fileName), '.jpg'),
                filePath: filePath.replace(path.extname(filePath), '.jpg'),
            };
        } catch {
            // If sharp fails, save the original image
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

        // Try to optimize with sharp
        try {
            const sharp = require('sharp');
            await sharp(sourcePath)
                .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toFile(filePath.replace(path.extname(filePath), '.jpg'));

            return {
                success: true,
                fileName: fileName.replace(path.extname(fileName), '.jpg'),
                filePath: filePath.replace(path.extname(filePath), '.jpg'),
            };
        } catch {
            // If sharp fails, just copy the file
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
            const sharp = require('sharp');
            await sharp(buffer)
                .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
                .png()
                .toFile(filePath);
            return { success: true, fileName, filePath };
        } catch {
            // sharp unavailable: keep the original bytes and extension
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
    getImagesDir,
    saveImage,
    saveLogo,
    saveImageFromPath,
    deleteImage,
    getImagePath,
    getImageBase64,
};
