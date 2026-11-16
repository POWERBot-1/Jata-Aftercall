import { describe, expect, it } from "vitest";
import { validatePreviewEnvironment } from "../../scripts/ci/check-preview-environment-isolation.mjs";

const safe = {
  DATABASE_URL: "postgresql://app:secret@ep-staging-pooler.c-2.us-east-1.aws.neon.tech/jata_staging?sslmode=require",
  DIRECT_URL: "postgresql://app:secret@ep-staging.c-2.us-east-1.aws.neon.tech/jata_staging?sslmode=require",
  JATA_STAGING_DATABASE_HOST: "ep-staging.c-2.us-east-1.aws.neon.tech",
  AUTH_SECRET: "preview-only-test-secret",
  NEXTAUTH_SECRET: "preview-only-test-secret",
  PAYSTACK_PUBLIC_KEY: "pk_test_example123",
  PAYSTACK_SECRET_KEY: "sk_test_example123",
  JATA_STORAGE_PROVIDER: "cloudflare-r2",
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_ACCESS_KEY_ID: "preview-access",
  R2_SECRET_ACCESS_KEY: "preview-secret",
  R2_BUCKET: "jata-media-preview",
  R2_PUBLIC_BASE_URL: "https://pub-1f9deae847f14589b1e8fcec981fdf5b.r2.dev",
  PUBLIC_BASE_URL: "https://jata-preview.vercel.app",
  NEXTAUTH_URL: "https://jata-preview.vercel.app",
};

describe("Vercel Preview isolation guard", () => {
  it("accepts a fully isolated staging configuration", () => {
    expect(validatePreviewEnvironment(safe)).toEqual([]);
  });
  it("rejects missing staging database and sandbox payment credentials", () => {
    const env = {...safe, DATABASE_URL: "", PAYSTACK_SECRET_KEY: "sk_live_bad"};
    const errors = validatePreviewEnvironment(env);
    expect(errors).toContain("missing DATABASE_URL");
    expect(errors).toContain("PAYSTACK_SECRET_KEY must be a Paystack test key");
  });
  it("rejects production database names, origins and storage buckets", () => {
    const env = {
      ...safe,
      DIRECT_URL: safe.DIRECT_URL.replace("jata_staging", "neondb"),
      R2_BUCKET: "jata-media-production",
      PUBLIC_BASE_URL: "https://jataaftercall.co.ke",
    };
    const errors = validatePreviewEnvironment(env);
    expect(errors).toContain("DIRECT_URL must target database jata_staging");
    expect(errors).toContain("R2_BUCKET must be the isolated preview bucket");
    expect(errors).toContain("PUBLIC_BASE_URL must not point to the production domain");
  });
  it("rejects a database host that differs from the explicitly pinned staging endpoint", () => {
    const env = {...safe, DIRECT_URL: safe.DIRECT_URL.replace("ep-staging.", "ep-production.")};
    expect(validatePreviewEnvironment(env)).toContain("DIRECT_URL does not match JATA_STAGING_DATABASE_HOST");
  });
});
