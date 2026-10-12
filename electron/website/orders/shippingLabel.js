/**
 * The shipping label of a website order (cash on delivery), 100 x 150 mm,
 * the courier companies' usual size; printed on any printer (the system
 * dialog) or saved as PDF.
 *
 *   labelHtml({ order, shop, lang, codes })
 *     order: the order as websiteService shows it (number, customer, phone,
 *            wilaya, commune, delivery, address or courier office, items, total)
 *     shop:  { name, phone, logo (data: URI or ''), currency }
 *     codes: { barcode(text) -> svg, qr(text) -> svg }   (labelService)
 *
 * Every text is escaped (customers write their own name and address). The
 * page holds no script: it is printed from a window with JavaScript off.
 */
const { formatMoney } = require('../../i18n');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const WORDS = {
    cod: ['الدفع عند الاستلام', 'Paiement à la livraison', 'Cash on delivery'],
    toPay: ['المبلغ المطلوب', 'Montant à encaisser', 'Amount to collect'],
    to: ['المستلم', 'Destinataire', 'Recipient'],
    phone: ['الهاتف', 'Tél.', 'Phone'],
    wilaya: ['الولاية', 'Wilaya', 'Province'],
    commune: ['البلدية', 'Commune', 'Town'],
    address: ['العنوان', 'Adresse', 'Address'],
    office: ['مكتب التوصيل', 'Bureau de livraison', 'Courier office'],
    home: ['توصيل إلى المنزل', 'Livraison à domicile', 'Home delivery'],
    pickupOffice: ['استلام من مكتب', 'Retrait au bureau', 'Pick up at the office'],
    article: ['السلعة', 'Article', 'Item'],
    size: ['المقاس', 'Taille', 'Size'],
    color: ['اللون', 'Couleur', 'Colour'],
    qty: ['الكمية', 'Qté', 'Qty'],
    total: ['المجموع', 'Total', 'Total'],
    order: ['رقم الطلب', 'Commande', 'Order'],
    from: ['المرسل', 'Expéditeur', 'Sender'],
    note: ['ملاحظة', 'Remarque', 'Note'],
};
const IDX = { ar: 0, fr: 1, en: 2 };

/** Only an SVG made by the label service (no script, no outside link) goes into the page. */
function safeSvg(svg) {
    const s = String(svg || '');
    return /^<svg[\s>]/.test(s.trim()) && !/<script|on\w+\s*=|href\s*=|<foreignObject/i.test(s) ? s : '';
}

