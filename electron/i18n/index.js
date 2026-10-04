/**
 * Translations for documents produced by the main process (receipts,
 * purchase orders, labels, dialogs). Same format as the interface
 * dictionaries: { key: [English, French, Arabic] }.
 *
 * The language is the shop's language (store_config.defaultLanguage).
 */
const CLOTHING = require('../shared/clothing.json');

const LANG_INDEX = { en: 0, fr: 1, ar: 2 };
const LOCALES = { en: 'en-GB', fr: 'fr-DZ', ar: 'ar-DZ-u-nu-latn' };
const DEFAULT_LANGUAGE = 'ar';

const MESSAGES = {
    // Receipt
    'receipt.number': ['Receipt no.', 'Ticket n°', 'رقم التذكرة'],
    'receipt.date': ['Date', 'Date', 'التاريخ'],
    'receipt.cashier': ['Cashier', 'Vendeur', 'البائع'],
    'receipt.customer': ['Customer', 'Client', 'الزبون'],
    'receipt.due': ['Due date', 'Échéance', 'تاريخ الاستحقاق'],
    'receipt.subtotal': ['Subtotal', 'Sous-total', 'المجموع الفرعي'],
    'receipt.discount': ['Discount', 'Remise', 'التخفيض'],
    'receipt.serviceCharge': ['Service charge', 'Frais de service', 'رسوم الخدمة'],
    'receipt.taxIncluded': ['incl.', 'incluse', 'مشمول'],
    'receipt.total': ['TOTAL', 'TOTAL', 'المجموع'],
    'receipt.received': ['Amount received', 'Montant reçu', 'المبلغ المستلم'],
    'receipt.change': ['Change', 'Monnaie rendue', 'الباقي'],
    'receipt.footer': ['Thank you for your visit!', 'Merci de votre visite !', 'شكراً على زيارتكم!'],
    'receipt.exchangeNote': ['Exchange within 7 days with this receipt', 'Échange sous 7 jours avec ce ticket', 'الاستبدال خلال 7 أيام بهذه التذكرة'],
    'receipt.giftCardBalance': ['Balance', 'Solde', 'الرصيد'],
    'receipt.items': ['{n} pcs', '{n} pcs', '{n} قطعة'],
    // Payment methods
    'pay.cash': ['Cash', 'Espèces', 'نقداً'],
    'pay.card': ['Card (CIB / Edahabia)', 'Carte (CIB / Edahabia)', 'بطاقة CIB أو الذهبية'],
    'pay.transfer': ['BaridiMob / CCP', 'BaridiMob / CCP', 'بريدي موب أو CCP'],
    'pay.credit': ['Credit', 'Crédit', 'كريدي'],
    'pay.gift_card': ['Gift card', 'Carte cadeau', 'بطاقة هدية'],
    'pay.bank_transfer': ['Bank transfer', 'Virement bancaire', 'تحويل بنكي'],
    'pay.check': ['Cheque', 'Chèque', 'صك'],
    'pay.other': ['Other', 'Autre', 'أخرى'],
    // Credit payment receipt
    'creditReceipt.title': ['Payment receipt', 'Reçu de paiement', 'وصل تسديد'],
    'creditReceipt.invoice': ['Invoice no.', 'Facture n°', 'رقم الفاتورة'],
    'creditReceipt.paid': ['AMOUNT PAID', 'MONTANT PAYÉ', 'المبلغ المدفوع'],
    'creditReceipt.method': ['Method', 'Mode', 'الطريقة'],
    'creditReceipt.remaining': ['Remaining balance', 'Reste à payer', 'المبلغ المتبقي'],
    'creditReceipt.thanks': ['Thank you for your payment!', 'Merci pour votre paiement !', 'شكراً على التسديد!'],
    // A4 documents (purchase order, quotation)
    'doc.receipt': ['RECEIPT', 'TICKET', 'تذكرة'],
    'doc.purchaseOrder': ['PURCHASE ORDER', 'BON DE COMMANDE', 'طلبية شراء'],
    'doc.quotation': ['QUOTATION', 'DEVIS', 'عرض سعر'],
    'doc.number': ['Document no.', 'N° du document', 'رقم الوثيقة'],
    'doc.date': ['Date', 'Date', 'التاريخ'],
    'doc.expected': ['Expected delivery', 'Livraison prévue', 'تاريخ الاستلام المتوقع'],
    'doc.vendor': ['SUPPLIER', 'FOURNISSEUR', 'المورد'],
    'doc.shipTo': ['DELIVER TO', 'LIVRER À', 'التسليم إلى'],
    'doc.preparedFor': ['PREPARED FOR', 'ÉTABLI POUR', 'مُعدّ لـ'],
    'doc.validUntil': ['VALID UNTIL', "VALABLE JUSQU'AU", 'صالح إلى غاية'],
    'doc.validDefault': ['30 days', '30 jours', '30 يوماً'],
    'doc.phone': ['Phone', 'Tél.', 'الهاتف'],
    'doc.email': ['E-mail', 'E-mail', 'البريد'],
    'doc.contact': ['Contact', 'Contact', 'الشخص المكلف'],
    'doc.website': ['Website', 'Site web', 'الموقع'],
    'doc.notes': ['Notes / special instructions', 'Notes / instructions', 'ملاحظات / تعليمات'],
    'doc.description': ['Description', 'Désignation', 'البيان'],
    'doc.qty': ['Qty', 'Qté', 'الكمية'],
    'doc.unitPrice': ['Unit price', 'Prix unitaire', 'سعر الوحدة'],
    'doc.amount': ['Amount', 'Montant', 'المبلغ'],
    'doc.exempt': ['EXEMPT', 'EXONÉRÉ', 'معفى'],
    'doc.signatory': ['Authorised signatory', 'Signataire autorisé', 'الموقّع المعتمد'],
    'doc.terms': ['Terms & conditions', 'Conditions', 'الشروط'],
    'doc.term1': ['Please deliver the goods as specified above', 'Merci de livrer la marchandise comme indiqué', 'يرجى تسليم السلع كما هو مبين أعلاه'],
    'doc.term2': ['The invoice must quote this order number', 'La facture doit mentionner ce numéro de commande', 'يجب ذكر رقم الطلبية في الفاتورة'],
    'doc.term3': ['Goods are received subject to inspection', 'Marchandise reçue sous réserve de contrôle', 'تُستلم السلع بعد المراقبة'],
    'doc.thanks': ['Thank you for your business!', 'Merci de votre confiance !', 'شكراً على ثقتكم!'],
    'doc.supplierDefault': ['Supplier', 'Fournisseur', 'المورد'],
    'doc.customerDefault': ['Customer', 'Client', 'الزبون'],
    // Gift card
    'gift.title': ['Gift card', 'Carte cadeau', 'بطاقة هدية'],
    'gift.number': ['Card number', 'Numéro de carte', 'رقم البطاقة'],
    'gift.expires': ['Expires', 'Expire le', 'تنتهي في'],
    'gift.noExpiry': ['No expiry date', "Sans date d'expiration", 'بدون تاريخ انتهاء'],
    'gift.terms': ['Terms and conditions apply', 'Conditions applicables', 'تُطبق الشروط'],
    // Shop legal identifiers
    'legal.rc': ['RC', 'RC', 'س.ت'],
    'legal.nif': ['NIF', 'NIF', 'ر.ت.ج'],
    'legal.nis': ['NIS', 'NIS', 'ر.ت.إ'],
    'legal.ai': ['AI', 'AI', 'م.ج'],
    // Dialogs
    'dialog.startFailed': ['{app} could not start', "{app} n'a pas pu démarrer", 'تعذّر تشغيل {app}'],
    'dialog.dbFailed': ['The local database could not be opened.', "La base de données locale n'a pas pu être ouverte.", 'تعذّر فتح قاعدة البيانات المحلية.'],
    'dialog.exportBackup': ['Create a backup', 'Créer une sauvegarde', 'إنشاء نسخة احتياطية'],
    'dialog.importBackup': ['Restore a backup', 'Restaurer une sauvegarde', 'استرجاع نسخة احتياطية'],
    'dialog.selectSignature': ['Choose the signature image', "Choisir l'image de signature", 'اختر صورة التوقيع'],
    'dialog.saveReceipt': ['Save the receipt as PDF', 'Enregistrer le ticket en PDF', 'حفظ التذكرة PDF'],
    'dialog.saveLabels': ['Save the labels as PDF', 'Enregistrer les étiquettes en PDF', 'حفظ الملصقات PDF'],
    'dialog.savePurchaseOrder': ['Save the purchase order as PDF', 'Enregistrer le bon de commande en PDF', 'حفظ طلبية الشراء PDF'],
    'dialog.saveQuotation': ['Save the quotation as PDF', 'Enregistrer le devis en PDF', 'حفظ عرض السعر PDF'],
    'dialog.saveGiftCard': ['Save the gift card as PDF', 'Enregistrer la carte cadeau en PDF', 'حفظ بطاقة الهدية PDF'],
    'dialog.pdfFiles': ['PDF documents', 'Documents PDF', 'ملفات PDF'],
    'dialog.backupFiles': ['Backup (SQLite)', 'Sauvegarde (SQLite)', 'نسخة احتياطية (SQLite)'],
    'dialog.imageFiles': ['Images', 'Images', 'الصور'],
    'dialog.dataFolder': ['Data folder', 'Dossier des données', 'مجلد البيانات'],
    'app.name': ['Hanout', 'Hanout', 'حانوت'],
};

