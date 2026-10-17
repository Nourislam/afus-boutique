# Website + program overhaul (requests 1–10) — design

Date: 2026-10-17 · Status: for review

Decisions taken with the owner (2026-10-17):
- Pictures: shop's own hero picture + its product photos; built-in free-licence fashion
  photos until the shop adds its own. Layouts inspired by Shopify's free **Dawn** theme
  (no copy of paid themes).
- Log out: one screen, the counted cash typed once, one button «أغلق الصندوق واخرج», no printing.
- Log in: opening cash pre-filled with the last closing amount, one button «ابدأ».
- Order: website first, then the program, then the audit report.

Guiding rule (AFUS): the program is designed for the shop worker, not the developer —
few words, big clear actions, everything else works by itself.

---

## Phase A — the website

### A1. Real pictures and better themes (request 1)
- **Hero picture:** new setting `publicInfo.hero = { image, title, subtitle }` in
  «موقعي ← الإعدادات ← معلومات المحل» (one picture field + 2 optional text fields).
  Uploaded through the existing image store (same rules: jpg/png/webp, resized).
- **Fallback order for every picture slot** (hero, category tiles, banners):
  shop picture → a product photo of that category → built-in photo.
- **Built-in photos:** ~12 fashion photos (women, men, kids, shoes, accessories, sale),
  free licence (Unsplash/Pexels licence: commercial use allowed, no attribution required),
  resized to WebP ≤ 120 KB each, shipped in the program, published with the site only
  when used. Licence and source of each photo listed in `website/photos/CREDITS.md`.
- **Themes:** the 8 themes get a Dawn-like structure: full-width hero with text over the
  picture and one button, category tiles with pictures, product grid with 2 photos on hover
  (desktop), clean product page. Each theme keeps its own colours/fonts/shape.
- Checks: no theme renders a grey box when the shop has no photo; the page weight stays
  light (lazy pictures, `srcset`); CSP unchanged (pictures are the site's own files).

### A2. «يظهر في الموقع» per article (request 2)
- DB: `products.show_on_website INTEGER NOT NULL DEFAULT 1` (existing articles stay
  visible, so live websites do not empty themselves). New article: checkbox ticked by default.
- Product form (add / edit): one checkbox «يظهر في الموقع الإلكتروني»; products list:
  a small badge on hidden ones and a filter.
- Public data: only visible articles are read. Categories, brands, sizes and colours on the
  website are **only those of visible articles** (an empty category disappears).
- «الأكثر مبيعًا» and «الجديد»: ranked as today, **then** hidden articles removed, the
  order kept (3rd overall → 1st on the website). Unit tests for exactly this case.

### A3. Footer brand + legal pages (request 3)
- Every theme's footer: «© {السنة} {اسم المحل} · صُنع بواسطة **Afus Boutique**» with the
  small Afus logo (SVG, built in), linking nowhere private.
- New pages, same Arabic text for every shop, only `{shopName}`, `{shopEmail}` (or the
  shop phone when there is no e-mail — many shops have none) replaced:
  «سياسة الإرجاع والاستبدال», «الشروط والأحكام», «سياسة الخصوصية», «الشحن والتوصيل».
  Written for cash on delivery in Algeria. Linked from every footer; French/English
  versions follow the website language.

### A4. Social links and map in the shop settings (request 6, second half)
- Move Facebook / Instagram / TikTok / WhatsApp / map link / opening hours from the
  website page to «الإعدادات ← معلومات المحل» in a folded box «مواقع التواصل والعنوان».
- One place for the data (store_config); the website reads it at each update; old values
  in `website.publicInfo` are moved once (migration) so nothing is lost.
- Tests: the values typed in the settings appear on the published pages after an update.

### A5. 58 wilayas → 1541 communes (request 8)
- Built-in list of the 1541 communes per wilaya (official names, Arabic + Latin), from an
  open dataset (licence checked, source noted), ~60 KB, shipped with the program and the
  website (`communes.json`, loaded only on the order form).
- Website order forms and the shop settings: the commune becomes a list filtered by the
  chosen wilaya (search inside it on phones). The Worker checks the commune belongs to the
  wilaya.

## Phase B — the program

### B1. Page headers (request 5)
- Remove the big repeated title + explanation under the top bar on every page **except the
  dashboard**. The page's own buttons move up to that line (left/right as today, RTL aware).
- Shorter, professional titles (list to be applied in `src/i18n`, e.g. «المخزون» not
  «إدارة المخزون والكميات»). Remove explanation texts that say nothing useful;
  keep short hints only where a mistake costs money.

### B2. Layout faults (request 4)
- Automated sweep of every page and dialog in Arabic / French / English at 1024, 1366 and
  1920 px: amounts overflowing their card, buttons outside dialogs, side-by-side boxes of
  different heights, titles wrapping differently by language.
- Fixes: amounts use a fitting text size + `tabular-nums`, never overflow; dialogs get a
  sticky footer for Save/Close; grids use equal-height rows; titles get one-line truncation
  with a tooltip. The sweep becomes a repeatable check (0 problems = pass).

### B3. Website page accounts tab (request 6, first half)
- GitHub and Cloudflare side by side as two equal cards on wide screens (one per line on
  narrow ones), with a 3-step progress line «الحسابان ← إنشاء الموقع ← الموقع يعمل».
  Domain card below, full width. No half-empty page.

### B4. Log in / log out (request 9)
- Log in: opening cash pre-filled (last closing), one «ابدأ» button.
- Log out: one screen (expected amount, counted amount, difference shown live), one button
  «أغلق الصندوق واخرج» that closes the drawer and logs out. **No printing** at log in or log
  out (the Z report stays available from «سجل المبيعات» on demand).

### B5. Remove training (request 10a)
- Remove the training mode completely: pages, banner, picker, exercises, the sandbox code
  in the main process, its menu entry, translations and tests. The demo shop stays.

### B6. Full redesign pass + research (request 7)
- A short study of popular shop/POS programs (Shopify POS, Square, Loyverse, Odoo POS,
  Algerian POS tools) → concrete proposals (pages to merge, add or simplify), delivered as a
  report; the agreed ones are applied in Phase B, the rest listed for later.

## Phase C — full audit and proposals (request 10b)
- Code, database, links between pages, every button (automated click-through: each button
  does something or is removed), simplicity for non-technical workers.
- Delivered as an Arabic report: each proposal has a title, what the worker sees today,
  what changes, why it is simpler. Skills used: improve-codebase-architecture (structure),
  simplify (code clean-up), ui-ux-pro-max (design rules), verification-before-completion
  (proof before saying done), build-dashboard (the audit results as a page).

## Testing (every phase)
- Unit tests for each data rule (visibility, ranking, communes, legal pages, social links).
- Browser end-to-end of the published site in every theme, Arabic/French, phone/desktop.
- In-app end-to-end (Electron) for the program changes; regression cycles stay green.
- Lint, build; commit and pull request per phase, merged after the checks.

## Out of scope
- Copying paid Shopify themes (licence).
- Changing the order flow to the program (verified on workerd, 2026-10-17).
