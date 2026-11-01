import { describe, expect, it, vi } from "vitest";
import { createControlAuditEvent } from "@/lib/control/audit";
import type { ControlGrant } from "@/lib/control/access";

const syntheticGrant: ControlGrant = {
  id: "memory-only-audit-context",
  role: "SUPPORT_ADMIN",
  permissionKeys: [],
  scopeBusinessId: "tenant-a",
};

describe("Control audit event helper", () => {
  it("binds actor, tenant, action, target, outcome, before/after and correlation while redacting secrets", async () => {
    const tx = {
      controlAuditEvent: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, createdAt: new Date("2026-11-01T12:00:00.000Z") })),
      },
    };

    const result = await createControlAuditEvent(tx, {
      actorId: "synthetic-actor",
      grant: syntheticGrant,
      action: "BUSINESS_SUSPEND",
      targetType: "BUSINESS",
      targetId: "business-a",
      scopeBusinessId: "tenant-a",
      outcome: "SUCCESS",
      reason: "Synthetic policy review fixture",
      beforeState: { status: "ACTIVE", nested: { apiToken: "must-not-be-stored" } },
      afterState: { status: "SUSPENDED" },
      metadata: { businessName: "Synthetic Shop", correlationHint: "req:synthetic-7", secret: "must-not-be-stored" },
      correlationId: "req:synthetic-7",
    });

    const [call] = tx.controlAuditEvent.create.mock.calls[0];
    expect(call.data).toMatchObject({
      actorId: "synthetic-actor",
      actorRole: "SUPPORT_ADMIN",
      action: "BUSINESS_SUSPEND",
      targetType: "BUSINESS",
      targetId: "business-a",
      scopeBusinessId: "tenant-a",
      outcome: "SUCCESS",
      reason: "Synthetic policy review fixture",
      beforeState: { status: "ACTIVE", nested: { apiToken: "[REDACTED]" } },
      afterState: { status: "SUSPENDED" },
      metadata: { businessName: "Synthetic Shop", correlationHint: "req:synthetic-7", secret: "[REDACTED]" },
      correlationId: "req:synthetic-7",
    });
    // Timestamp ownership stays with PostgreSQL's createdAt default, not the request payload.
    expect(call.data).not.toHaveProperty("createdAt");
    expect(result.createdAt).toEqual(new Date("2026-11-01T12:00:00.000Z"));
  });

  it("preserves FAILED or DENIED outcome labels and propagates persistence errors to the transaction", async () => {
    const create = vi.fn().mockResolvedValueOnce({ outcome: "FAILED" }).mockRejectedValueOnce(new Error("synthetic audit persistence failure"));
    const tx = { controlAuditEvent: { create } };
    const failed = await createControlAuditEvent(tx, {
      actorId: "synthetic-actor", grant: syntheticGrant, action: "BUSINESS_SUSPEND",
      targetType: "BUSINESS", targetId: "business-a", scopeBusinessId: "tenant-a", outcome: "FAILED",
      correlationId: "req:failed-fixture",
    });
    expect(failed.outcome).toBe("FAILED");
    expect(create.mock.calls[0][0].data.outcome).toBe("FAILED");

    await expect(createControlAuditEvent(tx, {
      actorId: "synthetic-actor", grant: syntheticGrant, action: "BUSINESS_SUSPEND",
      targetType: "BUSINESS", targetId: "business-a", scopeBusinessId: "tenant-a", outcome: "SUCCESS",
    })).rejects.toThrow("synthetic audit persistence failure");
  });
});
