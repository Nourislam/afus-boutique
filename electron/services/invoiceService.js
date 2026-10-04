const fs = require('fs');
const path = require('path');
const os = require('os');
const { BrowserWindow } = require('electron');
const emailService = require('./emailService');

class InvoiceService {
    constructor() {
        this.printWindow = null;
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount || 0);
    }

    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    getStatusColor(status) {
        const colors = {
            'pending': '#f59e0b',
            'partial': '#3b82f6',
            'paid': '#10b981',
            'overdue': '#ef4444'
        };
        return colors[status] || '#6b7280';
    }

    getStatusLabel(status) {
        const labels = {
            'pending': 'Pending',
            'partial': 'Partially Paid',
            'paid': 'Paid',
            'overdue': 'Overdue'
        };
        return labels[status] || status;
    }

    generateInvoiceHtml(creditSale, settings = {}) {
        const items = creditSale.items || [];
        const payments = creditSale.payments || [];

        // Calculate totals from items if not provided or zero
        let subtotal = creditSale.subtotal || 0;
        let taxAmount = creditSale.tax_amount || 0;
        let discountAmount = creditSale.discount_amount || 0;

        if (!subtotal && items.length > 0) {
            subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
            taxAmount = items.reduce((sum, item) => sum + (item.tax_amount || 0), 0);
            // Re-calculate total if needed, but amount_due should be source of truth
        }

        const amountDue = creditSale.amount_due || (subtotal + taxAmount - discountAmount);
        const balanceDue = amountDue - (creditSale.amount_paid || 0);

        const itemRows = items.map(item => `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.product_name}</td>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${this.formatCurrency(item.unit_price)}</td>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${this.formatCurrency(item.total || (item.quantity * item.unit_price))}</td>
            </tr>
        `).join('');

        const paymentRows = payments.length > 0 ? payments.map(p => `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${this.formatDate(p.created_at)}</td>
                <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${p.payment_method}</td>
                <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${this.formatCurrency(p.amount)}</td>
            </tr>
        `).join('') : '';

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Invoice ${creditSale.invoice_number}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Arial, sans-serif; 
            background: #fff; 
            color: #1f2937;
            padding: 40px;
        }
        .invoice-container { max-width: 800px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .company-info h1 { font-size: 28px; color: #6366f1; margin-bottom: 8px; }
        .company-info p { color: #6b7280; font-size: 13px; line-height: 1.6; }
        .invoice-info { text-align: right; }
        .invoice-info h2 { font-size: 32px; color: #1f2937; letter-spacing: 2px; }
        .invoice-number { font-size: 14px; color: #6b7280; margin-top: 8px; }
        .status-badge {
            display: inline-block;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            margin-top: 12px;
        }
        .details-grid { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .details-box { width: 48%; }
        .details-box h3 { 
            font-size: 11px; 
            text-transform: uppercase; 
            letter-spacing: 1px;
            color: #6b7280;
            margin-bottom: 12px;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 8px;
        }
        .details-box p { font-size: 14px; line-height: 1.8; color: #374151; }
        .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .items-table th { 
            background: #f9fafb; 
            padding: 14px 12px; 
            text-align: left; 
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6b7280;
            border-bottom: 2px solid #e5e7eb;
        }
        .items-table th:nth-child(2), .items-table th:nth-child(3), .items-table th:nth-child(4) { text-align: right; }
        .items-table th:nth-child(2) { text-align: center; }
        .totals-section { display: flex; justify-content: flex-end; margin-bottom: 40px; }
        .totals-box { width: 300px; }
        .totals-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
        .totals-row.total { border-bottom: none; border-top: 2px solid #1f2937; padding-top: 15px; font-size: 18px; font-weight: 700; }
        .totals-row.balance { background: #fef3c7; padding: 15px; border-radius: 8px; margin-top: 10px; }
        .payments-section { margin-bottom: 40px; }
        .payments-section h3 { 
            font-size: 14px; 
            font-weight: 600;
            margin-bottom: 15px;
            color: #374151;
        }
        .payments-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .payments-table th { 
            background: #f3f4f6; 
            padding: 10px; 
            text-align: left;
            font-size: 11px;
            text-transform: uppercase;
        }
        .payments-table th:last-child { text-align: right; }
        .footer { 
            margin-top: 50px; 
            padding-top: 20px; 
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #9ca3af;
            font-size: 12px;
        }
        .payment-terms {
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .payment-terms h4 { color: #0369a1; margin-bottom: 8px; font-size: 14px; }
        .payment-terms p { color: #0c4a6e; font-size: 13px; }
        @media print {
            body { padding: 20px; }
            .invoice-container { max-width: 100%; }
        }
    </style>
</head>
<body>
    <div class="invoice-container">
        <!-- Header -->
        <div class="header">
            <div class="company-info">
                <h1>${settings.businessName || 'Business Name'}</h1>
                <p>
                    ${settings.businessAddress || ''}<br>
                    ${settings.businessPhone ? `Phone: ${settings.businessPhone}` : ''}<br>
                    ${settings.businessEmail ? `Email: ${settings.businessEmail}` : ''}
                </p>
            </div>
            <div class="invoice-info">
                <h2>INVOICE</h2>
                <div class="invoice-number">${creditSale.invoice_number}</div>
                <div class="status-badge" style="background: ${this.getStatusColor(creditSale.status)}20; color: ${this.getStatusColor(creditSale.status)};">
                    ${this.getStatusLabel(creditSale.status)}
                </div>
            </div>
        </div>

        <!-- Details Grid -->
        <div class="details-grid">
            <div class="details-box">
                <h3>Bill To</h3>
                <p>
                    <strong>${creditSale.customer_name || 'Customer'}</strong><br>
                    ${creditSale.customer_address || ''}<br>
                    ${creditSale.customer_phone ? `Phone: ${creditSale.customer_phone}` : ''}<br>
                    ${creditSale.customer_email || ''}
                </p>
            </div>
            <div class="details-box">
                <h3>Invoice Details</h3>
                <p>
                    <strong>Invoice Date:</strong> ${this.formatDate(creditSale.created_at)}<br>
                    <strong>Due Date:</strong> ${this.formatDate(creditSale.due_date)}<br>
                    <strong>Receipt #:</strong> ${creditSale.receipt_number || 'N/A'}
                </p>
            </div>
        </div>

        <!-- Items Table -->
        <table class="items-table">
            <thead>
                <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Amount</th>
                </tr>
            </thead>
            <tbody>
                ${itemRows}
            </tbody>
        </table>

        <!-- Totals -->
        <div class="totals-section">
            <div class="totals-box">
                <div class="totals-row">
                    <span>Subtotal</span>
                    <span>${this.formatCurrency(subtotal)}</span>
                </div>
                ${taxAmount ? `
                <div class="totals-row">
                    <span>Tax</span>
                    <span>${this.formatCurrency(taxAmount)}</span>
                </div>
                ` : ''}
                ${discountAmount ? `
                <div class="totals-row">
                    <span>Discount</span>
                    <span>-${this.formatCurrency(discountAmount)}</span>
                </div>
                ` : ''}
                <div class="totals-row total">
                    <span>Total Due</span>
                    <span>${this.formatCurrency(amountDue)}</span>
                </div>
                ${creditSale.amount_paid > 0 ? `
                <div class="totals-row">
                    <span>Amount Paid</span>
                    <span style="color: #10b981;">-${this.formatCurrency(creditSale.amount_paid)}</span>
                </div>
                ` : ''}
                <div class="totals-row balance">
                    <span><strong>Balance Due</strong></span>
                    <span><strong>${this.formatCurrency(balanceDue)}</strong></span>
                </div>
            </div>
        </div>

        <!-- Payment History -->
        ${payments.length > 0 ? `
        <div class="payments-section">
            <h3>Payment History</h3>
            <table class="payments-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Method</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${paymentRows}
                </tbody>
            </table>
        </div>
        ` : ''}

        <!-- Payment Terms -->
        <div class="payment-terms">
            <h4>Payment Terms</h4>
            <p>Payment is due by ${this.formatDate(creditSale.due_date)}. Please include invoice number ${creditSale.invoice_number} with your payment.</p>
        </div>

        <!-- Footer -->
        <div class="footer">
            <p>Thank you for your business!</p>
            <p style="margin-top: 8px;">${settings.businessName || ''} • ${settings.businessPhone || ''} • ${settings.businessEmail || ''}</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    async generateInvoicePdf(creditSale, settings = {}, outputPath = null) {
        return new Promise((resolve, reject) => {
            const html = this.generateInvoiceHtml(creditSale, settings);

            const tempDir = os.tmpdir();
            const pdfPath = outputPath || path.join(tempDir, `invoice_${creditSale.invoice_number}_${Date.now()}.pdf`);

            const win = new BrowserWindow({
                width: 800,
                height: 1100,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });

            win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

            win.webContents.on('did-finish-load', () => {
                win.webContents.printToPDF({
                    printBackground: true,
                    pageSize: 'A4',
                    margins: {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0
                    }
                }).then(data => {
                    fs.writeFileSync(pdfPath, data);
                    win.close();
                    resolve(pdfPath);
                }).catch(error => {
                    win.close();
                    reject(error);
                });
            });

            win.webContents.on('did-fail-load', (event, code, description) => {
                win.close();
                reject(new Error(`Failed to load: ${description}`));
            });
        });
    }

    async sendInvoiceEmail({ to, creditSale, businessInfo, pdfPath }) {
        const items = creditSale.items || [];

        // Calculate totals from items if not provided or zero
        let subtotal = creditSale.subtotal || 0;
        let taxAmount = creditSale.tax_amount || 0;
        let discountAmount = creditSale.discount_amount || 0;

        if (!subtotal && items.length > 0) {
            subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
            taxAmount = items.reduce((sum, item) => sum + (item.tax_amount || 0), 0);
        }

        const amountDue = creditSale.amount_due || (subtotal + taxAmount - discountAmount);
        const balanceDue = amountDue - (creditSale.amount_paid || 0);

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; }
        .amount-box { background: #f9fafb; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
        .amount { font-size: 32px; font-weight: bold; color: #6366f1; }
        .due-date { color: #6b7280; margin-top: 5px; }
        .details { margin: 20px 0; }
        .details-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        .btn { display: inline-block; background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0;">${businessInfo.businessName || 'Invoice'}</h1>
        <p style="margin: 10px 0 0; opacity: 0.9;">Invoice #${creditSale.invoice_number}</p>
    </div>
    <div class="content">
        <p>Dear ${creditSale.customer_name || 'Valued Customer'},</p>
        <p>Please find attached your invoice for your recent purchase. Below is a summary:</p>
        
        <div class="amount-box">
            <div class="amount">${this.formatCurrency(balanceDue)}</div>
            <div class="due-date">Balance Due by ${this.formatDate(creditSale.due_date)}</div>
        </div>
        
        <div class="details">
            <div class="details-row">
                <span>Invoice Number</span>
                <strong>${creditSale.invoice_number}</strong>
            </div>
            <div class="details-row">
                <span>Invoice Date</span>
                <span>${this.formatDate(creditSale.created_at)}</span>
            </div>
            <div class="details-row">
                <span>Total Amount</span>
                <span>${this.formatCurrency(amountDue)}</span>
            </div>
            ${creditSale.amount_paid > 0 ? `
            <div class="details-row">
                <span>Paid</span>
                <span style="color: #10b981;">${this.formatCurrency(creditSale.amount_paid)}</span>
            </div>
            ` : ''}
        </div>
        
        <p>The full invoice is attached as a PDF for your records.</p>
        <p>If you have any questions, please don't hesitate to contact us.</p>
        <p>Thank you for your business!</p>
        <p style="margin-top: 20px;">
            Best regards,<br>
            <strong>${businessInfo.businessName || 'Team'}</strong>
        </p>
    </div>
    <div class="footer">
        <p>${businessInfo.businessAddress || ''}</p>
        <p>${businessInfo.businessPhone || ''} | ${businessInfo.businessEmail || ''}</p>
    </div>
</body>
</html>
        `;

        return await emailService.sendEmail({
            to,
            subject: `Invoice ${creditSale.invoice_number} from ${businessInfo.businessName || 'Hanout'}`,
            html,
            attachments: pdfPath ? [{
                filename: `Invoice_${creditSale.invoice_number}.pdf`,
                path: pdfPath
            }] : []
        });
    }

    async sendReminderEmail({ to, creditSale, businessInfo }) {
        const items = creditSale.items || [];

        // Calculate totals from items if not provided or zero (Reminder needs it for balanceDue)
        let subtotal = creditSale.subtotal || 0;
        let taxAmount = creditSale.tax_amount || 0;
        let discountAmount = creditSale.discount_amount || 0;

        if (!subtotal && items.length > 0) {
            subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
            taxAmount = items.reduce((sum, item) => sum + (item.tax_amount || 0), 0);
        }

        const amountDue = creditSale.amount_due || (subtotal + taxAmount - discountAmount);
        const balanceDue = amountDue - (creditSale.amount_paid || 0);

        const isOverdue = new Date(creditSale.due_date) < new Date();

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
        .header { background: ${isOverdue ? '#ef4444' : '#f59e0b'}; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; }
        .amount-box { background: ${isOverdue ? '#fef2f2' : '#fef3c7'}; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; border: 1px solid ${isOverdue ? '#fecaca' : '#fde68a'}; }
        .amount { font-size: 32px; font-weight: bold; color: ${isOverdue ? '#dc2626' : '#d97706'}; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0;">${isOverdue ? '⚠️ Payment Overdue' : '⏰ Payment Reminder'}</h1>
    </div>
    <div class="content">
        <p>Dear ${creditSale.customer_name || 'Valued Customer'},</p>
        <p>${isOverdue
                ? `This is a reminder that payment for invoice ${creditSale.invoice_number} is now overdue.`
                : `This is a friendly reminder that payment for invoice ${creditSale.invoice_number} is due soon.`
            }</p>
        
        <div class="amount-box">
            <div class="amount">${this.formatCurrency(balanceDue)}</div>
            <div style="color: ${isOverdue ? '#991b1b' : '#92400e'}; margin-top: 5px;">
                ${isOverdue ? `Was due ${this.formatDate(creditSale.due_date)}` : `Due by ${this.formatDate(creditSale.due_date)}`}
            </div>
        </div>
        
        <p>Please make payment at your earliest convenience. If you have already made this payment, please disregard this reminder.</p>
        <p>If you have any questions or need to discuss payment arrangements, please contact us.</p>
        <p style="margin-top: 20px;">
            Thank you,<br>
            <strong>${businessInfo.businessName || 'Team'}</strong>
        </p>
    </div>
    <div class="footer">
        <p>${businessInfo.businessPhone || ''} | ${businessInfo.businessEmail || ''}</p>
    </div>
</body>
</html>
        `;

        return await emailService.sendEmail({
            to,
            subject: `${isOverdue ? 'OVERDUE: ' : ''}Payment Reminder - Invoice ${creditSale.invoice_number}`,
            html
        });
    }
}

module.exports = new InvoiceService();
