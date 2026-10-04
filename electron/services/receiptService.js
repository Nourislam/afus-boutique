const fs = require('fs');
const path = require('path');
const os = require('os');
const { BrowserWindow } = require('electron');
const { translator, formatMoney, formatDate, variantLabel, paymentLabel } = require('../i18n');

class ReceiptService {
    constructor() {
        this.printWindow = null;
    }

    formatCurrency(amount, currency = 'DZD', lang) {
        return formatMoney(amount, lang, currency);
    }

    // ... (rest of methods until print)

    async generateQuotationPdf(quote, settings = {}, outputPath = null) {
        return this.generatePdf(quote, { ...settings, type: 'quotation' }, outputPath);
    }

    async generatePurchaseOrderPdf(po, settings = {}, outputPath = null) {
        return this.generatePdf(po, { ...settings, type: 'purchase_order' }, outputPath);
    }

    async generatePdf(sale, settings = {}, outputPath = null) {
        try {
            this.printWindow = new BrowserWindow({
                show: false,
                webPreferences: {
                    nodeIntegration: false
                }
            });

            const html = this.generateHtml(sale, settings);
            await this.printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

            // Get content dimensions
            // Wait a moment for rendering
            await new Promise(resolve => setTimeout(resolve, 500));

            const pageDimensions = await this.printWindow.webContents.executeJavaScript(`
                new Promise((resolve) => {
                    const body = document.body;
                    const html = document.documentElement;
                    const height = Math.max(
                        body.scrollHeight, body.offsetHeight,
                        html.clientHeight, html.scrollHeight, html.offsetHeight
                    );
                    resolve({ height: height }); 
                })
            `);

            // Determine page size based on document type
            const docType = settings.type || 'receipt';
            let pageConfig;

            if (docType === 'purchase_order' || docType === 'quotation') {
                // A4 size for formal documents
                pageConfig = {
                    pageSize: 'A4',
                    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
                };
            } else if (docType === 'gift_card') {
                // Gift Card Size (Approx 600px x 380px at 96 DPI -> 6.25in x 3.96in)
                pageConfig = {
                    pageSize: { width: 6.25, height: 3.96 },
                    margins: { top: 0, bottom: 0, left: 0, right: 0 }
                };
            } else {
                // Receipt size (thermal printer)
                const heightInInches = (pageDimensions.height + 40) / 96;
                pageConfig = {
                    pageSize: { width: 3.15, height: Math.max(heightInInches, 2) },
                    margins: { top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 }
                };
            }

            const pdfData = await this.printWindow.webContents.printToPDF({
                printBackground: true,
                ...pageConfig
            });

            const finalPath = outputPath || path.join(os.tmpdir(), `receipt_${sale.receipt_number || 'doc'}.pdf`);

            await fs.promises.writeFile(finalPath, pdfData);

            this.printWindow.close();
            this.printWindow = null;

            return finalPath;

        } catch (error) {
            console.error('PDF Generation failed:', error);
            if (this.printWindow) {
                this.printWindow.close();
                this.printWindow = null;
            }
            throw error;
        }
    }

    async generateGiftCardPdf(giftCard, settings = {}, outputPath = null) {
        return this.generatePdf({ ...giftCard }, { ...settings, type: 'gift_card' }, outputPath);
    }

