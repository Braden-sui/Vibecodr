/**
 * Next.js config for the MVP skeleton. We’ll target Cloudflare Pages.
 * TODO: Add next-on-pages adapter when wiring CI/CD.
 */

// Load env from repository root for local development
// INVARIANT: Keep this import at top-level so Next picks up env before config is evaluated
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;

