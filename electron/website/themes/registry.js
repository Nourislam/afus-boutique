/**
 * The website themes the program knows. Each one is checked against
 * schema.js when it is registered; a theme with an error is refused (never
 * half used). The built-in themes are in builtin/; more can be registered
 * later (register(manifest)) without touching the renderer or the screens.
 *
 *   list()          the themes, in order
 *   get(id)         one theme (an old name of phase 2 is understood), or null
 *   resolveId(id)   a theme id that exists (the default when unknown)
 *   describe(lang?) what the Website screen shows of each theme (no code)
 */
const { normalizeTheme } = require('./schema');
const BUILTIN = require('./builtin');

const DEFAULT_THEME = 'fashion-modern';
// The three looks of the first version, kept for shops that chose one
const ALIASES = { modern: 'fashion-modern', elegant: 'luxury', classic: 'classic' };

function createRegistry(manifests = BUILTIN) {
    const themes = new Map();

    function register(manifest) {
        const { ok, theme, errors } = normalizeTheme(manifest);
        if (!ok) {
            const error = new Error(`theme "${manifest?.id}" refused: ${errors.join('; ')}`);
            error.errors = errors;
            throw error;
        }
        if (themes.has(theme.id) || ALIASES[theme.id] && ALIASES[theme.id] !== theme.id) throw new Error(`theme "${theme.id}" already exists`);
        themes.set(theme.id, Object.freeze(theme));
        return theme;
    }

    for (const m of manifests) register(m);

    const list = () => [...themes.values()];
    const get = (id) => themes.get(id) || themes.get(ALIASES[id]) || null;
    const has = (id) => !!get(id);
    const resolveId = (id) => get(id)?.id || DEFAULT_THEME;

    /** What a theme looks like, for the theme cards of the Website screen. */
    function describe() {
        return list().map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            tags: t.tags,
            colors: { ...t.tokens.colors },
            look: {
                header: t.header.style, nav: t.header.nav, card: t.productCard.style, ratio: t.productCard.imageRatio,
                hero: t.home.find(s => s.type === 'hero')?.variant || null,
                radius: t.tokens.shape.cardRadius, buttonRadius: t.tokens.shape.buttonRadius,
                headingFont: t.tokens.fonts.heading, headingCase: t.tokens.type.headingCase, headingWeight: t.tokens.type.headingWeight,
            },
            sections: t.home.map(s => s.type),
        }));
    }

    return { register, list, get, has, resolveId, describe, DEFAULT_THEME };
}

// The program's registry (the built-in themes)
const registry = createRegistry();

module.exports = { createRegistry, registry, DEFAULT_THEME, ALIASES };
