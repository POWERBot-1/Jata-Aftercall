#!/usr/bin/env node
/**
 * Executes the local media-version and password-reset migrations on a throwaway schema in an
 * explicitly named loopback PostgreSQL test database. Synthetic rows only; schema is dropped.
 *
 * MEDIA_TEST_DATABASE_URL=postgresql://jata@127.0.0.1:55432/jata_media_cas_test npm run test:db:migrations
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const rawUrl = process.env.MEDIA_TEST_DATABASE_URL;
if (!rawUrl) {
  console.error("MEDIA_TEST_DATABASE_URL is required; no database connection was attempted.");
  process.exit(2);
}
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== rawUrl) {
  console.error("Refusing to run while DATABASE_URL points somewhere else; this harness accepts only its explicit isolated test URL.");
  process.exit(2);
}

let databaseUrl;
try {
  databaseUrl = new URL(rawUrl);
} catch {
  console.error("Refusing an invalid test database URL.");
  process.exit(2);
}
if (
  !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
  !["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
  databaseUrl.port !== "55432" ||
  databaseUrl.pathname !== "/jata_media_cas_test" ||
  databaseUrl.username !== "jata" ||
  databaseUrl.password ||
  databaseUrl.search ||
  databaseUrl.hash
) {
  console.error("Refusing writes except to jata_media_cas_test on loopback port 55432 as the local jata role.");
  process.exit(2);
}

// Resolve the PostgreSQL driver only after the fail-closed URL/target preflight. No driver or
// connection is needed to report a missing or disallowed target.
const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 4, application_name: "jata-isolated-migration-audit" });
const schema = `audit_${randomBytes(8).toString("hex")}`;
const quoteSchema = `"${schema}"`;
const mediaMigrationPath = join(process.cwd(), "prisma/migrations/20261017000000_media_asset_version/migration.sql");
const resetMigrationPath = join(process.cwd(), "prisma/migrations/20261018000000_password_reset_security/migration.sql");
let created = false;
let passed = 0;
let postgresVersion = "unknown";
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) passed += 1;
  else throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

try {
  const client = await pool.connect();
  try {
    const identity = (await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             host(inet_server_addr()) AS server,
             current_setting('data_directory') AS data_directory,
             version() AS version
    `)).rows[0];
    postgresVersion = identity?.version ?? "unknown";
    const expectedDataDirectory = resolve(process.cwd(), ".cache/audit-tools/pgdata");
    check(
      "connection is the isolated loopback audit database, not a production target",
      identity?.database === "jata_media_cas_test" && identity?.role === "jata" &&
        identity?.server === "127.0.0.1" && resolve(identity?.data_directory ?? "") === expectedDataDirectory,
      `database=${identity?.database}; role=${identity?.role}; server=${identity?.server}; data=${identity?.data_directory}`,
    );

    // No write is attempted until the exact local test database and PGDATA are confirmed.
    await client.query(`CREATE SCHEMA ${quoteSchema}`);
    created = true;
    await client.query(`SET search_path TO ${quoteSchema}`);
    await client.query("SET TIME ZONE 'UTC'");

    // Minimal pre-migration table shapes, with synthetic legacy rows and no production data.
    await client.query(`
      CREATE TABLE "MediaAsset" (
        "id" TEXT PRIMARY KEY,
        "businessId" TEXT NOT NULL,
        "url" TEXT NOT NULL,
        "kind" TEXT NOT NULL DEFAULT 'IMAGE',
        "alt" TEXT,
        "updatedAt" TIMESTAMP(3) NOT NULL
      );
      CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL UNIQUE,
        "passwordHash" TEXT NOT NULL
      );
      INSERT INTO "MediaAsset" ("id", "businessId", "url", "kind", "alt", "updatedAt")
      VALUES ('asset-a', 'business-a', 'https://fixtures.invalid/a.jpg', 'IMAGE', 'legacy alt', '2026-10-18T12:00:00.123Z');
      INSERT INTO "User" ("id", "email", "passwordHash")
      VALUES ('user-a', 'synthetic@example.test', 'not-a-real-password-hash');
    `);

    const mediaMigration = await readFile(mediaMigrationPath, "utf8");
    await client.query(mediaMigration);
    await client.query(mediaMigration); // the checked-in migration is intentionally idempotent
    const legacy = await client.query(`SELECT "businessId", "alt", "version" FROM "MediaAsset" WHERE "id" = 'asset-a'`);
    check("media migration applies twice and preserves the legacy row/default version", legacy.rowCount === 1 && legacy.rows[0].businessId === "business-a" && legacy.rows[0].alt === "legacy alt" && legacy.rows[0].version === 0);

    await client.query(`INSERT INTO "MediaAsset" ("id", "businessId", "url", "updatedAt") VALUES ('asset-b', 'business-a', 'https://fixtures.invalid/b.jpg', CURRENT_TIMESTAMP)`);
    const inserted = await client.query(`SELECT "version", "businessId", "url" FROM "MediaAsset" WHERE "id" = 'asset-b'`);
    check(
      "synthetic media creation preserves tenant/URL and receives version 0",
      inserted.rows[0]?.version === 0 && inserted.rows[0]?.businessId === "business-a" && inserted.rows[0]?.url === "https://fixtures.invalid/b.jpg",
    );

    const mediaUpdate = await client.query(
      `UPDATE "MediaAsset"
       SET "alt" = 'versioned edit', "kind" = 'HERO', "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = 'asset-b' AND "businessId" = 'business-a' AND "version" = 0
       RETURNING "version", "alt", "kind"`,
    );
    const staleMediaUpdate = await client.query(
      `UPDATE "MediaAsset" SET "alt" = 'stale edit', "version" = "version" + 1
       WHERE "id" = 'asset-b' AND "businessId" = 'business-a' AND "version" = 0 RETURNING "id"`,
    );
    const persistedMedia = await client.query(`SELECT "version", "alt", "kind" FROM "MediaAsset" WHERE "id" = 'asset-b'`);
    check(
      "versioned media update advances once and stale follow-up cannot overwrite the saved edit",
      mediaUpdate.rowCount === 1 && mediaUpdate.rows[0]?.version === 1 &&
        staleMediaUpdate.rowCount === 0 && persistedMedia.rows[0]?.version === 1 &&
        persistedMedia.rows[0]?.alt === "versioned edit" && persistedMedia.rows[0]?.kind === "HERO",
    );

    const fixedTimestamp = new Date("2026-10-18T12:34:56.789Z");
    const contenderA = await pool.connect();
    const contenderB = await pool.connect();
    let writes;
    try {
      await Promise.all([
        contenderA.query(`SET search_path TO ${quoteSchema}; SET TIME ZONE 'UTC'`),
        contenderB.query(`SET search_path TO ${quoteSchema}; SET TIME ZONE 'UTC'`),
      ]);
      const update = (connection, alt) => connection.query(
        `UPDATE "MediaAsset"
         SET "alt" = $1, "version" = "version" + 1, "updatedAt" = $2
         WHERE "id" = $3 AND "businessId" = $4 AND "version" = $5
         RETURNING "version", "alt", "updatedAt"`,
        [alt, fixedTimestamp, "asset-a", "business-a", 0],
      );
      writes = await Promise.all([update(contenderA, "concurrent A"), update(contenderB, "concurrent B")]);
    } finally {
      contenderA.release();
      contenderB.release();
    }
    const winners = writes.filter((result) => result.rowCount === 1);
    const losers = writes.filter((result) => result.rowCount === 0);
    check("concurrent same-version PostgreSQL CAS has exactly one winner", winners.length === 1 && losers.length === 1);
    const afterRace = await client.query(`SELECT "version", "alt", "updatedAt" FROM "MediaAsset" WHERE "id" = 'asset-a'`);
    check(
      "atomic winner is the persisted value and increments exactly once at the fixed millisecond",
      winners.length === 1 && afterRace.rows[0]?.version === 1 &&
        afterRace.rows[0]?.alt === winners[0].rows[0]?.alt &&
        new Date(afterRace.rows[0]?.updatedAt).getTime() === fixedTimestamp.getTime(),
    );

    const stale = await client.query(
      `UPDATE "MediaAsset" SET "alt" = 'stale overwrite', "version" = "version" + 1 WHERE "id" = 'asset-a' AND "businessId" = 'business-a' AND "version" = 0 RETURNING "id"`,
    );
    const foreignTenant = await client.query(
      `UPDATE "MediaAsset" SET "alt" = 'cross-tenant overwrite', "version" = "version" + 1 WHERE "id" = 'asset-a' AND "businessId" = 'business-b' AND "version" = 1 RETURNING "id"`,
    );
    const afterRejectedWrites = await client.query(`SELECT "version", "alt" FROM "MediaAsset" WHERE "id" = 'asset-a'`);
    check(
      "stale/foreign-tenant writes update zero rows and cannot change the persisted winner",
      stale.rowCount === 0 && foreignTenant.rowCount === 0 &&
        afterRejectedWrites.rows[0]?.version === 1 && afterRejectedWrites.rows[0]?.alt === winners[0].rows[0]?.alt,
    );

    const resetMigration = await readFile(resetMigrationPath, "utf8");
    await client.query(resetMigration);
    await client.query(resetMigration);
    const existingUser = await client.query(`SELECT "id", "email", "sessionVersion", "passwordResetRequestedAt" FROM "User" WHERE "id" = 'user-a'`);
    check("password-reset migration applies twice and preserves legacy account/defaults", existingUser.rowCount === 1 && existingUser.rows[0].email === "synthetic@example.test" && existingUser.rows[0].sessionVersion === 0 && existingUser.rows[0].passwordResetRequestedAt === null);

    await client.query(`
      INSERT INTO "User" ("id", "email", "passwordHash") VALUES
        ('user-b', 'synthetic-b@example.test', 'synthetic-old-hash'),
        ('user-c', 'synthetic-c@example.test', 'synthetic-old-hash');
      INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "expiresAt") VALUES
        ('reset-a', 'user-a', repeat('a', 64), CURRENT_TIMESTAMP + INTERVAL '30 minutes'),
        ('reset-expired', 'user-b', repeat('b', 64), CURRENT_TIMESTAMP - INTERVAL '1 second');
    `);
    const resetToken = await client.query(`SELECT "userId", "tokenHash", "usedAt" FROM "PasswordResetToken" WHERE "id" = 'reset-a'`);
    check("password-reset token table accepts a synthetic SHA-256 digest record", resetToken.rowCount === 1 && resetToken.rows[0].tokenHash.length === 64 && resetToken.rows[0].usedAt === null);

    const invalidToken = await client.query(`SELECT "id" FROM "PasswordResetToken" WHERE "tokenHash" = repeat('z', 64)`);
    const expiredClaim = await client.query(
      `UPDATE "PasswordResetToken" SET "usedAt" = CURRENT_TIMESTAMP
       WHERE "id" = 'reset-expired' AND "tokenHash" = repeat('b', 64) AND "usedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP
       RETURNING "id"`,
    );
    check("invalid token digest is absent and an expired token cannot be claimed", invalidToken.rowCount === 0 && expiredClaim.rowCount === 0);

    await client.query(
      `INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "expiresAt") VALUES ('reset-live', 'user-c', repeat('c', 64), CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
    );
    const claimantA = await pool.connect();
    const claimantB = await pool.connect();
    const claimTime = new Date();
    const claimToken = async (connection) => {
      await connection.query(`SET search_path TO ${quoteSchema}; SET TIME ZONE 'UTC'`);
      await connection.query("BEGIN");
      try {
        const claimed = await connection.query(
          `UPDATE "PasswordResetToken" SET "usedAt" = $1
           WHERE "id" = 'reset-live' AND "userId" = 'user-c' AND "tokenHash" = repeat('c', 64)
             AND "usedAt" IS NULL AND "expiresAt" > $1
           RETURNING "userId"`,
          [claimTime],
        );
        if (claimed.rowCount === 1) {
          await connection.query(
            `UPDATE "User" SET "passwordHash" = 'synthetic-reset-hash', "sessionVersion" = "sessionVersion" + 1 WHERE "id" = $1`,
            [claimed.rows[0].userId],
          );
        }
        await connection.query("COMMIT");
        return claimed;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      }
    };
    let tokenClaims;
    try {
      tokenClaims = await Promise.all([claimToken(claimantA), claimToken(claimantB)]);
    } finally {
      claimantA.release();
      claimantB.release();
    }
    const claimWinners = tokenClaims.filter((result) => result.rowCount === 1);
    const claimLosers = tokenClaims.filter((result) => result.rowCount === 0);
    const usedToken = await client.query(`SELECT "usedAt" FROM "PasswordResetToken" WHERE "id" = 'reset-live'`);
    const resetUser = await client.query(`SELECT "sessionVersion", "passwordHash" FROM "User" WHERE "id" = 'user-c'`);
    check(
      "concurrent reset redemption is single-use and increments the synthetic user's session version once",
      claimWinners.length === 1 && claimLosers.length === 1 && usedToken.rows[0]?.usedAt !== null &&
        resetUser.rows[0]?.sessionVersion === 1 && resetUser.rows[0]?.passwordHash === "synthetic-reset-hash",
    );

    const cooldownA = await pool.connect();
    const cooldownB = await pool.connect();
    const cooldownAt = new Date();
    const claimCooldown = async (connection) => {
      await connection.query(`SET search_path TO ${quoteSchema}; SET TIME ZONE 'UTC'`);
      return connection.query(
        `UPDATE "User" SET "passwordResetRequestedAt" = $1
         WHERE "id" = 'user-a' AND (
           "passwordResetRequestedAt" IS NULL OR
           "passwordResetRequestedAt" <= $2
         ) RETURNING "id"`,
        [cooldownAt, new Date(cooldownAt.getTime() - 15 * 60_000)],
      );
    };
    let cooldownClaims;
    try {
      cooldownClaims = await Promise.all([claimCooldown(cooldownA), claimCooldown(cooldownB)]);
    } finally {
      cooldownA.release();
      cooldownB.release();
    }
    const repeatCooldown = await client.query(
      `UPDATE "User" SET "passwordResetRequestedAt" = CURRENT_TIMESTAMP
       WHERE "id" = 'user-a' AND (
         "passwordResetRequestedAt" IS NULL OR
         "passwordResetRequestedAt" <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
       ) RETURNING "id"`,
    );
    check(
      "persistent account cooldown admits one concurrent request and rejects an immediate repeat",
      cooldownClaims.filter((result) => result.rowCount === 1).length === 1 &&
        cooldownClaims.filter((result) => result.rowCount === 0).length === 1 && repeatCooldown.rowCount === 0,
    );

    await client.query(`DELETE FROM "User" WHERE "id" = 'user-a'`);
    const cascaded = await client.query(`SELECT count(*)::int AS count FROM "PasswordResetToken" WHERE "userId" = 'user-a'`);
    const otherTokens = await client.query(`SELECT count(*)::int AS count FROM "PasswordResetToken"`);
    check("account deletion cascades to its recovery token without deleting other accounts' tokens", cascaded.rows[0]?.count === 0 && otherTokens.rows[0]?.count === 2);
  } finally {
    client.release();
  }
} catch (error) {
  console.error(`FAIL isolated PostgreSQL migration/CAS test: ${String(error)}`);
  process.exitCode = 1;
} finally {
  if (created) {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("RESET search_path");
      await cleanup.query(`DROP SCHEMA IF EXISTS ${quoteSchema} CASCADE`);
      console.log("CLEANED temporary synthetic schema; target database itself was not dropped.");
    } catch (error) {
      console.error(`Cleanup failed for temporary schema ${schema}: ${String(error)}`);
      process.exitCode = 1;
    } finally {
      cleanup.release();
    }
  }
  await pool.end();
}
if (process.exitCode !== 1) console.log(`${passed} passed, 0 failed — ${postgresVersion}; isolated native PostgreSQL test target only.`);
