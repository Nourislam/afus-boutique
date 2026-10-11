# Afus Boutique: modules that need something outside the shop's computer

Afus Boutique works fully offline on one computer. The local database is the source of truth.
This file lists what is done locally and what cannot be switched on without an outside service
(a server, an account, a certificate). Nothing below sends data anywhere today.

| Item | State | What is done locally | What is missing (outside) |
|---|---|---|---|
| Several computers in one shop | Designed, not enabled | `electron/sync/SyncManager.js`: tracks local changes (`is_synced = 0`) in batches; no transport is bundled (`SUPPORTED_PROVIDERS = []`) | A server that every till talks to (in the shop or online), and a transport for it |
| Cloud backup | Local route available | Daily backup plus a copy of the backup and the pictures to an external folder (`Backups/external-copy.json` records success or failure). That folder can be a USB key or the folder of a sync client (Google Drive / OneDrive desktop) | An online storage account owned by the shop, if the copy must go through the program itself |
| Owner's phone view | Not started | The Z report (closing) can be printed or saved as a PDF | A hosted service and an account per shop, with HTTPS (certificate) |
| Loyalty | Done | 1 point per 100 DA, taken back on a return, converted to a voucher at a value set by the owner (Settings › Sales screen) | — |
| Accounting | Management reports done | Reports screen, plus a sales journal for the accountant (Excel: excl. TVA, TVA, total, payment method, returns as negative lines) | Tax declarations (G50, annual statements) are the accountant's and are not produced |
| Native SQLite | Not needed (measured) | sql.js at 3 years of a busy shop, see below | — |

## Several computers: conditions before enabling

1. One authority. Each ticket number, stock movement and kridi payment is written once, by
   the server, or by a single "main" till that the others reach on the shop's network. Two
   databases merged later would give two tickets the same number and stock counted twice.
2. Every table that holds money must be synced. The list in `SyncManager.syncTables` does not
   yet include `payments`, `exchanges`, `cash_expenses`, `gift_card_transactions`,
   `reservations`, `reservation_items`, `stock_counts`, `shifts` or `settings`. These must be
   added, with `is_synced`, before any transport is enabled.
3. Offline till: it keeps selling and sends its queue later. A stock or kridi conflict is
   resolved by the server, never by the last write.
4. The role rules (`electron/services/ipcGuard.js`) must be applied again by the server.

## Measured performance (sql.js, 3 years of a busy shop)

The data: 49,275 tickets (45 a day for 3 years; a small boutique sells 10 to 40), 3,600
pieces (600 articles × 6 variants) and 3,000 customers. The database file is 18.3 MB.
Script: `npx vite-node scripts/perf-3years.mjs`. Each time is the median of several runs.

| Action | Time |
|---|---|
| Save a sale (ticket, stock, write to disk) | 70 ms |
| Save an article with 6 variants (write to disk) | 92 ms |
| Return of one piece (debt, points, write to disk) | 93 ms |
| History: first page (count and 50 rows) | 18 ms |
| History: search for the oldest ticket | 76 ms |
| Dashboard, first tab (alerts) | about 270 ms |
| Dashboard, all four tabs together | 818 ms |
| Reports: one year | 128 ms |
| Sales journal: one year | 330 ms |
| Backup (copy of the file) | 121 ms |

Every action stays under one second, so native SQLite (a compiled module per platform) is
not needed. The slowest queries are the dashboard's 30-day sales figures (about 250 ms each).
They compare `datetime(created_at)`, which does not use the date index. They would only be
reworked if a real shop turns out slower.
