#!/usr/bin/env node
// Publisher tool for offline licences (never shipped with the program).
//   node scripts/license.mjs keys  <folder>              create a key pair (keep private.pem secret)
//   node scripts/license.mjs sign  <private.pem> "<shop>" [plan] [expires YYYY-MM-DD]
// Put the content of public.pem in the installer profile (licensePublicKey).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { sign } = require('../electron/services/licenseService.js');
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'keys') {
    const folder = args[0] || '.';
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    fs.writeFileSync(path.join(folder, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log(`Keys written in ${folder} (keep private.pem secret, never in the repository)`);
} else if (cmd === 'sign') {
    const [keyFile, shop, plan = 'standard', expires] = args;
    if (!keyFile || !shop) { console.error('usage: sign <private.pem> "<shop>" [plan] [expires]'); process.exit(1); }
    const license = { shop, plan, issued: new Date().toISOString().slice(0, 10), ...(expires ? { expires } : {}) };
    console.log(sign(license, fs.readFileSync(keyFile, 'utf8')));
} else {
    console.error('usage: license.mjs keys <folder> | sign <private.pem> "<shop>" [plan] [expires]');
    process.exit(1);
}
