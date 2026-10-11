# Signing the installers and reseller profiles

Nothing secret is stored in this repository. Certificates and keys are given
to the build through environment variables on the publisher's computer.

## Windows (Authenticode)

electron-builder signs the `.exe` when these variables are set:

- `CSC_LINK` — path (or base64) of the `.pfx` / `.p12` code-signing certificate
- `CSC_KEY_PASSWORD` — its password

Without them the installer is built unsigned (Windows SmartScreen then warns
the first time). An EV certificate removes the SmartScreen warning at once.

## macOS (Developer ID + notarization)

- `CSC_LINK`, `CSC_KEY_PASSWORD` — the "Developer ID Application" certificate
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — for notarization

The hardened runtime and `signing/entitlements.mac.plist` are already set in
`package.json`.

## Reseller profile (support contacts, updates, licence)

1. Copy `signing/profiles/example.json` to `signing/profiles/<reseller>.json` and
   fill it in (`updateUrl` must be `https://`).
2. `node scripts/use-profile.mjs <reseller>` before `npm run electron:build`.
3. `node scripts/use-profile.mjs default` to go back to the neutral profile.

The update address points at a JSON file the reseller publishes:

```json
{ "version": "1.2.0", "url": "https://…/Afus Boutique Setup 1.2.0.exe", "notes": "…" }
```

The program only shows the new version and opens the download page; it never
installs anything by itself.

## Offline licences (optional)

- `node scripts/license.mjs keys <folder outside the repository>` creates the
  key pair. Keep `private.pem` secret.
- Put the content of `public.pem` in the profile (`licensePublicKey`).
- `node scripts/license.mjs sign <private.pem> "Shop name" standard 2027-12-31`
  prints a licence key to give to the shop.

A missing, wrong or expired licence never blocks sales, stock or data: it is
only shown in Settings › About.
