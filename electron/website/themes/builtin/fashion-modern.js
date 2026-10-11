// Fashion Modern: clean white pages, big photos, bold sans-serif titles.
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
        colors: { background: '#ffffff', surface: '#f4f4f2', text: '#111111', muted: '#6b6b6b', primary: '#111111', onPrimary: '#ffffff', accent: '#e4572e', sale: '#e4572e', border: '#e6e6e6' },
        fonts: {
            heading: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, 'Noto Sans Arabic', 'Geeza Pro', Tahoma, sans-serif",
            body: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, 'Noto Sans Arabic', 'Geeza Pro', Tahoma, sans-serif",
        },
        type: { baseSize: 16, scale: 1.28, headingWeight: '800', headingCase: 'none', headingTracking: -0.02, bodyTracking: 0 },
        shape: { radius: 6, buttonRadius: 999, cardRadius: 10 },
        layout: { container: 1280, sectionGap: 72, gridGap: 20 },
        style: { shadow: 'none', border: 1, imageFilter: 'none' },
    },
    header: { style: 'inline', sticky: true, announcement: true, nav: 'inline', search: true },
    productCard: { imageRatio: '3/4', style: 'plain', nameCase: 'none', align: 'start', showBrand: true, showColors: true, showSizes: false, badge: 'pill' },
    productPage: { layout: 'split', gallery: 'thumbs', sizes: 'buttons', colors: 'swatches', sticky: true, related: 4 },
    categoryPage: { desktopColumns: 4, mobileColumns: 2, filters: true, banner: true },
    footer: { style: 'columns' },
    home: [
        { type: 'hero', variant: 'split', cta: 'all' },
        { type: 'categories', style: 'tiles', limit: 6 },
        { type: 'products', source: 'new', limit: 8, layout: 'grid', columns: 4 },
        { type: 'promo', style: 'banner' },
        { type: 'products', source: 'featured', limit: 7, layout: 'large-first', columns: 4 },
        { type: 'brands', style: 'text' },
        { type: 'products', source: 'best', limit: 8, layout: 'grid', columns: 4 },
        { type: 'contact', style: 'card', whatsapp: true },
    ],
};
