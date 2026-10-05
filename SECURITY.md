# Security Policy – Afus Boutique

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x | ✅ |
| < 1.1 | ❌ |

Only the latest 1.1.x version receives security fixes. The application has no auto-update: a
fix is delivered as a new installer.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately on GitHub: **Security › Report a vulnerability** in this repository
(GitHub private vulnerability reporting). Include the version, the operating system, the steps
to reproduce and what an attacker could do.

We aim to acknowledge a report within 7 days and to tell you whether it is accepted, what will
be fixed and when. Please give us a reasonable time to deliver a fixed installer before
disclosing the problem publicly.

## Security model

Afus Boutique is an offline desktop application:

- **No account, no server, no telemetry.** The shop's data stays on its computer, in
  `%APPDATA%\AfusBoutique` (macOS: `~/Library/Application Support/AfusBoutique`). Nothing is
  sent over the internet unless the shop configures an optional service itself (e-mail,
  online store connection).
- **No auto-update** and no download at run time; the installed application does not point to
  any repository.
- **Isolated interface.** The interface runs with `contextIsolation`, without Node.js
  integration, and talks to the main process only through the functions listed in
  `electron/preload.js`. A Content-Security-Policy blocks scripts and connections from outside
  the application. Documents to print (tickets, labels) are rendered in sandboxed windows,
  labels with scripts disabled.
- **Local database.** Every sale, return, payment and purchase order is written in a single
  transaction, and the database is checked against negative stock and over-returns.

## Known limitations

- The database file is **not encrypted**. Anyone with access to the Windows/macOS user account
  can read it: protect the computer with a password and keep backups in a safe place.
- Employee **PIN codes are stored without hashing** in the local database. They protect the
  screens from other employees, not the database file itself.
- Optional service credentials (e-mail password, store API keys) are stored in the
  local database, not in the operating system's keychain.
- The installer is not yet code-signed, so Windows SmartScreen shows a warning on install.
