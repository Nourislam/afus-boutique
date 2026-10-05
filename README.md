# Afus Boutique

**Afus Boutique** is the [Afus](docs/NAMING.md) application for clothing and accessory shops:
an offline point of sale and stock manager for Windows and macOS (Electron + React + SQLite).
It works without an account, without activation and without internet: all data lives in a
local database on the shop's computer.

> **بالعربية:** Afus Boutique برنامج من شركة Afus لمحلات الملابس والإكسسوارات: بيع، مخزون
> بالألوان والمقاسات، ملصقات QR وباركود، تذاكر، كريدي، تقارير. يعمل بدون إنترنت وبدون حساب،
> وكل البيانات تبقى على حاسوب المحل. الواجهة بالعربية (من اليمين إلى اليسار) والفرنسية والإنجليزية.

## Features

- **Shop setup on first launch** – name and logo, owner, address and wilaya, legal numbers,
  currency (DZD by default), tax, ticket texts, printers. Editable later in *Settings*.
- **Three languages** – Arabic (right to left), French and English; light, dark or system theme.
- **Clothing catalogue** – articles with colour × size variants; each variant has its own SKU,
  QR identifier, optional barcode, price, cost and stock. Brands, categories, the shop's own
  colours and size sets, suppliers and customers in one *Catalogue* screen.
- **Stock per variant** – sales, returns, goods receiving, purchase returns and manual
  adjustments move the stock of the exact variant and are kept in the stock history; low-stock
  alerts per variant. A sale can never take more than the stock, and a return never more
  pieces than were sold.
- **Labels and barcodes** – QR, EAN-13, Code 128, Code 39 or DataMatrix, one code per variant
  or per article; codes missing on existing articles are created when printing. Label size,
  shape and content are set once in *Settings*; roll printers or A4 sticker sheets, or PDF.
  Codes only hold the article's identifier, never the price, so labels stay valid when prices
  change.
- **USB scanners** – any keyboard-mode (HID) barcode/QR scanner, no driver or SDK. Codes are
  read correctly even when Windows uses an Arabic or French (AZERTY) keyboard layout.
- **Tickets** – 58/80 mm thermal tickets with the shop logo, printed directly, previewed or
  not printed, as chosen in *Settings*.
- **Sales screen** – cash, card, transfer, gift card, split payment and customer credit
  (*kridi*, allowed by a manager or admin), tickets on hold, cash drawer opened at login and
  closed at logout.
- Customers and credit, gift cards, promotions and packs, suppliers and purchase orders,
  reports, employees with PIN login and roles (admin / manager / cashier), backups.

## Installing (shops)

One installer, `Afus Boutique Setup <version>.exe`, for Windows 10 and 11 (64-bit, 32-bit and
ARM), which can be copied to a USB key. The shop needs nothing else: no Node.js, no internet.
The program is `AfusBoutique.exe`; uninstalling keeps the shop's data.

macOS: `Afus Boutique.app` in `Afus-Boutique-<version>-<arch>.dmg` (Intel and Apple silicon).

The printers (ticket and label) must be installed in Windows or macOS with their driver;
scanners work in their default keyboard (HID) mode.

## Development

Requirements: Node.js 22, npm.

```bash
npm ci                 # install dependencies
npm run electron:dev   # Vite dev server + Electron
npm test               # unit tests (vitest)
npm run lint
npm run electron:build:win -- --publish never   # Windows installer (run on Windows)
node scripts/generate-icons.js                  # icons from public/icon.svg
```

Building the Windows installer on Linux requires Wine; build it on Windows or with GitHub
Actions. Nothing is ever published: the application has no auto-update.

| Workflow | When | Result |
|---|---|---|
| `Build Windows Installer` | started by hand (*Actions › Run workflow*), or when the workflow file changes | artifact `Afus-Boutique-Setup-<version>-win-x64` |
| `Release` | a `v*` tag is pushed | Windows, macOS and Linux files as artifacts |
| `CI` | pushes and pull requests to `main` | lint, tests, Windows build |

## Data

- Database: `%APPDATA%\AfusBoutique\afus-boutique.db`; images and logo in
  `%APPDATA%\AfusBoutique\images` (macOS: `~/Library/Application Support/AfusBoutique`).
  The folder also holds the window settings and browser storage. It is independent of any
  other application: nothing is imported automatically.
- Every sale, return, payment and purchase order is written in one transaction: either all of
  it is saved or nothing is.
- Schema changes are versioned in `electron/database/migrations.js`; a copy of the database
  file is written before an existing database is upgraded.
- *Settings › Backup* exports (`afus-boutique-backup-<date>.db`) and restores the database.

## Identity

The product identity (company, product name, app id, data folder, database file) is defined once
in `electron/shared/brand.json`, read by the main process (`electron/brand.js`) and the interface
(`src/config/brand.js`). `package.json` repeats what electron-builder needs; `tests/brand.test.js`
checks they match. Naming rules for the other Afus products: [docs/NAMING.md](docs/NAMING.md).

## Project structure

```
electron/
  main.js                 IPC handlers, window, printing entry points
  preload.js              contextIsolation bridge (window.electronAPI)
  brand.js, shared/       product identity, clothing reference data
  database/               init (load/save, transactions), migrations, strict adapter
  services/               catalogue, labels, receipts, printing, shifts, ...
src/
  pages/                  sales, products, stock, labels, catalogue, reports, settings, ...
  components/             screens' parts (products, labels, settings, POS, ...)
  i18n/                   Arabic / French / English texts
  hooks/useBarcodeScanner.js, lib/scanner.js   keyboard-mode scanner handling
tests/                    vitest tests (migrations, catalogue, scanner, printing, identity)
docs/NAMING.md            naming rules for Afus products
```

## Future online store

The local application is the authoritative system. A future online store must talk to a secure
cloud API fed by a synchronization service – it must never access the local SQLite file.
`electron/sync/SyncManager.js` is the boundary for that; no transport is bundled, so sync is off
and nothing leaves the computer.

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT – see [LICENSE.txt](LICENSE.txt). Part of the code comes from earlier MIT-licensed
open-source software; its copyright notice is kept in LICENSE.txt, as that license requires.
