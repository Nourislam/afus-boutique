/**
 * The accounts a website is published with, both the shop's own:
 *
 *   github      keeps the website's files (githubConnector.js)
 *   cloudflare  runs the website (Workers, D1) on the free address and the
 *               shop's own domain (cloudflareConnector.js)
 *
 * Each is available when the installer profile has the public id of the
 * AFUS app for it (profile.json › githubClientId / cloudflareClientId), never
 * in the demo shop or in training.
 */
const PROVIDERS = {
    github: { id: 'github' },
    cloudflare: { id: 'cloudflare' },
};

const providerIds = () => Object.keys(PROVIDERS);
const getProvider = (id) => PROVIDERS[id] || null;
/** What the window may know: which accounts exist and which can be linked now. */
const describeProviders = ({ github = false, cloudflare = false } = {}) => ({
    github: { available: !!github },
    cloudflare: { available: !!cloudflare },
});

module.exports = { PROVIDERS, providerIds, getProvider, describeProviders };
