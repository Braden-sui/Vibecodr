/**
 * Next.js config for the MVP skeleton. We’ll target Cloudflare Pages.
 * TODO: Add next-on-pages adapter when wiring CI/CD.
 */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true
  }
};

module.exports = nextConfig;

