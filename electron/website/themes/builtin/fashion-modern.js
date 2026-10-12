// Fashion Modern: clean white pages, big photos, bold sans-serif titles.
const SANS = "'Afus Sans', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

module.exports = {
    id: 'fashion-modern',
    version: 1,
    name: { ar: 'موضة عصرية', fr: 'Mode moderne', en: 'Fashion Modern' },
    description: {
        ar: 'صفحات بيضاء وصور كبيرة وعناوين عريضة. يناسب أغلب محلات الملابس.',
        fr: 'Pages blanches, grandes photos, titres affirmés. Convient à la plupart des boutiques.',
        en: 'White pages, large photos, bold titles. Suits most clothing shops.',
    },
    tags: ['women', 'men', 'everyday'],
    tokens: {
        colors: { background: '#ffffff', surface: '#f3f3f1', text: '#111111', muted: '#6b6b6b', primary: '#111111', onPrimary: '#ffffff', accent: '#d0021b', sale: '#d0021b', border: '#e8e8e8' },
        fonts: { heading: SANS, body: SANS },
        type: { baseSize: 16, scale: 1.3, headingWeight: '800', headingCase: 'none', headingTracking: -0.02, bodyTracking: 0 },
        shape: { radius: 4, buttonRadius: 4, cardRadius: 4 },
        layout: { container: 1320, sectionGap: 72, gridGap: 16 },
        style: { shadow: 'none', border: 1, imageFilter: 'none' },
    },
    header: { style: 'inline', sticky: true, announcement: true, nav: 'inline', search: true },
    productCard: { imageRatio: '3/4', style: 'plain', nameCase: 'none', align: 'start', showBrand: true, showColors: true, showSizes: false, badge: 'corner' },
    productPage: { layout: 'split', gallery: 'thumbs', sizes: 'buttons', colors: 'swatches', sticky: true, related: 4 },
    categoryPage: { desktopColumns: 4, mobileColumns: 2, filters: true, banner: false },
    footer: { style: 'columns' },
    home: [
        { type: 'hero', variant: 'full', cta: 'all' },
        { type: 'trust', style: 'strip' },
        { type: 'categories', style: 'tiles', limit: 8 },
        { type: 'products', source: 'new', limit: 8, layout: 'grid', columns: 4 },
        { type: 'promo', style: 'banner' },
        { type: 'products', source: 'featured', limit: 7, layout: 'large-first', columns: 4 },
        { type: 'products', source: 'best', limit: 10, layout: 'carousel', columns: 4 },
        { type: 'brands', style: 'text' },
        { type: 'contact', style: 'card', whatsapp: true },
    ],
};
