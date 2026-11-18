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
export type PostAuthDestination = "/dashboard" | "/agents/dashboard" | "/control" | "/dashboard/mjengo" | DashboardPath;

const TOKENS: Record<string, PostAuthDestination> = {
  agents: "/agents/dashboard",
  control: "/control",
  mjengo: "/dashboard/mjengo",
  // Accept the literal path for links already issued by the MJENGO entry redirect.
  "/dashboard/mjengo": "/dashboard/mjengo",
};

const DASHBOARD_PATH = /^\/dashboard(?:\/[A-Za-z0-9_-]{1,80}){1,6}$/;

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
  return isSafeDashboardPath(value) ? value : "/dashboard";
}

/** The query token to carry a destination across login ⇄ register links (null for the default). */
export function postAuthNextToken(destination: PostAuthDestination): string | null {
  switch (destination) {
    case "/agents/dashboard": return "agents";
    case "/control": return "control";
    case "/dashboard/mjengo": return "mjengo";
    case "/dashboard": return null;
    default: return isSafeDashboardPath(destination) ? destination : null;
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
