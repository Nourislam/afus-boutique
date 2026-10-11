#!/usr/bin/env node
// Installer profile of a reseller: copies signing/profiles/<name>.json to
// electron/shared/profile.json before building (support contacts, update
// address, licence public key). "default" puts the empty profile back.
//   node scripts/use-profile.mjs <name>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
const target = path.join(root, 'electron/shared/profile.json');
const EMPTY = { reseller: '', supportPhone: '', supportEmail: '', supportWebsite: '', updateUrl: '', licensePublicKey: '' };
if (!name) { console.error('usage: use-profile.mjs <name>|default'); process.exit(1); }
let profile = EMPTY;
if (name !== 'default') {
    const file = path.join(root, 'signing/profiles', `${path.basename(name)}.json`);
    if (!fs.existsSync(file)) { console.error(`No profile ${file}`); process.exit(1); }
    profile = { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    if (profile.updateUrl && !/^https:\/\//.test(profile.updateUrl)) { console.error('updateUrl must be https://'); process.exit(1); }
}
fs.writeFileSync(target, `${JSON.stringify(profile, null, 2)}\n`);
console.log(`Profile "${name}" written to electron/shared/profile.json`);
