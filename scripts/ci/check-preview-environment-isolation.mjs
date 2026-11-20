// Fail closed for Vercel Preview until every external dependency is isolated.
export function validatePreviewEnvironment(env) {
  const errors = [];
  const required = ["DATABASE_URL","DIRECT_URL","JATA_STAGING_DATABASE_HOST","AUTH_SECRET","NEXTAUTH_SECRET","PAYSTACK_PUBLIC_KEY","PAYSTACK_SECRET_KEY","JATA_STORAGE_PROVIDER","R2_ACCOUNT_ID","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_BUCKET","R2_PUBLIC_BASE_URL","PUBLIC_BASE_URL","NEXTAUTH_URL"];
  for (const key of required) if (!String(env[key] ?? "").trim()) errors.push(`missing ${key}`);

  const parseUrl = (key) => {
    try { return new URL(env[key]); } catch { errors.push(`invalid ${key}`); return null; }
  };
  if (env.DATABASE_URL && env.DIRECT_URL && env.JATA_STAGING_DATABASE_HOST) {
    const pooled = parseUrl("DATABASE_URL");
    const direct = parseUrl("DIRECT_URL");
    const expectedHost = String(env.JATA_STAGING_DATABASE_HOST).toLowerCase();
    const normalizedPooled = pooled?.hostname.toLowerCase().replace("-pooler.", ".");
    if (!expectedHost.endsWith(".neon.tech")) errors.push("JATA_STAGING_DATABASE_HOST must be a Neon endpoint host");
    if (direct && direct.hostname.toLowerCase() !== expectedHost) errors.push("DIRECT_URL does not match JATA_STAGING_DATABASE_HOST");
    if (pooled && normalizedPooled !== expectedHost) errors.push("DATABASE_URL does not match the staging Neon endpoint");
    if (pooled && decodeURIComponent(pooled.pathname.slice(1)) !== "jata_staging") errors.push("DATABASE_URL must target database jata_staging");
    if (direct && decodeURIComponent(direct.pathname.slice(1)) !== "jata_staging") errors.push("DIRECT_URL must target database jata_staging");
  }

  if (env.PAYSTACK_PUBLIC_KEY && !/^pk_test_[A-Za-z0-9]+$/.test(env.PAYSTACK_PUBLIC_KEY)) errors.push("PAYSTACK_PUBLIC_KEY must be a Paystack test key");
  if (env.PAYSTACK_SECRET_KEY && !/^sk_test_[A-Za-z0-9]+$/.test(env.PAYSTACK_SECRET_KEY)) errors.push("PAYSTACK_SECRET_KEY must be a Paystack test key");
  if (env.JATA_STORAGE_PROVIDER && env.JATA_STORAGE_PROVIDER !== "cloudflare-r2") errors.push("JATA_STORAGE_PROVIDER must be cloudflare-r2");
  if (env.R2_BUCKET && env.R2_BUCKET !== "jata-media-preview") errors.push("R2_BUCKET must be the isolated preview bucket");
  if (env.R2_PUBLIC_BASE_URL && env.R2_PUBLIC_BASE_URL !== "https://pub-1f9deae847f14589b1e8fcec981fdf5b.r2.dev") errors.push("R2_PUBLIC_BASE_URL must match the isolated preview bucket");
  for (const key of ["PUBLIC_BASE_URL","NEXTAUTH_URL"]) {
    if (env[key]) {
      try {
        const host = new URL(env[key]).hostname.toLowerCase();
        if (host === "jataaftercall.co.ke" || host === "www.jataaftercall.co.ke") errors.push(`${key} must not point to the production domain`);
      } catch { errors.push(`invalid ${key}`); }
    }
  }
  return errors;
}

if (process.env.VERCEL_ENV === "preview") {
  const errors = validatePreviewEnvironment(process.env);
  if (errors.length) {
    console.error("[preview-isolation] BLOCKED: Preview environment is not isolated.");
    for (const error of errors) console.error(`[preview-isolation] - ${error}`);
    process.exit(1);
  }
  console.log("[preview-isolation] PASS: database, Paystack, storage and public origins are isolated for Preview.");
}
