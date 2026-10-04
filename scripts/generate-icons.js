// Builds the application icons from public/icon.svg:
//   public/icon.png (256), public/icon-512.png (512), public/icon.ico (16-256)
// Usage: node scripts/generate-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PUBLIC = path.join(__dirname, '..', 'public');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function png(svg, size) {
    return sharp(svg, { density: Math.ceil(72 * size / 445) }).resize(size, size).png().toBuffer();
}

// 32-bit bitmap entry (bottom-up BGRA + empty AND mask): read by every
// Windows version and by the NSIS installer
async function bitmap(svg, size) {
    const { data } = await sharp(await png(svg, size)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const from = ((size - 1 - y) * size + x) * 4;
            const to = (y * size + x) * 4;
            pixels[to] = data[from + 2];
            pixels[to + 1] = data[from + 1];
            pixels[to + 2] = data[from];
            pixels[to + 3] = data[from + 3];
        }
    }
    return Buffer.concat([header, pixels, Buffer.alloc(Math.ceil(size / 32) * 4 * size)]);
}

async function ico(svg) {
    // 256 stored as PNG, smaller sizes as bitmaps
    const images = await Promise.all(ICO_SIZES.map(size => (size >= 256 ? png(svg, size) : bitmap(svg, size))));
    const dir = Buffer.alloc(6 + 16 * images.length);
    dir.writeUInt16LE(1, 2);
    dir.writeUInt16LE(images.length, 4);
    let offset = dir.length;
    images.forEach((image, i) => {
        const at = 6 + 16 * i;
        const size = ICO_SIZES[i] >= 256 ? 0 : ICO_SIZES[i];
        dir.writeUInt8(size, at);
        dir.writeUInt8(size, at + 1);
        dir.writeUInt16LE(1, at + 4);
        dir.writeUInt16LE(32, at + 6);
        dir.writeUInt32LE(image.length, at + 8);
        dir.writeUInt32LE(offset, at + 12);
        offset += image.length;
    });
    return Buffer.concat([dir, ...images]);
}

async function main() {
    const svg = fs.readFileSync(path.join(PUBLIC, 'icon.svg'));
    fs.writeFileSync(path.join(PUBLIC, 'icon.png'), await png(svg, 256));
    fs.writeFileSync(path.join(PUBLIC, 'icon-512.png'), await png(svg, 512));
    fs.writeFileSync(path.join(PUBLIC, 'icon.ico'), await ico(svg));
    console.log('Icons written to public/');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
