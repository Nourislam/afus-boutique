/**
 * Catalog service: product variants, identifiers (SKU / QR / barcode),
 * code lookup for scanners and variant-level stock movements.
 *
 * All functions take a small database adapter so they can run both inside the
 * Electron main process and in plain Node tests:
 *
 *   api.all(sql, params)  -> array of row objects
 *   api.get(sql, params)  -> row object or null
 *   api.run(sql, params)  -> executes a write, throws on failure
 *   api.transaction(fn)   -> runs fn atomically
 *   api.uuid()            -> new id
 */

const CLOTHING = require('../shared/clothing.json');

const IDENTIFIER_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

/**
 * User-facing errors are sent to the interface as "CODE|{json params}" so they
 * can be shown in the shop's language (see src/i18n/errors.js).
 */
function coded(code, params = {}) {
    return `${code}|${JSON.stringify(params)}`;
}
function codedError(code, params) {
    const error = new Error(coded(code, params));
    error.code = code;
    return error;
}
const MAX_IDENTIFIER_LENGTH = 64;

// Short codes for common colour names (English, French, Arabic) used when
// generating SKUs. Unknown colours fall back to letters from the name.
const COLOR_CODES = {
    black: 'BLK', noir: 'BLK', 'أسود': 'BLK', 'اسود': 'BLK',
    white: 'WHT', blanc: 'WHT', 'أبيض': 'WHT', 'ابيض': 'WHT',
    red: 'RED', rouge: 'RED', 'أحمر': 'RED', 'احمر': 'RED',
    blue: 'BLU', bleu: 'BLU', 'أزرق': 'BLU', 'ازرق': 'BLU',
    navy: 'NVY', marine: 'NVY', 'كحلي': 'NVY',
    green: 'GRN', vert: 'GRN', 'أخضر': 'GRN', 'اخضر': 'GRN',
    grey: 'GRY', gray: 'GRY', gris: 'GRY', 'رمادي': 'GRY',
    yellow: 'YLW', jaune: 'YLW', 'أصفر': 'YLW', 'اصفر': 'YLW',
    orange: 'ORG', 'برتقالي': 'ORG',
    pink: 'PNK', rose: 'PNK', 'وردي': 'PNK',
    purple: 'PRP', violet: 'PRP', 'بنفسجي': 'PRP',
    brown: 'BRN', marron: 'BRN', 'بني': 'BRN',
    beige: 'BEG', 'بيج': 'BEG',
    khaki: 'KHK', kaki: 'KHK',
    gold: 'GLD', 'or': 'GLD', 'ذهبي': 'GLD',
    silver: 'SLV', argent: 'SLV', 'فضي': 'SLV',
};

/**
 * Normalize a scanned or typed identifier: trim, drop control characters and
 * upper-case it. Identifiers are matched case-insensitively.
 */
function normalizeCode(code) {
    if (code === null || code === undefined) return '';
    // eslint-disable-next-line no-control-regex
    return String(code).replace(/[\u0000-\u001f\u007f]/g, '').trim().toUpperCase();
}

/** Returns null if valid, otherwise an error message. */
function validateIdentifier(code, label = 'sku') {
    const normalized = normalizeCode(code);
    if (!normalized) return coded('ID_REQUIRED', { field: label });
    if (normalized.length > MAX_IDENTIFIER_LENGTH) return coded('ID_TOO_LONG', { field: label, max: MAX_IDENTIFIER_LENGTH });
    if (!IDENTIFIER_PATTERN.test(normalized)) return coded('ID_INVALID_CHARS', { field: label, value: String(code) });
    return null;
}

