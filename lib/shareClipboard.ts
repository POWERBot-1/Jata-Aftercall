/**
 * Legacy clipboard fallback for browsers where `navigator.clipboard.writeText` is missing or
 * rejected (older Android WebViews, some in-app browsers, non-secure embedded contexts).
 * Returns a real boolean: the caller must still show an honest manual-copy state when false.
 * Never throws and never leaves the temporary textarea in the document.
 */
export function legacyCopyText(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.top = "0";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return Boolean(copied);
  } catch {
    return false;
  }
}
