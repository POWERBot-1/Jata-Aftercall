/**
 * Safe text rendering: untrusted strings are TEXT, never HTML.
 * No innerHTML for user data. If rich formatting is required, allowlist via this module only.
 * Event handlers and javascript: URLs are never permitted.
 */
const DISALLOWED_TEXT_RE = /[<>&]/g;

export function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Branding fields are plain text (1-200 chars). Strip control characters and trim.
 * Do not allow HTML tags — they render as literal text.
 */
export function sanitizeBrandingText(input: unknown, maxLen = 200): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  // Remove null bytes and control chars, keep normal unicode
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maxLen);
  return cleaned;
}

/**
 * Validate branding name — must be plain text, no tags, no javascript: URLs, no event handlers.
 * Returns { ok, safe } where safe is text-safe for rendering via textContent.
 */
export function isSafeBrandingName(name: string): boolean {
  const s = String(name ?? "");
  if (/[<>]/.test(s)) return false;
  if (/javascript:/i.test(s)) return false;
  if (/\bon\w+\s*=/i.test(s)) return false; // event handler
  return s.length >= 1 && s.length <= 200;
}

/**
 * For React rendering: use textContent safe path.
 * Example: <span>{sanitizeBrandingText(business.name)}</span> not dangerouslySetInnerHTML.
 */
export function mjengoSafeText(value: unknown): string {
  return sanitizeBrandingText(value);
}
