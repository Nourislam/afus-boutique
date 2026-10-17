# Phase B — the program (requests 4, 5, 6a, 7, 9, 10a) Implementation Plan

> Spec: `docs/superpowers/specs/2026-10-17-website-and-program-overhaul-design.md` (Phase B).
> Executed inline; each task verified (tests, lint, in-app e2e) before the next.

**Goal:** fewer words and clicks for the shop worker: no repeated page headers, a one-press drawer,
no training mode, tidy layouts in the three languages.

### Task B1 — page headers
- `src/components/ui/PageHeader.jsx`: one compact row. Without `hero`, no icon, title or subtitle
  (the sidebar already names the page): only the page's tabs (left) and its buttons (right), on one
  line; nothing at all when a page has neither. `hero` (dashboard only) keeps today's header.
- `DashboardPage.jsx` passes `hero`. Pages that put tools under the header (`children`) keep them on
  the same row as the buttons.
- Titles in `src/i18n` shortened where the sidebar or tabs repeat them; explanation lines that say
  nothing useful removed.
- Test: every route renders without the old `h1` page title except `/` (in-app e2e).

### Task B4 — log in / log out
- `OpeningCashDialog.jsx`: amount pre-filled with the last count (already), title + one line, one
  «ابدأ» button (Enter works), no number pad when a keyboard is used? kept (touch screens).
- `ShiftSummaryDialog.jsx` mode `logout`: expected amount shown at once, counted amount typed
  once, difference live, one button «أغلق الصندوق واخرج» (no reveal step), no «keep open», no
  Z printing (the Z stays in the history). Mode `close` (handover) the same, one button.
- In-app e2e: login = PIN then «ابدأ»; logout = count then one button; no print job.

### Task B5 — remove training
- Remove `src/components/training/*`, `src/stores/trainingStore.js`, `src/lib/trainingExercises.js`,
  the login / sidebar / layout entries, `electron/services/trainingService.js`, the training IPC
  and preload API, `startSandbox/stopSandbox` in `electron/database/init.js` (`isSandbox` kept as
  `() => false` only where a guard reads it, then removed), trial "training" window, receipt
  training mark, i18n keys, training tests. Demo shop untouched.
- Tests: full suite green; grep finds no "training" outside history/docs.

### Task B3 — website accounts tab
- `WebsitePage.jsx` accounts tab: a 3-step progress line, GitHub and Cloudflare as two equal cards
  (`grid md:grid-cols-2`, `h-full`), domain card full width below.

### Task B2 — layout sweep
- Script (scratch e2e) visiting every route + main dialogs in ar/fr/en at 1024/1366/1920 and
  reporting: text overflowing its card (`scrollWidth > clientWidth`), buttons outside a dialog,
  unequal heights of boxes in one grid row, titles wrapping in one language only.
- Fixes in shared components first (`StatTile`, `Modal` sticky footer, grid `items-stretch`,
  amounts `tabular-nums` + fitting size), then per page. Re-run until 0.

### Task B6 — research + proposals
- Report `docs/proposals/2026-10-program-review.md` (Arabic): what similar programs do
  (Loyverse, Square, Shopify POS, Odoo POS), pages to merge / add / simplify.

### Verify
`npm test`, `npm run lint`, `npm run build`, in-app cycles (login/logout, sale, products,
settings, website), screenshots reviewed; commit, PR, merge.
