// [English, French, Arabic] Article form, photos, sizes tab and TVA switch
export default {
    // TVA on / off
    'settings.taxEnabled': ["TVA", "TVA", "الرسوم (TVA)"],
    'settings.taxEnabledOn': ["On: TVA is computed and shown on sales, tickets and reports.", "Activée : la TVA est calculée et affichée sur les ventes, tickets et rapports.", "مفعّلة: تُحسب الرسوم وتظهر في البيع والتذاكر والتقارير."],
    'settings.taxEnabledOff': ["Off: no TVA is computed or shown anywhere.", "Désactivée : aucune TVA n'est calculée ni affichée.", "غير مفعّلة: لا تُحسب الرسوم ولا تظهر في أي مكان."],

    'settings.taxCardOff': ["The currency of the shop. Turn the switch on only if your prices include a tax.", "La monnaie de la boutique. Activez l'interrupteur seulement si vos prix comprennent une taxe.", "عملة المحل. فعّل الزر فقط إذا كانت أسعارك تتضمن رسوماً."],

    // Article form
    'common.on': ["On", "Activé", "مفعّل"],
    'common.off': ["Off", "Désactivé", "غير مفعّل"],
    'products.costLabel': ["Cost (purchase price)", "Coût (prix d'achat)", "التكلفة (سعر الشراء)"],
    'products.colorsSizes': ["Colours and sizes", "Couleurs et tailles", "الألوان والمقاسات"],
    'products.colorsSizesHint': ["Optional: colours only, sizes only, both, or none.", "Facultatif : couleurs seules, tailles seules, les deux ou aucune.", "اختياري: ألوان فقط، مقاسات فقط، الاثنان، أو لا شيء."],
    'products.variantsOffWarning': ["Saved without colours and sizes: the stock entered below replaces the stock per colour/size.", "Enregistré sans couleurs ni tailles : le stock saisi plus bas remplace le stock par couleur/taille.", "ستُحفظ بدون ألوان ومقاسات: المخزون المُدخل أدناه يحل محل مخزون كل لون/مقاس."],
    'products.availableForSale': ["Available for sale", "En vente", "متاحة للبيع"],
    'products.availableForSaleHint': ["Turned off, the article no longer appears in the lists or the sales screen.", "Désactivé, l'article n'apparaît plus dans les listes ni à la caisse.", "عند إيقافها، لا تظهر السلعة في القوائم ولا في شاشة البيع."],
    'variants.colorsOff': ["Off: this article has no colours.", "Désactivé : cet article n'a pas de couleurs.", "غير مفعّل: هذه السلعة بدون ألوان."],
    'variants.colorsOffKept': ["Off: the pieces saved with colours are kept and come back when you turn it on.", "Désactivé : les pièces enregistrées avec couleurs sont gardées et reviennent si vous le réactivez.", "غير مفعّل: القطع المحفوظة بالألوان تبقى محفوظة وتعود عند إعادة التفعيل."],
    'variants.sizesOff': ["Off: this article has no sizes.", "Désactivé : cet article n'a pas de tailles.", "غير مفعّل: هذه السلعة بدون مقاسات."],
    'variants.sizesOffKept': ["Off: the pieces saved with sizes are kept and come back when you turn it on.", "Désactivé : les pièces enregistrées avec tailles sont gardées et reviennent si vous le réactivez.", "غير مفعّل: القطع المحفوظة بالمقاسات تبقى محفوظة وتعود عند إعادة التفعيل."],
    'products.stockAndCodes': ["Stock and codes", "Stock et codes", "المخزون والرموز"],
    'products.stockFromGrid': ["{n} colours/sizes, {stock} pieces in stock (entered above)", "{n} couleurs/tailles, {stock} pièces en stock (saisies plus haut)", "{n} لون/مقاس، {stock} قطعة في المخزون (أُدخلت أعلاه)"],
    'products.stockSimpleHint': ["Quantity in stock and the code printed on the label", "Quantité en stock et code imprimé sur l'étiquette", "الكمية في المخزون والرمز المطبوع على الملصق"],
    'products.skuLabel': ["Article code (SKU)", "Code article (SKU)", "رمز السلعة (SKU)"],
    'products.skuPrefixLabel': ["Article code (SKU)", "Code article (SKU)", "رمز السلعة (SKU)"],
    'products.skuPrefixHint': ["Optional, e.g. TSH: the start of every colour/size code. Each piece gets its own SKU automatically.", "Facultatif, ex. TSH : début du code de chaque couleur/taille. Chaque pièce reçoit son SKU automatiquement.", "اختياري، مثل TSH: بداية رمز كل لون/مقاس. كل قطعة تأخذ رمزها تلقائياً."],
    'products.printLabelsAfterSave': ["Print the labels after saving", "Imprimer les étiquettes après l'enregistrement", "طباعة الملصقات بعد الحفظ"],
    'products.labelsPerStock': ["One label per piece in stock", "Une étiquette par pièce en stock", "ملصق لكل قطعة في المخزون"],
    'products.labelsPerStockHint': ["Follows the quantities entered (at least one).", "Suit les quantités saisies (au moins une).", "حسب الكميات المُدخلة (واحد على الأقل)."],
    'products.labelsFixed': ["A fixed number", "Un nombre fixe", "عدد ثابت"],
    'products.labelsFixedHint': ["The same number for each colour/size.", "Le même nombre pour chaque couleur/taille.", "نفس العدد لكل لون/مقاس."],
    'products.labelsFixedArticleHint': ["The same number for the article.", "Le même nombre pour l'article.", "نفس العدد للسلعة."],
    'products.labelsWillPrint': ["{n} labels will print", "{n} étiquettes seront imprimées", "سيُطبع {n} ملصق"],
    'products.moreDetailsHintTax': ["supplier, TVA, season…", "fournisseur, TVA, saison…", "المورد، الرسوم، الموسم…"],
    'products.moreDetailsHintNoTax': ["supplier, season, collection…", "fournisseur, saison, collection…", "المورد، الموسم، التشكيلة…"],

    // Photos (up to 3, optional)
    'products.addPhoto': ["Add a photo", "Ajouter une photo", "إضافة صورة"],
    'products.mainPhoto': ["Main", "Principale", "الرئيسية"],
    'products.viewPhoto': ["View", "Voir", "عرض"],
    'products.replacePhoto': ["Replace", "Remplacer", "استبدال"],
    'products.photoN': ["Photo {n} of {total}", "Photo {n} sur {total}", "الصورة {n} من {total}"],
    'products.photosHint': ["Optional · {n} of {max} photos", "Facultatif · {n} sur {max} photos", "اختياري · {n} من {max} صور"],
    'products.imageTooBig': ["This photo is too large (15 MB at most).", "Photo trop lourde (15 Mo au plus).", "الصورة كبيرة جداً (15 ميغابايت كحد أقصى)."],

    // Sizes tab
    'catalogCustom.addSet': ["Add a size set", "Ajouter une série de tailles", "إضافة مجموعة مقاسات"],
    'catalogCustom.setName': ["Name", "Nom", "الاسم"],
    'catalogCustom.setSizes': ["Sizes, separated by commas", "Tailles, séparées par des virgules", "المقاسات، مفصولة بفواصل"],
    'catalogCustom.preview': ["Preview:", "Aperçu :", "معاينة:"],
    'catalogCustom.shownState': ["Shown", "Affichée", "ظاهرة"],
    'catalogCustom.hiddenState': ["Hidden", "Masquée", "مخفية"],
    'catalogCustom.shownCount': ["{n} of {total} shown", "{n} sur {total} affichées", "{n} من {total} ظاهرة"],
};