function labelHtml({ order, shop = {}, lang = 'ar', codes = {} }) {
    const L = IDX[lang] ?? 0;
    const w = (k) => WORDS[k][L];
    const money = (n) => formatMoney(Number(n) || 0, ['ar', 'fr', 'en'].includes(lang) ? lang : 'ar', shop.currency || 'DZD');
    const number = String(order.number || order.id || '');
    const barcode = codes.barcode ? safeSvg(codes.barcode(number)) : '';
    const qr = codes.qr ? safeSvg(codes.qr(number)) : '';
    const office = order.delivery === 'office' && order.courier;
    const logo = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(String(shop.logo || '')) ? shop.logo : '';
    const lines = (order.items || []).map(i => `<tr><td>${esc(i.productName || i.productId)}</td><td>${esc(i.size)}</td><td>${esc(i.color)}</td><td class="n">${esc(i.quantity)}</td></tr>`).join('');
    return `<!doctype html>
<html lang="${esc(lang)}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(number)}</title>
<style>
@page { size: 100mm 150mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 100mm; height: 150mm; }
body { font-family: "Cairo", "Segoe UI", Tahoma, Arial, sans-serif; font-size: 9.5pt; color: #000; background: #fff; }
.label { width: 100mm; height: 150mm; padding: 4mm; display: flex; flex-direction: column; gap: 2.2mm; overflow: hidden; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 3mm; border-bottom: 0.5mm solid #000; padding-bottom: 2mm; }
.shop { display: flex; align-items: center; gap: 2mm; min-width: 0; }
.shop img { max-height: 13mm; max-width: 24mm; object-fit: contain; }
.shop b { font-size: 12pt; display: block; }
.shop small { font-size: 8pt; }
.cod { border: 0.6mm solid #000; text-align: center; padding: 1.5mm 2mm; font-weight: 800; white-space: nowrap; }
.cod .big { font-size: 15pt; display: block; direction: ltr; unicode-bidi: isolate; }
.to { border: 0.4mm solid #000; padding: 2mm; }
.to h2 { font-size: 8pt; margin: 0 0 1mm; text-transform: uppercase; letter-spacing: .05em; }
.to .name { font-size: 13pt; font-weight: 800; }
.to .phone { font-size: 13pt; font-weight: 800; direction: ltr; unicode-bidi: isolate; letter-spacing: .03em; }
.to .place { font-size: 11pt; font-weight: 700; }
.to p { margin: .6mm 0; }
.delivery { display: inline-block; border: 0.3mm solid #000; padding: .3mm 1.5mm; font-weight: 700; font-size: 8.5pt; }
table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
th, td { border-bottom: 0.2mm solid #000; padding: .8mm .5mm; text-align: start; vertical-align: top; }
th { font-size: 7.5pt; }
td.n, th.n { text-align: center; width: 9mm; }
.total { display: flex; justify-content: space-between; font-weight: 800; font-size: 11pt; }
.total span:last-child { direction: ltr; unicode-bidi: isolate; }
.codes { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 3mm; }
.codes .bar svg { width: 58mm; height: 16mm; }
.codes .qr svg { width: 20mm; height: 20mm; }
.num { font-size: 12pt; font-weight: 800; direction: ltr; unicode-bidi: isolate; }
.note { font-size: 8pt; border: 0.2mm dashed #000; padding: 1mm; }
</style>
</head>
<body>
<div class="label" data-order="${esc(number)}">
  <div class="head">
    <div class="shop">${logo ? `<img src="${logo}" alt="">` : ''}<div><small>${esc(w('from'))}</small><b>${esc(shop.name)}</b>${shop.phone ? `<small dir="ltr">${esc(shop.phone)}</small>` : ''}</div></div>
    <div class="cod">${esc(w('cod'))}<span class="big">${esc(money(order.total))}</span></div>
  </div>
  <div class="to">
    <h2>${esc(w('to'))}</h2>
    <p class="name">${esc(order.customerName)}</p>
    <p class="phone">${esc(order.phone)}</p>
    <p class="place">${esc(order.wilaya)} — ${esc(order.commune)}</p>
    ${office
        ? `<p><span class="delivery">${esc(w('pickupOffice'))}</span></p>
    <p><b>${esc(w('office'))}:</b> ${esc(order.courier.company)} — ${esc(order.courier.office)}</p>
    ${(order.courier.wilaya || order.courier.commune) ? `<p>${esc([order.courier.wilaya, order.courier.commune].filter(Boolean).join(' — '))}</p>` : ''}`
        : `<p><span class="delivery">${esc(w('home'))}</span></p>
    <p><b>${esc(w('address'))}:</b> ${esc(order.address)}</p>`}
  </div>
  <table>
    <thead><tr><th>${esc(w('article'))}</th><th>${esc(w('size'))}</th><th>${esc(w('color'))}</th><th class="n">${esc(w('qty'))}</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="total"><span>${esc(w('total'))} · ${esc(w('toPay'))}</span><span>${esc(money(order.total))}</span></div>
  ${order.note ? `<div class="note"><b>${esc(w('note'))}:</b> ${esc(order.note)}</div>` : ''}
  <div class="codes">
    <div><div>${esc(w('order'))}</div><div class="num">${esc(number)}</div><div class="bar">${barcode}</div></div>
    <div class="qr">${qr}</div>
  </div>
</div>
</body>
</html>`;
}

/** 100 x 150 mm in the units each Electron call expects. */
const PAGE = { widthMm: 100, heightMm: 150 };

module.exports = { labelHtml, PAGE, safeSvg };
