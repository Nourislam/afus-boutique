// Minimal: nothing but the articles; square photos, thin lines, a menu button.
const SANS = "'Afus Sans', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

module.exports = {
    id: 'minimal',
    version: 1,
    name: { ar: 'بسيط', fr: 'Minimal', en: 'Minimal' },
    description: {
        ar: 'السلع فقط دون زخرفة: صور مربعة وخطوط رفيعة وقائمة مخفية.',
        fr: 'Seulement les articles : photos carrées, traits fins, menu replié.',
        en: 'Just the products: square photos, thin lines, a folded menu.',
    },
    tags: ['basics', 'unisex', 'everyday'],
    tokens: {
        colors: { background: '#fcfbf8', surface: '#f3f1ec', text: '#1d1d1d', muted: '#8a8a8a', primary: '#1d1d1d', onPrimary: '#ffffff', accent: '#1d1d1d', sale: '#b91c1c', border: '#ececec' },
        fonts: {
            heading: "'Helvetica Neue', Helvetica, Arial, 'Afus Sans', sans-serif",
            body: SANS,
        },
        type: { baseSize: 15, scale: 1.2, headingWeight: '500', headingCase: 'none', headingTracking: 0, bodyTracking: 0.01 },
        shape: { radius: 0, buttonRadius: 0, cardRadius: 0 },
        layout: { container: 1360, sectionGap: 56, gridGap: 24 },
        style: { shadow: 'none', border: 1, imageFilter: 'none' },
    },
    header: { style: 'minimal', sticky: true, announcement: false, nav: 'drawer', search: false },
    productCard: { imageRatio: '4/5', style: 'plain', nameCase: 'none', align: 'start', showBrand: false, showColors: true, showSizes: false, badge: 'text' },
    productPage: { layout: 'split', gallery: 'stack', sizes: 'list', colors: 'chips', sticky: true, related: 4 },
    categoryPage: { desktopColumns: 4, mobileColumns: 2, filters: true, banner: false },
    footer: { style: 'simple' },
    home: [
        { type: 'hero', variant: 'centered', cta: 'all' },
        { type: 'trust', style: 'strip' },
        { type: 'categories', style: 'pills', limit: 10, title: false },
        { type: 'products', source: 'all', limit: 12, layout: 'grid', columns: 4, seeAll: true },
        { type: 'products', source: 'best', limit: 8, layout: 'grid', columns: 4 },
        { type: 'contact', style: 'strip', whatsapp: true },
    ],
};
