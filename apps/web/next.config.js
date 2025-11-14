/**
 * Next.js config for the MVP skeleton. We’ll target Cloudflare Pages.
 * TODO: Add next-on-pages adapter when wiring CI/CD.
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
};

module.exports = nextConfig;
