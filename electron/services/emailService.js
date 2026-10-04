const nodemailer = require('nodemailer');
const fs = require('fs');

/**
 * Properly strip HTML tags from a string.
 * Uses a loop to ensure all tags are removed (fixes CodeQL incomplete multi-character sanitization)
 */
function stripHtmlTags(html) {
    if (!html) return '';
    let text = html;
    let previous;
    // Loop until no more tags are found
    do {
        previous = text;
        text = text.replace(/<[^>]*>/g, '');
    } while (text !== previous);
    // Also clean up extra whitespace
    return text.replace(/\s+/g, ' ').trim();
}

let transporter = null;

// Initialize email transporter with SMTP settings
function initEmailService(settings) {
    if (!settings.smtp_host || !settings.smtp_user) {
        console.log('Email service: SMTP not configured');
        return false;
    }

    try {
        transporter = nodemailer.createTransport({
            host: settings.smtp_host,
            port: settings.smtp_port || 587,
            secure: settings.smtp_secure || false,
            auth: {
                user: settings.smtp_user,
                pass: settings.smtp_pass,
            },
        });

        console.log('Email service initialized');
        return true;
    } catch (error) {
        console.error('Failed to initialize email service:', error);
        return false;
    }
}

// Send email with optional attachments
async function sendEmail({ to, subject, html, text, attachments = [] }) {
    if (!transporter) {
        throw new Error('Email service not initialized. Please configure SMTP settings.');
    }

    const mailOptions = {
        from: transporter.options.auth.user,
        to,
        subject,
        html,
        // Use a loop to properly strip HTML tags (fixes CodeQL multi-character sanitization)
        text: text || stripHtmlTags(html),
        attachments,
    };

    const result = await transporter.sendMail(mailOptions);
    return result;
}

