# Phase A — website (requests 1, 2, 3, 6b, 8) Implementation Plan

> Spec: `docs/superpowers/specs/2026-10-17-website-and-program-overhaul-design.md` (Phase A).
> Executed inline (executing-plans), verified per task (verification-before-completion).

**Goal:** real pictures and Dawn-like themes, per-article website visibility, Afus footer and
legal pages, social links/map/hours in the shop settings, 1541 communes per wilaya.

**Architecture:** everything published goes through the existing public-data line
(`publicData/internal.js` → `public.js` → `guard.js`) and the pure renderer
(`storefront/*`). New data enters only as named, cleaned public fields (PUBLIC_SHAPE).

**Tech stack:** Electron main (CommonJS), sql.js, React renderer, vitest, Playwright.

---

### Task A2 — «يظهر في الموقع» per article
Files: `electron/database/migrations.js` (migration `2026_10_product_on_website`:
`products.show_on_website INTEGER NOT NULL DEFAULT 1`), `electron/services/catalogService.js`
(saveProduct writes it; missing = 1), `electron/website/publicData/internal.js`
(readProducts / readVariants: `AND COALESCE(p.show_on_website, 1) = 1`),
`src/components/products/ProductFormModal.jsx` (checkbox, default on),
products list badge + filter, i18n.
Tests (`tests/websiteVisibility.test.js`): hidden article absent from products, its
category/brand/sizes/colours gone when it was the only one; best sellers [h1,h2,v3] → [v3];
saveProduct keeps 1 by default and stores 0 when unticked.

### Task A1 — pictures and themes
Files: `electron/website/storefront/photos/*.webp` + `CREDITS.md` (Unsplash licence),
`electron/website/storefront/photos.js` (pick a built-in photo for a slot: hero / a
category by its name in ar/fr/en / any), `publicData/public.js` (`shop.hero = { image,
title, subtitle }` from `info.hero`), `storefront/sections.js` (hero and category tiles:
shop picture → product photo → built-in photo; `photos/<file>` paths), `publish/siteBuilder.js`
(publishes only the built-in photos the pages use), `storefront/css.js` (Dawn-like hero with
text over the picture, tiles with pictures, second photo on hover), website Design tab card
«صورة الواجهة» (picture + title + subtitle), service `setHero`.
Tests: every theme's home has an `<img` in the hero with no shop photo; the built-in photo
file is in the build; the shop's hero replaces it; no `photos/` file published when unused.

### Task A3 — footer and legal pages
Files: `storefront/legal.js` (4 Arabic/French/English texts with `{shopName}` / `{contact}`),
`storefront/pages.js` (STORE_PAGES returns, terms, privacy, shipping), `components.js`
footer: links + «© year shop · صُنع بواسطة Afus Boutique» with the inline SVG logo.
Tests: each page in pagesOf, contact = email or phone, every footer has the 4 links and
the Afus mark in every theme.

### Task A4 — social / map / hours in the shop settings
Files: store_config keys `shopHours`, `shopFacebook`, `shopInstagram`, `shopTiktok`,
`shopMapUrl` (`internal.js` STORE_KEYS), `public.js shopOf` (store first, old
`info` values as fallback), one-time copy in `websiteService` (old publicInfo → store_config
when empty), `ShopInfoForm.jsx` folded box «مواقع التواصل والعنوان», website Settings
«info» tab removed (couriers move to the delivery tab), i18n.
Tests: values in store_config appear on the published pages; old values are copied once.

### Task A5 — 1541 communes
Files: `electron/shared/communes.json` (open dataset, licence noted), storefront
`assets/communes.json` published, order forms: commune `<select>` filled by the script for
the chosen wilaya (text input kept without script), Worker check (commune of that wilaya when
the list is known), `ShopInfoForm` commune Combobox filtered by wilaya.
Tests: 1541 rows, 58 wilayas; Worker refuses a commune of another wilaya; form fallbacks.

### Task A6 — verification
`npm test`, `npm run lint`, `npm run build`, theme screenshots (all themes, ar/fr,
phone/desktop) reviewed, browser e2e `store.cjs`, in-app e2e of the product checkbox and
settings box; code review of the diff; commit, PR, merge.
