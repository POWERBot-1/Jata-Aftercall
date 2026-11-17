/**
 * Post-authentication destinations.
 *
 * Only these exact local destinations are ever honoured; an arbitrary `next` URL is never
 * followed (open-redirect protection). MJENGO OS is included so the public "Get MJENGO OS" CTA
 * survives sign-in/registration: previously `/login?next=/dashboard/mjengo` was silently
 * replaced with `/dashboard`, dropping the customer outside the product they came for.
 */
export type PostAuthDestination = "/dashboard" | "/agents/dashboard" | "/control" | "/dashboard/mjengo";

const TOKENS: Record<string, PostAuthDestination> = {
  agents: "/agents/dashboard",
  control: "/control",
  mjengo: "/dashboard/mjengo",
  // Accept the literal path for links already issued by the MJENGO entry redirect.
  "/dashboard/mjengo": "/dashboard/mjengo",
};

export function resolvePostAuthDestination(next: unknown): PostAuthDestination {
  const value = Array.isArray(next) ? next[0] : next;
  if (typeof value !== "string") return "/dashboard";
  return Object.prototype.hasOwnProperty.call(TOKENS, value) ? TOKENS[value] : "/dashboard";
}

/** The query token to carry a destination across login ⇄ register links (null for the default). */
export function postAuthNextToken(destination: PostAuthDestination): string | null {
  switch (destination) {
    case "/agents/dashboard": return "agents";
    case "/control": return "control";
    case "/dashboard/mjengo": return "mjengo";
    default: return null;
  }
}
