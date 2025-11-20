/**
 * Next.js config for the MVP skeleton. We'll target Cloudflare Workers via OpenNext.
 * Configured for Cloudflare deployment using @opennextjs/cloudflare.
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

module.exports = nextConfig;