function normalizeLanguage(lang) {
    return LANG_INDEX[lang] !== undefined ? lang : DEFAULT_LANGUAGE;
}

function translate(lang, key, params) {
    const entry = MESSAGES[key];
    let text = entry ? (entry[LANG_INDEX[normalizeLanguage(lang)]] || entry[0]) : key;
    if (params) {
        text = text.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined && params[name] !== null ? String(params[name]) : m));
    }
    return text;
}

/** A translator bound to one language: const T = translator('fr'); T('receipt.total') */
function translator(lang) {
    const value = normalizeLanguage(lang);
    const T = (key, params) => translate(value, key, params);
    T.lang = value;
    T.dir = value === 'ar' ? 'rtl' : 'ltr';
    T.locale = LOCALES[value];
    return T;
}

const SPACE = /[\u202f\u00a0 ]/g;
const NBSP = '\u00a0';

/** "2 500 DA" / "2 500 د.ج"; decimals only when needed. Same output as the interface. */
function formatMoney(amount, lang = DEFAULT_LANGUAGE, currency = 'DZD') {
    const value = Number(amount) || 0;
    const digits = Number.isInteger(value) ? 0 : 2;
    // No-break spaces keep "2 500" in one piece, also inside Arabic text
    const number = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
        .format(value).replace(SPACE, NBSP);
    if (!currency || currency === 'DZD') return `${number}${NBSP}${normalizeLanguage(lang) === 'ar' ? 'د.ج' : 'DA'}`;
    return `${number}${NBSP}${currency}`;
}

