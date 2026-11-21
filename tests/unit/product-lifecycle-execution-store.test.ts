import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "lib/admin/product-lifecycle-execution-store.ts"), "utf8");
const dbFallback = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");

describe("transaction-backed product lifecycle persistence contract", () => {
  it("enqueues within a transaction and relies on the unique idempotency key", () => {
    expect(source).toContain("prisma.$transaction(async (tx");
    expect(source).toContain("createMany({ data: rows, skipDuplicates: true })");
    expect(source).toContain("lifecycleIdempotencyKey");
    expect(source).toContain("lockActiveRun(tx, runId)");
    expect(source).toContain('rows[0].status === "RUNNING"');
  });

  it("claims bounded batches using PostgreSQL row locks and unique per-task lease tokens", () => {
    expect(source).toContain("FOR UPDATE SKIP LOCKED");
    expect(source).toContain('WHERE "id" = ${runId}');
    expect(source).toContain("FOR UPDATE");
    expect(source).toContain('LIMIT ${limit}');
    expect(source).toContain("gen_random_uuid()::text");
    expect(source).toContain('"leaseToken" = gen_random_uuid()::text');
    expect(source).toContain("MAX_BATCH = 100");
    expect(source).toContain("MAX_LEASE_MS = 15 * 60_000");
  });

  it("does not serialize concurrent task claims on the run row", () => {
    const claimBody = source.split("export async function claimLifecycleTasks")[1]?.split("async function loadTaskForTransition")[0] ?? "";
    expect(claimBody).toContain("productLifecycleExecutionRun.findUnique");
    expect(claimBody).not.toContain("lockActiveRun");
    expect(claimBody).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("provides fail-closed offline fallbacks for all new ledger models", () => {
    expect(dbFallback).toContain("productLifecycleExecutionRun: emptyModel()");
    expect(dbFallback).toContain("productLifecycleExecutionTask: emptyModel()");
    expect(dbFallback).toContain("productLifecycleExecutionEvent: emptyModel()");
  });

  it("writes transition events in the same transaction as guarded task updates", () => {
    expect(source).toContain('leaseUntil: { gt: input.now }');
    expect(source).toContain('state: "CLAIMED", leaseToken: input.token');
    expect(source).toContain("if (changed.count !== 1) return { updated: false }");
    expect(source).toContain("productLifecycleExecutionEvent.create");
  });

  it("does not contain subscription, entitlement, payment or provider mutation calls", () => {
    expect(source).not.toMatch(/(subscription|entitlement|payment)\.(update|updateMany|upsert|delete|deleteMany)\s*\(/i);
    expect(source).not.toMatch(/fetch\s*\(|PAYSTACK|TELNYX|sendEmail|sendSms/i);
  });

  it("keeps run completion conditional on RUNNING state", () => {
    expect(source).toContain('where: { id: input.runId, status: "RUNNING" }');
    expect(source).toContain('status: input.status');
    expect(source).toContain('state: { in: ["READY", "CLAIMED", "RETRY"] }');
    expect(source).toContain("if (pending > 0) return { updated: false, pending }");
  });
});
