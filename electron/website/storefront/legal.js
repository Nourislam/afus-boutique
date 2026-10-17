/**
 * The website's legal pages, the same words for every shop (cash on delivery
 * in Algeria): returns and exchanges, terms of sale, privacy, delivery. Only
 * the shop's name and its contact (its e-mail, else its phone: many shops
 * have no e-mail) change. In the website's language.
 *
 *   LEGAL_PAGES                  ['returns', 'terms', 'privacy', 'shipping']
 *   legalPage(id, lang, shop)    { title, sections: [{ h, p: [..] }] } | null
 */
const LEGAL_PAGES = ['returns', 'terms', 'privacy', 'shipping'];

const TITLES = {
    returns: ['سياسة الإرجاع والاستبدال', 'Retours et échanges', 'Returns and exchanges'],
    terms: ['الشروط والأحكام', 'Conditions générales de vente', 'Terms of sale'],
    privacy: ['سياسة الخصوصية', 'Politique de confidentialité', 'Privacy policy'],
    shipping: ['الشحن والتوصيل', 'Livraison', 'Delivery'],
};

// [heading, paragraphs] per language; {shop} and {contact} are replaced
const BODY = {
    returns: {
        ar: [
            ['الاستبدال', ['يمكنك استبدال السلعة بمقاس أو لون آخر خلال 7 أيام من استلامها، إذا كانت بحالتها الأصلية: غير ملبوسة، غير مغسولة، وبكل ملصقاتها وتغليفها.', 'يتم الاستبدال حسب توفر المقاس أو اللون المطلوب في {shop}.']],
            ['الإرجاع', ['يمكنك إرجاع السلعة خلال 7 أيام من استلامها إذا وصلتك تالفة أو مختلفة عن طلبك (مقاس أو لون أو موديل آخر).', 'في هذه الحالة يتحمل {shop} مصاريف التوصيل ويستبدل السلعة أو يرد ثمنها.']],
            ['ما لا يُرجع', ['الملابس الداخلية وملابس السباحة والإكسسوارات الشخصية لأسباب صحية، والسلع المخفضة إلا إذا وصلت تالفة.']],
            ['تكاليف الإرجاع', ['إذا كان الإرجاع أو الاستبدال برغبتك (تغيير الرأي أو المقاس)، تكون مصاريف التوصيل على حسابك.']],
            ['كيف تطلب الإرجاع أو الاستبدال', ['تواصل معنا على {contact} واذكر اسمك ورقم هاتفك والسلعة المعنية. سنتصل بك لترتيب الأمر.']],
        ],
        fr: [
            ['Échange', ["Vous pouvez échanger un article contre une autre taille ou couleur dans les 7 jours suivant sa réception, s'il est dans son état d'origine : non porté, non lavé, avec ses étiquettes et son emballage.", "L'échange se fait selon la disponibilité de la taille ou couleur demandée chez {shop}."]],
            ['Retour', ["Vous pouvez retourner un article dans les 7 jours suivant sa réception s'il est arrivé abîmé ou différent de votre commande (autre taille, couleur ou modèle).", "Dans ce cas, {shop} prend en charge les frais de livraison et échange l'article ou le rembourse."]],
            ['Articles non repris', ["Sous-vêtements, maillots de bain et accessoires personnels pour des raisons d'hygiène ; articles soldés, sauf s'ils sont arrivés abîmés."]],
            ['Frais de retour', ["Si le retour ou l'échange est à votre initiative (changement d'avis ou de taille), les frais de livraison sont à votre charge."]],
            ['Comment demander un retour ou un échange', ["Contactez-nous au {contact} en indiquant votre nom, votre téléphone et l'article concerné. Nous vous rappelons pour l'organiser."]],
        ],
        en: [
            ['Exchanges', ['You can exchange an item for another size or colour within 7 days of receiving it, if it is in its original condition: not worn, not washed, with its labels and packaging.', 'Exchanges depend on the size or colour being available at {shop}.']],
            ['Returns', ['You can return an item within 7 days of receiving it if it arrived damaged or different from your order (another size, colour or model).', 'In that case {shop} pays the delivery and exchanges or refunds the item.']],
            ['Items not taken back', ['Underwear, swimwear and personal accessories for hygiene reasons; sale items, unless they arrived damaged.']],
            ['Return costs', ['If the return or exchange is your choice (change of mind or size), the delivery costs are yours.']],
            ['How to ask for a return or an exchange', ['Contact us at {contact} with your name, your phone and the item. We will call you to arrange it.']],
        ],
    },
    terms: {
        ar: [
            ['التعريف', ['هذا الموقع ملك لـ {shop}. الطلب من الموقع يعني قبولك لهذه الشروط.']],
            ['الأسعار', ['الأسعار معروضة بالدينار الجزائري (دج). مصاريف التوصيل تظهر قبل تأكيد الطلب وتضاف إلى ثمن السلع.']],
            ['الطلب والتأكيد', ['بعد إرسال طلبك يتصل بك {shop} هاتفيًا لتأكيده. لا يُرسل أي طلب قبل تأكيده معك.', 'يحق للمحل إلغاء طلب إذا تعذر الاتصال بك أو إذا نفدت السلعة، مع إعلامك بذلك.']],
            ['الدفع', ['الدفع نقدًا عند الاستلام، لموظف التوصيل أو في مكتب شركة التوصيل. لا يُطلب منك أي دفع مسبق على الموقع.']],
            ['الصور والمقاسات', ['نحرص على أن تكون الصور والألوان والمقاسات مطابقة للسلعة، وقد يظهر اختلاف بسيط في اللون حسب الشاشة.']],
            ['التواصل', ['لأي سؤال: {contact}.']],
        ],
        fr: [
            ['Présentation', ["Ce site appartient à {shop}. Commander sur ce site vaut acceptation de ces conditions."]],
            ['Prix', ['Les prix sont affichés en dinars algériens (DA). Les frais de livraison sont indiqués avant la confirmation et s’ajoutent au prix des articles.']],
            ['Commande et confirmation', ["Après l'envoi de votre commande, {shop} vous appelle pour la confirmer. Aucune commande n'est expédiée avant cette confirmation.", 'La boutique peut annuler une commande si vous êtes injoignable ou si l’article est épuisé, en vous en informant.']],
            ['Paiement', ["Paiement en espèces à la livraison, au livreur ou au bureau de la société de livraison. Aucun paiement n'est demandé à l'avance sur le site."]],
            ['Photos et tailles', ['Nous veillons à ce que les photos, couleurs et tailles correspondent à l’article ; une légère différence de couleur peut apparaître selon l’écran.']],
            ['Contact', ['Pour toute question : {contact}.']],
        ],
        en: [
            ['About', ['This website belongs to {shop}. Ordering on it means you accept these terms.']],
            ['Prices', ['Prices are in Algerian dinars (DA). The delivery price is shown before you confirm and is added to the price of the items.']],
            ['Order and confirmation', ['After you send your order, {shop} calls you to confirm it. Nothing is sent before it is confirmed with you.', 'The shop may cancel an order if you cannot be reached or the item is sold out, and will tell you.']],
            ['Payment', ['Cash on delivery, to the courier or at the delivery company’s office. No payment is asked in advance on the website.']],
            ['Pictures and sizes', ['We make sure pictures, colours and sizes match the item; colours may look slightly different depending on the screen.']],
            ['Contact', ['For any question: {contact}.']],
        ],
    },
    privacy: {
        ar: [
            ['ما نجمعه', ['عند الطلب نطلب فقط ما يلزم لإيصال طلبك: الاسم، رقم الهاتف، الولاية، البلدية، والعنوان عند التوصيل للمنزل.']],
            ['لماذا', ['تُستعمل هذه المعلومات لتأكيد طلبك بالهاتف وتسليمه لشركة التوصيل فقط. لا تُباع ولا تُعطى لأي جهة أخرى.']],
            ['الحفظ', ['يحتفظ {shop} بطلبك في برنامج المحل لمتابعة التوصيل والإرجاع. لا يحفظ الموقع أي كلمة سر ولا بطاقة بنكية.']],
            ['الإحصاءات', ['يحسب الموقع عدد مرات مشاهدة الصفحات دون معرفة هويتك ودون عنوانك.']],
            ['حقوقك', ['يمكنك طلب الاطلاع على معلوماتك أو حذفها بالتواصل معنا على {contact}.']],
        ],
        fr: [
            ['Ce que nous recueillons', ['Lors d’une commande, seulement ce qui est nécessaire pour vous livrer : nom, téléphone, wilaya, commune et adresse pour une livraison à domicile.']],
            ['Pourquoi', ['Ces informations servent uniquement à confirmer votre commande par téléphone et à la remettre au livreur. Elles ne sont ni vendues ni transmises à des tiers.']],
            ['Conservation', ['{shop} garde votre commande dans le logiciel de la boutique pour suivre la livraison et les retours. Le site ne garde aucun mot de passe ni carte bancaire.']],
            ['Statistiques', ['Le site compte les visites des pages sans vous identifier et sans votre adresse.']],
            ['Vos droits', ['Vous pouvez demander à consulter ou supprimer vos informations en nous contactant au {contact}.']],
        ],
        en: [
            ['What we collect', ['When you order, only what is needed to deliver it: name, phone, wilaya, commune and the address for home delivery.']],
            ['Why', ['It is used only to confirm your order by phone and hand it to the courier. It is never sold or given to anyone else.']],
            ['Keeping it', ['{shop} keeps your order in the shop’s program to follow the delivery and returns. The website keeps no password and no bank card.']],
            ['Statistics', ['The website counts page views without knowing who you are or your address.']],
            ['Your rights', ['You can ask to see or delete your information by contacting us at {contact}.']],
        ],
    },
    shipping: {
        ar: [
            ['أين نوصل', ['نوصل إلى الولايات المذكورة في نموذج الطلب، للمنزل أو لمكتب شركة التوصيل حسب اختيارك.']],
            ['الأسعار', ['سعر التوصيل يظهر في نموذج الطلب حسب الولاية وطريقة التوصيل، قبل تأكيد الطلب.']],
            ['المدة', ['عادة من يومين إلى 7 أيام عمل بعد تأكيد الطلب، حسب الولاية وشركة التوصيل.']],
            ['عند الاستلام', ['تدفع نقدًا عند الاستلام. افحص الطرد أمام موظف التوصيل، وإذا كانت هناك مشكلة تواصل معنا فورًا على {contact}.']],
            ['الطلبات غير المستلمة', ['إذا رفضت الطرد دون سبب أو تعذر الاتصال بك، قد يرفض {shop} طلباتك القادمة.']],
        ],
        fr: [
            ['Où livrons-nous', ['Dans les wilayas proposées dans le formulaire de commande, à domicile ou au bureau de la société de livraison selon votre choix.']],
            ['Prix', ['Le prix de livraison est affiché dans le formulaire selon la wilaya et le mode de livraison, avant la confirmation.']],
            ['Délai', ['En général 2 à 7 jours ouvrables après la confirmation, selon la wilaya et la société de livraison.']],
            ['À la réception', ['Vous payez en espèces à la réception. Vérifiez le colis devant le livreur ; en cas de problème, contactez-nous aussitôt au {contact}.']],
            ['Colis non retirés', ['Si vous refusez le colis sans raison ou restez injoignable, {shop} peut refuser vos prochaines commandes.']],
        ],
        en: [
            ['Where we deliver', ['To the wilayas offered in the order form, at home or at the delivery company’s office, as you choose.']],
            ['Prices', ['The delivery price is shown in the order form by wilaya and way of delivery, before you confirm.']],
            ['Time', ['Usually 2 to 7 working days after confirmation, depending on the wilaya and the courier.']],
            ['On delivery', ['You pay cash when you receive it. Check the parcel in front of the courier; if something is wrong, contact us at once at {contact}.']],
            ['Parcels not collected', ['If you refuse a parcel without reason or cannot be reached, {shop} may refuse your next orders.']],
        ],
    },
};

const LANG_INDEX = { ar: 0, fr: 1, en: 2 };

function legalPage(id, lang, shop = {}) {
    if (!LEGAL_PAGES.includes(id)) return null;
    const language = LANG_INDEX[lang] === undefined ? 'ar' : lang;
    const name = shop.name || '';
    const contact = shop.email || shop.phone || '';
    const fill = (s) => s.replace(/\{shop\}/g, name).replace(/\{contact\}/g, contact);
    return {
        title: TITLES[id][LANG_INDEX[language]],
        sections: BODY[id][language].map(([h, p]) => ({ h: fill(h), p: p.map(fill) })),
    };
}

module.exports = { LEGAL_PAGES, legalPage };
