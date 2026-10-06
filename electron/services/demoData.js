/**
 * The demo shop: a clothing shop with three months of history, written into
 * the demo database only (see demoService.js). Same tables and rules as the
 * real program, so every screen has something to show: about 60 articles in
 * colours and sizes with local pictures, sales, returns, kridi and its
 * payments, two employees, closed cash drawers with expenses, customers,
 * suppliers and their deliveries.
 *
 * Deterministic: the same seed gives the same shop, dated from "now".
 */
const fs = require('fs');
const path = require('path');
const catalog = require('./catalogService');
const returnService = require('./returnService');
const { hashPin } = require('./pinService');
const { nextReceiptNumber } = require('./receiptNumber');
const CLOTHING = require('../shared/clothing.json');
const { getDatabase, bindable } = require('../database/init');

const DAYS = 90;

// The demo employees: PINs shown on the demo login screen, never real ones
const DEMO_STAFF = [
    { id: 'demo-admin', role: 'admin', pin: '1111', name: { ar: 'ياسين', fr: 'Yacine', en: 'Yacine' } },
    { id: 'demo-cashier', role: 'cashier', pin: '2222', name: { ar: 'لينة', fr: 'Lina', en: 'Lina' } },
];

const SHOP = {
    name: { ar: 'بوتيك الياسمين', fr: 'Boutique Yasmine', en: 'Yasmine Boutique' },
    city: { ar: 'باب الزوار', fr: 'Bab Ezzouar', en: 'Bab Ezzouar' },
};

// Sizes by kind of article
const SIZES = {
    top: ['S', 'M', 'L', 'XL'],
    dress: ['S', 'M', 'L'],
    jeans: ['30', '32', '34', '36', '38'],
    trousers: ['38', '40', '42', '44'],
    shoes: ['38', '39', '40', '41', '42', '43', '44'],
    kids: ['4Y', '6Y', '8Y', '10Y', '12Y'],
    one: ['TU'],
};
// Middle sizes sell more
const SIZE_WEIGHT = { S: 2, M: 4, L: 4, XL: 2, 30: 2, 32: 4, 34: 4, 36: 3, 38: 2, 40: 3, 42: 3, 44: 2, 39: 3, 41: 4, 43: 2, '4Y': 2, '6Y': 3, '8Y': 3, '10Y': 3, '12Y': 2, TU: 1 };

