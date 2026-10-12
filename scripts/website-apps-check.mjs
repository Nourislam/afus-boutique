#!/usr/bin/env node
// Before building copies to sell: are the AFUS sign-in apps of GitHub and
// Cloudflare in the installer profile? With them, a shop only creates its
// two free accounts and presses "Sign in"; without them, it has to make keys
// by hand (the fallback). Read-only: nothing is changed.
//   node scripts/website-apps-check.mjs [path/to/profile.json]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'electron/shared/profile.json');
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const ports = Array.isArray(p.cloudflareRedirectPorts) && p.cloudflareRedirectPorts.length ? p.cloudflareRedirectPorts : [47651, 47652, 47653];
let ok = true;
const line = (good, text) => { if (!good) ok = false; console.log(`${good ? 'OK  ' : 'MISSING'}  ${text}`); };

console.log(`Profile: ${path.relative(root, file)}\n`);
line(/^[A-Za-z0-9._-]{10,}$/.test(String(p.githubClientId || '')) && !/your-/.test(String(p.githubClientId)),
    `githubClientId — GitHub OAuth App, "Enable Device Flow" ticked (${p.githubClientId || 'empty'})`);
line(/^[A-Za-z0-9._-]{8,}$/.test(String(p.cloudflareClientId || '')) && !/your-/.test(String(p.cloudflareClientId)),
    `cloudflareClientId — Cloudflare OAuth client, PKCE, public (${p.cloudflareClientId || 'empty'})`);
line(Array.isArray(p.cloudflareScopes) && p.cloudflareScopes.length > 0 && p.cloudflareScopes.every(x => /^[A-Za-z0-9_.:-]+$/.test(String(x))),
    `cloudflareScopes — the exact scope names chosen for that client (${JSON.stringify(p.cloudflareScopes || [])}); see scripts/cloudflare-oauth-scopes.mjs`);
line(ports.every(n => Number.isInteger(n) && n > 1024 && n < 65536), `cloudflareRedirectPorts ${JSON.stringify(ports)}`);
console.log('\nRedirect URLs to register on the Cloudflare OAuth client (all of them):');
for (const n of ports) console.log(`  http://127.0.0.1:${n}/oauth/callback`);
console.log(ok
    ? '\nReady: shops will only create their free GitHub and Cloudflare accounts and press "Sign in".'
    : '\nNot ready: shops will have to make keys by hand. See docs/WEBSITE-ACCOUNTS-SETUP.md');
process.exit(ok ? 0 : 1);
