// Kids: warm and playful colours, round shapes, sizes on every card.
module.exports = {
    id: 'kids',
    version: 1,
    name: { ar: 'أطفال', fr: 'Enfants', en: 'Kids' },
    description: {
        ar: 'ألوان دافئة ومرحة وأشكال دائرية والمقاسات ظاهرة على كل سلعة. لملابس الأطفال والرضع.',
        fr: 'Couleurs gaies, formes arrondies, tailles visibles sur chaque article. Pour la mode enfant.',
        en: 'Cheerful colours, round shapes, sizes on every card. For kids and baby clothes.',
    },
    tags: ['kids', 'baby', 'family'],
    tokens: {
        colors: { background: '#fffdf7', surface: '#fff1d6', text: '#2d2a4a', muted: '#6e6a8f', primary: '#ff6b6b', onPrimary: '#ffffff', accent: '#4ecdc4', sale: '#ff6b6b', border: '#ffe2a8' },
        fonts: {
            heading: "'Nunito', 'Baloo 2', 'Segoe UI Rounded', 'Segoe UI', Arial, 'Noto Sans Arabic', Tahoma, sans-serif",
            body: "'Nunito', 'Segoe UI', Arial, 'Noto Sans Arabic', Tahoma, sans-serif",
        },
        type: { baseSize: 16, scale: 1.25, headingWeight: '800', headingCase: 'none', headingTracking: 0, bodyTracking: 0 },
        shape: { radius: 14, buttonRadius: 999, cardRadius: 24 },
        layout: { container: 1200, sectionGap: 64, gridGap: 22 },
        style: { shadow: 'soft', border: 2, imageFilter: 'none' },
    },
    header: { style: 'inline', sticky: true, announcement: true, nav: 'inline', search: true },
    productCard: { imageRatio: '1/1', style: 'rounded', nameCase: 'none', align: 'center', showBrand: false, showColors: true, showSizes: true, badge: 'pill' },
    productPage: { layout: 'split', gallery: 'grid', sizes: 'pills', colors: 'swatches', sticky: true, related: 4 },
    categoryPage: { desktopColumns: 4, mobileColumns: 2, filters: true, banner: true },
    footer: { style: 'columns' },
    home: [
        { type: 'hero', variant: 'playful', cta: 'all' },
        { type: 'categories', style: 'circles', limit: 8 },
        { type: 'products', source: 'new', limit: 8, layout: 'grid', columns: 4 },
        { type: 'promo', style: 'banner' },
        { type: 'products', source: 'available', limit: 8, layout: 'grid', columns: 4 },
        { type: 'contact', style: 'card', whatsapp: true },
    ],
};