// [key, category code, picture, sizes, price, cost, colours, brand, gender, season, popularity, names ar | fr | en]
const ARTICLES = [
    ['TSB', 'tshirts', 'tshirt', 'top', 1500, 700, ['white', 'black', 'navy'], 'Casbah', 'men', 'all_year', 9, 'تيشيرت قطن أساسي', 'T-shirt coton basique', 'Basic cotton T-shirt'],
    ['TSO', 'tshirts', 'tshirt', 'top', 2200, 1000, ['black', 'grey', 'beige'], 'Casbah', 'unisex', 'summer', 6, 'تيشيرت واسع', 'T-shirt oversize', 'Oversized T-shirt'],
    ['TSP', 'tshirts', 'tshirt', 'top', 1900, 850, ['white', 'skyblue'], 'Atlas', 'men', 'summer', 4, 'تيشيرت مطبوع', 'T-shirt imprimé', 'Printed T-shirt'],
    ['TSW', 'tshirts', 'tshirt', 'top', 1700, 750, ['pink', 'white', 'yellow'], 'Yasmine', 'women', 'summer', 5, 'تيشيرت نسائي', 'T-shirt femme', "Women's T-shirt"],
    ['TSV', 'tshirts', 'tshirt', 'top', 1800, 800, ['green', 'navy'], 'Atlas', 'men', 'summer', 3, 'تيشيرت ياقة V', 'T-shirt col V', 'V-neck T-shirt'],
    ['CHL', 'shirts', 'shirt', 'top', 3900, 1900, ['white', 'skyblue', 'beige'], 'Medina', 'men', 'summer', 6, 'قميص كتان', 'Chemise en lin', 'Linen shirt'],
    ['CHO', 'shirts', 'shirt', 'top', 3500, 1700, ['blue', 'white'], 'Medina', 'men', 'all_year', 5, 'قميص أكسفورد', 'Chemise Oxford', 'Oxford shirt'],
    ['CHC', 'shirts', 'shirt', 'top', 3200, 1500, ['red', 'navy'], 'Atlas', 'men', 'winter', 3, 'قميص كاروه', 'Chemise à carreaux', 'Checked shirt'],
    ['CHF', 'shirts', 'shirt', 'top', 4200, 2000, ['white', 'black'], 'Yasmine', 'women', 'all_year', 4, 'قميص نسائي فضفاض', 'Chemise femme fluide', "Women's flowing shirt"],
    ['CHJ', 'shirts', 'shirt', 'top', 4500, 2200, ['blue'], 'Djurdjura', 'unisex', 'midseason', 3, 'قميص جينز', 'Chemise en jean', 'Denim shirt'],
    ['POC', 'polos', 'polo', 'top', 2800, 1300, ['navy', 'white', 'green'], 'Casbah', 'men', 'summer', 6, 'بولو كلاسيك', 'Polo classique', 'Classic polo'],
    ['POS', 'polos', 'polo', 'top', 3200, 1500, ['black', 'burgundy'], 'Atlas', 'men', 'summer', 3, 'بولو رياضي', 'Polo sport', 'Sport polo'],
    ['POL', 'polos', 'polo', 'top', 3600, 1700, ['grey', 'navy'], 'Medina', 'men', 'winter', 2, 'بولو أكمام طويلة', 'Polo manches longues', 'Long-sleeve polo'],
    ['JSL', 'jeans', 'trousers', 'jeans', 4900, 2400, ['blue', 'black'], 'Djurdjura', 'men', 'all_year', 8, 'جينز سليم', 'Jean slim', 'Slim jeans'],
    ['JDR', 'jeans', 'trousers', 'jeans', 4600, 2200, ['blue', 'navy'], 'Djurdjura', 'men', 'all_year', 6, 'جينز مستقيم', 'Jean droit', 'Straight jeans'],
    ['JMM', 'jeans', 'trousers', 'jeans', 5200, 2500, ['skyblue', 'blue'], 'Yasmine', 'women', 'all_year', 6, 'جينز موم', 'Jean mom', 'Mom jeans'],
    ['JLG', 'jeans', 'trousers', 'jeans', 5500, 2700, ['black', 'grey'], 'Yasmine', 'women', 'all_year', 4, 'جينز واسع', 'Jean large', 'Wide-leg jeans'],
    ['PCH', 'trousers', 'trousers', 'trousers', 3900, 1800, ['beige', 'khaki', 'navy'], 'Medina', 'men', 'all_year', 6, 'سروال شينو', 'Pantalon chino', 'Chino trousers'],
    ['PCA', 'trousers', 'trousers', 'trousers', 4200, 2000, ['khaki', 'black'], 'Atlas', 'men', 'all_year', 4, 'سروال كارغو', 'Pantalon cargo', 'Cargo trousers'],
    ['PTA', 'trousers', 'trousers', 'trousers', 4800, 2300, ['black', 'navy'], 'Medina', 'men', 'all_year', 3, 'سروال بدلة', 'Pantalon de costume', 'Suit trousers'],
    ['PPZ', 'trousers', 'trousers', 'trousers', 3600, 1700, ['beige', 'black', 'burgundy'], 'Yasmine', 'women', 'all_year', 4, 'سروال بلازو', 'Pantalon palazzo', 'Palazzo trousers'],
    ['JGB', 'trousers', 'trousers', 'top', 2900, 1300, ['grey', 'black'], 'Casbah', 'unisex', 'winter', 5, 'سروال رياضي', 'Jogging', 'Joggers'],
    ['RET', 'dresses', 'dress', 'dress', 5800, 2700, ['yellow', 'pink', 'white'], 'Yasmine', 'women', 'summer', 5, 'فستان صيفي', "Robe d'été", 'Summer dress'],
    ['RSO', 'dresses', 'dress', 'dress', 9500, 4500, ['burgundy', 'black', 'gold'], 'Yasmine', 'women', 'wedding', 3, 'فستان سهرة', 'Robe de soirée', 'Evening dress'],
    ['RLO', 'dresses', 'dress', 'dress', 6900, 3200, ['green', 'beige', 'navy'], 'Yasmine', 'women', 'all_year', 4, 'فستان طويل', 'Robe longue', 'Maxi dress'],
    ['RCH', 'dresses', 'dress', 'dress', 5200, 2400, ['skyblue', 'white'], 'Yasmine', 'women', 'midseason', 3, 'فستان قميص', 'Robe chemise', 'Shirt dress'],
    ['ABY', 'abayas', 'dress', 'dress', 7500, 3600, ['black', 'navy', 'brown'], 'Medina', 'women', 'all_year', 5, 'عباية مطرزة', 'Abaya brodée', 'Embroidered abaya'],
    ['ABS', 'abayas', 'dress', 'dress', 6200, 2900, ['black', 'beige'], 'Medina', 'women', 'ramadan', 4, 'عباية بسيطة', 'Abaya simple', 'Plain abaya'],
    ['JUP', 'skirts', 'skirt', 'dress', 3900, 1800, ['black', 'beige', 'burgundy'], 'Yasmine', 'women', 'all_year', 4, 'تنورة بليسيه', 'Jupe plissée', 'Pleated skirt'],
    ['JUJ', 'skirts', 'skirt', 'dress', 3500, 1600, ['blue', 'black'], 'Djurdjura', 'women', 'all_year', 3, 'تنورة جينز', 'Jupe en jean', 'Denim skirt'],
    ['JUL', 'skirts', 'skirt', 'dress', 4400, 2100, ['khaki', 'navy'], 'Yasmine', 'women', 'winter', 2, 'تنورة طويلة', 'Jupe longue', 'Long skirt'],
    ['VEJ', 'jackets', 'jacket', 'top', 7900, 3800, ['blue', 'black'], 'Djurdjura', 'unisex', 'midseason', 4, 'جاكيت جينز', 'Veste en jean', 'Denim jacket'],
    ['BLZ', 'jackets', 'jacket', 'top', 9800, 4800, ['navy', 'black', 'beige'], 'Medina', 'men', 'all_year', 3, 'بليزر', 'Blazer', 'Blazer'],
    ['DOU', 'jackets', 'jacket', 'top', 12500, 6200, ['black', 'khaki', 'navy'], 'Atlas', 'unisex', 'winter', 4, 'جاكيت منفوخ', 'Doudoune', 'Puffer jacket'],
    ['MAN', 'jackets', 'jacket', 'top', 14900, 7300, ['camel', 'black'], 'Medina', 'women', 'winter', 2, 'معطف طويل', 'Manteau long', 'Long coat'],
    ['BOM', 'jackets', 'jacket', 'top', 8500, 4100, ['khaki', 'black'], 'Atlas', 'men', 'midseason', 2, 'جاكيت بومبر', 'Blouson bomber', 'Bomber jacket'],
    ['PUC', 'knitwear', 'sweater', 'top', 4500, 2100, ['beige', 'grey', 'navy'], 'Casbah', 'unisex', 'winter', 5, 'كنزة صوف', 'Pull en laine', 'Wool sweater'],
    ['PUT', 'knitwear', 'sweater', 'top', 3900, 1800, ['black', 'cream'], 'Yasmine', 'women', 'winter', 3, 'كنزة ياقة عالية', 'Pull col roulé', 'Turtleneck sweater'],
    ['CAR', 'knitwear', 'sweater', 'top', 4800, 2300, ['burgundy', 'camel'], 'Yasmine', 'women', 'midseason', 2, 'كارديغان', 'Cardigan', 'Cardigan'],
    ['SWC', 'hoodies', 'sweater', 'top', 3800, 1700, ['grey', 'black', 'navy'], 'Casbah', 'unisex', 'winter', 6, 'هودي بقبعة', 'Sweat à capuche', 'Hoodie'],
    ['SWR', 'hoodies', 'sweater', 'top', 3200, 1500, ['beige', 'green'], 'Casbah', 'unisex', 'midseason', 3, 'سويتشيرت', 'Sweat col rond', 'Crewneck sweatshirt'],
    ['SHO', 'shorts', 'shorts', 'top', 2200, 1000, ['beige', 'navy', 'khaki'], 'Atlas', 'men', 'summer', 4, 'شورت شينو', 'Short chino', 'Chino shorts'],
    ['SHB', 'shorts', 'shorts', 'top', 1900, 850, ['blue', 'black'], 'Atlas', 'men', 'summer', 2, 'شورت سباحة', 'Short de bain', 'Swim shorts'],
    ['KTS', 'kids', 'tshirt', 'kids', 1200, 550, ['red', 'blue', 'yellow'], 'Mini', 'boys', 'summer', 5, 'تيشيرت أطفال', 'T-shirt enfant', "Kids' T-shirt"],
    ['KJE', 'kids', 'trousers', 'kids', 2400, 1100, ['blue'], 'Mini', 'boys', 'all_year', 4, 'جينز أطفال', 'Jean enfant', "Kids' jeans"],
    ['KRO', 'kids', 'dress', 'kids', 2900, 1300, ['pink', 'white', 'purple'], 'Mini', 'girls', 'eid', 4, 'فستان بنات', 'Robe fille', "Girls' dress"],
    ['KSW', 'kids', 'sweater', 'kids', 2600, 1200, ['grey', 'red'], 'Mini', 'unisex', 'winter', 3, 'هودي أطفال', 'Sweat enfant', "Kids' hoodie"],
    ['KEN', 'kids', 'jacket', 'kids', 4900, 2300, ['navy', 'pink'], 'Mini', 'unisex', 'winter', 2, 'جاكيت أطفال', 'Blouson enfant', "Kids' jacket"],
    ['BAS', 'shoes', 'shoe', 'shoes', 6500, 3200, ['white', 'black'], 'Atlas', 'unisex', 'all_year', 6, 'حذاء رياضي', 'Baskets', 'Sneakers'],
    ['MOC', 'shoes', 'shoe', 'shoes', 7200, 3500, ['brown', 'black'], 'Medina', 'men', 'all_year', 3, 'موكاسان جلد', 'Mocassins cuir', 'Leather loafers'],
    ['SAN', 'shoes', 'shoe', 'shoes', 3900, 1800, ['beige', 'black', 'gold'], 'Yasmine', 'women', 'summer', 4, 'صندل', 'Sandales', 'Sandals'],
    ['BOT', 'shoes', 'shoe', 'shoes', 9900, 4800, ['black', 'camel'], 'Yasmine', 'women', 'winter', 3, 'بوت', 'Bottines', 'Ankle boots'],
    ['ESC', 'shoes', 'shoe', 'shoes', 8500, 4200, ['black', 'burgundy'], 'Yasmine', 'women', 'wedding', 2, 'حذاء كعب', 'Escarpins', 'Heels'],
    ['ECH', 'scarves', 'scarf', 'one', 1500, 600, ['burgundy', 'beige', 'navy', 'grey'], 'Yasmine', 'women', 'winter', 5, 'شال', 'Écharpe', 'Scarf'],
    ['HIJ', 'scarves', 'scarf', 'one', 1200, 500, ['black', 'beige', 'pink', 'skyblue', 'green'], 'Medina', 'women', 'all_year', 7, 'حجاب شيفون', 'Hijab mousseline', 'Chiffon hijab'],
    ['CEI', 'belts', 'belt', 'one', 1800, 800, ['black', 'brown'], 'Medina', 'men', 'all_year', 4, 'حزام جلد', 'Ceinture cuir', 'Leather belt'],
    ['CAS', 'caps', 'cap', 'one', 1400, 600, ['black', 'navy', 'beige'], 'Casbah', 'unisex', 'summer', 4, 'قبعة', 'Casquette', 'Cap'],
    ['SAC', 'bags', 'bag', 'one', 4900, 2300, ['black', 'camel', 'beige'], 'Yasmine', 'women', 'all_year', 4, 'حقيبة يد', 'Sac à main', 'Handbag'],
    ['CHA', 'accessories', 'socks', 'one', 600, 250, ['black', 'white', 'grey'], 'Casbah', 'unisex', 'all_year', 6, 'جوارب (3 أزواج)', 'Chaussettes (lot de 3)', 'Socks (pack of 3)'],
    ['BON', 'caps', 'cap', 'one', 1300, 550, ['grey', 'burgundy', 'black'], 'Casbah', 'unisex', 'winter', 3, 'طاقية صوف', 'Bonnet', 'Beanie'],
];

