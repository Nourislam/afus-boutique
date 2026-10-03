/**
 * QR label generation and printing.
 *
 * - QR codes are generated locally with bwip-js as vector SVG, so they stay
 *   sharp at any printer resolution (no external QR service).
 * - The QR only encodes the variant's stable identifier (its qr_code, which
 *   defaults to the SKU) - never price or stock - so prices can change without
 *   reprinting labels.
 * - All physical sizes are in millimetres.
 * - Two layouts:
 *     roll  - one label per page, for thermal/label printers with label rolls
 *     sheet - a grid of labels on a sheet (e.g. A4 sticker sheets) for normal printers
 * - Printing uses a hidden Electron window and webContents.print() with an
 *   explicit page size, which is more reliable than window.print().
 */

const bwipjs = require('bwip-js');

const PAPER_SIZES_MM = {
    A4: { width: 210, height: 297 },
    A5: { width: 148, height: 210 },
    Letter: { width: 215.9, height: 279.4 },
};

// Common clothing label formats. Users can also enter any custom size.
const LABEL_TEMPLATES = {
    'roll-30x20': { name: '30 × 20 mm (roll)', mode: 'roll', widthMm: 30, heightMm: 20 },
    'roll-40x30': { name: '40 × 30 mm (roll)', mode: 'roll', widthMm: 40, heightMm: 30 },
    'roll-50x30': { name: '50 × 30 mm (roll)', mode: 'roll', widthMm: 50, heightMm: 30 },
    'roll-50x25': { name: '50 × 25 mm (roll)', mode: 'roll', widthMm: 50, heightMm: 25 },
    'roll-60x40': { name: '60 × 40 mm (roll)', mode: 'roll', widthMm: 60, heightMm: 40 },
    'sheet-a4-3x8': {
        name: 'A4 sheet, 3 × 8 (70 × 37 mm)', mode: 'sheet', widthMm: 70, heightMm: 37,
        paper: 'A4', columns: 3, rows: 8, pageMarginTopMm: 0.5, pageMarginLeftMm: 0, gapXMm: 0, gapYMm: 0,
    },
    'sheet-a4-4x10': {
        name: 'A4 sheet, 4 × 10 (48.5 × 25.4 mm)', mode: 'sheet', widthMm: 48.5, heightMm: 25.4,
        paper: 'A4', columns: 4, rows: 10, pageMarginTopMm: 21.5, pageMarginLeftMm: 8, gapXMm: 0, gapYMm: 0,
    },
};

const DEFAULT_LABEL_SETTINGS = {
    template: 'roll-40x30',
    mode: 'roll',
    widthMm: 40,
    heightMm: 30,
    paddingMm: 1.5,
    paper: 'A4',
    columns: 3,
    rows: 8,
    pageMarginTopMm: 0.5,
    pageMarginLeftMm: 0,
    gapXMm: 0,
    gapYMm: 0,
    showLogo: false,
    showShopName: true,
    showProductName: true,
    showVariant: true,
    showSku: true,
    showPrice: true,
    extraText: '',
    qrErrorCorrection: 'M',
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toNumber(value, fallback) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Merge saved settings with the template they reference and the defaults. */
function resolveLayout(settings = {}) {
    const template = LABEL_TEMPLATES[settings.template] || {};
    const merged = { ...DEFAULT_LABEL_SETTINGS, ...template, ...settings };
    // A predefined template fixes the geometry unless the user picked "custom"
    if (settings.template && settings.template !== 'custom' && LABEL_TEMPLATES[settings.template]) {
        Object.assign(merged, template);
    }
    merged.widthMm = toNumber(merged.widthMm, 40);
    merged.heightMm = toNumber(merged.heightMm, 30);
    merged.paddingMm = Math.max(0, parseFloat(merged.paddingMm) || 0);
    merged.columns = Math.max(1, parseInt(merged.columns, 10) || 1);
    merged.rows = Math.max(1, parseInt(merged.rows, 10) || 1);
    merged.pageMarginTopMm = Math.max(0, parseFloat(merged.pageMarginTopMm) || 0);
    merged.pageMarginLeftMm = Math.max(0, parseFloat(merged.pageMarginLeftMm) || 0);
    merged.gapXMm = Math.max(0, parseFloat(merged.gapXMm) || 0);
    merged.gapYMm = Math.max(0, parseFloat(merged.gapYMm) || 0);
    merged.mode = merged.mode === 'sheet' ? 'sheet' : 'roll';
    return merged;
}

/** Physical page size (mm) the printer must be told about. */
function getPageSize(layout) {
    if (layout.mode === 'sheet') {
        return PAPER_SIZES_MM[layout.paper] || PAPER_SIZES_MM.A4;
    }
    return { width: layout.widthMm, height: layout.heightMm };
}

function qrSvg(text, eclevel = 'M') {
    if (!text) throw new Error('QR content is empty');
    // Quiet zone is added by the label layout, so no padding here
    return bwipjs.toSVG({ bcid: 'qrcode', text: String(text), eclevel, paddingwidth: 0, paddingheight: 0 });
}

// Compact price for small labels: "2,500 DA" rather than "DZD 2,500.00"
function formatPrice(amount, currency, symbol) {
    const value = Number(amount || 0);
    const number = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
        maximumFractionDigits: 2,
    }).format(value);
    return `${number} ${symbol || currency || ''}`.trim();
}

