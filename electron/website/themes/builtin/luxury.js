// Luxury: ivory and gold, serif capitals, wide spaces, few articles at a time.
module.exports = {
    id: 'luxury',
    version: 1,
    name: { ar: 'فاخر', fr: 'Luxe', en: 'Luxury' },
    description: {
        ar: 'لون عاجي وذهبي وخط كلاسيكي ومساحات واسعة. للأزياء الراقية والفساتين والجلود.',
        fr: 'Ivoire et or, capitales à empattements, grands espaces. Pour la mode haut de gamme.',
        en: 'Ivory and gold, serif capitals, generous space. For high-end fashion.',
    },
    tags: ['premium', 'women', 'evening'],
    tokens: {
        colors: { background: '#faf7f2', surface: '#f1ebe1', text: '#1c1a17', muted: '#7a7064', primary: '#1c1a17', onPrimary: '#faf7f2', accent: '#b08d57', sale: '#8c2f39', border: '#e4dccd' },
        fonts: {
            heading: "'Playfair Display', 'Bodoni 72', Didot, Georgia, 'Noto Naskh Arabic', 'Times New Roman', serif",
            body: "'Lato', 'Segoe UI', 'Helvetica Neue', Arial, 'Noto Sans Arabic', Tahoma, sans-serif",
        },
        type: { baseSize: 15, scale: 1.33, headingWeight: '400', headingCase: 'upper', headingTracking: 0.12, bodyTracking: 0.01 },
        shape: { radius: 0, buttonRadius: 0, cardRadius: 0 },
        layout: { container: 1200, sectionGap: 104, gridGap: 32 },
        style: { shadow: 'none', border: 1, imageFilter: 'warm' },
    },
    header: { style: 'centered', sticky: true, announcement: true, nav: 'inline', search: false },
    productCard: { imageRatio: '2/3', style: 'plain', nameCase: 'upper', align: 'center', showBrand: true, showColors: false, showSizes: false, badge: 'text' },
    productPage: { layout: 'split', gallery: 'stack', sizes: 'pills', colors: 'chips', sticky: true, related: 3 },
    categoryPage: { desktopColumns: 3, mobileColumns: 2, filters: false, banner: true },
    footer: { style: 'dark' },
    home: [
        { type: 'hero', variant: 'editorial', cta: 'all' },
        { type: 'products', source: 'featured', limit: 6, layout: 'grid', columns: 3, seeAll: true },
        { type: 'about', style: 'centered' },
        { type: 'categories', style: 'list', limit: 8 },
        { type: 'products', source: 'new', limit: 8, layout: 'carousel', columns: 3 },
        { type: 'products', source: 'best', limit: 8, layout: 'grid', columns: 4 },
        { type: 'contact', style: 'strip', whatsapp: true },
    ],
};
