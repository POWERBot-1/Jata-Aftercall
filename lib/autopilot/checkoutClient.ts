/**
 * JATA Autopilot — activation request from the Command Center (client-safe, no DOM required).
 *
 * Every activation button goes through this module so the behaviour is identical for
 * Standard (KES 2,499), Pro (KES 6,999) and Enterprise (KES 19,999), and so the decisions it
 * makes can be tested without a browser. It never throws and it never reports success: the only
 * "success" outcome is a validated provider URL the caller may navigate to.
 *
 * Why a plan key is sent instead of the stored plan id: the button used to post an id that came
 * from the server-rendered plan list. If that row was missing or had been re-created, the id was
 * null and the click returned before any request was sent, so the control looked dead. The key is
 * an allowlisted product identifier; the server resolves the stored row itself and still derives
 * the amount from it.
 */

export type ActivationNotice = {
  tone: "error" | "info";
  text: string;
  action?: { href: string; label: string } | null;
  code?: string;
};

export type ActivationOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "notice"; notice: ActivationNotice };

export type ActivationDeps = {
  businessId: string;
  planKey: string;
  fetchImpl?: typeof fetch;
  /** Absolute or relative origin used to validate the returned URL. */
  baseUrl?: string;
  signal?: AbortSignal;
};

export const ACTIVATION_NETWORK_ERROR =
  "Network error — the request could not reach JATA. Check your connection and try again.";
export const ACTIVATION_FALLBACK_ERROR = "Checkout could not be started right now. Please try again.";
export const ACTIVATION_BAD_LINK =
  "Checkout returned an unusable payment link. Nothing was charged — please try again or contact support.";

function currentBaseUrl(fallback?: string): string {
  if (fallback) return fallback;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://localhost:3000";
}

/**
 * The only URLs an activation may navigate to:
 *   • Paystack's hosted checkout (https, exact host);
 *   • the repository's own local test checkout page (same origin, `/checkout/mock`).
 * Anything else — including a `javascript:` URL or a third-party host — is refused.
 */
export function resolveCheckoutUrl(raw: unknown, baseUrl?: string): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const base = currentBaseUrl(baseUrl);
  let url: URL;
  let baseUrlObject: URL;
  try {
    url = new URL(raw, base);
    baseUrlObject = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol === "https:" && url.hostname === "checkout.paystack.com") return url.toString();
  if (url.origin === baseUrlObject.origin && url.pathname === "/checkout/mock") return url.toString();
  return null;
}

/** A same-origin status link the server owns; never a URL supplied wholesale by a response. */
export function safeStatusPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/checkout/callback?reference=")) return null;
  if (/[\s\r\n]/.test(raw)) return null;
  return raw;
}

function notice(text: string, extra: Partial<ActivationNotice> = {}): ActivationOutcome {
  return { kind: "notice", notice: { tone: "error", text, ...extra } };
}

export async function beginAutopilotActivation(deps: ActivationDeps): Promise<ActivationOutcome> {
  const doFetch = deps.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return notice(ACTIVATION_NETWORK_ERROR);

  let response: Response;
  try {
    response = await doFetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: deps.businessId, planKey: deps.planKey }),
      cache: "no-store",
      signal: deps.signal,
    });
  } catch {
    return notice(ACTIVATION_NETWORK_ERROR);
  }

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const message = typeof json?.error === "string" && json.error.trim() ? json.error : "";
  const code = typeof json?.code === "string" ? json.code : "";

  if (response.ok) {
    const url = resolveCheckoutUrl(json?.authorization_url, deps.baseUrl);
    if (!url) return notice(ACTIVATION_BAD_LINK, { code: "CHECKOUT_LINK_INVALID" });
    return { kind: "redirect", url };
  }

  if (response.status === 401) {
    return notice(message || "Your session has expired. Sign in again to activate JATA Autopilot.", {
      code: code || "SIGN_IN_REQUIRED",
      action: { href: "/login", label: "Sign in" },
    });
  }

  if (response.status === 409 && (code === "" || code === "CHECKOUT_IN_PROGRESS")) {
    const statusPath = safeStatusPath(json?.statusUrl);
    return notice(
      message || "A payment for this plan is already in progress. Check its status before starting another.",
      {
        code: "CHECKOUT_IN_PROGRESS",
        action: statusPath ? { href: statusPath, label: "Check the existing payment" } : null,
      },
    );
  }

  if (code === "PLAN_NOT_CONFIGURED" || code === "PAYMENTS_UNAVAILABLE") {
    // Configuration/provider access is missing: say so, do not imply the click failed silently.
    return notice(message || ACTIVATION_FALLBACK_ERROR, { code });
  }

  if (code === "PROVIDER_ERROR") {
    return notice(message || "Paystack could not start this payment. Please try again.", { code });
  }

  return notice(message || ACTIVATION_FALLBACK_ERROR, { code: code || undefined });
}
