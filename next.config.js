/**
 * Browser-bundle boundary for JATA Team Free Access (Phase 5).
 *
 * Four entitlement getters are shared with client components (for example DashboardClient →
 * lib/ai-config → lib/ai-entitlement). Statically importing the real server module there would
 * emit the authorised allowlist, the audit queries and `node:crypto` into a frontend chunk — and
 * webpack cannot compile `node:` imports for the browser. In the CLIENT compilation only, every
 * request for `lib/team-access.ts` is rewritten to the fail-closed stub. Server pages, route
 * handlers, middleware and tests always use the real module.
 */
class ServerOnlyTeamAccessPlugin {
  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap("ServerOnlyTeamAccessPlugin", (factory) => {
      factory.hooks.beforeResolve.tap("ServerOnlyTeamAccessPlugin", (result) => {
        if (!result || typeof result.request !== "string") return;
        // Requests arrive without the file extension (e.g. "./team-access" or
        // "@/lib/team-access"), so match the module stem, not the .ts filename.
        if (/team-access(?:\.ts)?$/.test(result.request)) {
          result.request = `${process.cwd()}/lib/teamAccessStub.ts`;
        }
      });
    });
  }
}

// Explicit local QA only. Production cannot opt into this with an environment flag.
const localArenaPreview = process.env.NODE_ENV === "development" && process.env.ARENA_LIVE_PREVIEW === "1";
/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(localArenaPreview ? { allowedDevOrigins: ["*.e2b.app"] } : {}),
  reactStrictMode: true,
  // Dev-only browser evidence: hide the Next.js floating indicator from screenshots.
  devIndicators: false,
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
      {
        // Owner push-to-talk voice briefs inside JATA Autopilot Command Center (§9).
        // Every other route retains `microphone=()` from the global rule above.
        source: "/dashboard/autopilot/:path*",
        headers: [
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(self)" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  webpack(config, { isServer }) {
    if (!isServer) config.plugins.push(new ServerOnlyTeamAccessPlugin());
    return config;
  },
};

module.exports = nextConfig;
