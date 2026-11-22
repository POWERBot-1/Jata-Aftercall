/**
 * Safety guard for scripts/browser/mjengo-authenticated.check.mjs. That script creates users,
 * businesses, a PAID payment row and ACTIVE MJENGO rows, so it must only ever touch a disposable local
 * database behind a local HTTP server. Kept separate so the refusal rules are unit-tested
 * (tests/unit/mjengo-browser-guard.test.ts) without launching Chrome.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function assertDisposableMjengoBrowserEnv(env) {
  if (env.JATA_DISPOSABLE_BROWSER_DB !== "1") throw new Error("Refusing: JATA_DISPOSABLE_BROWSER_DB=1 is required (disposable database only).");
  let db;
  let base;
  try { db = new URL(env.DATABASE_URL || ""); } catch { throw new Error("Refusing: DATABASE_URL is missing or not a URL."); }
  try { base = new URL(env.BASE_URL || ""); } catch { throw new Error("Refusing: BASE_URL is missing or not a URL."); }
  if (!["postgresql:", "postgres:"].includes(db.protocol) || !LOCAL_HOSTS.has(db.hostname)) throw new Error("Refusing: DATABASE_URL must be a local PostgreSQL database.");
  if (base.protocol !== "http:" || !LOCAL_HOSTS.has(base.hostname)) throw new Error("Refusing: BASE_URL must be a local http server.");
  if (env.NODE_ENV === "production" && env.VERCEL) throw new Error("Refusing: Vercel production runtime.");
  if (!env.DEMO_FIXTURE_PASSWORD || env.DEMO_FIXTURE_PASSWORD.length < 16) throw new Error("Refusing: an ephemeral DEMO_FIXTURE_PASSWORD (16+ characters) is required.");
  return { db, base };
}
