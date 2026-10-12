/**
 * The website's own font: Cairo (SIL Open Font License, assets/fonts/OFL.txt),
 * served by the website itself (Content-Security-Policy font-src 'self', no
 * outside font service). Two files, each loaded only when the page has its
 * letters (unicode-range): an Arabic page with a few Latin brand names takes
 * both, about 65 KB once, then from the browser's cache.
 *
 * Themes name it "Afus Sans" in their font lists; a theme may still put
 * another font first (Georgia, Didot...) for its Latin titles: the Arabic
 * letters then come from Cairo, not from whatever the phone has.
 */
const fs = require('fs');
const path = require('path');

const FAMILY = 'Afus Sans';
const DIR = path.join(__dirname, 'assets', 'fonts');
const FILES = [
    {
        file: 'cairo-arabic.woff2',
        range: 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC',
    },
    {
        file: 'cairo-latin.woff2',
        range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
];

let cache = null;
/** The font files, read once: [{ path (published, next to the style sheet), file, data }]. */
function fontFiles() {
    if (!cache) cache = FILES.map(f => ({ file: f.file, path: `assets/fonts/${f.file}`, data: fs.readFileSync(path.join(DIR, f.file)) }));
    return cache;
}

/**
 * @font-face rules. url(file) says where each file is: next to the style
 * sheet on the website, a data: address in the program's own preview.
 */
function fontFaces(url) {
    return FILES.map(f => `@font-face{font-family:'${FAMILY}';font-style:normal;font-weight:200 1000;font-display:swap;src:url(${url(f.file)}) format('woff2');unicode-range:${f.range}}`).join('\n');
}

const SITE_URL = (file) => `fonts/${file}`;
const PREVIEW_URL = (file) => `data:font/woff2;base64,${fontFiles().find(f => f.file === file).data.toString('base64')}`;

module.exports = { FAMILY, fontFiles, fontFaces, SITE_URL, PREVIEW_URL };
