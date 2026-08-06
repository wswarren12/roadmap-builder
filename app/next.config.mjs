/** @type {import('next').NextConfig} */
const nextConfig = {
  // agent.md is imported as a bundled string (the runtime image ships only
  // .next, so reading it from src/ at runtime would fail in production).
  webpack: (config) => {
    config.module.rules.push({ test: /\.md$/, type: 'asset/source' });
    return config;
  },
  // Iframe-embedded from *.plnetwork.io — never send X-Frame-Options; allow
  // sibling-subdomain framing via frame-ancestors.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://plnetwork.io https://*.plnetwork.io",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
