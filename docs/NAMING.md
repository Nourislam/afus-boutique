# Afus product naming

Afus is the company. Each product is a separate application with its own identity, so two
Afus products installed on the same computer never share an installation, a data folder or a
database.

## Rules

| Field | Rule | Afus Boutique |
|---|---|---|
| Company | `Afus` | Afus |
| Product name | `Afus <Product>` | Afus Boutique |
| npm package name | `afus-<product>` (lowercase) | afus-boutique |
| App ID | `dz.afus.<product>` – one per product, never shared | dz.afus.boutique |
| Executable | `Afus<Product>.exe` | AfusBoutique.exe |
| Windows installer | `Afus <Product> Setup <version>.exe` | Afus Boutique Setup 1.1.2.exe |
| macOS application | `Afus <Product>.app` in `Afus-<Product>-<version>-<arch>.dmg` | Afus Boutique.app |
| Data folder | `%APPDATA%\Afus<Product>` (macOS `~/Library/Application Support/Afus<Product>`) | AfusBoutique |
| Database file | `afus-<product>.db` | afus-boutique.db |
| File prefix (backups, temporary files) | `afus-<product>` | afus-boutique |

## Planned products

| Product | npm name | App ID | Executable | Data folder | Database |
|---|---|---|---|---|---|
| Afus Boutique | afus-boutique | dz.afus.boutique | AfusBoutique.exe | AfusBoutique | afus-boutique.db |
| Afus Farm | afus-farm | dz.afus.farm | AfusFarm.exe | AfusFarm | afus-farm.db |
| Afus POS | afus-pos | dz.afus.pos | AfusPOS.exe | AfusPOS | afus-pos.db |
| Afus Stock | afus-stock | dz.afus.stock | AfusStock.exe | AfusStock | afus-stock.db |
| Afus Restaurant | afus-restaurant | dz.afus.restaurant | AfusRestaurant.exe | AfusRestaurant | afus-restaurant.db |

## Starting a new product from this code base

1. Edit `electron/shared/brand.json` (all fields of the table above).
2. Copy the same `name`, `build.appId`, `build.productName` and `build.executableName` into
   `package.json` – `npm test` fails until they match.
3. Replace `public/icon.svg` (and `public/icon-light.svg`) with the product's logo, then run
   `node scripts/generate-icons.js`.
4. Update the artifact name/path in `.github/workflows/build-windows-installer.yml`.

The interface reads the name from `src/config/brand.js` and the main process from
`electron/brand.js`; nothing else needs the product name.