function renderLabel(label, layout, shop) {
    const pad = layout.paddingMm;
    const innerH = layout.heightMm - pad * 2;
    const innerW = layout.widthMm - pad * 2;
    // Square QR on the left; keep a quiet zone of ~1.2 mm around it and leave
    // at least 40% of the width for text.
    const quiet = 1.2;
    const qrSize = Math.max(8, Math.min(innerH, innerW * 0.5) - quiet * 2);
    // Font size in mm, scaled to the label so text fits next to the QR
    const base = Math.max(1.5, Math.min(layout.heightMm / 10, layout.widthMm / 15, 3.2));

    const lines = [];
    if (layout.showShopName && shop.name) {
        lines.push(`<div class="shop">${layout.showLogo && shop.logo ? `<img src="${shop.logo}" alt="">` : ''}<span>${escapeHtml(shop.name)}</span></div>`);
    } else if (layout.showLogo && shop.logo) {
        lines.push(`<div class="shop"><img src="${shop.logo}" alt=""></div>`);
    }
    if (layout.showProductName) lines.push(`<div class="name">${escapeHtml(label.productName)}</div>`);
    if (layout.showVariant && label.variantLabel) lines.push(`<div class="variant">${escapeHtml(label.variantLabel)}</div>`);
    // Width left for text next to the QR; long single-line values (SKU,
    // price) are shrunk to fit instead of being cut off.
    const textWidthMm = innerW - (qrSize + quiet * 2);
    const fit = (text, preferredMm, charWidthEm) =>
        Math.max(1.2, Math.min(preferredMm, textWidthMm / (Math.max(String(text).length, 1) * charWidthEm))).toFixed(2);
    if (layout.showSku && label.sku) {
        lines.push(`<div class="sku" style="font-size:${fit(label.sku, base * 0.8, 0.62)}mm">${escapeHtml(label.sku)}</div>`);
    }
    if (layout.showPrice && label.price !== null && label.price !== undefined) {
        const price = formatPrice(label.price, label.currency, label.currencySymbol);
        lines.push(`<div class="price" style="font-size:${fit(price, base * 1.25, 0.6)}mm">${escapeHtml(price)}</div>`);
    }
    if (layout.extraText) lines.push(`<div class="extra">${escapeHtml(layout.extraText)}</div>`);

    return `
        <div class="label" style="width:${layout.widthMm}mm;height:${layout.heightMm}mm;padding:${pad}mm;font-size:${base.toFixed(2)}mm">
            <div class="qr" style="width:${qrSize.toFixed(2)}mm;height:${qrSize.toFixed(2)}mm;margin:${quiet}mm">${qrSvg(label.qrValue, layout.qrErrorCorrection)}</div>
            <div class="text">${lines.join('')}</div>
        </div>`;
}

/**
 * Build the printable HTML for a list of labels.
 * @param {Array} labels [{ productName, variantLabel, sku, qrValue, price, currency, quantity }]
 * @param {object} settings label settings (see DEFAULT_LABEL_SETTINGS)
 * @param {object} shop { name, logo (data URI) }
 */
