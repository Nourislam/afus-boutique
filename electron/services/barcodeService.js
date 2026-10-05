/**
 * Barcode Service
 * 
 * Barcode generation (EAN, Code 128, QR…) for clothing labels.
 */

const bwipjs = require('bwip-js');
const path = require('path');
const fs = require('fs');

// Label templates for clothing and fashion-accessory shops (names are
// translated in the interface by key)
const INDUSTRY_PRESETS = {
    fashion: {
        name: 'Hang tag',
        barcodeType: 'code128',
        labelWidth: 45,
        labelHeight: 80,
        showPrice: true,
        showName: true,
        showSize: true,
        description: 'Clothing hang tags with size',
    },
    retail: {
        name: 'Price sticker',
        barcodeType: 'code128',
        labelWidth: 50,
        labelHeight: 25,
        showPrice: true,
        showName: true,
        description: 'Standard price sticker',
    },
    accessories: {
        name: 'Accessories',
        barcodeType: 'code128',
        labelWidth: 25,
        labelHeight: 15,
        showPrice: true,
        showName: true,
        showSKU: true,
        description: 'Small tags for jewellery, belts, sunglasses',
    },
    shoebox: {
        name: 'Shoe box',
        barcodeType: 'code128',
        labelWidth: 60,
        labelHeight: 30,
        showPrice: true,
        showName: true,
        showSKU: true,
        showSize: true,
        description: 'Shoe and bag box labels',
    },
    qr: {
        name: 'QR tag',
        barcodeType: 'qrcode',
        labelWidth: 30,
        labelHeight: 30,
        showName: true,
        showPrice: true,
        description: 'Square QR labels',
    },
};

// Barcode type specifications
const BARCODE_TYPES = {
    // 1D Barcodes
    'upca': { name: 'UPC-A', digits: 12, type: '1D', region: 'US/Canada' },
    'ean13': { name: 'EAN-13', digits: 13, type: '1D', region: 'International' },
    'ean8': { name: 'EAN-8', digits: 8, type: '1D', region: 'International' },
    'code128': { name: 'Code 128', digits: 'Variable', type: '1D', region: 'Universal' },
    'code39': { name: 'Code 39', digits: 'Variable', type: '1D', region: 'Industrial' },
    'itf14': { name: 'ITF-14', digits: 14, type: '1D', region: 'Logistics' },
    // 2D Barcodes
    'qrcode': { name: 'QR Code', digits: 'Variable', type: '2D', region: 'Universal' },
    'datamatrix': { name: 'DataMatrix', digits: 'Variable', type: '2D', region: 'Industrial/Pharma' },
};

class BarcodeService {
    constructor() {
        this.labelsDir = null;
    }

    ensureLabelsDir() {
        if (!this.labelsDir) {
            const { app } = require('electron');
            this.labelsDir = path.join(app.getPath('userData'), 'labels');
        }
        if (!fs.existsSync(this.labelsDir)) {
            fs.mkdirSync(this.labelsDir, { recursive: true });
        }
    }

    /**
     * Get all supported barcode types
     */
    getBarcodeTypes() {
        return BARCODE_TYPES;
    }

    /**
     * Get all industry presets
     */
    getIndustryPresets() {
        return INDUSTRY_PRESETS;
    }

