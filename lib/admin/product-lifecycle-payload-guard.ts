/**
 * Conservative guard for lifecycle ledger JSON evidence.
 * This denylist reduces accidental disclosure; it is not a task-specific schema
 * allowlist or a complete PII/secret detector.
 */
const FORBIDDEN_KEY = /(?:password|secret|token|authorization|cookie|api[_-]?key|credential|email|phone|mobile|address|name|message|transcript|provider[_-]?response|raw[_-]?body)/i;
const FORBIDDEN_EXACT_KEY = new Set(["__proto__", "prototype", "constructor"]);
const SUSPICIOUS_VALUE = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?\d[\d ()-]{7,}\d)\b/,
  /\b(?:sk_live_|sk_test_|pk_live_|pk_test_|Bearer\s+)/i,
];

export function assertSafeLifecyclePayload(value: unknown): void {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 256 || depth > 8) throw new Error("LIFECYCLE_PAYLOAD_COMPLEXITY_LIMIT");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("LIFECYCLE_PAYLOAD_INVALID_NUMBER");
      return;
    }
    if (typeof item === "string") {
      if (item.length > 512 || SUSPICIOUS_VALUE.some((pattern) => pattern.test(item))) {
        throw new Error("LIFECYCLE_PAYLOAD_SENSITIVE_VALUE");
      }
      return;
    }
    if (typeof item !== "object") throw new Error("LIFECYCLE_PAYLOAD_INVALID_TYPE");
    if (seen.has(item)) throw new Error("LIFECYCLE_PAYLOAD_CIRCULAR");
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 64) throw new Error("LIFECYCLE_PAYLOAD_ARRAY_LIMIT");
      for (const child of item) visit(child, depth + 1);
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("LIFECYCLE_PAYLOAD_INVALID_OBJECT");
      }
      const entries = Object.entries(item as Record<string, unknown>);
      if (entries.length > 64) throw new Error("LIFECYCLE_PAYLOAD_FIELD_LIMIT");
      for (const [key, child] of entries) {
        if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) ||
            FORBIDDEN_KEY.test(key) || FORBIDDEN_EXACT_KEY.has(key)) {
          throw new Error("LIFECYCLE_PAYLOAD_FORBIDDEN_FIELD");
        }
        visit(child, depth + 1);
      }
    }
    seen.delete(item);
  };
  visit(value, 0);
}
