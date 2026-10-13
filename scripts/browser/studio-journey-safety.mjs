/** Test-runner boundary only. Never imported by the application or used to authorize an owner. */
const METHODS = {
  "/api/auth/register": ["POST"], "/api/auth/login": ["POST"], "/api/auth/logout": ["POST", "GET"],
  "/api/business": ["PATCH"], "/api/experience": ["GET", "POST", "PATCH"],
  "/api/experience/publish": ["POST"], "/api/experience/versions": ["GET", "POST"],
  "/api/experience/history": ["GET"], "/api/studio/health": ["GET"],
  "/api/products": ["GET", "POST"], "/api/services": ["GET", "POST"],
  "/api/storefront/quote": ["POST"], "/api/storefront/booking": ["GET", "POST"],
  "/api/bookings": ["GET", "PATCH"], "/api/analytics/event": ["POST"],
  "/api/storefront/enquiry": ["GET", "POST"],
};

/** An explicit opt-in AND the exact disposable workflow database are required before any write. */
export function assertIsolatedStudioTarget(env, files = []) {
  if (env.STUDIO_BROWSER_TEST_WRITE !== "1") throw new Error("Isolated browser fixture writes not opted in");
  if (!env.DATABASE_URL || env.DATABASE_URL !== env.PRISMA_TEST_DATABASE_URL) throw new Error("Dedicated test database URLs missing or unequal");
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error("Invalid test database URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.pathname !== "/jata_e2e" || url.username !== "jata" || url.password !== "jata" ||
      (url.port && url.port !== "5432") || url.hash ||
      [...url.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) {
    throw new Error("Refusing anything except the disposable loopback jata_e2e workflow database");
  }
  if (env.AUTH_SECRET !== "interactive-business-e2e-test-secret") throw new Error("Refusing a non-workflow authentication secret");
  if (files.some((file) => file.startsWith(".env") && file !== ".env.example")) throw new Error("Refusing local environment files that Next could load");
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (/^(PAYSTACK_|OPENAI_|GEMINI_|GOOGLE_AI_|ANTHROPIC_|BLOB_|STORAGE_|S3_|AWS_|CLOUDINARY_|SUPABASE_|R2_|MPESA_|DARAJA_)/i.test(key)) {
      throw new Error("Provider/storage configuration present; refusing this provider-free test");
    }
    if (/^PRISMA_(QUERY_ENGINE_LIBRARY|QUERY_ENGINE_BINARY|SCHEMA_ENGINE_BINARY|GENERATE_NO_ENGINE)$/.test(key)) {
      throw new Error("Native database evidence cannot use downloader/engine-less overrides");
    }
  }
  return { databaseUrl: env.DATABASE_URL };
}

/** The harness creates its own local server: callers cannot aim it at a deployment/preview. */
export function isAllowedStudioRequest(raw, origin, method = "GET") {
  let url, target;
  try { url = new URL(raw); target = new URL(origin); } catch { return false; }
  if (target.protocol !== "http:" || target.hostname !== "localhost" || target.username || target.password) return false;
  if ((url.protocol === "data:" || url.protocol === "blob:") && method === "GET") return true;
  if (url.origin !== target.origin || url.username || url.password || url.protocol !== "http:") return false;
  if (url.pathname.startsWith("/api/")) return METHODS[url.pathname]?.includes(method) === true;
  return ["GET", "HEAD"].includes(method);
}
