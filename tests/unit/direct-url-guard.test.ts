/**
 * The migration connection guard (blocker E8).
 *
 * The defect: `DEPLOYMENT.md` told operators to put Neon's *pooled* connection string in
 * `DATABASE_URL`, and `scripts/build.sh` ran `prisma migrate deploy` against it. That endpoint is
 * PgBouncer in transaction mode, so Prisma's session-level advisory lock is not reliably held →
 * P1002, or a half-applied migration that blocks every later deploy (P3009). No CI job could catch it:
 * every one of them points at a plain PostgreSQL container with no pooler in front of it.
 *
 * These tests pin the decision table. They use synthetic URLs — no network, no credentials — so they
 * can prove the guard on a machine that cannot reach Neon at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CODES, checkDirectUrl, isPooledHost } from "../../scripts/lib/direct-url-guard.mjs";

const root = path.resolve(__dirname, "../..");
const POOLED = "postgresql://u:p@ep-cool-name-123-pooler.eu-central-1.aws.neon.tech/jata?sslmode=require";
const DIRECT = "postgresql://u:p@ep-cool-name-123.eu-central-1.aws.neon.tech/jata?sslmode=require";
const LOCAL = "postgresql://jata:jata@127.0.0.1:5432/jata_ci?schema=public";

describe("pooled host detection", () => {
  it("recognises Neon's pooled endpoint and not the direct one", () => {
    expect(isPooledHost(POOLED)).toBe(true);
    expect(isPooledHost(DIRECT)).toBe(false);
    expect(isPooledHost(LOCAL)).toBe(false);
  });

  it("does not mistake an unrelated hostname containing the word", () => {
    // "pooler.example.com" IS pooled, but "ep-poolerish" is not the `-pooler.` shape Neon emits.
    expect(isPooledHost("postgresql://u:p@pooler.example.com/db")).toBe(true);
    expect(isPooledHost("postgresql://u:p@ep-poolerish.example.com/db")).toBe(false);
  });

  it("returns false for unparseable input rather than throwing", () => {
    expect(isPooledHost("")).toBe(false);
    expect(isPooledHost("not-a-url")).toBe(false);
    expect(isPooledHost(undefined)).toBe(false);
  });
});

describe("the decision table", () => {
  it("refuses a pooled DATABASE_URL with no DIRECT_URL at all", () => {
    const verdict = checkDirectUrl({ DATABASE_URL: POOLED });
    expect(verdict.allow).toBe(false);
    expect(verdict.code).toBe(CODES.REFUSED_MISSING_DIRECT_URL);
  });

  it("refuses a DIRECT_URL that defaulted to the pooled URL (the post-prisma-env.sh shape)", () => {
    // This is exactly what scripts/lib/prisma-env.sh produces when the operator set nothing.
    const verdict = checkDirectUrl({ DATABASE_URL: POOLED, DIRECT_URL: POOLED, JATA_DIRECT_URL_DEFAULTED: "1" });
    expect(verdict.allow).toBe(false);
    expect(verdict.code).toBe(CODES.REFUSED_MISSING_DIRECT_URL);
  });

  it("refuses a DIRECT_URL that was set explicitly to a pooled host", () => {
    // "It is set, so it must be right" is the trap this branch exists for.
    const verdict = checkDirectUrl({ DATABASE_URL: POOLED, DIRECT_URL: POOLED });
    expect(verdict.allow).toBe(false);
    expect(verdict.code).toBe(CODES.REFUSED_DIRECT_IS_POOLED);
  });

  it("allows a pooled runtime URL with a genuinely direct migration URL", () => {
    const verdict = checkDirectUrl({ DATABASE_URL: POOLED, DIRECT_URL: DIRECT });
    expect(verdict.allow).toBe(true);
    expect(verdict.code).toBe(CODES.OK);
    expect(verdict.detail).toMatch(/pooled/i);
  });

  it("allows a single non-pooled URL, which is what CI and local development use", () => {
    const verdict = checkDirectUrl({ DATABASE_URL: LOCAL });
    expect(verdict.allow).toBe(true);
    const defaulted = checkDirectUrl({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL, JATA_DIRECT_URL_DEFAULTED: "1" });
    expect(defaulted.allow).toBe(true);
  });

  it("allows an absent DATABASE_URL, because a preview build skips migrations entirely", () => {
    expect(checkDirectUrl({}).allow).toBe(true);
    expect(checkDirectUrl({}).code).toBe(CODES.OK_NO_DATABASE_URL);
  });

  it("refuses URLs it cannot parse, and ones with no database name", () => {
    expect(checkDirectUrl({ DATABASE_URL: "not-a-url" }).code).toBe(CODES.REFUSED_UNPARSEABLE);
    expect(checkDirectUrl({ DATABASE_URL: "postgresql://u:p@host:5432" }).code).toBe(CODES.REFUSED_NO_DATABASE_NAME);
    expect(checkDirectUrl({ DATABASE_URL: LOCAL, DIRECT_URL: "nonsense" }).code).toBe(CODES.REFUSED_UNPARSEABLE);
  });

  it("never includes a password in what it reports", () => {
    const verdict = checkDirectUrl({ DATABASE_URL: POOLED, DIRECT_URL: POOLED });
    expect(verdict.detail).not.toContain("u:p");
    expect(verdict.detail).not.toContain("ep-cool-name-123");
  });
});

describe("the wiring this depends on", () => {
  it("declares directUrl in the datasource, and keeps the pooled url", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(schema).toContain('directUrl = env("DIRECT_URL")');
    expect(schema).toContain('url      = env("DATABASE_URL")');
  });

  it("defaults DIRECT_URL in build.sh so an unset variable cannot fail prisma generate with P1012", () => {
    const build = readFileSync(path.join(root, "scripts/build.sh"), "utf8");
    expect(build).toContain("scripts/lib/prisma-env.sh");
    const helper = readFileSync(path.join(root, "scripts/lib/prisma-env.sh"), "utf8");
    expect(helper).toContain('export DIRECT_URL="$DATABASE_URL"');
  });

  it("runs the guard in migrate.sh before prisma is invoked", () => {
    const migrate = readFileSync(path.join(root, "scripts/migrate.sh"), "utf8");
    const guardAt = migrate.indexOf("direct-url-guard.mjs");
    const prismaAt = migrate.indexOf("npx prisma migrate deploy");
    expect(guardAt).toBeGreaterThan(-1);
    expect(prismaAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(prismaAt);
  });

  it("derives DIRECT_URL from DATABASE_URL inside the migration rehearsal", () => {
    // The rehearsal spawns the Prisma CLI for several different databases in turn. An inherited
    // DIRECT_URL could name a different database than the one under test, so it must be derived
    // per invocation; otherwise `migrate deploy` could act on the wrong target.
    const rehearsal = readFileSync(path.join(root, "scripts/ci/rehearse-candidate-migrations.mjs"), "utf8");
    expect(rehearsal).toContain("mergedEnv.DIRECT_URL = mergedEnv.DATABASE_URL");
    expect(rehearsal).toContain("if (mergedEnv.DATABASE_URL && !mergedEnv.DIRECT_URL)");
  });

  it("routes every CI invocation of the Prisma CLI through the wrapper", () => {
    // The first attempt at this change covered `generate` only, and CI failed on `prisma validate`
    // with exactly the P1012 this is supposed to prevent. Pin the whole surface, not one verb.
    const workflows = ["pos-erp-verify", "interactive-business-e2e", "release-validation", "premium-screenshots", "candidate-rehearsal"];
    for (const name of workflows) {
      const source = readFileSync(path.join(root, `.github/workflows/${name}.yml`), "utf8");
      const raw = source.match(/npx prisma /g) ?? [];
      expect(raw.length, `${name}.yml still calls npx prisma directly`).toBe(0);
    }
  });

  it("keeps the existing migration-target guard, so this change did not replace a control", () => {
    const migrate = readFileSync(path.join(root, "scripts/migrate.sh"), "utf8");
    expect(migrate).toContain("migration-target-guard.mjs");
    expect(migrate).toContain("scripts/lib/prisma-env.sh");
  });
});
