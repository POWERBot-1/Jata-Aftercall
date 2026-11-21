/**
 * Post-authentication destinations.
 *
 * Only local destinations are ever honoured; an arbitrary `next` URL is never followed
 * (open-redirect protection). Two shapes are accepted:
 *   1. exact tokens (`agents`, `control`, `mjengo`) for the product entry points; and
 *   2. (R-RT-01) a strictly shaped workspace path under `/dashboard/…`, so a signed-out or
 *      expired-session visitor who opened e.g. `/dashboard/pos/sales` returns there after sign-in
 *      instead of being dropped on `/dashboard`.
 *
 * The workspace-path shape is deliberately narrow: it must start with `/dashboard/`, consist of
 * 1–6 segments of `[A-Za-z0-9_-]`, and contain no dots, percent-encoding, backslashes, colons,
 * doubled slashes, query or fragment. Nothing outside `/dashboard` can be expressed, so it cannot
 * leave the origin or the workspace. Honouring the path grants nothing: every dashboard route still
 * applies its own session, ownership and entitlement checks after the redirect.
 */
export type DashboardPath = `/dashboard/${string}`;
/** (R-RT-02) An owner's preview of their own AI Front Desk page. The page re-checks ownership. */
export type AiPreviewPath = `/b/${string}/ai?preview=true`;
export type PostAuthDestination = "/dashboard" | "/agents/dashboard" | "/control" | "/dashboard/mjengo" | DashboardPath | AiPreviewPath;

const TOKENS: Record<string, PostAuthDestination> = {
  agents: "/agents/dashboard",
  control: "/control",
  mjengo: "/dashboard/mjengo",
  // Accept the literal path for links already issued by the MJENGO entry redirect.
  "/dashboard/mjengo": "/dashboard/mjengo",
};

const DASHBOARD_PATH = /^\/dashboard(?:\/[A-Za-z0-9_-]{1,80}){1,6}$/;
/** Same shape lib/slug.ts validateSlug accepts: 3–50 of [a-z0-9-], no leading/trailing/double hyphen. */
const BUSINESS_SLUG = /^[a-z0-9](?:-?[a-z0-9]){2,49}$/;
const AI_PREVIEW_TOKEN_PREFIX = "ai-preview:";

/** The `next` token for an owner's AI page preview, or null when the slug is not a valid slug. */
export function aiPreviewNextToken(slug: unknown): string | null {
  return typeof slug === "string" && slug.length <= 50 && BUSINESS_SLUG.test(slug) ? `${AI_PREVIEW_TOKEN_PREFIX}${slug}` : null;
}

/** `/login?next=…` for an owner's AI page preview (falls back to plain /login for an invalid slug). */
export function aiPreviewLoginPath(slug: string): string {
  const token = aiPreviewNextToken(slug);
  return token ? `/login?next=${encodeURIComponent(token)}` : "/login";
}

function aiPreviewDestination(value: string): AiPreviewPath | null {
  if (!value.startsWith(AI_PREVIEW_TOKEN_PREFIX)) return null;
  const slug = value.slice(AI_PREVIEW_TOKEN_PREFIX.length);
  return aiPreviewNextToken(slug) ? `/b/${slug}/ai?preview=true` : null;
}

/** True for a strictly shaped workspace path (see the module comment). */
export function isSafeDashboardPath(value: unknown): value is DashboardPath {
  return typeof value === "string" && value.length <= 400 && DASHBOARD_PATH.test(value);
}

export function resolvePostAuthDestination(next: unknown): PostAuthDestination {
  // A repeated `next` parameter is ambiguous (e.g. `?next=agents&next=https://evil`); refuse it
  // rather than guessing which value the user meant. A single-element array is unambiguous.
  if (Array.isArray(next) && next.length !== 1) return "/dashboard";
  const value = Array.isArray(next) ? next[0] : next;
  if (typeof value !== "string") return "/dashboard";
  if (Object.prototype.hasOwnProperty.call(TOKENS, value)) return TOKENS[value];
  const aiPreview = aiPreviewDestination(value);
  if (aiPreview) return aiPreview;
  return isSafeDashboardPath(value) ? value : "/dashboard";
}

/** The query token to carry a destination across login ⇄ register links (null for the default). */
export function postAuthNextToken(destination: PostAuthDestination): string | null {
  switch (destination) {
    case "/agents/dashboard": return "agents";
    case "/control": return "control";
    case "/dashboard/mjengo": return "mjengo";
    case "/dashboard": return null;
    default: {
      const preview = /^\/b\/([^/?#]+)\/ai\?preview=true$/.exec(destination);
      if (preview) return aiPreviewNextToken(preview[1]);
      return isSafeDashboardPath(destination) ? destination : null;
    }
  }
}

/**
 * Request header carrying the requested workspace path from proxy.ts to app/dashboard/layout.tsx.
 * A layout cannot see which child route was requested; the proxy always overwrites this header, and
 * the value is re-validated here, so a client-supplied value can at most choose its own (safe) return
 * path.
 */
export const DASHBOARD_PATH_HEADER = "x-jata-dashboard-path";

/** `/login`, plus `?next=` when the requested workspace path is a safe destination other than `/dashboard`. */
export function loginPathFor(requestedPath: string | null | undefined): string {
  const token = postAuthNextToken(resolvePostAuthDestination(requestedPath ?? undefined));
  return token ? `/login?next=${token}` : "/login";
}
