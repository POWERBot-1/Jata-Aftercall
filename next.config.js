// Explicit local QA only. Production cannot opt into this with an environment flag.
const localArenaPreview = process.env.NODE_ENV === "development" && process.env.ARENA_LIVE_PREVIEW === "1";
/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(localArenaPreview ? { allowedDevOrigins: ["*.e2b.app"] } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          ...(localArenaPreview
            ? [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://arena.ai https://*.arena.ai" }]
            : [{ key: "X-Frame-Options", value: "DENY" }]),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
          { key: "X-XSS-Protection", value: "0" },
        ],
      },
      {
        // Public business pages are framed by the owner's own preview panel (§16), so they
        // allow same-origin framing only. Every other route stays DENY, and no page may be
        // framed by another site.
        source: "/b/:slug*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

module.exports = nextConfig;
