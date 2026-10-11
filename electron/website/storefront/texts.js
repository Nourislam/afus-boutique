/**
 * The storefront's own words (buttons, titles), in the shop's language.
 * Everything else on the website is the shop's data.
 */
const TEXTS = {
    home: ['الرئيسية', 'Accueil', 'Home'],
    all: ['كل السلع', 'Tous les articles', 'All products'],
    sale: ['تخفيضات', 'Promotions', 'Sale'],
    new: ['وصل حديثًا', 'Nouveautés', 'New in'],
    featured: ['اخترنا لك', 'Notre sélection', 'Our selection'],
    available: ['متوفر الآن', 'Disponible maintenant', 'In stock now'],
    categories: ['الأصناف', 'Catégories', 'Categories'],
    brands: ['الماركات', 'Marques', 'Brands'],
    about: ['من نحن', 'À propos', 'About us'],
    contact: ['اتصل بنا', 'Contact', 'Contact'],
    shopNow: ['تسوّق الآن', 'Découvrir', 'Shop now'],
    seeAll: ['عرض الكل', 'Tout voir', 'See all'],
    sizes: ['المقاسات', 'Tailles', 'Sizes'],
    colors: ['الألوان', 'Couleurs', 'Colours'],
    sizesInStock: ['المقاسات المتوفرة', 'Tailles disponibles', 'Sizes in stock'],
    soldOut: ['نفد', 'Épuisé', 'Sold out'],
    inStock: ['متوفر', 'En stock', 'In stock'],
    order: ['اطلب عبر واتساب', 'Commander sur WhatsApp', 'Order on WhatsApp'],
    call: ['اتصل', 'Appeler', 'Call'],
    address: ['العنوان', 'Adresse', 'Address'],
    phone: ['الهاتف', 'Téléphone', 'Phone'],
    related: ['قد يعجبك أيضًا', 'Vous aimerez aussi', 'You may also like'],
    menu: ['القائمة', 'Menu', 'Menu'],
    search: ['بحث', 'Rechercher', 'Search'],
    articles: ['سلعة', 'articles', 'items'],
    empty: ['ستظهر سلعك هنا.', 'Vos articles apparaîtront ici.', 'Your products will appear here.'],
    orderText: ['مرحبًا، أريد طلب:', 'Bonjour, je voudrais commander :', 'Hello, I would like to order:'],
    upTo: ['حتى', "jusqu'à", 'up to'],
    rights: ['جميع الحقوق محفوظة', 'Tous droits réservés', 'All rights reserved'],
    orderTitle: ['اطلب هذه السلعة', 'Commander cet article', 'Order this item'],
    orderHint: ['اترك اسمك ورقمك وسيتصل بك المحل لتأكيد الطلب.', 'Laissez votre nom et votre numéro : la boutique vous appelle pour confirmer.', 'Leave your name and number: the shop calls you to confirm.'],
    yourName: ['الاسم', 'Nom', 'Name'],
    yourPhone: ['رقم الهاتف', 'Téléphone', 'Phone number'],
    wilaya: ['الولاية', 'Wilaya', 'Province'],
    addressField: ['العنوان', 'Adresse', 'Address'],
    note: ['ملاحظة', 'Remarque', 'Note'],
    quantity: ['الكمية', 'Quantité', 'Quantity'],
    chooseSize: ['اختر المقاس', 'Choisir la taille', 'Choose the size'],
    chooseColor: ['اختر اللون', 'Choisir la couleur', 'Choose the colour'],
    send: ['أرسل الطلب', 'Envoyer la commande', 'Send the order'],
    thanksTitle: ['شكرًا، وصل طلبك', 'Merci, votre commande est arrivée', 'Thank you, your order arrived'],
    thanksText: ['سيتصل بك المحل قريبًا لتأكيد الطلب والتوصيل.', 'La boutique vous appelle bientôt pour confirmer et livrer.', 'The shop will call you soon to confirm and deliver.'],
    errorTitle: ['لم يُرسل الطلب', "La commande n'est pas partie", 'The order was not sent'],
    errorText: ['تحقق من الاسم ورقم الهاتف وأعد المحاولة، أو اتصل بالمحل.', 'Vérifiez le nom et le numéro puis réessayez, ou appelez la boutique.', 'Check the name and number and try again, or call the shop.'],
    backHome: ['العودة إلى المتجر', 'Retour à la boutique', 'Back to the shop'],
};
const INDEX = { ar: 0, fr: 1, en: 2 };

/** t('sale') in the language; unknown key -> the key itself (seen in tests). */
const textsFor = (lang) => (key) => (TEXTS[key] ? TEXTS[key][INDEX[lang] ?? 0] : key);

module.exports = { TEXTS, textsFor };
