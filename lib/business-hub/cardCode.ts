/**
 * Loyalty card codes, as a customer actually types them.
 *
 * A code is copied off a screen, read aloud, pasted from a message or followed as a link, so the
 * same card arrives as `jata-4f9k-2q7m`, ` JATA 4F9K 2Q7M ` or `Jata-4F9K-2Q7M`. One definition
 * serves both sides of the boundary: the browser normalises what was typed, the server normalises
 * what it looks up, and neither can drift from the other. Codes are stored upper-case.
 *
 * This module imports nothing, so a client component can use it without pulling the database layer
 * into the browser bundle.
 */

/** Collapse spacing, ignore case, drop control characters, and cap what a paste can become. */
export function normaliseCardCode(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 60);
}