// Categories the demo uses (names from the shared clothing list)
const CATEGORY_FALLBACK = {
    knitwear: { en: 'Knitwear', fr: 'Pulls', ar: 'كنزات', color: '#a16207' },
};

const CUSTOMERS = [
    ['Karima Benali', 'كريمة بن علي', '0661 23 45 67', true, 30000],
    ['Sofiane Haddad', 'سفيان حداد', '0770 11 22 33', true, 20000],
    ['Nadia Meziane', 'نادية مزيان', '0555 98 76 54', true, 40000],
    ['Amine Bouzid', 'أمين بوزيد', '0699 45 12 78', true, 15000],
    ['Samira Khelifi', 'سميرة خليفي', '0550 33 44 55', true, 25000],
    ['Walid Cherif', 'وليد شريف', '0771 65 43 21', false, 0],
    ['Imane Djebbar', 'إيمان جبار', '0662 87 65 43', false, 0],
    ['Rachid Ould Ali', 'رشيد ولد علي', '0698 21 43 65', false, 0],
    ['Lamia Saadi', 'لمياء سعدي', '0556 78 90 12', false, 0],
    ['Hakim Ferhat', 'حكيم فرحات', '0775 90 12 34', false, 0],
];

const SUPPLIERS = [
    ['Textiles El Djazair', 'نسيج الجزائر', 'Mourad', '0213 21 55 66 77', 'Alger'],
    ['Atelier Oran Mode', 'ورشة وهران للموضة', 'Fethi', '0213 41 22 33 44', 'Oran'],
    ['Istanbul Wholesale', 'جملة إسطنبول', 'Emre', '0090 212 555 0101', 'Istanbul'],
    ['Chaussures du Sahel', 'أحذية الساحل', 'Bilal', '0213 25 66 77 88', 'Blida'],
];