function asciiLetters(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function productCode(product, settings = {}) {
    const explicit = asciiLetters(product.sku);
    if (explicit) return explicit.slice(0, 8);
    const fromName = asciiLetters(product.name);
    const code = fromName.slice(0, 3) || 'PRD';
    return (asciiLetters(settings.prefix) + code).slice(0, 8);
}

// Palette colours (by code or by name in any language) -> short SKU code
const PALETTE_SKU = {};
// Any palette name (en/fr/ar) or code -> stable palette code ("Noir" -> "black")
const PALETTE_CODE = {};
for (const c of CLOTHING.colors) {
    for (const name of [c.code, c.en, c.fr, c.ar]) PALETTE_CODE[String(name).trim().toLowerCase()] = c.code;
}
function paletteCode(color, code = null) {
    if (code && PALETTE_CODE[String(code).toLowerCase()]) return PALETTE_CODE[String(code).toLowerCase()];
    return color ? PALETTE_CODE[String(color).trim().toLowerCase()] || null : null;
}
for (const c of CLOTHING.colors) {
    for (const name of [c.code, c.en, c.fr, c.ar]) PALETTE_SKU[String(name).toLowerCase()] = c.sku;
}

function colorCode(color, index = 0, code = null) {
    if (code && PALETTE_SKU[String(code).toLowerCase()]) return PALETTE_SKU[String(code).toLowerCase()];
    if (!color) return '';
    if (PALETTE_SKU[String(color).trim().toLowerCase()]) return PALETTE_SKU[String(color).trim().toLowerCase()];
    const key = String(color).trim().toLowerCase();
    if (COLOR_CODES[key]) return COLOR_CODES[key];
    const letters = asciiLetters(color);
    if (!letters) return `C${index + 1}`;
    if (letters.length <= 3) return letters;
    // First letter + following consonants gives readable codes (e.g. OLIVE -> OLV)
    const consonants = letters.slice(1).replace(/[AEIOU]/g, '');
    return (letters[0] + consonants + letters.slice(1)).slice(0, 3);
}

function sizeCode(size, index = 0) {
    if (!size) return '';
    const letters = asciiLetters(size);
    return letters ? letters.slice(0, 5) : `S${index + 1}`;
}

/**
 * Find what (if anything) already uses an identifier, across product variants
 * (sku, qr_code, barcode) and simple products (sku, barcode).
 */
function findIdentifierOwner(api, code, { excludeVariantId = null, excludeProductId = null } = {}) {
    const normalized = normalizeCode(code);
    if (!normalized) return null;

    const variant = api.get(`
        SELECT v.id, v.product_id, v.sku, v.qr_code, v.barcode, v.color, v.size, p.name AS product_name
        FROM product_variants v
        LEFT JOIN products p ON p.id = v.product_id
        WHERE (UPPER(v.sku) = ? OR UPPER(v.qr_code) = ? OR UPPER(v.barcode) = ?)
          AND (? IS NULL OR v.id <> ?)
        LIMIT 1
    `, [normalized, normalized, normalized, excludeVariantId, excludeVariantId]);
    if (variant) return { type: 'variant', ...variant };

    const product = api.get(`
        SELECT id, name AS product_name, sku, barcode FROM products
        WHERE (UPPER(sku) = ? OR UPPER(barcode) = ?)
          AND (? IS NULL OR id <> ?)
        LIMIT 1
    `, [normalized, normalized, excludeProductId, excludeProductId]);
    if (product) return { type: 'product', ...product };

    return null;
}

function describeOwner(owner) {
    if (!owner) return '';
    if (owner.type === 'variant') {
        const label = [owner.color, owner.size].filter(Boolean).join(' / ');
        return `${owner.product_name || 'a product'}${label ? ` (${label})` : ''}`;
    }
    return owner.product_name || 'another product';
}

/**
 * Generate deterministic SKUs of the form PRODUCT-COLOR-SIZE-NNN.
 * The sequence number is the lowest one not already used in the database or
 * in this batch, so the same inputs and database state always give the same
 * result.
 *
 * @param {object} product  { name, sku? }
 * @param {Array} variants  [{ color, size }]
 * @param {object} settings { prefix?, separator?, digits? }
 * @param {Set<string>} [reserved] identifiers already taken in this batch
 */
function generateSkus(api, product, variants, settings = {}, reserved = new Set()) {
    const separator = settings.separator === '' ? '' : (settings.separator || '-');
    const digits = Math.min(Math.max(parseInt(settings.digits, 10) || 3, 1), 6);
    const base = productCode(product, settings);
    const taken = new Set([...reserved].map(normalizeCode));

    return variants.map((variant, index) => {
        const parts = [base, colorCode(variant.color, index, variant.color_code), sizeCode(variant.size, index)].filter(Boolean);
        const stem = parts.join(separator);
        for (let seq = 1; seq < 10 ** digits; seq++) {
            const candidate = normalizeCode(`${stem}${separator}${String(seq).padStart(digits, '0')}`);
            if (taken.has(candidate)) continue;
            if (findIdentifierOwner(api, candidate, { excludeVariantId: variant.id || null })) continue;
            taken.add(candidate);
            return candidate;
        }
        throw codedError('SKU_EXHAUSTED', { stem });
    });
}

/** EAN-13 check digit for the first 12 digits. */
function ean13CheckDigit(digits12) {
    const d = String(digits12);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (sum % 10)) % 10);
}

