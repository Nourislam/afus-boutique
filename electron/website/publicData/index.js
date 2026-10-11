/**
 * The website's data: the line between the shop's SQLite database
 * (internal.js, read only) and what the website shows (public.js), checked
 * before it goes anywhere (guard.js).
 *
 *   buildPublicData(api, { now, info, secrets, preview }) -> public data
 *     preview: for the program's own preview (SVG drawings allowed, never published)
 *     throws { code: 'WEBSITE_PRIVATE_DATA', problems } when the check fails
 *   summarize(data) -> the figures shown on the Website screen
 */
const { readInternal, readPrivateMarkers } = require('./internal');
const { toPublic, publicInfo, PUBLIC_SHAPE } = require('./public');
const { checkPublic, checkFiles, allowedOf } = require('./guard');

class PrivateDataError extends Error {
    constructor(problems) {
        super('private data in the website');
        this.code = 'WEBSITE_PRIVATE_DATA';
        this.reason = 'private_data';
        this.problems = problems;
    }
}

function buildPublicData(api, { now = Date.now(), info = {}, secrets = [], preview = false } = {}) {
    const data = toPublic(readInternal(api), { now, info, preview });
    const problems = checkPublic(data, { markers: readPrivateMarkers(api), secrets });
    if (problems.length) throw new PrivateDataError(problems);
    return data;
}

/** The website's files hold nothing private either (same markers and keys). */
function checkSiteFiles(api, files, { data, secrets = [] } = {}) {
    const problems = checkFiles(files, { markers: readPrivateMarkers(api), secrets, allowed: allowedOf(data) });
    if (problems.length) throw new PrivateDataError(problems);
}

function summarize(data) {
    const products = data.products;
    return {
        products: products.length,
        available: products.filter(p => p.available).length,
        onSale: products.filter(p => p.salePrice !== null && p.salePrice < p.price).length,
        withImages: products.filter(p => p.images.length > 0).length,
        categories: data.categories.length,
    };
}

module.exports = { buildPublicData, checkSiteFiles, summarize, publicInfo, PrivateDataError, PUBLIC_SHAPE };
