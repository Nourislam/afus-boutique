import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const BRAND = require('../electron/shared/brand.json');
const pkg = require('../package.json');
const { dataDirectory, databasePath } = require('../electron/brand');

// Names of products this code base no longer belongs to
const OLD_NAMES = /storepos|store-pos|store_pos|com\.storepos|hanout|cirvex|storeclothes/i;

function filesUnder(dir) {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(rel) : [rel];
    });
}

describe('product identity', () => {
    it('package.json uses the identity of electron/shared/brand.json', () => {
        expect(pkg.name).toBe(BRAND.packageName);
        expect(pkg.productName).toBe(BRAND.productName);
        expect(pkg.build.win.publisherName).toBe(BRAND.companyName);
        expect(pkg.build.appId).toBe(BRAND.appId);
        expect(pkg.build.productName).toBe(BRAND.productName);
        expect(pkg.build.executableName).toBe(BRAND.executableName);
        expect(pkg.build.nsis.shortcutName).toBe(BRAND.productName);
        expect(pkg.author.name).toBe(BRAND.companyName);
    });

    it('follows the Afus naming rules (docs/NAMING.md)', () => {
        expect(BRAND.appId).toMatch(/^dz\.afus\.[a-z]+$/);
        expect(BRAND.productName).toMatch(/^Afus /);
        expect(BRAND.packageName).toBe(BRAND.productName.toLowerCase().replace(/\s+/g, '-'));
        expect(BRAND.executableName).toBe(BRAND.productName.replace(/\s+/g, ''));
        expect(BRAND.dataDirName).toBe(BRAND.executableName);
        expect(BRAND.databaseFile).toBe(`${BRAND.packageName}.db`);
    });

    it('keeps the data in its own folder and database file', () => {
        expect(dataDirectory('/appdata')).toBe(path.join('/appdata', 'AfusBoutique'));
        expect(databasePath(path.join('/appdata', 'AfusBoutique'))).toBe(path.join('/appdata', 'AfusBoutique', 'afus-boutique.db'));
    });

    it('no former product name is left in the application, build or documentation', () => {
        const files = [
            ...filesUnder('electron'), ...filesUnder('src'), ...filesUnder('scripts'), ...filesUnder('.github'), ...filesUnder('docs'),
            'package.json', 'index.html', 'vite.config.js', 'README.md',
        ].filter(f => !/\.(png|ico|jpg|wasm)$/.test(f));
        const found = files.filter(f => OLD_NAMES.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
        expect(found).toEqual([]);
    });
});