    /**
     * Generate a barcode image as base64 PNG
     */
    async generateBarcode(options) {
        let { type = 'ean13', data } = options;
        const {
            includeText = true,
            scale = 3,
            backgroundColor = '#ffffff',
            barcodeColor = '#000000',
        } = options;

        // Older saved settings used these names
        if (type === 'interleaved2of5') type = 'itf14';
        if (type === 'upce') type = 'upca';
        // Code 39 only has capital letters
        if (type === 'code39') data = String(data || '').toUpperCase();

        try {
            // Validate data for specific barcode types
            this.validateBarcodeData(type, data);

            const is2D = ['qrcode', 'datamatrix', 'azteccode'].includes(type);

            const bwipOptions = {
                bcid: type,
                text: data,
                scale: scale,
                backgroundcolor: backgroundColor.replace('#', ''),
                barcolor: barcodeColor.replace('#', ''),
            };

            // Only add height for 1D barcodes
            if (!is2D) {
                bwipOptions.height = options.barHeight || 10;
                bwipOptions.textxalign = 'center';
            }

            // Include text logic
            if (includeText && !is2D) {
                bwipOptions.includetext = true;
            }

            // Add type-specific options
            if (type === 'qrcode') {
                bwipOptions.eclevel = 'M';
            }

            const png = await bwipjs.toBuffer(bwipOptions);
            return {
                success: true,
                image: `data:image/png;base64,${png.toString('base64')}`,
                type: type,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Validate barcode data for specific types
     */
    validateBarcodeData(type, data) {
        const specs = BARCODE_TYPES[type];
        if (!specs) {
            throw new Error(`Unsupported barcode type: ${type}`);
        }

        if (!data || !String(data).trim()) throw new Error('empty');
        if (typeof specs.digits === 'number') {
            // Handle check digit calculation for UPC/EAN
            const requiredLength = specs.digits - 1;

            if (data.length !== requiredLength && data.length !== specs.digits) {
                throw new Error(`${specs.name}: ${specs.digits} / ${requiredLength}`);
            }

            if (!/^\d+$/.test(data)) {
                throw new Error(`${specs.name} only accepts numeric data`);
            }
        }

        return true;
    }

    /**
     * Generate a printable label with barcode and product info
     */
    async generateLabel(options) {
        const {
            product,
            preset = 'retail',
            customTemplate = null,
            quantity = 1,
        } = options;

        const template = customTemplate || INDUSTRY_PRESETS[preset];
        if (!template) {
            throw new Error(`Unknown preset: ${preset}`);
        }

        // Get barcode data
        const barcodeData = product.barcode || product.sku || product.id;

        // Determine best barcode type for this data
        let barcodeType = template.barcodeType;

        // Auto-detect: if data doesn't match expected format for numeric barcodes, fall back to Code128
        // We only check this for numeric-only linear barcodes where length matters
        if (barcodeType === 'ean13') {
            if (!/^\d{12,13}$/.test(barcodeData)) barcodeType = 'code128';
        } else if (barcodeType === 'upca') {
            if (!/^\d{11,12}$/.test(barcodeData)) barcodeType = 'code128';
        } else if (barcodeType === 'ean8') {
            if (!/^\d{7,8}$/.test(barcodeData)) barcodeType = 'code128';
        }

        // Try to generate barcode with detected type
        let barcode = await this.generateBarcode({
            type: barcodeType,
            data: barcodeData,
            scale: 2,
        });

        // If it failed, log why
        if (!barcode.success) {
            console.warn(`Barcode generation failed for type ${barcodeType} with data "${barcodeData}": ${barcode.error}`);

            // Fallback strategy:
            // Only fallback to Code128 if the original intent was NOT a 2D code.
            // Converting a failed QR code (likely due to config) to a huge linear barcode is bad UX.
            // Also, don't fallback if we already tried Code128.
            const is2D = ['qrcode', 'datamatrix', 'azteccode'].includes(barcodeType);

            if (!is2D && barcodeType !== 'code128' && barcodeData && barcodeData.length > 0) {
                console.log('Falling back to Code128...');
                barcode = await this.generateBarcode({
                    type: 'code128',
                    data: barcodeData,
                    scale: 2,
                });
            }
        }

        if (!barcode.success) {
            throw new Error(`Failed to generate barcode: ${barcode.error}`);
        }

        // Build label data
        const label = {
            barcode: barcode.image,
            barcodeData: barcodeData,
            barcodeType: barcodeType,
            productName: product.name,
            price: product.price,
            sku: product.sku,
            template: template,
            quantity: quantity,
        };

        // Add industry-specific fields
        if (template.showWeight && product.weight) {
            label.weight = product.weight;
        }
        if (template.showExpiry && product.expiry_date) {
            label.expiryDate = product.expiry_date;
        }
        if (template.showLot && product.lot_number) {
            label.lotNumber = product.lot_number;
        }

        return label;
    }

    /**
     * Generate batch labels for multiple products
     */
    async generateBatchLabels(products, preset = 'retail', quantityPerProduct = 1) {
        const labels = [];

        for (const product of products) {
            try {
                const label = await this.generateLabel({
                    product,
                    preset,
                    quantity: quantityPerProduct,
                });
                labels.push(label);
            } catch (error) {
                labels.push({
                    error: error.message,
                    productName: product.name,
                    productId: product.id,
                });
            }
        }

        return labels;
    }

    /**
     * Generate GS1 formatted barcode data (for pharmaceutical/logistics)
     */
    generateGS1Data(components) {
        // GS1 Application Identifiers
        const AI = {
            GTIN: '01',
            LOT: '10',
            EXPIRY: '17',
            SERIAL: '21',
            SSCC: '00',
        };

        let gs1String = '';

        if (components.gtin) {
            gs1String += `(${AI.GTIN})${components.gtin.padStart(14, '0')}`;
        }
        if (components.lot) {
            gs1String += `(${AI.LOT})${components.lot}`;
        }
        if (components.expiry) {
            // Format: YYMMDD
            gs1String += `(${AI.EXPIRY})${components.expiry}`;
        }
        if (components.serial) {
            gs1String += `(${AI.SERIAL})${components.serial}`;
        }

        return gs1String;
    }

    /**
     * Calculate check digit for EAN/UPC
     */
    calculateCheckDigit(data) {
        // GS1 (EAN-8/13, UPC-A, ITF-14): weights 3,1,3… from the right
        const digits = String(data).split('').map(Number).reverse();
        const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
        return String((10 - (sum % 10)) % 10);
    }

    /**
     * Generate a random valid barcode for testing
     */
    generateRandomBarcode(type = 'ean13') {
        let data = '';

        if (type === 'ean13') {
            // Generate 12 random digits, then add check digit
            for (let i = 0; i < 12; i++) {
                data += Math.floor(Math.random() * 10);
            }
            data += this.calculateCheckDigit(data, 'ean13');
        } else if (type === 'upca') {
            for (let i = 0; i < 11; i++) {
                data += Math.floor(Math.random() * 10);
            }
            data += this.calculateCheckDigit(data, 'upca');
        } else if (type === 'ean8') {
            for (let i = 0; i < 7; i++) {
                data += Math.floor(Math.random() * 10);
            }
            data += this.calculateCheckDigit(data, 'ean8');
        } else if (type === 'itf14' || type === 'interleaved2of5') {
            for (let i = 0; i < 13; i++) {
                data += Math.floor(Math.random() * 10);
            }
            data += this.calculateCheckDigit(data);
        } else {
            // For variable length, generate a reasonable length
            const length = 10;
            for (let i = 0; i < length; i++) {
                data += Math.floor(Math.random() * 10);
            }
        }

        return data;
    }
}

module.exports = new BarcodeService();