    generateHtml(data, storeSettings = {}) {
        const type = storeSettings.type || 'receipt';

        if (type === 'gift_card') {
            return this.generateGiftCardHtml(data, storeSettings);
        }

        const isA4 = type === 'purchase_order' || type === 'quotation';

        // Use thermal receipt style for regular receipts
        if (type === 'receipt') {
            return this.generateThermalReceiptHtml(data, storeSettings);
        } else if (type === 'credit_payment') {
            return this.generateCreditPaymentReceiptHtml(data, storeSettings);
        }

        const T = translator(storeSettings.defaultLanguage);
        const esc = (v) => this.escapeHtml(v);
        const money = (v) => formatMoney(v, T.lang, storeSettings.currency);
        const settings = {
            ...storeSettings,
            name: storeSettings.businessName || '',
            address: [storeSettings.businessAddress, storeSettings.businessCity, storeSettings.businessWilaya].filter(Boolean).join(', '),
            phone: storeSettings.businessPhone || '',
            email: storeSettings.businessEmail || '',
            website: storeSettings.businessWebsite || '',
            poSignatureName: storeSettings.poSignatureName || '',
            poSignatureTitle: storeSettings.poSignatureTitle || T('doc.signatory'),
        };
        const legal = [
            ['legal.rc', storeSettings.businessRc],
            ['legal.nif', storeSettings.businessTaxId],
            ['legal.nis', storeSettings.businessNis],
            ['legal.ai', storeSettings.businessAi],
        ].filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${T(k)}: ${esc(v)}`).join(' · ');

        const dateStr = formatDate(data.created_at, T.lang, false);

        // Generate items table rows
        const itemsHtml = (data.items || []).map((item, index) => `
            <tr>
                <td class="item-num">${index + 1}</td>
                <td class="item-desc">
                    <strong>${esc(item.product_name)}</strong>
                    ${variantLabel(item, T.lang) ? ` — ${esc(variantLabel(item, T.lang))}` : ''}
                    ${item.sku ? `<br><span class="sku">SKU: ${esc(item.sku)}</span>` : ''}
                </td>
                <td class="item-qty">${item.quantity}</td>
                <td class="item-price">${money(item.unit_price || item.unit_cost)}</td>
                <td class="item-total">${money(item.total || item.total_cost)}</td>
            </tr>
        `).join('');

        // Determine document type specifics
        let docTitle = T('doc.receipt');
        let docNumber = data.receipt_number || data.id?.slice(0, 8);
        let supplierSection = '';
        let notesSection = '';
        let signatureSection = '';

        if (type === 'purchase_order') {
            docTitle = T('doc.purchaseOrder');
            docNumber = data.po_number || data.id?.slice(0, 8);

            supplierSection = `
                <div class="info-grid">
                    <div class="info-box vendor">
                        <div class="info-box-header">${T('doc.vendor')}</div>
                        <div class="info-box-content">
                            <div class="company-name">${esc(data.supplier_name || T('doc.supplierDefault'))}</div>
                            ${data.supplier_address ? `<div class="detail">${data.supplier_address}</div>` : ''}
                            ${data.supplier_phone ? `<div class="detail"><strong>${T('doc.phone')}:</strong> ${esc(data.supplier_phone)}</div>` : ''}
                            ${data.supplier_email ? `<div class="detail"><strong>${T('doc.email')}:</strong> ${esc(data.supplier_email)}</div>` : ''}
                            ${data.supplier_contact_person ? `<div class="detail"><strong>${T('doc.contact')}:</strong> ${esc(data.supplier_contact_person)}</div>` : ''}
                            ${data.supplier_website ? `<div class="detail"><strong>${T('doc.website')}:</strong> ${esc(data.supplier_website)}</div>` : ''}
                        </div>
                    </div>
                    <div class="info-box ship-to">
                        <div class="info-box-header">${T('doc.shipTo')}</div>
                        <div class="info-box-content">
                            <div class="company-name">${settings.name}</div>
                            <div class="detail">${settings.address}</div>
                            ${settings.phone ? `<div class="detail"><strong>${T('doc.phone')}:</strong> ${esc(settings.phone)}</div>` : ''}
                            ${settings.email ? `<div class="detail"><strong>${T('doc.email')}:</strong> ${esc(settings.email)}</div>` : ''}
                        </div>
                    </div>
                </div>
            `;

            notesSection = data.notes ? `
                <div class="notes-section">
                    <div class="notes-header">${T('doc.notes')}</div>
                    <div class="notes-content">${esc(data.notes)}</div>
                </div>
            ` : '';

            // Get signature image if available
            let signatureImageHtml = '';
            if (settings.poSignatureImage) {
                try {
                    const imageService = require('./imageService');
                    const base64Image = imageService.getImageBase64(settings.poSignatureImage);
                    if (base64Image) {
                        signatureImageHtml = `<img src="${base64Image}" alt="Signature" class="signature-img" />`;
                    }
                } catch (e) {
                    console.error('Failed to load signature image:', e);
                }
            }

            signatureSection = `
                <div class="signature-section">
                    <div class="signature-box">
                        ${signatureImageHtml ? `
                            <div class="signature-image-wrapper">
                                ${signatureImageHtml}
                            </div>
                        ` : `
                            <div class="signature-line"></div>
                        `}
                        <div class="signature-name">${settings.poSignatureName || '________________________'}</div>
                        <div class="signature-title">${settings.poSignatureTitle}</div>
                        <div class="signature-date">${T('doc.date')}: ${dateStr}</div>
                    </div>
                    <div class="terms-box">
                        <div class="terms-header">${T('doc.terms')}</div>
                        <ul class="terms-list">
                            <li>${T('doc.term1')}</li>
                            <li>${T('doc.term2')}</li>
                            <li>${T('doc.term3')}</li>
                        </ul>
                    </div>
                </div>
            `;
        } else if (type === 'quotation') {
            docTitle = T('doc.quotation');
            docNumber = data.quote_number || data.id?.slice(0, 8);
            supplierSection = `
                <div class="info-grid">
                    <div class="info-box">
                        <div class="info-box-header">${T('doc.preparedFor')}</div>
                        <div class="info-box-content">
                            <div class="company-name">${esc(data.customer_name || T('doc.customerDefault'))}</div>
                            ${data.customer_email ? `<div class="detail">${data.customer_email}</div>` : ''}
                            ${data.customer_phone ? `<div class="detail">${data.customer_phone}</div>` : ''}
                        </div>
                    </div>
                    <div class="info-box">
                        <div class="info-box-header">${T('doc.validUntil')}</div>
                        <div class="info-box-content">
                            <div class="company-name">${data.valid_until ? formatDate(data.valid_until, T.lang, false) : T('doc.validDefault')}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <!DOCTYPE html>
            <html lang="${T.lang}" dir="${T.dir}">
            <head>
                <meta charset="UTF-8">
                <style>
                    
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    
                    body {
                        font-family: ${T.lang === 'ar' ? 'Tahoma, Arial, sans-serif' : "'Segoe UI', Arial, sans-serif"};
                        font-size: 12px;
                        line-height: 1.5;
                        color: #1a1a2e;
                        background: white;
                        padding: 40px;
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    
                    /* Header */
                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        margin-bottom: 30px;
                        padding-bottom: 25px;
                        border-bottom: 3px solid #0f172a;
                    }
                    
                    .company-info {
                        max-width: 300px;
                    }
                    
                    .company-logo {
                        font-size: 26px;
                        font-weight: 800;
                        color: #0f172a;
                        margin-bottom: 8px;
                        letter-spacing: -0.5px;
                    }
                    
                    .company-details {
                        color: #64748b;
                        font-size: 11px;
                        line-height: 1.6;
                    }
                    
                    .doc-info {
                        text-align: end;
                    }
                    
                    .doc-title {
                        font-size: 36px;
                        font-weight: 800;
                        color: #0ea5e9;
                        letter-spacing: 1px;
                        margin-bottom: 12px;
                    }
                    
                    .doc-meta {
                        font-size: 12px;
                        color: #475569;
                    }
                    
                    .doc-meta-row {
                        display: flex;
                        justify-content: flex-end;
                        gap: 10px;
                        margin-bottom: 4px;
                    }
                    
                    .doc-meta-label {
                        color: #94a3b8;
                        font-weight: 500;
                    }
                    
                    .doc-meta-value {
                        font-weight: 700;
                        color: #0f172a;
                    }
                    
                    /* Info Grid */
                    .info-grid {
                        display: flex;
                        gap: 30px;
                        margin-bottom: 30px;
                    }
                    
                    .info-box {
                        flex: 1;
                        background: #f8fafc;
                        border-radius: 8px;
                        overflow: hidden;
                        border: 1px solid #e2e8f0;
                    }
                    
                    .info-box-header {
                        background: #0f172a;
                        color: white;
                        padding: 8px 15px;
                        font-size: 10px;
                        font-weight: 700;
                        letter-spacing: 1px;
                    }
                    
                    .info-box-content {
                        padding: 15px;
                    }
                    
                    .company-name {
                        font-size: 14px;
                        font-weight: 700;
                        color: #0f172a;
                        margin-bottom: 8px;
                    }
                    
                    .detail {
                        font-size: 11px;
                        color: #475569;
                        margin-bottom: 3px;
                    }
                    
                    /* Items Table */
                    .items-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 25px;
                    }
                    
