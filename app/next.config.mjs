/** @type {import('next').NextConfig} */
const nextConfig = {
  // agent.md is imported as a bundled string (the runtime image ships only
  // .next, so reading it from src/ at runtime would fail in production).
  webpack: (config) => {
    config.module.rules.push({ test: /\.md$/, type: 'asset/source' });
    return config;
  },
  // Iframe-embedded from the LabOS portal (https://os.pl.xyz) — never send
  // X-Frame-Options; allow that origin via frame-ancestors (kit v1.11).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://os.pl.xyz",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
