#!/usr/bin/env node
// The exact Cloudflare OAuth scope names the shop's website needs, read from
// Cloudflare itself (GET /client/v4/oauth/scopes), for profile.json ›
// cloudflareScopes and for the scopes ticked on the AFUS OAuth client.
// Needs an API token of YOUR (the publisher's) account; read-only.
//   CLOUDFLARE_API_TOKEN=... node scripts/cloudflare-oauth-scopes.mjs
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) { console.error('Set CLOUDFLARE_API_TOKEN (an API token of your own Cloudflare account).'); process.exit(1); }
const res = await fetch('https://api.cloudflare.com/client/v4/oauth/scopes', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
const data = await res.json().catch(() => ({}));
if (!res.ok || data.success === false) { console.error(`Cloudflare answered ${res.status}:`, JSON.stringify(data.errors || data).slice(0, 400)); process.exit(1); }
const list = (Array.isArray(data.result) ? data.result : []).map(s => (typeof s === 'string' ? { name: s } : s));
const nameOf = (s) => String(s.name || s.scope || s.id || '');
// What the website does: Workers scripts (write), D1 (write), read the account; stay linked (refresh)
const WANTED = [
    ['Workers scripts, write', /worker.*script.*(write|edit)|workers-scripts\.write/i],
    ['D1, write', /\bd1\b.*(write|edit)|^d1\.write$/i],
    ['Account settings, read', /account.*setting.*read|account-settings\.read/i],
    ['Stay linked (refresh)', /offline/i],
];
const chosen = [];
for (const [label, re] of WANTED) {
    const hits = list.filter(s => re.test(nameOf(s)) || re.test(String(s.description || '')));
    console.log(`${label}: ${hits.length ? hits.map(nameOf).join(', ') : 'not found — look in the full list below'}`);
    if (hits[0]) chosen.push(nameOf(hits[0]));
}
console.log(`\nprofile.json › "cloudflareScopes": ${JSON.stringify(chosen)}`);
console.log('\nFull list from Cloudflare:');
for (const s of list) console.log(`  ${nameOf(s)}${s.description ? ` — ${s.description}` : ''}`);
