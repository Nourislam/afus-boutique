// Streetwear: dark pages, neon accent, heavy capitals, photos in black and white until hovered.
module.exports = {
    id: 'streetwear',
    version: 1,
    name: { ar: 'ستريت وير', fr: 'Streetwear', en: 'Streetwear' },
    description: {
        ar: 'خلفية داكنة ولون فسفوري وعناوين ضخمة. للملابس الرياضية والشبابية والأحذية.',
        fr: 'Fond sombre, accent fluo, grosses capitales. Pour le sportswear et les sneakers.',
        en: 'Dark pages, neon accent, heavy capitals. For sportswear, youth fashion and sneakers.',
    },
    tags: ['youth', 'sport', 'sneakers'],
    tokens: {
        colors: { background: '#0e0e0e', surface: '#1a1a1a', text: '#f5f5f5', muted: '#a3a3a3', primary: '#d4ff00', onPrimary: '#0e0e0e', accent: '#d4ff00', sale: '#ff3b30', border: '#2a2a2a' },
        fonts: {
            heading: "'Archivo Black', 'Arial Black', Impact, 'Noto Sans Arabic', Tahoma, sans-serif",
            body: "'Inter', 'Segoe UI', Arial, 'Noto Sans Arabic', Tahoma, sans-serif",
        },
        type: { baseSize: 15, scale: 1.36, headingWeight: '900', headingCase: 'upper', headingTracking: -0.01, bodyTracking: 0 },
        shape: { radius: 2, buttonRadius: 2, cardRadius: 2 },
        layout: { container: 1440, sectionGap: 64, gridGap: 12 },
        style: { shadow: 'none', border: 2, imageFilter: 'mono-hover' },
    },
    header: { style: 'bold', sticky: true, announcement: true, nav: 'tabs', search: true },
    productCard: { imageRatio: '4/5', style: 'overlay', nameCase: 'upper', align: 'start', showBrand: true, showColors: false, showSizes: true, badge: 'corner' },
    productPage: { layout: 'split', gallery: 'grid', sizes: 'buttons', colors: 'chips', sticky: true, related: 4 },
    categoryPage: { desktopColumns: 4, mobileColumns: 2, filters: true, banner: true },
    footer: { style: 'columns' },
    home: [
        { type: 'hero', variant: 'full', cta: 'sale' },
        { type: 'promo', style: 'strip' },
        { type: 'products', source: 'new', limit: 10, layout: 'carousel', columns: 4 },
        { type: 'categories', style: 'tiles', limit: 4, title: true },
        { type: 'products', source: 'sale', limit: 8, layout: 'grid', columns: 4 },
        { type: 'brands', style: 'boxed' },
        { type: 'contact', style: 'strip', whatsapp: true },
    ],
};
