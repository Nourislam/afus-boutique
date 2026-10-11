/**
 * Offline licence. A licence key is "<payload>.<signature>" (base64url): the
 * payload is JSON { shop, plan, issued, expires? }, signed with the
 * publisher's Ed25519 private key (scripts/license.mjs). The program only
 * holds the public key (electron/shared/profile.json › licensePublicKey) and
 * checks the key without internet.
 *
 * A missing, wrong or expired licence NEVER blocks the shop: sales, stock,
 * backups and every piece of data keep working. Settings just shows it.
 */
const crypto = require('crypto');

const b64url = {
    decode: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    encode: (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
};

/**
 * @returns {{ status: 'none'|'valid'|'invalid'|'expired'|'not_configured', license?: object }}
 */
function check(key, publicKeyPem, now = Date.now()) {
    if (!publicKeyPem) return { status: 'not_configured' };
    const value = String(key || '').trim();
    if (!value) return { status: 'none' };
    const [payloadPart, signaturePart] = value.split('.');
    if (!payloadPart || !signaturePart) return { status: 'invalid' };
    let ok = false;
    try {
        ok = crypto.verify(null, b64url.decode(payloadPart), crypto.createPublicKey(publicKeyPem), b64url.decode(signaturePart));
    } catch {
        ok = false;
    }
    if (!ok) return { status: 'invalid' };
    let license;
    try { license = JSON.parse(b64url.decode(payloadPart).toString('utf8')); } catch { return { status: 'invalid' }; }
    if (license.expires && Date.parse(license.expires) < now) return { status: 'expired', license };
    return { status: 'valid', license };
}

/** Sign a licence (publisher side, scripts/license.mjs and the tests). */
function sign(license, privateKeyPem) {
    const payload = Buffer.from(JSON.stringify(license), 'utf8');
    const signature = crypto.sign(null, payload, crypto.createPrivateKey(privateKeyPem));
    return `${b64url.encode(payload)}.${b64url.encode(signature)}`;
}

module.exports = { check, sign };
