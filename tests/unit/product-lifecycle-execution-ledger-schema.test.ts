import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(join(root, "prisma/migrations/20261122000000_product_lifecycle_execution_ledger/migration.sql"), "utf8");

describe("product lifecycle ledger schema contract", () => {
  it("defines the run, task and append-only event records", () => {
    expect(schema).toContain("model ProductLifecycleExecutionRun");
    expect(schema).toContain("model ProductLifecycleExecutionTask");
    expect(schema).toContain("model ProductLifecycleExecutionEvent");
    expect(migration).toContain('CREATE TABLE "ProductLifecycleExecutionRun"');
    expect(migration).toContain('CREATE TABLE "ProductLifecycleExecutionTask"');
    expect(migration).toContain('CREATE TABLE "ProductLifecycleExecutionEvent"');
  });

  it("enforces unique task idempotency and bounded states/attempts", () => {
    expect(migration).toContain('UNIQUE INDEX "ProductLifecycleExecutionTask_idempotencyKey_key"');
    expect(migration).toContain("BETWEEN 1 AND 20");
    expect(migration).toContain("'MANUAL_REVIEW'");
    expect(migration).toContain("'DEAD_LETTER'");
  });

  it("makes lifecycle event history immutable at the database boundary", () => {
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON \"ProductLifecycleExecutionEvent\"");
    expect(migration).toContain("Product lifecycle execution events are append-only");
  });

  it("does not mutate subscription, payment or entitlement tables", () => {
    expect(migration).not.toMatch(/\b(UPDATE|DELETE\s+FROM)\s+\"(Subscription|Payment|.*Entitlement)\"/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+\"(Subscription|Payment|.*Entitlement)\"/i);
  });
});
