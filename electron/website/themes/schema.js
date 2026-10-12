/**
 * What a website theme is: data only (no code, no shop data). A theme says
 * how the shop's own catalogue looks (colours, fonts, layout, header and
 * navigation, home page sections, product cards, product and category
 * pages, footer); the products, pictures, categories, prices, sizes and
 * colours always come from the shop (catalogSnapshot.js), whatever the theme.
 *
 * normalizeTheme(manifest) checks a theme against this description and fills
 * what it leaves out with defaults: { ok, theme, errors }. A theme with an
 * error is never used (registry.js refuses it).
 *
 * The home page is a list of sections; the kinds of section and their
 * options are declared by the renderer (storefront/sections.js), so a new
 * kind of section is one entry there, and a new theme is one file in
 * themes/builtin (or registered at start).
 */
const { SECTION_TYPES } = require('../storefront/sections');

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const LANGS = ['ar', 'fr', 'en'];
// A font list: names and generic families only (no url, no quote tricks)
const FONT_STACK = /^[A-Za-z0-9 ,'-]{3,200}$/;

const e = (values, def) => ({ kind: 'enum', values, default: def });
const int = (min, max, def) => ({ kind: 'int', min, max, default: def });
const num = (min, max, def) => ({ kind: 'num', min, max, default: def });
const bool = (def) => ({ kind: 'bool', default: def });
const color = (def) => ({ kind: 'color', default: def });
const font = (def) => ({ kind: 'font', default: def });

/** Every part of a theme and its options (with their defaults). */
const SPEC = {
    tokens: {
        colors: {
            background: color('#ffffff'), surface: color('#f6f6f6'), text: color('#111111'), muted: color('#6b6b6b'),
            primary: color('#111111'), onPrimary: color('#ffffff'), accent: color('#c2410c'), sale: color('#dc2626'), border: color('#e5e5e5'),
        },
        fonts: {
            heading: font("'Helvetica Neue', Arial, 'Noto Sans Arabic', Tahoma, sans-serif"),
            body: font("'Helvetica Neue', Arial, 'Noto Sans Arabic', Tahoma, sans-serif"),
        },
        type: {
            baseSize: int(14, 18, 16), scale: num(1.1, 1.5, 1.25), headingWeight: e(['300', '400', '500', '600', '700', '800', '900'], '700'),
            headingCase: e(['none', 'upper'], 'none'), headingTracking: num(-0.05, 0.3, 0), bodyTracking: num(0, 0.1, 0),
        },
        shape: { radius: int(0, 24, 6), buttonRadius: int(0, 999, 6), cardRadius: int(0, 32, 8) },
        layout: { container: int(960, 1600, 1200), sectionGap: int(24, 120, 64), gridGap: int(2, 40, 20) },
        style: { shadow: e(['none', 'soft', 'strong'], 'none'), border: int(0, 3, 1), imageFilter: e(['none', 'warm', 'mono-hover'], 'none') },
    },
    header: {
        style: e(['inline', 'centered', 'bold', 'minimal'], 'inline'),
        sticky: bool(true), announcement: bool(true), nav: e(['inline', 'tabs', 'drawer'], 'inline'), search: bool(true),
    },
    productCard: {
        imageRatio: e(['1/1', '4/5', '3/4', '2/3'], '3/4'),
        style: e(['plain', 'bordered', 'elevated', 'overlay', 'rounded'], 'plain'),
        nameCase: e(['none', 'upper'], 'none'), align: e(['start', 'center'], 'start'),
        showBrand: bool(true), showColors: bool(true), showSizes: bool(false),
        badge: e(['pill', 'corner', 'ribbon', 'text'], 'pill'),
    },
    productPage: {
        layout: e(['split', 'wide'], 'split'), gallery: e(['stack', 'thumbs', 'grid'], 'thumbs'),
        sizes: e(['buttons', 'pills', 'list'], 'buttons'), colors: e(['swatches', 'chips'], 'swatches'),
        sticky: bool(true), related: int(0, 12, 4),
    },
    categoryPage: { desktopColumns: int(2, 5, 4), mobileColumns: int(1, 2, 2), filters: bool(true), banner: bool(true) },
    footer: { style: e(['simple', 'columns', 'dark'], 'columns') },
};

function checkValue(spec, value, where, errors) {
    if (value === undefined) return spec.default;
    switch (spec.kind) {
        case 'enum': if (spec.values.includes(String(value))) return String(value); break;
        case 'int': if (Number.isInteger(value) && value >= spec.min && value <= spec.max) return value; break;
        case 'num': if (typeof value === 'number' && Number.isFinite(value) && value >= spec.min && value <= spec.max) return value; break;
        case 'bool': if (typeof value === 'boolean') return value; break;
        case 'color': if (typeof value === 'string' && HEX.test(value)) return value.toLowerCase(); break;
        case 'font': if (typeof value === 'string' && FONT_STACK.test(value)) return value; break;
        case 'text': if (typeof value === 'string' && value.length <= (spec.max || 80)) return value; break;
        default: break;
    }
    errors.push(`${where}: bad value`);
    return spec.default;
}

/** Fill one group from its spec; unknown keys are errors (a typo never passes silently). */
function checkGroup(spec, value, where, errors) {
    const out = {};
    const given = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    if (value !== undefined && given !== value) errors.push(`${where}: must be an object`);
    for (const key of Object.keys(given)) if (!(key in spec)) errors.push(`${where}.${key}: unknown`);
    for (const [key, sub] of Object.entries(spec)) {
        out[key] = sub.kind ? checkValue(sub, given[key], `${where}.${key}`, errors) : checkGroup(sub, given[key], `${where}.${key}`, errors);
    }
    return out;
}

function checkTexts(value, where, errors, max) {
    const out = {};
    for (const lang of LANGS) {
        const text = value?.[lang];
        if (typeof text !== 'string' || !text.trim() || text.length > max) errors.push(`${where}.${lang}: missing`);
        out[lang] = typeof text === 'string' ? text.slice(0, max) : '';
    }
    return out;
}

function checkSections(list, errors) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 20) { errors.push('home: 1 to 20 sections'); return []; }
    return list.map((section, i) => {
        const type = SECTION_TYPES[section?.type];
        if (!type) { errors.push(`home[${i}]: unknown section "${section?.type}"`); return null; }
        const { type: _type, ...options } = section;
        return { type: section.type, ...checkGroup(type.options, options, `home[${i}]`, errors) };
    }).filter(Boolean);
}

/** { ok, theme, errors }: a theme ready for the renderer, or why not. */
function normalizeTheme(manifest) {
    const errors = [];
    const m = manifest && typeof manifest === 'object' ? manifest : {};
    if (!ID.test(m.id || '')) errors.push('id: lowercase letters, digits and dashes');
    if (m.version !== 1) errors.push('version: 1');
    const known = new Set(['id', 'version', 'name', 'description', 'tags', 'home', ...Object.keys(SPEC)]);
    for (const key of Object.keys(m)) if (!known.has(key)) errors.push(`${key}: unknown`);
    const theme = {
        id: String(m.id || ''),
        version: 1,
        name: checkTexts(m.name, 'name', errors, 40),
        description: checkTexts(m.description, 'description', errors, 200),
        tags: Array.isArray(m.tags) ? m.tags.filter(t => typeof t === 'string' && ID.test(t)).slice(0, 6) : [],
        ...Object.fromEntries(Object.entries(SPEC).map(([key, spec]) => [key, checkGroup(spec, m[key], key, errors)])),
        home: checkSections(m.home, errors),
    };
    return { ok: errors.length === 0, theme, errors };
}

module.exports = { SPEC, normalizeTheme, LANGS };