/**
 * Barcodes for the shop's own articles: EAN-13 in the in-store range
 * (starting with 2, never used by manufacturers), never already used by an
 * article, a variant or a gift card.
 */
function generateInternalBarcodes(api, count = 1, reserved = new Set(), random = Math.random) {
    const taken = new Set([...reserved].map(normalizeCode));
    const codes = [];
    for (let attempts = 0; codes.length < count && attempts < count * 200; attempts++) {
        // 20…–28…: article codes. 29… is kept for free labels (generateFreeCodes)
        let body = '2' + Math.min(Math.floor(random() * 9), 8);
        for (let i = 0; i < 10; i++) body += Math.floor(random() * 10);
        const code = body + ean13CheckDigit(body);
        if (taken.has(code)) continue;
        if (findIdentifierOwner(api, code)) continue;
        const gift = api.get('SELECT id FROM gift_cards WHERE code = ? LIMIT 1', [code]);
        if (gift) continue;
        taken.add(code);
        codes.push(code);
    }
    if (codes.length < count) throw codedError('SKU_EXHAUSTED', { stem: '2' });
    return codes;
}

/** GS1 check digit (EAN-8, EAN-13, UPC-A, ITF-14): weights 3,1,3… from the right. */
function gs1CheckDigit(body) {
    const d = String(body);
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += Number(d[d.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
    return String((10 - (sum % 10)) % 10);
}

// Free label formats: how a sequence number becomes a valid code
const FREE_CODE_FORMATS = {
    ean13: (n) => { const b = '29' + String(n).padStart(10, '0'); return b + gs1CheckDigit(b); },
    ean8: (n) => { const b = '2' + String(n).padStart(6, '0'); return b + gs1CheckDigit(b); },
    upca: (n) => { const b = '2' + String(n).padStart(10, '0'); return b + gs1CheckDigit(b); },
    itf14: (n) => { const b = '29' + String(n).padStart(11, '0'); return b + gs1CheckDigit(b); },
    code: (n) => 'HN' + String(n).padStart(8, '0'),
};
const FREE_CODE_LIMITS = { ean13: 1e10, ean8: 1e6, upca: 1e10, itf14: 1e11, code: 1e8 };
const FREE_CODE_SEQ_KEY = 'free_barcode_seq';

/** Which free-code family a barcode symbology uses. */
function freeCodeFormat(type) {
    if (type === 'ean13' || type === 'ean8' || type === 'upca' || type === 'itf14') return type;
    if (type === 'interleaved2of5') return 'itf14';
    return 'code';
}

function isCodeUsed(api, code) {
    if (findIdentifierOwner(api, code)) return true;
    return !!api.get('SELECT id FROM gift_cards WHERE UPPER(code) = ? LIMIT 1', [normalizeCode(code)]);
}

/**
 * Codes for labels printed without an article (a roll of stickers that is
 * scanned into articles later). A sequence kept in settings guarantees a code
 * is never handed out twice, even before it is attached to an article, and
 * every code is also checked against articles, variants and gift cards.
 */
function generateFreeCodes(api, { type = 'ean13', count = 1, reserved = [] } = {}) {
    const format = freeCodeFormat(type);
    const make = FREE_CODE_FORMATS[format];
    const taken = new Set([...reserved].map(normalizeCode));
    const row = api.get('SELECT value FROM settings WHERE key = ?', [FREE_CODE_SEQ_KEY]);
    let seqs = {};
    try { seqs = row ? JSON.parse(row.value) || {} : {}; } catch { seqs = {}; }
    if (typeof seqs !== 'object') seqs = {};
    let seq = Number(seqs[format]) || 0;
    const codes = [];
    while (codes.length < count) {
        seq += 1;
        if (seq >= FREE_CODE_LIMITS[format]) throw codedError('SKU_EXHAUSTED', { stem: format });
        const code = make(seq);
        if (taken.has(code) || isCodeUsed(api, code)) continue;
        taken.add(code);
        codes.push(code);
    }
    seqs[format] = seq;
    const value = JSON.stringify(seqs);
    if (row) api.run('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?', [value, FREE_CODE_SEQ_KEY]);
    else api.run('INSERT INTO settings (key, value) VALUES (?, ?)', [FREE_CODE_SEQ_KEY, value]);
    return codes;
}

function effectivePrice(product, variant) {
    if (variant && variant.price !== null && variant.price !== undefined && variant.price !== '') {
        return Number(variant.price);
    }
    return Number(product.price) || 0;
}

function variantLabel(variant) {
    if (!variant) return '';
    return [variant.color, variant.size].filter(Boolean).join(' / ');
}

function getVariants(api, productId, { includeInactive = false } = {}) {
    return api.all(`
        SELECT * FROM product_variants
        WHERE product_id = ? ${includeInactive ? '' : 'AND is_active = 1'}
        ORDER BY sort_order, color, size
    `, [productId]);
}

function recomputeProductStock(api, productId) {
    api.run(`
        UPDATE products SET
            stock_quantity = (SELECT COALESCE(SUM(stock_quantity), 0) FROM product_variants WHERE product_id = ? AND is_active = 1),
            updated_at = CURRENT_TIMESTAMP, is_synced = 0
        WHERE id = ? AND has_variants = 1
    `, [productId, productId]);
}

/**
 * Move stock for a product or one of its variants and record it in
 * inventory_logs. `delta` is positive to add stock and negative to remove it.
 * Products that have variants must always be moved through a variant.
 */
function adjustStock(api, { productId, variantId = null, delta, type, reason = null, employeeId = null }) {
    const change = parseInt(delta, 10);
    if (!Number.isFinite(change)) throw new Error('Invalid stock quantity');

    if (variantId) {
        const variant = api.get('SELECT id, product_id, stock_quantity FROM product_variants WHERE id = ?', [variantId]);
        if (!variant) throw new Error(`Variant ${variantId} not found`);
        if (productId && variant.product_id !== productId) {
            throw new Error('Variant does not belong to the given product');
        }
        const before = variant.stock_quantity || 0;
        const after = before + change;
        api.run('UPDATE product_variants SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?', [after, variantId]);
        api.run(`
            INSERT INTO inventory_logs (id, product_id, variant_id, type, quantity_change, quantity_before, quantity_after, reason, employee_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [api.uuid(), variant.product_id, variantId, type, change, before, after, reason, employeeId]);
        recomputeProductStock(api, variant.product_id);
        return { productId: variant.product_id, variantId, before, after };
    }

    const product = api.get('SELECT id, stock_quantity, has_variants, name FROM products WHERE id = ?', [productId]);
    if (!product) throw new Error(`Product ${productId} not found`);
    if (product.has_variants) {
        throw codedError('VARIANT_REQUIRED', { product: product.name });
    }
    const before = product.stock_quantity || 0;
    const after = before + change;
    api.run('UPDATE products SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?', [after, productId]);
    api.run(`
        INSERT INTO inventory_logs (id, product_id, variant_id, type, quantity_change, quantity_before, quantity_after, reason, employee_id, created_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [api.uuid(), productId, type, change, before, after, reason, employeeId]);
    return { productId, variantId: null, before, after };
}

/**
 * Validate a full set of variants for one product, checking for duplicates
 * inside the set and against everything already in the database.
 * Returns a list of error messages (empty when valid).
 */
function validateVariants(api, productId, variants) {
    const errors = [];
    const seen = new Map();
    const combos = new Set();

    variants.forEach((variant, index) => {
        const row = { row: index + 1, variant: variantLabel(variant) };
        const combo = `${(variant.color || '').trim().toLowerCase()}|${(variant.size || '').trim().toLowerCase()}`;
        if (variant.is_active !== false && variant.is_active !== 0) {
            if (combos.has(combo)) errors.push(coded('VARIANT_DUPLICATE_COMBO', row));
            combos.add(combo);
        }

        const identifiers = [
            ['sku', variant.sku],
            ['qr', variant.qr_code],
            ['barcode', variant.barcode],
        ];
        for (const [label, value] of identifiers) {
            if (label === 'barcode' && !value) continue;
            const message = validateIdentifier(value, label);
            if (message) {
                const [code, params] = message.split('|');
                errors.push(coded(code, { ...JSON.parse(params), ...row }));
                continue;
            }
            const normalized = normalizeCode(value);
            // The QR code of a variant is normally its own SKU: that is fine.
            const previous = seen.get(normalized);
            if (previous && previous.index !== index) {
                errors.push(coded('ID_DUPLICATE_IN_FORM', { ...row, field: label, value: normalized, other: previous.index + 1 }));
            } else if (!previous) {
                seen.set(normalized, { index });
            }
            const owner = findIdentifierOwner(api, normalized, { excludeVariantId: variant.id || null, excludeProductId: productId });
            if (owner && !(owner.type === 'variant' && owner.product_id === productId && variants.some(v => v.id === owner.id))) {
                errors.push(coded('ID_TAKEN', { ...row, field: label, value: normalized, owner: describeOwner(owner) }));
            }
        }
    });

    return errors;
}

/**
 * Create or update a product together with its variants, atomically.
 *
 * product:  product fields (id, name, price, ...). has_variants is derived.
 * variants: [{ id?, color, size, sku, qr_code?, barcode?, price?, cost?,
 *              stock_quantity, min_stock_level, is_active }]
 *           Variants missing from the list are deactivated, never deleted, so
 *           sales history and printed labels keep pointing at a real record.
 */
function saveProduct(api, product, variants = [], { employeeId = null, isNew = false } = {}) {
    if (!product || !product.id) throw new Error('Product id is required');
    if (!product.name || !String(product.name).trim()) throw codedError('PRODUCT_NAME_REQUIRED');

    const hasVariants = Array.isArray(variants) && variants.length > 0;

    // Normalize identifiers; the QR code defaults to the SKU.
    const prepared = (variants || []).map((v, index) => ({
        ...v,
        sku: normalizeCode(v.sku),
        qr_code: normalizeCode(v.qr_code) || normalizeCode(v.sku),
        barcode: normalizeCode(v.barcode) || null,
        sort_order: index,
        is_active: v.is_active === false || v.is_active === 0 ? 0 : 1,
    }));

    const productSku = normalizeCode(product.sku) || null;
    const productBarcode = normalizeCode(product.barcode) || null;
    if (productSku) {
        const owner = findIdentifierOwner(api, productSku, { excludeProductId: product.id });
        if (owner && !(owner.type === 'variant' && owner.product_id === product.id)) {
            throw codedError('ID_TAKEN', { field: 'sku', value: productSku, owner: describeOwner(owner) });
        }
    }
    if (productBarcode) {
        const owner = findIdentifierOwner(api, productBarcode, { excludeProductId: product.id });
        if (owner && !(owner.type === 'variant' && owner.product_id === product.id)) {
            throw codedError('ID_TAKEN', { field: 'barcode', value: productBarcode, owner: describeOwner(owner) });
        }
    }

    const errors = validateVariants(api, product.id, prepared);
    if (errors.length) {
        const error = new Error(errors.join('\n'));
        error.validationErrors = errors;
        throw error;
    }

    return api.transaction(() => {
        const existing = api.get('SELECT id, stock_quantity, has_variants FROM products WHERE id = ?', [product.id]);
        const fields = [
            productSku, productBarcode, product.name, product.description || null,
            product.category_id || null, product.supplier_id || null,
            Number(product.price) || 0, Number(product.cost) || 0,
            parseInt(product.min_stock_level, 10) || 0, Number(product.tax_rate) || 0,
            product.is_active === false || product.is_active === 0 ? 0 : 1,
            product.image_path || null, product.brand ? String(product.brand).trim() : null, product.gender || null,
            product.season || null, product.collection ? String(product.collection).trim() : null, hasVariants ? 1 : 0,
        ];

        if (existing && !isNew) {
            api.run(`
                UPDATE products SET
                    sku = ?, barcode = ?, name = ?, description = ?, category_id = ?, supplier_id = ?,
                    price = ?, cost = ?, min_stock_level = ?, tax_rate = ?, is_active = ?, image_path = ?,
                    brand = ?, gender = ?, season = ?, collection = ?, has_variants = ?,
                    updated_at = CURRENT_TIMESTAMP, is_synced = 0
                WHERE id = ?
            `, [...fields, product.id]);
        } else {
            if (existing) throw new Error('A product with this id already exists');
            api.run(`
                INSERT INTO products (
                    sku, barcode, name, description, category_id, supplier_id,
                    price, cost, min_stock_level, tax_rate, is_active, image_path,
                    brand, gender, season, collection, has_variants, id, stock_quantity, is_synced
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            `, [...fields, product.id]);
        }

        // Simple product: stock is kept on the product itself
        if (!hasVariants) {
            const target = parseInt(product.stock_quantity, 10) || 0;
            const current = existing && !isNew ? (existing.stock_quantity || 0) : 0;
            // Deactivate variants left over from a previous configuration
            api.run('UPDATE product_variants SET is_active = 0, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE product_id = ?', [product.id]);
            if (target !== current) {
                adjustStock(api, {
                    productId: product.id, delta: target - current,
                    type: existing && !isNew ? 'adjustment' : 'initial',
                    reason: existing && !isNew ? 'Stock edited in product form' : 'Initial stock',
                    employeeId,
                });
            }
            return { product: api.get('SELECT * FROM products WHERE id = ?', [product.id]), variants: [] };
        }

        const keptIds = new Set();
        for (const variant of prepared) {
            const current = variant.id ? api.get('SELECT * FROM product_variants WHERE id = ?', [variant.id]) : null;
            const id = current ? current.id : (variant.id || api.uuid());
            keptIds.add(id);
            const price = variant.price === '' || variant.price === null || variant.price === undefined ? null : Number(variant.price);
            const cost = variant.cost === '' || variant.cost === null || variant.cost === undefined ? null : Number(variant.cost);
            const values = [
                variant.color ? String(variant.color).trim() : null,
                paletteCode(variant.color, variant.color_code),
                variant.size ? String(variant.size).trim() : null,
                variant.sku, variant.barcode, variant.qr_code, price, cost,
                parseInt(variant.min_stock_level, 10) || 0, variant.is_active, variant.sort_order,
            ];

            if (current) {
                if (current.product_id !== product.id) throw new Error(`Variant ${id} belongs to another product`);
                api.run(`
                    UPDATE product_variants SET
                        color = ?, color_code = ?, size = ?, sku = ?, barcode = ?, qr_code = ?, price = ?, cost = ?,
                        min_stock_level = ?, is_active = ?, sort_order = ?,
                        updated_at = CURRENT_TIMESTAMP, is_synced = 0
                    WHERE id = ?
                `, [...values, id]);
            } else {
                api.run(`
                    INSERT INTO product_variants (
                        color, color_code, size, sku, barcode, qr_code, price, cost, min_stock_level, is_active, sort_order,
                        id, product_id, stock_quantity, is_synced
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                `, [...values, id, product.id]);
            }

            const target = parseInt(variant.stock_quantity, 10) || 0;
            const before = current ? (current.stock_quantity || 0) : 0;
            if (target !== before) {
                adjustStock(api, {
                    productId: product.id, variantId: id, delta: target - before,
                    type: current ? 'adjustment' : 'initial',
                    reason: current ? 'Stock edited in product form' : 'Initial stock',
                    employeeId,
                });
            }
        }

        // Variants removed from the form are deactivated (kept for history)
        const all = getVariants(api, product.id, { includeInactive: true });
        for (const v of all) {
            if (!keptIds.has(v.id) && v.is_active) {
                api.run('UPDATE product_variants SET is_active = 0, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?', [v.id]);
            }
        }

        // A product converted from simple to variants keeps no stock of its own
        if (existing && !isNew && !existing.has_variants && existing.stock_quantity) {
            api.run(`
                INSERT INTO inventory_logs (id, product_id, variant_id, type, quantity_change, quantity_before, quantity_after, reason, employee_id, created_at)
                VALUES (?, ?, NULL, 'adjustment', ?, ?, 0, 'Converted to colour/size variants', ?, CURRENT_TIMESTAMP)
            `, [api.uuid(), product.id, -existing.stock_quantity, existing.stock_quantity, employeeId]);
        }
        recomputeProductStock(api, product.id);

        return {
            product: api.get('SELECT * FROM products WHERE id = ?', [product.id]),
            variants: getVariants(api, product.id, { includeInactive: true }),
        };
    });
}

/**
 * Resolve a scanned/typed code to a sellable item.
 * Order: variant QR code, variant SKU, variant barcode, product barcode, product SKU.
 * Returns { type: 'variant', product, variant } | { type: 'product', product } | null.
 * A product with variants matched by its own code returns type 'product' with
 * `needsVariant: true`, so the UI can ask which variant to sell.
 */
function lookupCode(api, code) {
    const normalized = normalizeCode(code);
    if (!normalized) return null;

    const productSelect = `
        SELECT p.*, c.name AS category_name, c.color AS category_color
        FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?
    `;

    const variant = api.get(`
        SELECT * FROM product_variants
        WHERE is_active = 1 AND (UPPER(qr_code) = ? OR UPPER(sku) = ? OR UPPER(barcode) = ?)
        ORDER BY CASE WHEN UPPER(qr_code) = ? THEN 0 WHEN UPPER(sku) = ? THEN 1 ELSE 2 END
        LIMIT 1
    `, [normalized, normalized, normalized, normalized, normalized]);

    if (variant) {
        const product = api.get(productSelect, [variant.product_id]);
        if (product && product.is_active) {
            return { type: 'variant', product, variant: { ...variant, effective_price: effectivePrice(product, variant), label: variantLabel(variant) } };
        }
    }

    const productRow = api.get(`
        SELECT id FROM products
        WHERE is_active = 1 AND (UPPER(barcode) = ? OR UPPER(sku) = ?)
        ORDER BY CASE WHEN UPPER(barcode) = ? THEN 0 ELSE 1 END
        LIMIT 1
    `, [normalized, normalized, normalized]);

    if (productRow) {
        const product = api.get(productSelect, [productRow.id]);
        if (product.has_variants) {
            return { type: 'product', product, needsVariant: true, variants: getVariants(api, product.id) };
        }
        return { type: 'product', product };
    }
    return null;
}

/** Point a variant's QR code at its current SKU (used after a SKU change). */
function regenerateQrCode(api, variantId) {
    const variant = api.get('SELECT * FROM product_variants WHERE id = ?', [variantId]);
    if (!variant) throw new Error('Variant not found');
    const owner = findIdentifierOwner(api, variant.sku, { excludeVariantId: variantId });
    if (owner) throw codedError('ID_TAKEN', { field: 'sku', value: variant.sku, owner: describeOwner(owner) });
    api.run('UPDATE product_variants SET qr_code = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?', [normalizeCode(variant.sku), variantId]);
    return api.get('SELECT * FROM product_variants WHERE id = ?', [variantId]);
}

/** Search active variants by product name, colour, size, SKU or codes. */
function searchVariants(api, query, limit = 50) {
    const term = `%${String(query || '').trim()}%`;
    return api.all(`
        SELECT v.*, p.name AS product_name, p.price AS product_price, p.brand, p.image_path
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1
          AND (p.name LIKE ? OR v.sku LIKE ? OR v.qr_code LIKE ? OR v.barcode LIKE ? OR v.color LIKE ? OR v.size LIKE ?)
        ORDER BY p.name, v.sort_order
        LIMIT ?
    `, [term, term, term, term, term, term, limit]);
}

/** Low-stock rows at the most specific level: variants for variant products, products otherwise. */
function getLowStock(api) {
    const variants = api.all(`
        SELECT v.id AS variant_id, v.product_id, p.name AS product_name, v.color, v.size, v.sku,
               v.stock_quantity, v.min_stock_level
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1 AND p.has_variants = 1
          AND v.stock_quantity <= v.min_stock_level
    `);
    const products = api.all(`
        SELECT NULL AS variant_id, id AS product_id, name AS product_name, NULL AS color, NULL AS size, sku,
               stock_quantity, min_stock_level
        FROM products
        WHERE is_active = 1 AND COALESCE(has_variants, 0) = 0 AND stock_quantity <= min_stock_level
    `);
    return [...variants, ...products].sort((a, b) => a.stock_quantity - b.stock_quantity);
}

module.exports = {
    coded,
    codedError,
    normalizeCode,
    validateIdentifier,
    generateSkus,
    findIdentifierOwner,
    describeOwner,
    effectivePrice,
    variantLabel,
    getVariants,
    recomputeProductStock,
    adjustStock,
    validateVariants,
    saveProduct,
    lookupCode,
    regenerateQrCode,
    searchVariants,
    getLowStock,
    COLOR_CODES,
    paletteCode,
    ean13CheckDigit,
    generateInternalBarcodes,
    gs1CheckDigit,
    generateFreeCodes,
    freeCodeFormat,
    isCodeUsed,
};