function buildLabelsHtml(labels, settings = {}, shop = {}) {
    const layout = resolveLayout(settings);
    const page = getPageSize(layout);

    const expanded = [];
    for (const label of labels) {
        const qty = Math.min(Math.max(parseInt(label.quantity, 10) || 1, 1), 1000);
        for (let i = 0; i < qty; i++) expanded.push(label);
    }
    if (expanded.length === 0) throw new Error('No labels to print');

    let body;
    if (layout.mode === 'roll') {
        body = expanded.map(l => `<div class="page roll">${renderLabel(l, layout, shop)}</div>`).join('');
    } else {
        const perPage = layout.columns * layout.rows;
        const pages = [];
        for (let i = 0; i < expanded.length; i += perPage) {
            const cells = expanded.slice(i, i + perPage).map(l => renderLabel(l, layout, shop)).join('');
            pages.push(`
                <div class="page sheet" style="padding:${layout.pageMarginTopMm}mm 0 0 ${layout.pageMarginLeftMm}mm;
                    grid-template-columns:repeat(${layout.columns}, ${layout.widthMm}mm);
                    grid-auto-rows:${layout.heightMm}mm;column-gap:${layout.gapXMm}mm;row-gap:${layout.gapYMm}mm">${cells}</div>`);
        }
        body = pages.join('');
    }

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
    @page { size: ${page.width}mm ${page.height}mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, "Segoe UI", sans-serif; }
    .page { width: ${page.width}mm; height: ${page.height}mm; overflow: hidden; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    .page.sheet { display: grid; align-content: start; }
    .label { display: flex; align-items: center; overflow: hidden; }
    .qr { flex: none; }
    .qr svg { display: block; width: 100%; height: 100%; shape-rendering: crispEdges; }
    .text { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 0.25em; line-height: 1.1; }
    .shop { display: flex; align-items: center; gap: 0.3em; font-size: 0.7em; text-transform: uppercase; white-space: nowrap; overflow: hidden; }
    .shop span { overflow: hidden; text-overflow: ellipsis; }
    .shop img { height: 1.6em; max-width: 6em; object-fit: contain; }
    .name { font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
    .variant { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sku { font-family: "Courier New", monospace; font-size: 0.8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .price { font-weight: 800; font-size: 1.25em; white-space: nowrap; overflow: hidden; }
    .extra { font-size: 0.7em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head>
<body>${body}</body></html>`;
}

/**
 * Load HTML into a hidden window and run fn(webContents). The window is
 * always destroyed afterwards.
 */
async function withHiddenWindow(BrowserWindow, html, fn) {
    const win = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false },
    });
    try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return await fn(win.webContents);
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

/**
 * Send labels to a printer.
 * @param {object} options { printerName, silent, copies, dpi }
 */
async function printLabels(BrowserWindow, html, settings, options = {}) {
    const layout = resolveLayout(settings);
    const page = getPageSize(layout);
    return withHiddenWindow(BrowserWindow, html, (webContents) => new Promise((resolve, reject) => {
        const printOptions = {
            silent: !!options.silent,
            printBackground: true,
            deviceName: options.printerName || '',
            margins: { marginType: 'none' },
            // Electron expects microns here
            pageSize: { width: Math.round(page.width * 1000), height: Math.round(page.height * 1000) },
            copies: Math.max(1, parseInt(options.copies, 10) || 1),
            landscape: false,
        };
        const dpi = parseInt(options.dpi, 10);
        if (dpi > 0) printOptions.dpi = { horizontal: dpi, vertical: dpi };

        webContents.print(printOptions, (success, failureReason) => {
            if (success) resolve({ success: true });
            else if (failureReason === 'cancelled' || failureReason === 'Print job canceled') resolve({ success: false, cancelled: true });
            else reject(new Error(failureReason || 'Printing failed'));
        });
    }));
}

/** Render the labels to a PDF buffer with exact physical page size. */
async function labelsToPdf(BrowserWindow, html, settings) {
    const layout = resolveLayout(settings);
    const page = getPageSize(layout);
    return withHiddenWindow(BrowserWindow, html, (webContents) => webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        // printToPDF expects inches
        pageSize: { width: page.width / 25.4, height: page.height / 25.4 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }));
}

module.exports = {
    LABEL_TEMPLATES,
    DEFAULT_LABEL_SETTINGS,
    PAPER_SIZES_MM,
    resolveLayout,
    getPageSize,
    buildLabelsHtml,
    printLabels,
    labelsToPdf,
    qrSvg,
    escapeHtml,
};