function parseDate(value) {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    // SQLite CURRENT_TIMESTAMP values are UTC without a zone marker
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return new Date(`${value.replace(' ', 'T')}Z`);
    return new Date(value);
}

function formatDate(value, _lang = DEFAULT_LANGUAGE, withTime = true) {
    const d = parseDate(value);
    if (Number.isNaN(d.getTime())) return String(value || '');
    const options = withTime
        ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
        : { year: 'numeric', month: '2-digit', day: '2-digit' };
    // dd/mm/yyyy hh:mm in every language (the Arabic locale adds direction marks)
    return new Intl.DateTimeFormat('fr-DZ', options).format(d);
}

// Colour and size names from the shared clothing catalogue
const COLOR_BY_KEY = new Map();
for (const c of CLOTHING.colors) {
    for (const k of [c.code, c.en, c.fr, c.ar]) COLOR_BY_KEY.set(String(k).trim().toLowerCase(), c);
}

function colorName(item, lang = DEFAULT_LANGUAGE) {
    if (!item) return '';
    const entry = COLOR_BY_KEY.get(String(item.color_code || '').toLowerCase()) || COLOR_BY_KEY.get(String(item.color || '').trim().toLowerCase());
    return entry ? entry[normalizeLanguage(lang)] : (item.color || '');
}

const SIZE_UNITS = { Y: { en: 'yrs', fr: 'ans', ar: 'سنوات' }, M: { en: 'mo', fr: 'mois', ar: 'أشهر' } };

function sizeLabel(size, lang = DEFAULT_LANGUAGE) {
    if (!size) return '';
    const value = String(size).trim();
    const label = CLOTHING.sizeLabels && CLOTHING.sizeLabels[value];
    if (label) return label[normalizeLanguage(lang)] || value;
    const m = /^(\d+(?:-\d+)?)([YM])$/.exec(value);
    if (m) return `${m[1]} ${SIZE_UNITS[m[2]][normalizeLanguage(lang)]}`;
    return value;
}

/** "Noir / M" in the shop's language; falls back to the stored snapshot. */
function variantLabel(item, lang = DEFAULT_LANGUAGE) {
    if (!item) return '';
    if (item.color || item.size || item.color_code) {
        return [colorName(item, lang), sizeLabel(item.size, lang)].filter(Boolean).join(' / ');
    }
    return item.variant_label || '';
}

function paymentLabel(method, lang = DEFAULT_LANGUAGE) {
    const key = `pay.${method}`;
    return MESSAGES[key] ? translate(lang, key) : String(method || '').replace(/_/g, ' ');
}

module.exports = {
    MESSAGES,
    DEFAULT_LANGUAGE,
    normalizeLanguage,
    translate,
    translator,
    formatMoney,
    formatDate,
    colorName,
    sizeLabel,
    variantLabel,
    paymentLabel,
};
