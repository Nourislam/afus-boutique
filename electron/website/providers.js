/**
 * The accounts a website is published with, both the shop's own:
 *
 *   github      keeps the website's files (githubConnector.js)
 *   cloudflare  runs the website (Workers, D1) on the free address and the
 *               shop's own domain (cloudflareConnector.js)
 *
 * Each can always be linked with a key the shop makes itself on the
 * provider's own page (never in the demo shop); the one-click
 * sign-in is offered too when the installer profile has the public id of the
 * AFUS app for it (profile.json › githubClientId / cloudflareClientId).
 */
const PROVIDERS = {
    github: { id: 'github' },
    cloudflare: { id: 'cloudflare' },
};

const providerIds = () => Object.keys(PROVIDERS);
const getProvider = (id) => PROVIDERS[id] || null;
/** What the window may know: which accounts exist and which can be linked now. */
const describeProviders = ({ github = false, cloudflare = false, githubSignIn = false, cloudflareSignIn = false } = {}) => ({
    github: { available: !!github, signIn: !!github && !!githubSignIn },
    cloudflare: { available: !!cloudflare, signIn: !!cloudflare && !!cloudflareSignIn },
});

module.exports = { PROVIDERS, providerIds, getProvider, describeProviders };