const EXPENSES = {
    ar: ['خبز وقهوة', 'تنظيف المحل', 'نقل السلع', 'أكياس', 'كهرباء صغيرة'],
    fr: ['Pain et café', 'Nettoyage', 'Transport marchandise', 'Sachets', 'Petite électricité'],
    en: ['Bread and coffee', 'Cleaning', 'Goods transport', 'Shopping bags', 'Small electricity'],
};

/** Small seeded random generator (mulberry32). */
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pad = (n) => String(n).padStart(2, '0');
/** The same text as SQLite's CURRENT_TIMESTAMP (UTC), so dates compare like real ones. */
const sqlTime = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const colorOf = (code) => CLOTHING.colors.find(c => c.code === code);
const pick = (random, list) => list[Math.floor(random() * list.length)];
function weighted(random, items, weightOf) {
    const total = items.reduce((s, it) => s + weightOf(it), 0);
    let r = random() * total;
    for (const it of items) { r -= weightOf(it); if (r <= 0) return it; }
    return items[items.length - 1];
}

/**
 * The same database adapter, with each SQL text prepared once and reused.
 * Building the shop runs about 11 000 statements; sql.js would otherwise
 * compile every one of them again (db.run), which is most of the time spent.
 * Used only inside the transaction that builds the shop (nothing is saved
 * statement by statement there), and freed at the end.
 */
function withPreparedStatements(api) {
    const db = getDatabase();
    const cache = new Map();
    const prepared = (sql) => {
        let stmt = cache.get(sql);
        if (!stmt) { stmt = db.prepare(sql); cache.set(sql, stmt); }
        return stmt;
    };
    const all = (sql, params = []) => {
        const stmt = prepared(sql);
        try {
            stmt.bind(bindable(params));
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
        } finally {
            stmt.reset();
        }
    };
    return {
        ...api,
        all,
        get: (sql, params = []) => all(sql, params)[0] || null,
        run: (sql, params = []) => { prepared(sql).run(bindable(params)); return true; },
        free: () => { for (const stmt of cache.values()) { try { stmt.free(); } catch { /* already freed */ } } cache.clear(); },
    };
}

/**
 * EAN-13 codes for the articles, as catalog.generateInternalBarcodes makes
 * them (same digits from the same random numbers). The demo database is empty
 * at this point, so only the codes made here can collide; no lookup needed.
 */
function demoBarcodes(count, random) {
    const taken = new Set();
    const codes = [];
    for (let attempts = 0; codes.length < count && attempts < count * 200; attempts++) {
        let body = '2' + Math.min(Math.floor(random() * 9), 8);
        for (let i = 0; i < 10; i++) body += Math.floor(random() * 10);
        const code = body + catalog.ean13CheckDigit(body);
        if (taken.has(code)) continue;
        taken.add(code);
        codes.push(code);
    }
    if (codes.length < count) throw new Error('Demo barcodes: not enough codes');
    return codes;
}

// The demo PINs are known to everybody: hashed once per run of the program
// (scrypt is slow on purpose), then reused when the demo is started again.
const demoPinHashes = new Map();
function demoPinHash(pin) {
    if (!demoPinHashes.has(pin)) demoPinHashes.set(pin, hashPin(pin));
    return demoPinHashes.get(pin);
}

/** Last stock movement written so far (the next ones are after it). */
const lastLogRow = (api) => api.get('SELECT COALESCE(MAX(rowid), 0) AS id FROM inventory_logs').id;

