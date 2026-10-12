// Atelier: black on white, thin capital titles, tall photos edge to edge,
// a tight grid and almost nothing else: the look of the big fashion houses.
const SANS = "'Afus Sans', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

module.exports = {
    id: 'atelier',
    version: 1,
    name: { ar: 'أتيلييه', fr: 'Atelier', en: 'Atelier' },
    description: {
        ar: 'أبيض وأسود، عناوين رفيعة بحروف كبيرة، صور طويلة من حافة إلى حافة وشبكة متقاربة. بأسلوب دور الأزياء العالمية.',
        fr: 'Noir sur blanc, titres fins en capitales, grandes photos bord à bord, grille serrée. Le style des grandes maisons de mode.',
        en: 'Black on white, thin capital titles, tall edge-to-edge photos, a tight grid. The look of the big fashion houses.',
    },
    tags: ['women', 'men', 'premium'],
    tokens: {
        colors: { background: '#ffffff', surface: '#f2f2f2', text: '#000000', muted: '#707070', primary: '#000000', onPrimary: '#ffffff', accent: '#000000', sale: '#c8102e', border: '#e5e5e5' },
        fonts: {
            heading: "'Helvetica Neue', Helvetica, Arial, 'Afus Sans', sans-serif",
            body: SANS,
        },
        type: { baseSize: 14, scale: 1.42, headingWeight: '300', headingCase: 'upper', headingTracking: 0.08, bodyTracking: 0.02 },
        shape: { radius: 0, buttonRadius: 0, cardRadius: 0 },
        layout: { container: 1600, sectionGap: 88, gridGap: 4 },
        style: { shadow: 'none', border: 1, imageFilter: 'none' },
    },
    header: { style: 'minimal', sticky: true, announcement: false, nav: 'drawer', search: false },
    productCard: { imageRatio: '2/3', style: 'plain', nameCase: 'upper', align: 'start', showBrand: false, showColors: false, showSizes: false, badge: 'text' },
    productPage: { layout: 'split', gallery: 'stack', sizes: 'list', colors: 'chips', sticky: true, related: 4 },
    categoryPage: { desktopColumns: 4, mobileColumns: 2, filters: true, banner: false },
    footer: { style: 'simple' },
    home: [
        { type: 'hero', variant: 'full', cta: 'all' },
        { type: 'trust', style: 'strip' },
        { type: 'products', source: 'new', limit: 8, layout: 'grid', columns: 4 },
        { type: 'categories', style: 'list', limit: 8 },
        { type: 'products', source: 'featured', limit: 7, layout: 'large-first', columns: 4 },
        { type: 'products', source: 'best', limit: 8, layout: 'grid', columns: 4 },
        { type: 'contact', style: 'strip', whatsapp: true },
    ],
};
