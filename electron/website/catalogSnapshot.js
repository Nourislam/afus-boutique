/**
 * The website's view of the shop: kept as the name used by the Website
 * screen; the work is done by publicData/ (SQLite internal data -> website
 * public data, checked).
 */
const { buildPublicData, summarize } = require('./publicData');

const buildSnapshot = (api, options = {}) => buildPublicData(api, options);

module.exports = { buildSnapshot, summarize };