// ------------------------------------------------------------------
// Pictures: simple drawings of the garment in its colour, kept on disk
// ------------------------------------------------------------------
const SHAPES = {
    tshirt: 'M70 40 L100 28 Q120 44 140 28 L170 40 L200 80 L172 96 L164 84 L164 200 L76 200 L76 84 L68 96 L40 80 Z',
    shirt: 'M72 36 L104 26 L120 46 L136 26 L168 36 L196 92 L172 102 L164 88 L164 204 L76 204 L76 88 L68 102 L44 92 Z M120 46 L120 204',
    polo: 'M70 40 L104 28 L120 50 L136 28 L170 40 L198 82 L172 96 L164 86 L164 200 L76 200 L76 86 L68 96 L42 82 Z M112 30 L120 64 L128 30',
    trousers: 'M78 28 L162 28 L170 212 L132 212 L120 92 L108 212 L70 212 Z',
    dress: 'M96 26 L144 26 L150 70 L184 210 L56 210 L90 70 Z',
    skirt: 'M84 60 L156 60 L188 204 L52 204 Z',
    jacket: 'M66 38 L104 26 L120 60 L136 26 L174 38 L202 150 L176 156 L168 120 L168 210 L72 210 L72 120 L64 156 L38 150 Z M120 60 L120 210',
    sweater: 'M68 40 L100 30 Q120 46 140 30 L172 40 L204 150 L178 158 L166 100 L166 206 L74 206 L74 100 L62 158 L36 150 Z',
    shorts: 'M74 60 L166 60 L176 160 L130 160 L120 110 L110 160 L64 160 Z',
    shoe: 'M40 150 L90 120 L120 132 L176 140 Q204 146 204 168 L204 180 L40 180 Z',
    scarf: 'M86 30 L154 30 L154 160 L170 210 L140 210 L128 168 L112 168 L100 210 L70 210 L86 160 Z',
    belt: 'M30 104 L210 104 L210 136 L30 136 Z M150 96 L186 96 L186 144 L150 144 Z',
    cap: 'M60 140 Q60 70 120 70 Q180 70 180 140 Z M120 140 L214 150 L214 160 L110 156 Z',
    bag: 'M60 100 L180 100 L196 210 L44 210 Z M90 100 Q90 50 120 50 Q150 50 150 100',
    socks: 'M90 30 L130 30 L130 150 L170 170 Q186 190 168 206 L100 196 Q86 190 90 170 Z',
};

function garmentSvg(shape, hex) {
    const fill = String(hex || '#999').startsWith('linear') ? '#9b87f5' : hex;
    const light = ['#f5f5f5', '#fff8e7', '#e7d8b9', '#facc15', '#c0c0c0', '#7dd3fc'].includes(fill);
    const stroke = light ? '#6b6b6b' : 'rgba(0,0,0,0.35)';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" rx="24" fill="#eef0f3"/>`
        + `<path d="${SHAPES[shape] || SHAPES.tshirt}" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/></svg>`;
}

