import { normalizeKePhone } from "@/lib/phone";

export type ApplicationFields = { fullName: string; phoneE164: string };

/** These are unverified contact details, not proof of identity or an agent entitlement. */
export function validateAgentApplication(input: unknown): ApplicationFields | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (typeof body.fullName !== "string" || typeof body.phone !== "string" || body.privacyAccepted !== true) return null;
  const fullName = body.fullName.trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 80 || /[\u0000-\u001f\u007f<>]/.test(fullName)) return null;
  // The shared normalizer strips punctuation; reject letters and extensions rather than silently
  // interpreting them as part of a different number.
  if (!/^[+\d\s().-]{1,30}$/.test(body.phone)) return null;
  const phone = normalizeKePhone(body.phone);
  return phone ? { fullName, phoneE164: `+${phone}` } : null;
}

/** Reject cross-origin cookie-authenticated mutations, including missing and opaque origins. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    const requestUrl = new URL(request.url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.host.toLowerCase() === host.toLowerCase() &&
      // In Vercel the internal request URL may be HTTP; the forwarded protocol is set by ingress.
      parsed.protocol === (process.env.VERCEL === "1" ? "https:" : requestUrl.protocol) &&
      parsed.username === "" && parsed.password === "";
  } catch { return false; }
}
