# إعداد تطبيقَي الدخول (GitHub وCloudflare) — مرة واحدة للبائع

**لماذا؟** موقع كل محل يُنشأ على حسابَي GitHub وCloudflare **الخاصين بالمحل** (مجانيان).
حتى يكفي صاحب المحل أن **يُنشئ الحسابين ثم يضغط «سجّل الدخول»**، يجب أن يُسجَّل
برنامج Afus Boutique **مرة واحدة** لدى الشركتين، وتوضع المعرّفات في ملف التثبيت
`electron/shared/profile.json` قبل بناء النسخ التي تبيعها. لا يوجد أي سرّ (كلمة سر)
داخل البرنامج: المعرّفان عامّان.

بدون هذا الإعداد يبقى البرنامج يعمل، لكن المحل يضطر إلى إنشاء «مفاتيح» يدويًا
(طريقة احتياطية، صعبة على غير التقنيين).

---

## 1) GitHub — تطبيق OAuth (5 دقائق)

1. سجّل الدخول إلى GitHub بحساب البائع (حسابك أنت، ليس حساب محل).
2. افتح: **Settings ← Developer settings ← OAuth Apps ← New OAuth App**
   (الرابط المباشر: https://github.com/settings/applications/new).
3. املأ:
   - **Application name:** `Afus Boutique`
   - **Homepage URL:** موقعك (أو صفحة البرنامج)
   - **Authorization callback URL:** موقعك أيضًا (لا يُستعمل في طريقة البرنامج)
4. اضغط **Register application**.
5. في صفحة التطبيق فعّل **Enable Device Flow** ثم احفظ.
6. انسخ **Client ID** (يشبه `Ov23li...`). **لا تُنشئ Client secret** — البرنامج لا يحتاجه.

## 2) Cloudflare — عميل OAuth (10 دقائق + تأكيد الدومين)

1. سجّل الدخول إلى Cloudflare بحساب البائع.
2. افتح **Manage Account ← OAuth clients ← Create client**
   (https://dash.cloudflare.com/?to=/:account/oauth-clients).
3. املأ:
   - **Client name:** `Afus Boutique`
   - **Response type:** `code` — **Grant type:** `authorization_code` (+ `refresh_token` إن ظهر)
   - **Token authentication method:** `none` (برنامج حاسوب: PKCE)
   - **Redirect URLs** (الثلاثة كلها، كما يطبعها `npm run check:website-apps`):
     - `http://127.0.0.1:47651/oauth/callback`
     - `http://127.0.0.1:47652/oauth/callback`
     - `http://127.0.0.1:47653/oauth/callback`
4. **الصلاحيات (Scopes):** اختر فقط: كتابة **Workers Scripts**، كتابة **D1**، قراءة
   **Account Settings**، وصلاحية البقاء مربوطًا (refresh / offline) إن وُجدت.
   لمعرفة الأسماء الدقيقة كما يسمّيها Cloudflare:
   ```bash
   CLOUDFLARE_API_TOKEN=<مفتاح API من حسابك> node scripts/cloudflare-oauth-scopes.mjs
   ```
   يطبع السطر الجاهز لـ `cloudflareScopes`.
5. احفظ، وانسخ **Client ID**.
6. **اجعل العميل عامًا (Public)** حتى يستطيع أي محل الدخول به:
   - املأ الشعار ورابط موقعك (client URL).
   - أكّد ملكية الدومين: أضف سجل `TXT` الذي يعطيه Cloudflare (يبدأ بـ
     `cloudflare_oauth_client_publisher=`) في إعدادات DNS لدومينك. التأكيد قد يأخذ حتى يومين.
   - **تنبيه:** جعل العميل عامًا قرار نهائي، والدومين بعد التأكيد لا يتغيّر.
   - قبل ذلك (عميل خاص) يمكنك تجربة الدخول بحسابك أنت فقط.

## 3) ضع المعرّفات في ملف التثبيت

في `signing/profiles/<اسمك>.json` (أو مباشرة في `electron/shared/profile.json`):

```json
{
  "githubClientId": "Ov23li...",
  "cloudflareClientId": "....",
  "cloudflareScopes": ["...", "...", "...", "..."],
  "cloudflareRedirectPorts": [47651, 47652, 47653]
}
```

ثم:

```bash
node scripts/use-profile.mjs <اسمك>     # إن استعملت ملفًا في signing/profiles
npm run check:website-apps              # يجب أن يقول Ready
npm run build
npx electron-builder --win nsis --x64 --ia32 --arm64 --publish never
```

## 4) ما يفعله صاحب المحل بعدها

1. «موقعي على الإنترنت ← الحسابات والدومين».
2. ليس لديه حساب؟ يضغط **«أنشئ حسابًا مجانيًا»** (GitHub ثم Cloudflare) ويؤكّد بريده.
3. **«سجّل الدخول بحساب GitHub»**: تُفتح صفحة GitHub والرمز منسوخ تلقائيًا، يلصقه ويوافق.
4. **«سجّل الدخول بحساب Cloudflare»**: تُفتح صفحة Cloudflare، يوافق، ويعود البرنامج وحده.
5. **«إنشاء الموقع»**. انتهى.

## ملاحظات تمنع مشاكل لاحقًا

- **تأكيد البريد:** GitHub وCloudflare يطلبان تأكيد البريد قبل إنشاء المستودع/الخادم؛
  البرنامج يقول ذلك بوضوح إن لم يكن مؤكَّدًا.
- **الطلبات لا تتوقف إن انتهى الربط:** وصول الطلبات من الموقع إلى البرنامج يستعمل مفتاحًا
  خاصًا بالمحل (ليس دخول Cloudflare). إن انتهت صلاحية الدخول يكفي «سجّل الدخول» من جديد
  عند «تحديث الموقع».
- **مجاني:** GitHub Pages وCloudflare Workers/D1 في الخطة المجانية تكفي محلًا عاديًا
  (حتى 100 ألف طلب يوميًا على Workers).
- **الطريقة الاحتياطية** (مفتاح يُنشئه المحل يدويًا) تبقى متاحة تحت «طريقة أخرى».