function logoSvg(letter) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="44" fill="#9d174d"/>`
        + '<circle cx="100" cy="100" r="62" fill="none" stroke="#fbcfe8" stroke-width="6"/>'
        + `<text x="100" y="125" font-family="Georgia, serif" font-size="80" font-weight="bold" fill="#fdf2f8" text-anchor="middle">${letter}</text></svg>`;
}

// ------------------------------------------------------------------
// The shop
// ------------------------------------------------------------------

/**
 * Fill an empty (just created) demo database.
 * @param api       database adapter of the OPEN database (the demo file)
 * @param options   { lang: 'ar'|'fr'|'en', imagesDir, now: Date, seed }
 */
function seedDemoShop(baseApi, options = {}) {
    const api = withPreparedStatements(baseApi);
    try {
        return buildShop(api, options);
    } finally {
        api.free();
    }
}

function buildShop(api, { lang = 'ar', imagesDir, now = new Date(), seed = 20261006 } = {}) {
    const random = seeded(seed);
    const tr = (obj) => obj[lang] || obj.fr;
    const setSetting = (key, value) => api.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
    const at = (daysAgo, hour, minute = 0) => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute, Math.floor(random() * 60));
        return d;
    };

    if (imagesDir) fs.mkdirSync(imagesDir, { recursive: true });
    const writeImage = (name, svg) => { if (imagesDir) fs.writeFileSync(path.join(imagesDir, name), svg); return name; };

    // Shop identity and choices: the whole menu, every useful module
    const shopName = tr(SHOP.name);
    setSetting('store_config', {
        businessName: shopName, shopLogo: writeImage('demo-logo.svg', logoSvg(lang === 'ar' ? 'ي' : 'Y')),
        ownerName: tr(DEMO_STAFF[0].name), businessPhone: '0555 12 34 56', businessEmail: '',
        businessAddress: lang === 'ar' ? 'شارع الاستقلال، رقم 12' : lang === 'fr' ? "12, rue de l'Indépendance" : '12 Independence Street',
        businessWilaya: '16 - Alger', businessCity: tr(SHOP.city), defaultLanguage: lang,
        currency: 'DZD', currencySymbol: 'DA', taxRate: 0, taxName: 'TVA', taxType: 'inclusive', receiptShowBrand: true,
    });
    setSetting('ui_mode', 'full');
    setSetting('features', { credit: true, customers: true, promotions: true, bundles: true, giftCards: false, suppliers: true, purchaseOrders: true, email: false, ecommerce: false });
    setSetting('setup_completed', 'true');
    setSetting('demo_shop', true);

    // Employees (PINs hashed like real ones)
    for (const staff of DEMO_STAFF) {
        api.run('INSERT INTO employees (id, name, pin, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
            [staff.id, tr(staff.name), demoPinHash(staff.pin), staff.role, sqlTime(at(DAYS + 10, 9))]);
    }
    const cashier = DEMO_STAFF[1].id;
    const admin = DEMO_STAFF[0].id;

    // Categories
    const categoryIds = {};
    for (const code of [...new Set(ARTICLES.map(a => a[1]))]) {
        const entry = CLOTHING.categories.find(c => c.code === code) || CATEGORY_FALLBACK[code] || { en: code, fr: code, ar: code, color: '#6366f1' };
        categoryIds[code] = `demo-cat-${code}`;
        api.run('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)', [categoryIds[code], entry[lang] || entry.fr, entry.color || '#6366f1']);
    }

    // Suppliers
    const supplierIds = SUPPLIERS.map(([fr, ar, contact, phone, city], i) => {
        const id = `demo-sup-${i + 1}`;
        api.run('INSERT INTO suppliers (id, name, contact_person, phone, address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [id, lang === 'ar' ? ar : fr, contact, phone, city, sqlTime(at(DAYS + 20, 10))]);
        return id;
    });

    // Customers (half of them may buy on kridi)
    const customers = CUSTOMERS.map(([latin, ar, phone, credit, limit], i) => {
        const id = `demo-cus-${i + 1}`;
        api.run('INSERT INTO customers (id, name, phone, credit_enabled, credit_limit, credit_balance, is_active, created_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?)',
            [id, lang === 'ar' ? ar : latin, phone, credit ? 1 : 0, limit, sqlTime(at(DAYS + 5 - i, 11))]);
        return { id, credit };
    });
    const creditCustomers = customers.filter(c => c.credit);

    // ---- Plan three months of tickets first, to know how much stock each piece needed
    const variantsPlan = [];
    const articles = ARTICLES.map(([key, cat, shape, sizeKind, price, cost, colors, brand, gender, season, popularity, ar, fr, en], index) => {
        const sizes = SIZES[sizeKind];
        const variants = [];
        for (const code of colors) {
            const color = colorOf(code);
            for (const size of sizes) {
                // One-size articles (scarves, bags...): the colour only, like in the product form
                const v = { key: `${key}-${color.sku}-${size}`, colorCode: code, color: color[lang] || color.fr, size: size === 'TU' ? null : size, sold: 0, weight: (SIZE_WEIGHT[size] || 2) };
                variants.push(v);
                variantsPlan.push(v);
            }
        }
        return { id: `demo-prd-${key.toLowerCase()}`, key, cat, shape, price, cost, colors, brand, gender, season, popularity, name: { ar, fr, en }[lang] || fr, variants, supplier: supplierIds[index % supplierIds.length] };
    });

    const days = [];
    for (let d = DAYS; d >= 0; d--) {
        const date = at(d, 12);
        const weekday = date.getDay(); // 5 = Friday (mostly closed in the morning), 4/6 busy
        const base = weekday === 5 ? 3 : weekday === 4 || weekday === 6 ? 11 : 7;
        // Busier in the last weeks (season, Eid...)
        const trend = 1 + (DAYS - d) / DAYS * 0.5;
        let count = Math.max(1, Math.round(base * trend * (0.7 + random() * 0.6)));
        // Today: only the morning so far
        const closeHour = d === 0 ? Math.min(19, Math.max(10, now.getHours())) : 19;
        if (d === 0) count = Math.max(0, Math.round(count * Math.max(0, (now.getHours() - 9.5)) / 10));
        const tickets = [];
        for (let i = 0; i < count; i++) {
            const lines = [];
            const nLines = random() < 0.62 ? 1 : random() < 0.75 ? 2 : 3;
            for (let l = 0; l < nLines; l++) {
                const article = weighted(random, articles, a => a.popularity);
                const variant = weighted(random, article.variants, v => v.weight);
                const quantity = article.cost < 700 && random() < 0.3 ? 2 : 1;
                const same = lines.find(x => x.variant === variant);
                if (same) same.quantity += quantity; else lines.push({ article, variant, quantity });
                variant.sold += quantity;
            }
            const minute = Math.floor(9.6 * 60 + random() * ((closeHour - 9.6) * 60 - 10));
            tickets.push({ time: at(d, Math.floor(minute / 60), minute % 60), lines });
        }
        tickets.sort((a, b) => a.time - b.time);
        days.push({ daysAgo: d, tickets });
    }

    // ---- Articles with their stock: what is left today + what was sold
    const barcodes = demoBarcodes(variantsPlan.length, random);
    let barcodeIndex = 0;
    for (const article of articles) {
        const image = writeImage(`demo-${article.key.toLowerCase()}.svg`, garmentSvg(article.shape, colorOf(article.colors[0]).hex));
        const variants = article.variants.map((v) => {
            // A few pieces sold out, some running low, the rest in stock
            const r = random();
            v.left = r < 0.04 ? 0 : r < 0.12 ? 1 + Math.floor(random() * 2) : 3 + Math.floor(random() * 10);
            return {
                color: v.color, color_code: v.colorCode, size: v.size,
                sku: `DM-${v.key}`, barcode: barcodes[barcodeIndex++],
                stock_quantity: v.left + v.sold, min_stock_level: 2,
            };
        });
        catalog.saveProduct(api, {
            id: article.id, name: article.name, category_id: categoryIds[article.cat], supplier_id: article.supplier,
            price: article.price, cost: article.cost, min_stock_level: 2, brand: article.brand, gender: article.gender,
            season: article.season, image_path: image, has_colors: true, has_sizes: article.variants.some(v => v.size),
        }, variants, { employeeId: admin, isNew: true });
        const saved = catalog.getVariants(api, article.id);
        for (const v of article.variants) v.id = saved.find(s => s.sku === `DM-${v.key}`).id;
        // The stock arrived three months ago with the first delivery
        api.run('UPDATE inventory_logs SET created_at = ? WHERE product_id = ?', [sqlTime(at(DAYS + 2, 10)), article.id]);
        api.run('UPDATE products SET created_at = ? WHERE id = ?', [sqlTime(at(DAYS + 3, 10)), article.id]);
    }

    // ---- Deliveries from the suppliers (two received, one paid in part, one waiting)
    const orders = [
        { supplier: 0, daysAgo: DAYS + 2, status: 'received', paid: 1 },
        { supplier: 2, daysAgo: 45, status: 'received', paid: 0.5 },
        { supplier: 3, daysAgo: 20, status: 'received', paid: 0 },
        { supplier: 1, daysAgo: 2, status: 'draft', paid: 0 },
    ];
    orders.forEach((order, i) => {
        const id = `demo-po-${i + 1}`;
        const items = articles.filter(a => a.supplier === supplierIds[order.supplier]).slice(0, 5);
        let total = 0;
        const created = sqlTime(at(order.daysAgo, 10));
        const lines = items.map(a => { const qty = 6 + Math.floor(random() * 10); total += qty * a.cost; return { a, qty }; });
        const paid = Math.round(total * order.paid);
        api.run(`INSERT INTO purchase_orders (id, po_number, supplier_id, status, subtotal, total, amount_paid, payment_status, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, `PO-DEMO-${String(i + 1).padStart(3, '0')}`, supplierIds[order.supplier], order.status, total, total, paid,
                paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid', admin, created]);
        for (const { a, qty } of lines) {
            api.run(`INSERT INTO purchase_order_items (id, purchase_order_id, product_id, product_name, quantity, unit_cost, total_cost, received_quantity)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [api.uuid(), id, a.id, a.name, qty, a.cost, qty * a.cost, order.status === 'received' ? qty : 0]);
        }
        if (order.status === 'received') {
            const rid = `demo-rcv-${i + 1}`;
            api.run('INSERT INTO receivings (id, receive_number, purchase_order_id, supplier_id, received_date, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [rid, `REC-DEMO-${String(i + 1).padStart(3, '0')}`, id, supplierIds[order.supplier], created, 'completed', admin, created]);
            for (const { a, qty } of lines) {
                api.run('INSERT INTO receiving_items (id, receiving_id, product_id, product_name, quantity_ordered, quantity_received) VALUES (?, ?, ?, ?, ?, ?)',
                    [api.uuid(), rid, a.id, a.name, qty, qty]);
            }
        }
        if (paid > 0) {
            api.run('INSERT INTO supplier_payments (id, purchase_order_id, supplier_id, amount, payment_method, paid_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [api.uuid(), id, supplierIds[order.supplier], paid, 'cash', created, admin]);
        }
    });

    // ---- The days: open the drawer, sell, sometimes spend, close
    const expenseReasons = EXPENSES[lang] || EXPENSES.fr;
    const creditOpen = [];
    let creditCount = 0;
    let returnCount = 0;
    const soldLines = [];
    for (const day of days) {
        const opening = 5000;
        // Cash expected in the drawer at closing, counted as the day goes
        // (same rule as shiftService.getShiftStats: cash sales + kridi paid in
        // cash - refunds of tickets not on kridi - expenses; checked in the tests)
        let drawer = opening;
        const shiftStart = at(day.daysAgo, 9, 20);
        const shiftId = `demo-shift-${day.daysAgo}`;
        api.run('INSERT INTO shifts (id, employee_id, start_time, opening_cash, notes) VALUES (?, ?, ?, ?, ?)',
            [shiftId, cashier, shiftStart.toISOString(), opening, '']);

        for (const ticket of day.tickets) {
            const saleId = api.uuid();
            const receipt = nextReceiptNumber(api, ticket.time);
            // Kridi for a few tickets, when a customer may buy on kridi
            const methodRoll = random();
            const credit = methodRoll < 0.08 && day.daysAgo > 0;
            const method = credit ? 'credit' : methodRoll < 0.78 ? 'cash' : methodRoll < 0.9 ? 'card' : 'transfer';
            const customer = credit ? pick(random, creditCustomers) : (random() < 0.15 ? pick(random, customers) : null);
            // Some bargaining: a round amount off
            const subtotal = ticket.lines.reduce((s, l) => s + l.quantity * l.article.price, 0);
            const discount = random() < 0.12 ? Math.min(500, Math.round(subtotal * 0.05 / 100) * 100) : 0;
            const total = subtotal - discount;
            const created = sqlTime(ticket.time);
            const logsBefore = lastLogRow(api);
            api.run(`INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, tax_amount, discount_amount, total, status, created_at)
                     VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'completed', ?)`, [saleId, receipt, cashier, customer ? customer.id : null, subtotal, discount, total, created]);
            for (const line of ticket.lines) {
                const lineId = api.uuid();
                const v = line.variant;
                api.run(`INSERT INTO sale_items (id, sale_id, product_id, variant_id, variant_label, sku, product_name, quantity, unit_price, discount, total, unit_cost)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                    [lineId, saleId, line.article.id, v.id, catalog.variantLabel(v), `DM-${v.key}`,
                        line.article.name, line.quantity, line.article.price, line.quantity * line.article.price, line.article.cost]);
                catalog.adjustStock(api, { productId: line.article.id, variantId: v.id, delta: -line.quantity, type: 'sale', reason: `Sale #${receipt}`, employeeId: cashier });
                soldLines.push({ saleId, lineId, line, time: ticket.time, receipt, credit, method });
            }
            // The ticket's stock movements: the rows written since logsBefore
            api.run('UPDATE inventory_logs SET created_at = ? WHERE rowid > ?', [created, logsBefore]);
            api.run('INSERT INTO payments (id, sale_id, method, amount, created_at) VALUES (?, ?, ?, ?, ?)', [api.uuid(), saleId, method, total, created]);
            if (method === 'cash') drawer += total;
            if (customer) api.run('UPDATE customers SET total_spent = total_spent + ? WHERE id = ?', [total, customer.id]);
            if (credit) {
                creditCount++;
                const creditId = api.uuid();
                const due = new Date(ticket.time.getTime() + 30 * 86400000);
                const yymmdd = `${String(ticket.time.getFullYear()).slice(-2)}${pad(ticket.time.getMonth() + 1)}${pad(ticket.time.getDate())}`;
                api.run(`INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, amount_paid, status, due_date, created_at)
                         VALUES (?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
                    [creditId, saleId, customer.id, `INV-${yymmdd}-${String(creditCount).padStart(4, '0')}`, total, due.toISOString(), created]);
                api.run('UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?', [total, customer.id]);
                creditOpen.push({ id: creditId, customer: customer.id, total, time: ticket.time, paid: 0 });
            }
        }

        // Kridi paid back in the drawer, a few weeks after
        for (const debt of creditOpen) {
            const age = (at(day.daysAgo, 12) - debt.time) / 86400000;
            if (debt.paid >= debt.total || age < 7 || random() > 0.08) continue;
            const amount = Math.min(debt.total - debt.paid, random() < 0.5 ? debt.total - debt.paid : Math.round(debt.total / 2 / 100) * 100);
            if (amount <= 0) continue;
            const when = sqlTime(at(day.daysAgo, 16, Math.floor(random() * 50)));
            api.run('INSERT INTO credit_payments (id, credit_sale_id, amount, payment_method, received_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [api.uuid(), debt.id, amount, 'cash', cashier, when]);
            debt.paid += amount;
            drawer += amount;
            api.run('UPDATE credit_sales SET amount_paid = ?, status = ? WHERE id = ?', [debt.paid, debt.paid >= debt.total ? 'paid' : 'partial', debt.id]);
            api.run('UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?', [amount, debt.customer]);
        }

        // A piece brought back now and then (a few days after the sale)
        if (day.daysAgo > 0 && random() < 0.35) {
            const candidates = soldLines.filter(s => !s.credit && !s.returned && (at(day.daysAgo, 12) - s.time) / 86400000 >= 1 && (at(day.daysAgo, 12) - s.time) / 86400000 < 8);
            if (candidates.length) {
                const s = pick(random, candidates);
                s.returned = true;
                returnCount++;
                const returnId = api.uuid();
                const sellable = random() < 0.8;
                const logsBefore = lastLogRow(api);
                returnService.createReturn(api, {
                    id: returnId, sale_id: s.saleId, return_number: `RET-DEMO-${String(returnCount).padStart(3, '0')}`,
                    total_refund: s.line.article.price, reason: sellable ? 'size' : 'defect', employee_id: cashier,
                    items: [{ sale_item_id: s.lineId, quantity: 1, refund_amount: s.line.article.price, condition: sellable ? 'sellable' : 'damaged' }],
                });
                const when = sqlTime(at(day.daysAgo, 15, Math.floor(random() * 50)));
                api.run('UPDATE returns SET created_at = ? WHERE id = ?', [when, returnId]);
                drawer -= s.line.article.price;
                api.run('UPDATE inventory_logs SET created_at = ? WHERE rowid > ?', [when, logsBefore]);
            }
        }

        // Money taken out for the shop
        if (random() < 0.3) {
            const amount = (2 + Math.floor(random() * 12)) * 100;
            api.run('INSERT INTO cash_expenses (id, shift_id, employee_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [api.uuid(), shiftId, cashier, amount, pick(random, expenseReasons), sqlTime(at(day.daysAgo, 13, Math.floor(random() * 50)))]);
            drawer -= amount;
        }

        // Closing, except today's drawer which is still open
        if (day.daysAgo > 0) {
            const end = at(day.daysAgo, 19, 30);
            api.run('UPDATE shifts SET end_time = ? WHERE id = ?', [end.toISOString(), shiftId]);
            const expected = Math.round(drawer * 100) / 100;
            // Usually right, sometimes a small difference
            const roll = random();
            const diff = roll < 0.8 ? 0 : roll < 0.9 ? -100 : roll < 0.95 ? -50 : 50;
            const counted = Math.max(0, Math.round(expected + diff));
            const notes = {};
            let rest = counted;
            for (const value of [2000, 1000, 500, 200, 100, 50, 20, 10, 5]) { const n = Math.floor(rest / value); if (n) notes[value] = n; rest -= n * value; }
            api.run('UPDATE shifts SET closing_cash = ?, closing_count = ? WHERE id = ?', [counted, JSON.stringify(notes), shiftId]);
        }
    }

    // One old kridi left unpaid, so the overdue list is not empty
    const oldest = creditOpen.find(d => d.paid < d.total && (now - d.time) / 86400000 > 40);
    if (!oldest && creditOpen.length) {
        const debt = creditOpen[0];
        api.run('UPDATE credit_sales SET due_date = ? WHERE id = ?', [new Date(now.getTime() - 10 * 86400000).toISOString(), debt.id]);
    }

    // A season discount ending soon (shows in the offers and on the dashboard)
    const ends = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10);
    const starts = new Date(now.getTime() - 12 * 86400000).toISOString().slice(0, 10);
    api.run(`INSERT INTO promotions (id, name, description, type, value, start_date, end_date, is_active, applies_to, applies_to_ids, auto_apply)
             VALUES (?, ?, ?, 'percentage', 20, ?, ?, 1, 'category', ?, 1)`,
        ['demo-promo-1', lang === 'ar' ? 'تخفيضات الشالات' : lang === 'fr' ? 'Soldes écharpes' : 'Scarf sale', '', starts, ends, JSON.stringify([categoryIds.scarves])]);

    return {
        articles: articles.length,
        variants: variantsPlan.length,
        sales: days.reduce((s, d) => s + d.tickets.length, 0),
        returns: returnCount,
        credits: creditCount,
        staff: DEMO_STAFF.map(s => ({ id: s.id, role: s.role, pin: s.pin, name: tr(s.name) })),
    };
}

/** The demo employees as the login screen shows them (name, role, PIN). */
function demoStaff(lang = 'ar') {
    return DEMO_STAFF.map(s => ({ id: s.id, role: s.role, pin: s.pin, name: s.name[lang] || s.name.fr }));
}

module.exports = { seedDemoShop, demoStaff, DEMO_STAFF, ARTICLES, seeded, sqlTime };
