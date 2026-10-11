import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Afus Boutique is a stand-alone, offline-first product: nothing in its core
// may need an account, an activation or a server. Only the optional online
// modules (online store, e-mail) may open a network connection.
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function filesUnder(dir) {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) return filesUnder(rel);
        return /\.(js|jsx|mjs|cjs|html)$/.test(entry.name) ? [rel] : [];
    });
}
const CODE = [...filesUnder('src'), ...filesUnder('electron'), 'index.html'];

// Where a network connection is allowed, and why
const NETWORK_ALLOWED = {
    'electron/ecommerce/adapters/ShopifyAdapter.js': 'online store (optional module)',
    'electron/ecommerce/adapters/WooCommerceAdapter.js': 'online store (optional module)',
    'electron/services/emailService.js': 'tickets and purchase orders by e-mail (optional module)',
    'electron/main.js': 'e-mail sending handlers only (nodemailer), see the next test',
    // Asked by the shop (Settings › About › check), only when the reseller's
    // installer profile gives an https address; nothing is installed by itself
    'electron/services/updateService.js': 'optional update check, on demand',
};
const NETWORK = /\bfetch\s*\(|node-fetch|nodemailer|axios|XMLHttpRequest|new WebSocket|EventSource|\bhttps?\.(request|get)\s*\(|net\.request|autoUpdater|electron-updater|sendBeacon/;

describe('offline-first core', () => {
    it('opens network connections only in the optional online modules', () => {
        const found = CODE.filter(f => NETWORK.test(read(f)));
        expect(found.filter(f => !NETWORK_ALLOWED[f])).toEqual([]);
    });

    it('the main process only uses the network to send e-mails, never at startup', () => {
        const main = read('electron/main.js');
        expect(main).not.toMatch(/\bfetch\s*\(|axios|https?\.(request|get)\s*\(|net\.request|autoUpdater/);
        // nodemailer transports are only created inside the e-mail handlers
        const transports = [...main.matchAll(/nodemailer\.createTransport/g)].map(m => main.lastIndexOf("ipcMain.handle('", m.index));
        for (const at of transports) expect(main.slice(at, at + 40)).toMatch(/email|mail/i);
    });

    it('no server address is built into the program (only help links for the online store)', () => {
        const urls = CODE.flatMap(f => [...read(f).matchAll(/https?:\/\/[^\s'"`)]+/g)].map(m => [f, m[0]]))
            .filter(([, url]) => !/^https?:\/\/(localhost|127\.0\.0\.1|www\.w3\.org)/.test(url));
        // wa.me: the credit reminder only hands a WhatsApp link to the system (the program connects to nothing)
        const allowed = /shopify\.dev|help\.shopify\.com|woocommerce\.(com|github\.io)|your-store\.com|^https:\/\/wa\.me\b/;
        expect(urls.filter(([, url]) => !allowed.test(url))).toEqual([]);
    });

    it('needs no account, activation, subscription or plan limit', () => {
        const pattern = /activation_data|licen[cs]e_?key|subscription_?(status|plan)|plan_?limit|max_?(products|employees)|entitlement/i;
        // The one migration that deletes the old activation data is the only allowed mention,
        // with the optional offline licence of a reseller (Settings › About), which only shows a status
        const LICENCE_SCREENS = ['src/components/settings/AboutSettings.jsx', 'src/i18n/messages/about.js'];
        const found = CODE.filter(f => f !== 'electron/database/migrations.js' && !LICENCE_SCREENS.includes(f) && pattern.test(read(f)));
        expect(found).toEqual([]);
    });

    it('the offline licence never blocks anything: no check uses it', () => {
        // Only the About screen reads it; sales, stock, backups and the role checks never do
        for (const f of CODE.filter(f => f !== 'electron/main.js' && f !== 'electron/services/licenseService.js')) {
            expect(read(f), f).not.toMatch(/licenseService|licenseStatus/);
        }
        const main = read('electron/main.js');
        // Each use sits in the licence function or the two About handlers
        for (const m of main.matchAll(/(?<!function )licenseStatus\(\)|licenseService\.check/g)) {
            const before = main.slice(Math.max(0, m.index - 400), m.index);
            const owner = [...before.matchAll(/ipcMain\.handle\('([^']+)'|function (\w+)/g)].pop();
            expect(owner && (owner[1] || owner[2])).toMatch(/^(about:info|license:set|licenseStatus)$/);
        }
    });

    it('bundles no cloud sync transport: nothing leaves the computer', () => {
        expect(read('electron/sync/SyncManager.js')).toMatch(/const SUPPORTED_PROVIDERS = \[\];/);
    });
});

describe('licence', () => {
    it('keeps the original MIT notice of the source project and its terms', () => {
        const licence = read('LICENSE.txt');
        expect(licence).toMatch(/^MIT License\n/);
        expect(licence).toContain('Copyright (c) 2024 Cirvex Inc.');
        expect(licence).toContain('Permission is hereby granted, free of charge, to any person obtaining a copy');
        expect(licence).toContain('The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.');
        expect(licence).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND');
    });

    it('ships the licence file with the application', () => {
        const pkg = JSON.parse(read('package.json'));
        expect(pkg.license).toBe('MIT');
        expect(pkg.build.files).toContain('LICENSE.txt');
    });
});
