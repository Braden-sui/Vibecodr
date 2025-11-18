/**
 * Next.js config for the MVP skeleton. We'll target Cloudflare Pages.
 * Configured for Cloudflare Pages deployment.
 */

const path = require("path");
const securityHeaders = require("./securityHeaders");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const baseSecurityHeaders = securityHeaders.getSecurityHeaderSet();

const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  async headers() {
    return [
      {
        source: "/_next/:path*",
        headers: baseSecurityHeaders,
      },
    ];
  },
};

// Setup dev platform for Cloudflare Pages local development
if (process.env.NODE_ENV === 'development') {
  const { setupDevPlatform } = require('@cloudflare/next-on-pages/next-dev');
  setupDevPlatform().catch((err) => {
    // Silently fail if @cloudflare/next-on-pages is not installed
    // This allows the app to run without the Cloudflare adapter in local dev
  });
}

module.exports = nextConfig;
