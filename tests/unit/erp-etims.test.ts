/**
 * eTIMS submission seam (POS / ERP - PRO).
 *
 * The point of these tests is that the product cannot overstate its tax position. There is no KRA
 * connection, so the adapter must refuse, the invoice must stay queued, and `ACCEPTED` must be
 * impossible without an authoritative control number. A timeout must never become a rejection.
 */
import { describe, expect, it } from "vitest";
import {
  canTransitionEtims,
  DISABLED_ETIMS_ADAPTER,
  etimsAdapter,
  etimsLiveEnabled,
  etimsSubmissionEnabled,
  etimsSubmissionPosture,
  submitInvoiceToEtims,
  validateEtimsPayload,
  type EtimsAdapter,
  type EtimsInvoicePayload,
} from "@/lib/erp/etims";

const payload: EtimsInvoicePayload = {
  invoiceId: "inv_1",
  invoiceNumber: "INV-000001",
  businessId: "bizA",
  issuedAt: new Date("2026-10-27T09:00:00+03:00"),
  currencyCode: "KES",
  customerName: "Jane Wanjiku",
  customerPin: "P051234567X",
  lines: [
    { description: "Chapati", quantity: 3, unitAmountCents: 5000, lineTotalCents: 15_000, taxTypeCode: "B", taxRateBps: 1600 },
  ],
  subtotalCents: 15_000,
  taxCents: 0,
  totalCents: 15_000,
};

function adapter(overrides: Partial<EtimsAdapter> = {}): EtimsAdapter {
  return {
    key: "test",
    label: "Test adapter",
    certified: true,
    configured: true,
    submit: async () => ({ outcome: "ACCEPTED", controlNumber: "KRA-0001", responseSource: "KRA_ETIMS", raw: {} }),
    health: async () => ({ ok: true, state: "HEALTHY", message: "ok" }),
    ...overrides,
  };
}

