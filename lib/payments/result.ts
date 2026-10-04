/**
 * Result narrowing for the payment module.
 *
 * This repository compiles with `strict: false`, where a boolean discriminant (`ok: true` /
 * `ok: false`) does not narrow a union. Rather than downgrade the payment result types to
 * "everything is optional" — which is exactly the kind of looseness forbidden around money — the
 * unions stay precise and every caller narrows through these two guards.
 */

export function isOk<T extends { ok: boolean }>(result: T): result is Extract<T, { ok: true }> {
  return Boolean(result) && result.ok === true;
}

export function isFailure<T extends { ok: boolean }>(result: T): result is Extract<T, { ok: false }> {
  return !isOk(result);
}
