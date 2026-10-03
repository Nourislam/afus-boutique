# Store POS

An offline point of sale for clothing stores, built as a Windows desktop application
(Electron + React + SQLite). It works without an account, without activation and without
internet: all data lives in a local database on the shop's computer.

## Features

- **First-launch shop setup** – shop name and logo (required), owner, phone, address,
  wilaya/city, currency, tax, receipt texts and printers. Editable later in *Settings*.
- **Clothing catalog** – products with colour × size variants. Each variant has its own SKU,
  QR identifier, optional barcode, price, cost, stock and minimum stock. Products without
  variants work as simple products.
- **Variant-level inventory** – sales, returns, goods receiving, purchase returns and manual
  adjustments move the stock of the exact variant and are recorded in the stock history.
  Low-stock alerts per variant.
- **QR codes** – generated locally (bwip-js). A QR contains only the variant's stable
  identifier (its SKU at creation time), never price or stock, so labels stay valid when
  prices change.
- **QR labels** – sizes in millimetres (30×20, 40×30, 50×30, … or custom), label rolls or
  A4 sticker sheets, printed through Electron to any Windows printer, or saved as PDF.
- **USB scanners** – standard keyboard-wedge barcode/QR scanners, no SDK. Codes are read
  correctly even when Windows uses an Arabic or French (AZERTY) keyboard layout.
- **Receipts** – 58/80 mm thermal receipts with the shop logo and details, variant and SKU
  per line, optional automatic printing after each sale.
- Customers, credit sales, gift cards, promotions, bundles, suppliers, purchase orders,
  reports, employees with PIN login and roles (admin / manager / cashier).

## Development

Requirements: Node.js 22, npm.

```bash
npm ci                 # install dependencies
npm run electron:dev   # Vite dev server + Electron
npm test               # unit tests (vitest)
npm run lint
npm run electron:build # production build + installer for the current OS
```

The Windows installer (NSIS) is produced by `npm run electron:build` on Windows, or by the
`Release` GitHub workflow (runs on `windows-latest` when a `v*` tag is pushed). Building the
Windows installer on Linux requires Wine. Customers only need the installer – no Node.js or
other tools.

## Data

- Database: `%APPDATA%\StorePOS\pos-database.sqlite` (product images and the logo are in
  `%APPDATA%\StorePOS\images`).
- Installations created by the previous product name are copied into this folder on first
  start (the old folder is left untouched).
- Schema changes are versioned in `electron/database/migrations.js`; a backup copy of the
  database file is written before an existing database is upgraded.
- Settings › Backup exports/imports the database.

## Project structure

```
electron/
  main.js                 IPC handlers, window, printing entry points
  preload.js              contextIsolation bridge (window.electronAPI)
  database/
    init.js               load/save, legacy migrations, transactions
    migrations.js         versioned migrations (variants, ...)
    api.js                strict DB adapter used by services
  services/
    catalogService.js     variants, SKU generation, identifier checks, code lookup, stock moves
    labelService.js       QR label layout (mm) and printing / PDF
    receiptService.js     receipts and documents
  sync/SyncManager.js     optional sync boundary (disabled, see below)
src/
  pages/                  POS, Products, Inventory, QR Labels, Settings, ...
  components/products/    product form, variant editor, QR preview
  components/settings/    shop, printer, scanner forms
  hooks/useBarcodeScanner.js, lib/scanner.js   keyboard-wedge scanner handling
tests/                    vitest tests for migrations, catalog and scanner logic
```

## Future online store

The local POS is the authoritative system. A future online store must talk to a secure
cloud API fed by a synchronization service – it must never access the local SQLite file.
`electron/sync/SyncManager.js` is the boundary for that: it tracks unsynced rows
(`is_synced`) and hands batches to a transport. No transport is bundled, so sync is off and
nothing leaves the computer.

## License

MIT. This application is based on open-source software originally published as
"POSbyCirvex" – see [LICENSE.txt](LICENSE.txt) for the original copyright notice, which must
be kept with copies of the software.