describe("payload validation", () => {
  it("accepts a consistent invoice", () => {
    expect(validateEtimsPayload(payload).ok).toBe(true);
  });

  it("rejects an invoice whose lines do not add up", () => {
    const result = validateEtimsPayload({ ...payload, lines: [{ ...payload.lines[0], lineTotalCents: 9_000 }] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/do not add up/i);
  });

  it("rejects a missing tax type code and a bad currency", () => {
    expect(validateEtimsPayload({ ...payload, lines: [{ ...payload.lines[0], taxTypeCode: "" }] }).ok).toBe(false);
    expect(validateEtimsPayload({ ...payload, currencyCode: "SHILLINGS" }).ok).toBe(false);
  });

  it("rejects an invoice with no date or no lines", () => {
    expect(validateEtimsPayload({ ...payload, issuedAt: new Date("nope") }).ok).toBe(false);
    expect(validateEtimsPayload({ ...payload, lines: [], subtotalCents: 0, totalCents: 0 }).ok).toBe(false);
  });
});

describe("switch and registry", () => {
  it("is off unless the flag is explicitly true", () => {
    expect(etimsLiveEnabled({})).toBe(false);
    expect(etimsLiveEnabled({ ETIMS_LIVE_ENABLED: "yes" })).toBe(false);
    expect(etimsLiveEnabled({ ETIMS_LIVE_ENABLED: "true" })).toBe(true);
  });

  it("also needs an adapter key before submission counts as enabled", () => {
    expect(etimsSubmissionEnabled({ ETIMS_LIVE_ENABLED: "true" })).toBe(false);
    expect(etimsSubmissionEnabled({ ETIMS_LIVE_ENABLED: "true", ETIMS_ADAPTER_KEY: "oscu" })).toBe(true);
  });

  it("falls back to the inert adapter for an unknown or uncertified key", () => {
    expect(etimsAdapter({}).key).toBe("disabled");
    expect(etimsAdapter({ ETIMS_ADAPTER_KEY: "made-up" }).key).toBe("disabled");
    expect(etimsAdapter({ ETIMS_ADAPTER_KEY: "vendor" }, { vendor: adapter({ certified: false }) }).key).toBe("disabled");
    expect(etimsAdapter({ ETIMS_ADAPTER_KEY: "vendor" }, { vendor: adapter() }).key).toBe("test");
  });

  it("never reports that submission is possible in this release", () => {
    for (const env of [{}, { ETIMS_LIVE_ENABLED: "true" }, { ETIMS_LIVE_ENABLED: "true", ETIMS_ADAPTER_KEY: "oscu" }]) {
      const posture = etimsSubmissionPosture(env);
      expect(posture.canSubmit).toBe(false);
      expect(posture.requires.length).toBeGreaterThan(1);
      expect(posture.headline).not.toMatch(/accepted/i);
    }
  });
});

describe("submitting an invoice", () => {
  it("queues the invoice when no certified connection exists", async () => {
    const result = await submitInvoiceToEtims({ adapter: DISABLED_ETIMS_ADAPTER, payload });
    expect(result.status).toBe("QUEUED");
    expect(result.controlNumber).toBeNull();
    expect(result.reason).toMatch(/nothing was sent/i);
  });

  it("refuses to accept an invoice even when an adapter claims success without a control number", async () => {
    const rogue = adapter({ submit: async () => ({ outcome: "ACCEPTED", controlNumber: "", responseSource: "KRA_ETIMS", raw: {} }) });
    const result = await submitInvoiceToEtims({ adapter: rogue, payload });
    expect(result.status).toBe("UNCERTAIN");
    expect(result.controlNumber).toBeNull();
    expect(result.reason).toMatch(/control number/i);
  });

  it("refuses to accept an invoice whose 'acceptance' came from anywhere but KRA", async () => {
    const wrongSource = adapter({ submit: async () => ({ outcome: "ACCEPTED", controlNumber: "X-1", responseSource: "VENDOR_PORTAL", raw: {} }) });
    const result = await submitInvoiceToEtims({ adapter: wrongSource, payload });
    expect(result.status).toBe("UNCERTAIN");
  });

  it("accepts only with both the control number and the authoritative source", async () => {
    const result = await submitInvoiceToEtims({ adapter: adapter(), payload });
    expect(result.status).toBe("ACCEPTED");
    expect(result.controlNumber).toBe("KRA-0001");
  });

  it("treats a thrown transport error as uncertain, not failed", async () => {
    const flaky = adapter({ submit: async () => { throw new Error("socket hang up"); } });
    const result = await submitInvoiceToEtims({ adapter: flaky, payload });
    expect(result.status).toBe("UNCERTAIN");
    expect(result.reason).toMatch(/reconcile/i);
  });

  it("passes a rejection through with its reason and keeps the invoice", async () => {
    const strict = adapter({ submit: async () => ({ outcome: "REJECTED", reason: "PIN does not match the taxpayer", raw: {} }) });
    const result = await submitInvoiceToEtims({ adapter: strict, payload });
    expect(result.status).toBe("REJECTED");
    expect(result.reason).toMatch(/PIN/);
  });

  it("does not resubmit an invoice that was already accepted", async () => {
    let calls = 0;
    const counting = adapter({ submit: async () => { calls += 1; return { outcome: "ACCEPTED", controlNumber: "KRA-2", responseSource: "KRA_ETIMS", raw: {} }; } });
    const result = await submitInvoiceToEtims({ adapter: counting, payload, currentStatus: "ACCEPTED" });
    expect(calls).toBe(0);
    expect(result.reason).toMatch(/credit note/i);
  });

  it("validates locally before it calls any provider", async () => {
    let calls = 0;
    const counting = adapter({ submit: async () => { calls += 1; return { outcome: "ACCEPTED", controlNumber: "KRA-3", responseSource: "KRA_ETIMS", raw: {} }; } });
    const result = await submitInvoiceToEtims({ adapter: counting, payload: { ...payload, totalCents: 99_999 }, currentStatus: "QUEUED" });
    expect(calls).toBe(0);
    expect(result.status).toBe("REJECTED");
    expect(result.responseSource).toBe("LOCAL_VALIDATION");
  });

  it("writes nothing but the queue when the invoice is marked not required", async () => {
    const result = await submitInvoiceToEtims({ adapter: DISABLED_ETIMS_ADAPTER, payload, currentStatus: "NOT_REQUIRED" });
    expect(result.status).toBe("NOT_REQUIRED");
  });
});

describe("state machine", () => {
  it("only allows the documented transitions", () => {
    expect(canTransitionEtims("QUEUED", "SUBMITTING")).toBe(true);
    expect(canTransitionEtims("SUBMITTING", "PENDING_ACK")).toBe(true);
    expect(canTransitionEtims("PENDING_ACK", "ACCEPTED")).toBe(true);
    expect(canTransitionEtims("UNCERTAIN", "ACCEPTED")).toBe(true);
    expect(canTransitionEtims("ACCEPTED", "QUEUED")).toBe(false);
    expect(canTransitionEtims("REJECTED", "ACCEPTED")).toBe(false);
    expect(canTransitionEtims("none", "QUEUED")).toBe(true);
  });
});
