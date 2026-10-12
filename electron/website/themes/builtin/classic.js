// Classic: navy and brick, serif titles, framed cards with the sizes shown.
const SANS = "'Afus Sans', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

module.exports = {
    id: 'classic',
    version: 1,
    name: { ar: 'كلاسيكي', fr: 'Classique', en: 'Classic' },
    description: {
        ar: 'أزرق داكن وخط كلاسيكي وبطاقات بإطار تظهر فيها المقاسات. للمحلات العائلية والرجالية.',
        fr: 'Bleu marine, titres à empattements, cartes encadrées avec les tailles. Pour les boutiques familiales.',
        en: 'Navy, serif titles, framed cards showing the sizes. For family and menswear shops.',
    },
    tags: ['men', 'family', 'formal'],
    tokens: {
        colors: { background: '#ffffff', surface: '#f4f1ec', text: '#2b2b2b', muted: '#6f6a63', primary: '#1f3a5f', onPrimary: '#ffffff', accent: '#a0522d', sale: '#b4232a', border: '#e3ddd3' },
        fonts: {
            heading: "Georgia, 'Times New Roman', 'Afus Sans', serif",
            body: SANS,
        },
        type: { baseSize: 16, scale: 1.25, headingWeight: '700', headingCase: 'none', headingTracking: 0, bodyTracking: 0 },
        shape: { radius: 4, buttonRadius: 4, cardRadius: 6 },
        layout: { container: 1200, sectionGap: 64, gridGap: 20 },
        style: { shadow: 'none', border: 1, imageFilter: 'none' },
    },
    header: { style: 'inline', sticky: true, announcement: true, nav: 'inline', search: true },
    productCard: { imageRatio: '3/4', style: 'bordered', nameCase: 'none', align: 'start', showBrand: true, showColors: true, showSizes: true, badge: 'ribbon' },
    productPage: { layout: 'split', gallery: 'thumbs', sizes: 'buttons', colors: 'swatches', sticky: false, related: 4 },
    categoryPage: { desktopColumns: 4, mobileColumns: 2, filters: true, banner: true },
    footer: { style: 'columns' },
    home: [
        { type: 'hero', variant: 'split', cta: 'all' },
        { type: 'trust', style: 'cards' },
        { type: 'categories', style: 'tiles', limit: 6 },
        { type: 'products', source: 'featured', limit: 8, layout: 'grid', columns: 4 },
        { type: 'promo', style: 'split' },
        { type: 'about', style: 'plain' },
        { type: 'products', source: 'new', limit: 4, layout: 'grid', columns: 4 },
        { type: 'products', source: 'best', limit: 8, layout: 'grid', columns: 4 },
        { type: 'contact', style: 'card', whatsapp: true },
    ],
};
