/**
 * Afus Boutique identity, read by the main process.
 *
 * Single source: electron/shared/brand.json (also imported by the interface
 * through src/config/brand.js). package.json repeats name, appId, productName
 * and executableName for electron-builder; tests/brand.test.js checks that
 * the two stay the same. See docs/NAMING.md for the other Afus products.
 */
const path = require('path');
const BRAND = require('./shared/brand.json');

/** Folder of the shop's data: %APPDATA%\AfusBoutique (macOS: ~/Library/Application Support/AfusBoutique). */
function dataDirectory(appDataPath) {
    return path.join(appDataPath, BRAND.dataDirName);
}

/** The SQLite database file inside the data folder. */
function databasePath(userDataPath) {
    return path.join(userDataPath, BRAND.databaseFile);
}

module.exports = { BRAND, dataDirectory, databasePath };