                    .items-table th {
                        background: #0f172a;
                        color: white;
                        padding: 12px 15px;
                        text-align: left;
                        font-size: 10px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    
                    .items-table th:first-child {
                        border-radius: 6px 0 0 0;
                    }
                    
                    .items-table th:last-child {
                        border-radius: 0 6px 0 0;
                    }
                    
                    .items-table td {
                        padding: 14px 15px;
                        border-bottom: 1px solid #e2e8f0;
                        font-size: 12px;
                    }
                    
                    .items-table tr:nth-child(even) {
                        background: #f8fafc;
                    }
                    
                    .item-num { width: 40px; text-align: center; color: #94a3b8; }
                    .item-desc { }
                    .item-qty { width: 60px; text-align: center; }
                    .item-price { width: 100px; text-align: end; }
                    .item-total { width: 100px; text-align: end; font-weight: 600; color: #0f172a; }
                    
                    .sku { color: #94a3b8; font-size: 10px; }
                    
                    /* Summary */
                    .summary-section {
                        display: flex;
                        justify-content: flex-end;
                        margin-bottom: 30px;
                    }
                    
                    .summary-box {
                        width: 280px;
                        background: #f8fafc;
                        border-radius: 8px;
                        padding: 20px;
                        border: 1px solid #e2e8f0;
                    }
                    
                    .summary-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 8px 0;
                        font-size: 12px;
                        color: #475569;
                    }
                    
                    .summary-row.total {
                        border-top: 2px solid #0f172a;
                        margin-top: 10px;
                        padding-top: 15px;
                        font-size: 16px;
                        font-weight: 800;
                        color: #0f172a;
                    }
                    
                    /* Notes */
                    .notes-section {
                        background: #fffbeb;
                        border: 1px solid #fcd34d;
                        border-radius: 8px;
                        padding: 15px;
                        margin-bottom: 30px;
                    }
                    
                    .notes-header {
                        font-weight: 700;
                        color: #92400e;
                        margin-bottom: 8px;
                        font-size: 11px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    
                    .notes-content {
                        color: #78716c;
                        font-size: 12px;
                        line-height: 1.6;
                    }
                    
                    /* Signature & Terms */
                    .signature-section {
                        display: flex;
                        gap: 40px;
                        margin-top: 40px;
                        padding-top: 30px;
                        border-top: 1px dashed #e2e8f0;
                    }
                    
                    .signature-box {
                        flex: 1;
                    }
                    
                    .signature-image-wrapper {
                        height: 60px;
                        margin-bottom: 10px;
                        margin-top: 20px;
                    }
                    
                    .signature-img {
                        max-height: 60px;
                        max-width: 200px;
                        object-fit: contain;
                    }
                    
                    .signature-line {
                        width: 200px;
                        height: 1px;
                        background: #0f172a;
                        margin-bottom: 10px;
                        margin-top: 50px;
                    }
                    
                    .signature-name {
                        font-weight: 700;
                        font-size: 14px;
                        color: #0f172a;
                    }
                    
                    .signature-title {
                        color: #64748b;
                        font-size: 11px;
                        margin-top: 2px;
                    }
                    
                    .signature-date {
                        color: #94a3b8;
                        font-size: 10px;
                        margin-top: 8px;
                    }
                    
                    .terms-box {
                        flex: 1;
                    }
                    
                    .terms-header {
                        font-weight: 700;
                        font-size: 11px;
                        color: #475569;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 10px;
                    }
                    
                    .terms-list {
                        list-style: none;
                        font-size: 10px;
                        color: #64748b;
                        line-height: 1.8;
                    }
                    
                    .terms-list li::before {
                        content: "•";
                        margin-inline-end: 8px;
                        color: #0ea5e9;
                    }
                    
                    /* Footer */
                    .footer {
                        margin-top: 50px;
                        text-align: center;
                        color: #94a3b8;
                        font-size: 10px;
                        padding-top: 20px;
                        border-top: 1px solid #e2e8f0;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="company-info">
                        <div class="company-logo">${esc(settings.name)}</div>
                        <div class="company-details">
                            ${settings.address ? `${esc(settings.address)}<br>` : ''}
                            ${settings.phone ? `${T('doc.phone')}: ${esc(settings.phone)}<br>` : ''}
                            ${settings.email ? `${T('doc.email')}: ${esc(settings.email)}` : ''}
                            ${settings.website ? `<br>${T('doc.website')}: ${esc(settings.website)}` : ''}
                            ${legal ? `<br>${legal}` : ''}
                        </div>
                    </div>
                    <div class="doc-info">
                        <div class="doc-title">${docTitle}</div>
                        <div class="doc-meta">
                            <div class="doc-meta-row">
                                <span class="doc-meta-label">${T('doc.number')}:</span>
                                <span class="doc-meta-value">${docNumber}</span>
                            </div>
                            <div class="doc-meta-row">
                                <span class="doc-meta-label">${T('doc.date')}:</span>
                                <span class="doc-meta-value">${dateStr}</span>
                            </div>
                            ${data.expected_date ? `
                            <div class="doc-meta-row">
                                <span class="doc-meta-label">${T('doc.expected')}:</span>
                                <span class="doc-meta-value">${formatDate(data.expected_date, T.lang, false)}</span>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
                
                ${supplierSection}
                
                <table class="items-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>${T('doc.description')}</th>
                            <th style="text-align:center">${T('doc.qty')}</th>
                            <th style="text-align:end">${T('doc.unitPrice')}</th>
                            <th style="text-align:end">${T('doc.amount')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                </table>
                
                <div class="summary-section">
                    <div class="summary-box">
                        <div class="summary-row">
                            <span>${T('receipt.subtotal')}</span>
                            <span>${money(data.subtotal)}</span>
                        </div>
                        <div class="summary-row">
                            <span>${esc(settings.taxName || 'TVA')} ${settings.taxType === 'inclusive' ? `(${T('receipt.taxIncluded')})` : ''}</span>
                            <div style="text-align:end">
                                ${data.tax_exempt ? `<span style="font-size:10px;color:#d97706;margin-inline-end:4px">${T('doc.exempt')}</span>` : ''}
                                <span>${money(data.tax_amount || 0)}</span>
                            </div>
                        </div>
                         ${(data.service_charge && data.service_charge > 0) ? `
                        <div class="summary-row">
                            <span>${T('receipt.serviceCharge')}</span>
                            <span>${money(data.service_charge)}</span>
                        </div>
                        ` : ''}
                        ${(data.discount_amount && data.discount_amount > 0) ? `
                        <div class="summary-row">
                            <span>${T('receipt.discount')}</span>
                            <span style="color:#ef4444">-${money(data.discount_amount)}</span>
                        </div>
                        ` : ''}
                        <div class="summary-row total">
                            <span>${T('receipt.total')}</span>
                            <span>${money(data.total)}</span>
                        </div>
                    </div>
                </div>
                
                ${notesSection}
                
                ${signatureSection}
                
                <div class="footer">
                    ${T('doc.thanks')}
                </div>
            </body>
            </html>
        `;
    }

    getHtml(sale, storeSettings = {}) {
        return this.generateHtml(sale, storeSettings);
    }

    /**
     * Print a receipt on the configured receipt printer.
     * @param {object} sale
     * @param {object} storeSettings shop settings (see generateThermalReceiptHtml)
     * @param {object} printer { printerName, silent, copies, paperWidthMm }
     */
    async print(sale, storeSettings = {}, printer = {}) {
        const paperWidthMm = parseInt(printer.paperWidthMm || storeSettings.receiptPaperWidthMm, 10) === 58 ? 58 : 80;
        const html = this.generateHtml(sale, { ...storeSettings, receiptPaperWidthMm: paperWidthMm });

        const win = new BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
        });
        try {
            await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

            // Roll paper: page height = content height (CSS px -> mm)
            const heightPx = await win.webContents.executeJavaScript(
                'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)', true
            ).catch(() => 1200);
            const heightMm = Math.max(50, Math.ceil(heightPx * 25.4 / 96) + 6);

            const printOptions = {
                silent: !!printer.silent,
                printBackground: true,
                deviceName: printer.printerName || '',
                margins: { marginType: 'none' },
                // microns
                pageSize: { width: paperWidthMm * 1000, height: heightMm * 1000 },
                copies: Math.max(1, parseInt(printer.copies, 10) || 1),
            };

            return await new Promise((resolve, reject) => {
                win.webContents.print(printOptions, (success, failureReason) => {
                    if (success) resolve(true);
                    else if (failureReason === 'cancelled') resolve(false);
                    else reject(new Error(failureReason || 'Printing failed'));
                });
            });
        } finally {
            if (!win.isDestroyed()) win.destroy();
        }
    }

    // Traditional thermal receipt format
    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Thermal receipt (58 mm / 80 mm roll) in the shop's language, right to
     * left in Arabic. Uses the shop information from the setup / Settings:
     * logo, name, address, wilaya, phone, legal numbers, header and footer.
     * storeSettings.shopLogoDataUri is filled in by the caller (main process).
     */
    generateThermalReceiptHtml(data, storeSettings = {}) {
        const esc = (v) => this.escapeHtml(v);
        const T = translator(storeSettings.defaultLanguage);
        const money = (v) => formatMoney(v, T.lang, storeSettings.currency);
        const paperWidthMm = parseInt(storeSettings.receiptPaperWidthMm, 10) === 58 ? 58 : 80;
        // Printable width is a little smaller than the paper on most printers
        const contentWidthMm = paperWidthMm === 58 ? 48 : 72;

        const legal = [
            ['legal.rc', storeSettings.businessRc],
            ['legal.nif', storeSettings.businessTaxId],
            ['legal.nis', storeSettings.businessNis],
            ['legal.ai', storeSettings.businessAi],
        ].filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${T(k)}: ${esc(v)}`);

        const shop = {
            name: storeSettings.businessName || '',
            address: storeSettings.businessAddress || '',
            city: [storeSettings.businessCity, storeSettings.businessWilaya].filter(Boolean).join(' — '),
            phone: storeSettings.businessPhone || '',
            header: storeSettings.receiptHeader || '',
            footer: storeSettings.receiptFooter || T('receipt.footer'),
            logo: storeSettings.shopLogoDataUri || '',
        };

        const itemCount = (data.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        const itemsHtml = (data.items || []).map(item => {
            const lineDiscount = parseFloat(item.discount) || 0;
            const variant = variantLabel(item, T.lang);
            return `
            <div class="item">
                <div class="item-name">${esc(item.product_name)}</div>
                ${variant || item.sku ? `<div class="item-variant">${esc(variant)}${variant && item.sku ? ' · ' : ''}${item.sku ? `<span class="ltr">${esc(item.sku)}</span>` : ''}</div>` : ''}
                <div class="row small">
                    <span><span class="ltr">${esc(item.quantity)} × ${money(item.unit_price)}</span></span>
                    <span class="ltr">${money(item.total)}</span>
                </div>
                ${lineDiscount > 0 ? `<div class="row small"><span>${T('receipt.discount')}</span><span class="ltr">-${money(lineDiscount)}</span></div>` : ''}
            </div>`;
        }).join('');

        let tendered = 0;
        const paymentsHtml = (data.payments || []).map(p => {
            let methodLabel = esc(paymentLabel(p.method, T.lang));
            let extra = '';
            if (p.method === 'cash' && p.reference) {
                try {
                    const parsed = JSON.parse(p.reference);
                    if (Number.isFinite(parsed.tendered) && parsed.tendered > 0) tendered += parsed.tendered;
                } catch { /* plain text reference */ }
            }
            if (p.method === 'gift_card' && p.reference) {
                let code = p.reference;
                let balance = null;
                try {
                    const parsed = JSON.parse(p.reference);
                    if (parsed.code) {
                        code = parsed.code;
                        balance = parsed.remaining;
                    }
                } catch {
                    // Not JSON, plain code
                }
                const masked = String(code).length > 4 ? '****' + String(code).slice(-4) : code;
                methodLabel += ` (<span class="ltr">${esc(masked)}</span>)`;
                if (balance !== null && balance !== undefined) {
                    extra = `<div class="row small muted"><span>${T('receipt.giftCardBalance')}</span><span class="ltr">${money(balance)}</span></div>`;
                }
            }
            return `<div class="row"><span>${methodLabel}</span><span class="ltr">${money(p.amount)}</span></div>${extra}`;
        }).join('');

        const cashPaid = (data.payments || []).filter(p => p.method === 'cash').reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        const change = tendered > 0 ? tendered - cashPaid : 0;
        const showTax = (parseFloat(data.tax_amount) || 0) > 0;

        return `<!DOCTYPE html>
<html lang="${T.lang}" dir="${T.dir}"><head><meta charset="UTF-8">
<style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { width: ${contentWidthMm}mm; margin: 0 auto; padding: 3mm 0;
        font-family: ${T.lang === 'ar' ? 'Tahoma, Arial, sans-serif' : '"Courier New", monospace'};
        font-size: ${paperWidthMm === 58 ? 10 : 11.5}px; }
    .center { text-align: center; }
    .logo { display: block; margin: 0 auto 2mm; max-width: 60%; max-height: 22mm; object-fit: contain; }
    .shop-name { font-size: 1.5em; font-weight: bold; margin-bottom: 1mm; }
    .muted { color: #333; font-size: 0.9em; }
    .sep { border-top: 1px dashed #000; margin: 2mm 0; }
    .row { display: flex; justify-content: space-between; gap: 2mm; }
    .row span:last-child { text-align: end; white-space: nowrap; }
    .small { font-size: 0.92em; }
    .item { margin-bottom: 1.5mm; }
    .item-name { font-weight: bold; word-break: break-word; }
    .item-variant { font-size: 0.9em; }
    .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
    .grand { font-size: 1.35em; font-weight: bold; border-top: 1px solid #000; margin-top: 1mm; padding-top: 1mm; }
    .footer { text-align: center; margin-top: 2mm; white-space: pre-line; }
</style></head>
<body>
    <div class="center">
        ${shop.logo ? `<img class="logo" src="${shop.logo}" alt="">` : ''}
        ${shop.name ? `<div class="shop-name">${esc(shop.name)}</div>` : ''}
        ${shop.address ? `<div class="muted">${esc(shop.address)}</div>` : ''}
        ${shop.city ? `<div class="muted">${esc(shop.city)}</div>` : ''}
        ${shop.phone ? `<div class="muted ltr">${esc(shop.phone)}</div>` : ''}
        ${legal.length ? `<div class="muted small">${legal.join(' · ')}</div>` : ''}
        ${shop.header ? `<div style="margin-top:1.5mm">${esc(shop.header)}</div>` : ''}
    </div>
    <div class="sep"></div>
    <div class="row"><span>${T('receipt.number')}</span><span class="ltr">${esc(data.receipt_number || (data.id || '').slice(0, 8))}</span></div>
    <div class="row"><span>${T('receipt.date')}</span><span class="ltr">${esc(formatDate(data.created_at, T.lang))}</span></div>
    ${data.employee_name ? `<div class="row"><span>${T('receipt.cashier')}</span><span>${esc(data.employee_name)}</span></div>` : ''}
    ${data.customer_name ? `<div class="row"><span>${T('receipt.customer')}</span><span>${esc(data.customer_name)}</span></div>` : ''}
    ${data.due_date ? `<div class="row"><span>${T('receipt.due')}</span><span class="ltr">${esc(formatDate(data.due_date, T.lang, false))}</span></div>` : ''}
    <div class="sep"></div>
    ${itemsHtml}
    <div class="sep"></div>
    <div class="row"><span>${T('receipt.subtotal')} (${T('receipt.items', { n: itemCount })})</span><span class="ltr">${money(data.subtotal)}</span></div>
    ${data.discount_amount > 0 ? `<div class="row"><span>${T('receipt.discount')}</span><span class="ltr">-${money(data.discount_amount)}</span></div>` : ''}
    ${(data.service_charge && data.service_charge > 0) ? `<div class="row"><span>${T('receipt.serviceCharge')}</span><span class="ltr">${money(data.service_charge)}</span></div>` : ''}
    ${showTax ? `<div class="row"><span>${esc(storeSettings.taxName || 'TVA')}${storeSettings.taxType === 'inclusive' ? ` (${T('receipt.taxIncluded')})` : ''}</span><span class="ltr">${money(data.tax_amount)}</span></div>` : ''}
    <div class="row grand"><span>${T('receipt.total')}</span><span class="ltr">${money(data.total)}</span></div>
    <div class="sep"></div>
    ${paymentsHtml}
    ${tendered > 0 ? `<div class="row"><span>${T('receipt.received')}</span><span class="ltr">${money(tendered)}</span></div>` : ''}
    ${change > 0.004 ? `<div class="row" style="font-weight:bold"><span>${T('receipt.change')}</span><span class="ltr">${money(change)}</span></div>` : ''}
    <div class="sep"></div>
    <div class="footer">${esc(shop.footer)}</div>
</body></html>`;
    }

    generateCreditPaymentReceiptHtml(data, storeSettings = {}) {
        const esc = (v) => this.escapeHtml(v);
        const T = translator(storeSettings.defaultLanguage);
        const money = (v) => formatMoney(v, T.lang, storeSettings.currency);
        const city = [storeSettings.businessCity, storeSettings.businessWilaya].filter(Boolean).join(' — ');

        return `<!DOCTYPE html>
<html lang="${T.lang}" dir="${T.dir}"><head><meta charset="UTF-8">
<style>
    body { font-family: ${T.lang === 'ar' ? 'Tahoma, Arial, sans-serif' : '"Courier New", monospace'}; font-size: 12px;
        width: 280px; margin: 0 auto; padding: 10px; color: #000; background: white; }
    .header { text-align: center; margin-bottom: 20px; border-bottom: 2px dashed #000; padding-bottom: 10px; }
    .store-name { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
    .store-info { font-size: 11px; }
    .title { text-align: center; font-size: 16px; font-weight: bold; margin: 15px 0; }
    .info-row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
    .amount-box { border: 2px solid #000; padding: 10px; margin: 15px 0; text-align: center; }
    .amount-label { font-size: 12px; margin-bottom: 5px; }
    .amount-value { font-size: 20px; font-weight: bold; }
    .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
    .footer { text-align: center; margin-top: 20px; padding-top: 10px; border-top: 1px dashed #000; font-size: 11px; }
</style></head>
<body>
    <div class="header">
        <div class="store-name">${esc(storeSettings.businessName || '')}</div>
        <div class="store-info">
            ${storeSettings.businessAddress ? `${esc(storeSettings.businessAddress)}<br>` : ''}
            ${city ? `${esc(city)}<br>` : ''}
            ${storeSettings.businessPhone ? `<span class="ltr">${esc(storeSettings.businessPhone)}</span>` : ''}
        </div>
    </div>

    <div class="title">${T('creditReceipt.title')}</div>

    <div class="info-row"><span>${T('receipt.date')}</span><span class="ltr">${esc(formatDate(new Date(), T.lang))}</span></div>
    <div class="info-row"><span>${T('receipt.customer')}</span><span>${esc(data.customer_name)}</span></div>
    <div class="info-row"><span>${T('creditReceipt.invoice')}</span><span class="ltr">${esc(data.invoice_number)}</span></div>

    <div class="amount-box">
        <div class="amount-label">${T('creditReceipt.paid')}</div>
        <div class="amount-value ltr">${money(data.amount)}</div>
        <div style="margin-top:5px; font-size:11px">${T('creditReceipt.method')}: ${esc(paymentLabel(data.payment_method, T.lang))}</div>
        ${data.tendered ? `
            <div class="info-row" style="margin-top:5px; border-top:1px dashed #000; padding-top:5px; font-size:11px;">
                <span>${T('receipt.received')}</span><span class="ltr">${money(data.tendered)}</span>
            </div>
            <div class="info-row" style="font-size:11px; font-weight:bold;">
                <span>${T('receipt.change')}</span><span class="ltr">${money(data.change)}</span>
            </div>
        ` : ''}
    </div>

    <div class="info-row" style="margin-top:10px; font-weight:bold">
        <span>${T('creditReceipt.remaining')}</span><span class="ltr">${money(data.remaining_balance)}</span>
    </div>

    <div class="footer">${T('creditReceipt.thanks')}</div>
</body></html>`;
    }

    generateGiftCardHtml(card, settings) {
        // Use passed barcode image or placeholder
        const barcodeSrc = card.barcodeImage || '';
        const T = translator(settings.defaultLanguage);

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                
                body { 
                    margin: 0;
                    padding: 0;
                    width: 100vw;
                    height: 100vh;
                    overflow: hidden;
                    font-family: 'Inter', sans-serif;
                    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
                    color: white;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                }
                
                .header {
                    padding: 30px 40px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                }
                
                .brand {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .logo-icon {
                    background: rgba(255, 255, 255, 0.2);
                    padding: 8px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .title-section h1 {
                    font-size: 20px;
                    font-weight: 800;
                    margin: 0;
                    letter-spacing: 0.05em;
                    text-transform: uppercase;
                }
                
                .title-section p {
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    margin: 2px 0 0 0;
                    color: #c7d2fe;
                }
                
                .amount {
                    font-size: 42px;
                    font-weight: 800;
                    text-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                
                .content {
                    flex: 1;
                    padding: 0 40px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }
                
                .label {
                    font-size: 10px;
                    color: #c7d2fe;
                    margin-bottom: 4px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                
                .code {
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 24px;
                    letter-spacing: 0.15em;
                    font-weight: 500;
                    text-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                
                .footer {
                    padding: 20px 40px 30px;
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                
                .barcode-container {
                    background: white;
                    border-radius: 12px;
                    padding: 15px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                    height: 80px;
                }
                
                .barcode-img {
                    max-width: 100%;
                    max-height: 100%;
                    object-fit: contain;
                }
                
                .meta {
                    display: flex;
                    justify-content: space-between;
                    font-size: 9px;
                    color: #a5b4fc;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="brand">
                    <div class="logo-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 12 20 22 4 22 4 12"></polyline>
                            <rect x="2" y="7" width="20" height="5"></rect>
                            <line x1="12" y1="22" x2="12" y2="7"></line>
                            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
                            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
                        </svg>
                    </div>
                    <div class="title-section">
                        <h1>${T('gift.title')}</h1>
                        <p>${this.escapeHtml(settings.businessName || settings.name || T('app.name'))}</p>
                    </div>
                </div>
                <div class="amount">${formatMoney(card.current_balance, T.lang, settings.currency)}</div>
            </div>

            <div class="content">
                <div class="label">${T('gift.number')}</div>
                <div class="code">${card.code}</div>
            </div>

            <div class="footer">
                <div class="barcode-container">
                    ${barcodeSrc ? `<img src="${barcodeSrc}" class="barcode-img" />` : ''}
                </div>
                <div class="meta">
                    <span>${card.expires_at ? `${T('gift.expires')}: ${formatDate(card.expires_at, T.lang, false)}` : T('gift.noExpiry')}</span>
                    <span>${T('gift.terms')}</span>
                </div>
            </div>
        </body>
        </html>
        `;
    }
}

module.exports = ReceiptService;
