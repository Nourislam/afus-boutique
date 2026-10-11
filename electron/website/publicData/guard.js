/**
 * The last check before anything is published: the public data and the
 * website's files may hold nothing private. Three rules:
 *
 *   1. shape    every field is one of PUBLIC_SHAPE (public.js), with its type
 *   2. names    no field is named like private data (cost, supplier, token...)
 *               even inside a value object (defence in depth)
 *   3. values   no text holds a known private value: customers' and
 *               suppliers' phones / e-mails, tax numbers, PIN hashes
 *               (internal.js › readPrivateMarkers) and the program's own
 *               keys (GitHub, Cloudflare, the website key)
 *
 * checkPublic(data, { markers, secrets, allowed }) -> [problems] (empty: fine)
 * checkFiles(files, { secrets, markers, allowed }) -> [problems]
 */
const { PUBLIC_SHAPE } = require('./public');

const PRIVATE_NAME = /cost|profit|margin|wholesale|supplier|purchase|stock_?q|quantity|min_?stock|barcode|\bsku\b|qr_?code|password|passwd|\bpin\b|token|secret|api_?key|employee|cashier|customer|credit|debt|salary|nif|\bnis\b|\brc\b|tax_?id|owner|shift|cash|payment|refresh|account_?id/i;

function typeOk(type, value) {
    return String(type).split('|').some(t => (t === 'null' ? value === null : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t));
}

function walk(shape, value, where, problems) {
    if (typeof shape === 'string') {
        if (!typeOk(shape, value)) problems.push(`${where}: not ${shape}`);
        return;
    }
    if (shape['*']) {
        if (!Array.isArray(value)) { problems.push(`${where}: not a list`); return; }
        value.forEach((v, i) => walk(shape['*'], v, `${where}[${i}]`, problems));
        return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { problems.push(`${where}: not an object`); return; }
    for (const key of Object.keys(value)) {
        if (!(key in shape)) problems.push(`${where}.${key}: not a public field`);
        else if (PRIVATE_NAME.test(key)) problems.push(`${where}.${key}: private name`);
    }
    for (const [key, sub] of Object.entries(shape)) {
        if (key in value) walk(sub, value[key], `${where}.${key}`, problems);
    }
}

/** Private values that may legitimately appear: the shop's own public contact. */
const allowedOf = (data) => new Set([data?.shop?.phone, data?.shop?.email].filter(Boolean).map(s => s.trim()));

function valueProblems(textOf, { markers = [], secrets = [], allowed = new Set() }, where) {
    const problems = [];
    for (const secret of secrets) if (secret && secret.length >= 8 && textOf.includes(secret)) problems.push(`${where}: holds a program key`);
    for (const m of markers) if (m && !allowed.has(m) && textOf.includes(m)) problems.push(`${where}: holds private data`);
    return problems;
}

function checkPublic(data, { markers = [], secrets = [] } = {}) {
    const problems = [];
    walk(PUBLIC_SHAPE, data, 'public', problems);
    problems.push(...valueProblems(JSON.stringify(data), { markers, secrets, allowed: allowedOf(data) }, 'public'));
    return problems;
}

function checkFiles(files, { markers = [], secrets = [], allowed = new Set() } = {}) {
    const problems = [];
    for (const f of files) {
        if (/\.(jpe?g|png|webp|gif)$/i.test(f.path)) continue; // pictures are the shop's photos
        const content = Buffer.isBuffer(f.content) ? f.content.toString('utf8') : String(f.content);
        problems.push(...valueProblems(content, { markers, secrets, allowed }, f.path));
    }
    return problems;
}

module.exports = { checkPublic, checkFiles, allowedOf, PRIVATE_NAME };