// Send receipt email with PDF attachment
async function sendReceiptEmail({ to, sale, businessInfo, pdfPath }) {
    const subject = `Receipt #${sale.receipt_number} from ${businessInfo.businessName || 'our store'}`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #6366f1; padding-bottom: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #6366f1; }
        .receipt-info { margin: 20px 0; }
        .total { font-size: 24px; font-weight: bold; color: #6366f1; }
        .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">${businessInfo.businessName || 'our store'}</div>
          <p>${businessInfo.businessAddress || ''}</p>
        </div>
        
        <div class="receipt-info">
          <p><strong>Receipt Number:</strong> ${sale.receipt_number}</p>
          <p><strong>Date:</strong> ${new Date(sale.created_at).toLocaleString()}</p>
          <p><strong>Total:</strong> <span class="total">$${sale.total.toFixed(2)}</span></p>
        </div>
        
        <p>Thank you for your purchase! Your receipt is attached as a PDF.</p>
        
        <div class="footer">
          <p>${businessInfo.receiptFooter || 'Thank you for shopping with us!'}</p>
          <p>${businessInfo.businessPhone || ''} | ${businessInfo.businessEmail || ''}</p>
        </div>
      </div>
    </body>
    </html>
  `;

    const attachments = [];
    if (pdfPath && fs.existsSync(pdfPath)) {
        attachments.push({
            filename: `Receipt_${sale.receipt_number}.pdf`,
            path: pdfPath,
        });
    }

    return sendEmail({ to, subject, html, attachments });
}

// Test SMTP connection
async function testEmailConnection(settings) {
    try {
        console.log('Testing email connection with settings:', JSON.stringify(settings, null, 2));

        if (!settings.smtp_host) {
            return { success: false, message: 'SMTP Host is missing. Please enter a valid host (e.g., smtp.gmail.com)' };
        }

        if (!settings.auth || !settings.auth.user || !settings.auth.pass) {
            // If auth is just settings.smtp_user/pass on top level, re-map or check
            // The incoming settings object already maps user/pass to auth object in createTransport below? No.
            // Look at lines 112-115 below. It maps settings.smtp_user to auth.user.
        }

        const testTransporter = nodemailer.createTransport({
            host: settings.smtp_host,
            port: settings.smtp_port || 587,
            secure: settings.smtp_secure || false,
            auth: {
                user: settings.smtp_user,
                pass: settings.smtp_pass,
            },
        });

        await testTransporter.verify();
        return { success: true, message: 'SMTP connection successful' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Send test email
async function sendTestEmail(settings, toEmail) {
    try {
        const testTransporter = nodemailer.createTransport({
            host: settings.smtp_host,
            port: settings.smtp_port || 587,
            secure: settings.smtp_secure || false,
            auth: {
                user: settings.smtp_user,
                pass: settings.smtp_pass,
            },
        });

        await testTransporter.sendMail({
            from: settings.smtp_user,
            to: toEmail,
            subject: 'afus boutique - Test e-mail',
            html: `
        <h2>Email Configuration Test</h2>
        <p>This is a test email from your point of sale system.</p>
        <p>If you received this email, your SMTP settings are configured correctly!</p>
        <p><small>Sent at: ${new Date().toLocaleString()}</small></p>
      `,
        });

        return { success: true, message: 'Test email sent successfully' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Send quotation email with PDF attachment
async function sendQuotationEmail({ to, quote, businessInfo, pdfPath }) {
    const subject = `Quotation #${quote.quote_number} from ${businessInfo.businessName || 'our store'}`;
    const itemsHtml = quote.items.map(item => `
        <tr style="border-bottom: 1px solid #f3f4f6;">
            <td style="padding: 12px 16px; color: #1f2937;">${item.product_name}</td>
            <td style="padding: 12px 16px; color: #4b5563; text-align: center;">${item.quantity}</td>
            <td style="padding: 12px 16px; color: #4b5563; text-align: right;">$${item.unit_price.toFixed(2)}</td>
            <td style="padding: 12px 16px; color: #1f2937; text-align: right; font-weight: 500;">$${item.total.toFixed(2)}</td>
        </tr>
    `).join('');

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Quotation ${quote.quote_number}</title>
      <style>
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151; background-color: #f9fafb; margin: 0; padding: 0; }
        .container { max-width: 800px; margin: 40px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%); padding: 40px; color: white; display: flex; justify-content: space-between; align-items: center; }
        .header-content h1 { margin: 0; font-size: 32px; font-weight: 700; letter-spacing: -0.025em; }
        .header-content p { margin: 8px 0 0; opacity: 0.9; font-size: 16px; }
        .status-badge { background: rgba(255, 255, 255, 0.2); padding: 6px 12px; border-radius: 9999px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; backdrop-filter: blur(4px); }
        
        .content { padding: 40px; }
        .grid-header { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px; }
        .info-box h3 { font-size: 12px; text-transform: uppercase; color: #6b7280; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 8px; }
        .info-box p { margin: 0; font-size: 16px; font-weight: 500; color: #111827; }
        .info-box .address { color: #4b5563; font-weight: normal; margin-top: 4px; font-size: 15px; }

        table { w-full; width: 100%; border-collapse: collapse; margin-bottom: 40px; }
        th { text-align: left; padding: 12px 16px; background-color: #f9fafb; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb; }
        
        .totals { margin-left: auto; width: 300px; }
        .total-row { display: flex; justify-content: space-between; padding: 8px 0; color: #4b5563; }
        .total-row.final { border-top: 2px solid #e5e7eb; margin-top: 8px; padding-top: 16px; color: #111827; font-weight: 700; font-size: 20px; }
        .amount { font-weight: 600; }

        .footer { background: #f9fafb; padding: 32px 40px; text-align: center; border-top: 1px solid #e5e7eb; }
        .footer p { margin: 0 0 8px; color: #6b7280; font-size: 14px; }
        .contact-info { color: #4f46e5; font-weight: 500; }
        
        .note { background-color: #fefce8; border: 1px solid #fef08a; padding: 16px; border-radius: 8px; margin-top: 24px; color: #854d0e; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="header-content">
            <h1>Quotation</h1>
            <p>#${quote.quote_number}</p>
          </div>
          <div class="status-badge">Valid for 30 Days</div>
        </div>
        
        <div class="content">
          <div class="grid-header">
            <div class="info-box">
              <h3>From</h3>
              <p>${businessInfo.businessName || 'our store'}</p>
              <p class="address">${businessInfo.businessAddress || ''}</p>
              <p class="address">${businessInfo.businessEmail || ''}</p>
            </div>
            <div class="info-box">
              <h3>To</h3>
              <p>${quote.customer_name || 'Valued Customer'}</p>
              <p class="address">Date: ${new Date(quote.created_at).toLocaleDateString()}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 40%">Item</th>
                <th style="width: 15%; text-align: center">Qty</th>
                <th style="width: 20%; text-align: right">Price</th>
                <th style="width: 25%; text-align: right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="totals">
            <div class="total-row">
              <span>Subtotal</span>
              <span class="amount">$${quote.subtotal.toFixed(2)}</span>
            </div>
            ${quote.discount_amount > 0 ? `
            <div class="total-row" style="color: #ef4444;">
              <span>Discount</span>
              <span class="amount">-$${quote.discount_amount.toFixed(2)}</span>
            </div>` : ''}
            <div class="total-row">
              <span>Tax</span>
              <span class="amount">$${quote.tax_amount.toFixed(2)}</span>
            </div>
            <div class="total-row final">
              <span>Total Quote</span>
              <span>$${quote.total.toFixed(2)}</span>
            </div>
          </div>

          ${quote.notes ? `<div class="note"><strong>Note:</strong> ${quote.notes}</div>` : ''}
        </div>
        
        <div class="footer">
          <p>Thank you for considering our products!</p>
          <p class="contact-info">${businessInfo.businessPhone || ''} | ${businessInfo.businessWebsite || ''}</p>
        </div>
      </div>
    </body>
    </html>
  `;

    const attachments = [];
    if (pdfPath && fs.existsSync(pdfPath)) {
        attachments.push({
            filename: `Quotation_${quote.quote_number}.pdf`,
            path: pdfPath,
        });
    }

    return sendEmail({ to, subject, html, attachments });
}

// Send purchase order email with PDF attachment
async function sendPurchaseOrderEmail({ to, po, businessInfo, pdfPath }) {
    const subject = `Purchase Order #${po.po_number || po.id.slice(0, 8)} from ${businessInfo.businessName || 'our store'}`;
    const itemsHtml = po.items.map(item => `
        <tr style="border-bottom: 1px solid #f3f4f6;">
            <td style="padding: 12px 16px; color: #1f2937;">${item.product_name}</td>
            <td style="padding: 12px 16px; color: #4b5563; text-align: center;">${item.quantity}</td>
            <td style="padding: 12px 16px; color: #4b5563; text-align: right;">$${item.unit_cost.toFixed(2)}</td>
            <td style="padding: 12px 16px; color: #1f2937; text-align: right; font-weight: 500;">$${item.total_cost.toFixed(2)}</td>
        </tr>
    `).join('');

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Purchase Order ${po.po_number}</title>
      <style>
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151; background-color: #f9fafb; margin: 0; padding: 0; }
        .container { max-width: 800px; margin: 40px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; color: white; display: flex; justify-content: space-between; align-items: center; }
        .header-content h1 { margin: 0; font-size: 32px; font-weight: 700; letter-spacing: -0.025em; }
        .header-content p { margin: 8px 0 0; opacity: 0.9; font-size: 16px; }
        .status-badge { background: rgba(255, 255, 255, 0.2); padding: 6px 12px; border-radius: 9999px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; backdrop-filter: blur(4px); }
        
        .content { padding: 40px; }
        .grid-header { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px; }
        .info-box h3 { font-size: 12px; text-transform: uppercase; color: #6b7280; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 8px; }
        .info-box p { margin: 0; font-size: 16px; font-weight: 500; color: #111827; }
        .info-box .address { color: #4b5563; font-weight: normal; margin-top: 4px; font-size: 15px; }

        table { w-full; width: 100%; border-collapse: collapse; margin-bottom: 40px; }
        th { text-align: left; padding: 12px 16px; background-color: #f9fafb; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb; }
        
        .totals { margin-left: auto; width: 300px; }
        .total-row { display: flex; justify-content: space-between; padding: 8px 0; color: #4b5563; }
        .total-row.final { border-top: 2px solid #e5e7eb; margin-top: 8px; padding-top: 16px; color: #111827; font-weight: 700; font-size: 20px; }
        .amount { font-weight: 600; }

        .footer { background: #f9fafb; padding: 32px 40px; text-align: center; border-top: 1px solid #e5e7eb; }
        .footer p { margin: 0 0 8px; color: #6b7280; font-size: 14px; }
        .contact-info { color: #10b981; font-weight: 500; }
        
        .note { background-color: #fefce8; border: 1px solid #fef08a; padding: 16px; border-radius: 8px; margin-top: 24px; color: #854d0e; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="header-content">
            <h1>Purchase Order</h1>
            <p>#${po.po_number || po.id.slice(0, 8)}</p>
          </div>
          <div class="status-badge">REQUEST</div>
        </div>
        
        <div class="content">
          <div class="grid-header">
            <div class="info-box">
              <h3>To Supplier</h3>
              <p>${po.supplier_name || 'Supplier'}</p>
            </div>
            <div class="info-box">
              <h3>From</h3>
              <p>${businessInfo.businessName || 'our store'}</p>
              <p class="address">${businessInfo.businessAddress || ''}</p>
              <p class="address">${businessInfo.businessEmail || ''}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 40%">Item</th>
                <th style="width: 15%; text-align: center">Qty</th>
                <th style="width: 20%; text-align: right">Unit Cost</th>
                <th style="width: 25%; text-align: right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="totals">
            <div class="total-row">
              <span>Subtotal</span>
              <span class="amount">$${(po.subtotal || 0).toFixed(2)}</span>
            </div>
            <div class="total-row">
              <span>Tax</span>
              <span class="amount">$${(po.tax_amount || 0).toFixed(2)}</span>
            </div>
            <div class="total-row final">
              <span>Total</span>
              <span>$${(po.total || 0).toFixed(2)}</span>
            </div>
          </div>

          ${po.notes ? `<div class="note"><strong>Note:</strong> ${po.notes}</div>` : ''}
        </div>
        
        <div class="footer">
          <p>Please confirm receipt of this order.</p>
          <p class="contact-info">${businessInfo.businessPhone || ''} | ${businessInfo.businessWebsite || ''}</p>
        </div>
      </div>
    </body>
    </html>
  `;

    const attachments = [];
    if (pdfPath && fs.existsSync(pdfPath)) {
        attachments.push({
            filename: `PO_${po.po_number || 'draft'}.pdf`,
            path: pdfPath,
        });
    }

    return sendEmail({ to, subject, html, attachments });
}

module.exports = {
    initEmailService,
    sendEmail,
    sendReceiptEmail,
    sendQuotationEmail,
    sendPurchaseOrderEmail,
    testEmailConnection,
    sendTestEmail,
};
