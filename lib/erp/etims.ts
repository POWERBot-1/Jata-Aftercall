/**
 * eTIMS submission adapter — deliberately inert until a certified connection exists.
 *
 * What this module is: the seam where a certified eTIMS integrator (OSCU/VSCU through a vendor, or
 * a KRA-vetted system-to-system client) plugs in later. It defines the request the ERP can already
 * build from a posted invoice, the outcome it can already store, and the state machine an invoice
 * must follow.
 *
 * What this module is not: a KRA integration. Nothing here sends anything, and nothing here may
 * report an invoice as accepted. `ETIMS_LIVE_ENABLED` has to be set *and* a certified adapter has to
 * be registered *and* the response has to carry KRA's control number before `ACCEPTED` is written.
 *
 * A timeout is `UNCERTAIN`, never `FAILED`: a request that timed out may still have been registered
 * at KRA, and resubmitting it could create a second fiscal document. Uncertain invoices are
 * reconciled, not resent.
 */

import { assertAuthoritativeAcceptance, ETIMS_INVOICE_STATES } from "./compliance";

export type EtimsInvoicePayload = {
  /** Stable reference the ERP uses for idempotency; the invoice's own id. */
  invoiceId: string;
  invoiceNumber: string;
  businessId: string;
  issuedAt: Date;
  currencyCode: string;
  customerName: string;
  customerPin?: string | null;
  lines: Array<{
    description: string;
    quantity: number;
    unitAmountCents: number;
    lineTotalCents: number;
    /** A–E, from `etimsTaxTypeCode` in the tax engine. */
    taxTypeCode: string;
    taxRateBps: number;
  }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type EtimsAdapterResult =
  // `responseSource` is deliberately a plain string: an adapter that claims acceptance from
  // anywhere but KRA must be representable so `assertAuthoritativeAcceptance` can reject it.
  | { outcome: "ACCEPTED"; controlNumber: string; responseSource: string; raw: unknown }
  | { outcome: "REJECTED"; reason: string; raw: unknown }
  | { outcome: "PENDING_ACK"; detail: string; raw: unknown }
  | { outcome: "UNCERTAIN"; reason: string }
  | { outcome: "BLOCKED"; reason: string; code: string };

export type EtimsAdapter = {
  key: string;
  label: string;
  /** True only for a connection that talks to KRA (directly or through a certified vendor). */
  certified: boolean;
  configured: boolean;
  submit(payload: EtimsInvoicePayload): Promise<EtimsAdapterResult>;
  health(): Promise<{ ok: boolean; state: "HEALTHY" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED"; message: string }>;
};

/** Invoice states this module will write, in the order the compliance screen documents them. */
export const WRITABLE_ETIMS_STATES = ETIMS_INVOICE_STATES.map((state) => state.key);

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NONE: ["QUEUED", "NOT_REQUIRED"],
  VALIDATED: ["QUEUED", "NOT_REQUIRED"],
  QUEUED: ["SUBMITTING", "NOT_REQUIRED"],
  SUBMITTING: ["PENDING_ACK", "ACCEPTED", "REJECTED", "UNCERTAIN"],
  PENDING_ACK: ["ACCEPTED", "REJECTED", "UNCERTAIN"],
  UNCERTAIN: ["ACCEPTED", "REJECTED", "QUEUED"],
  REJECTED: ["QUEUED"],
  ACCEPTED: [],
};

export function etimsLiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.ETIMS_LIVE_ENABLED ?? "").toLowerCase() === "true";
}

/** The switch that keeps a half-configured deployment from writing fiscal states. */
export function etimsSubmissionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return etimsLiveEnabled(env) && Boolean(String(env.ETIMS_ADAPTER_KEY ?? "").trim());
}

/**
 * The only adapter this release ships. It is honest: not certified, not configured, and it refuses
 * to submit. Registering a real one means writing a vendor adapter and setting the two flags.
 */
export const DISABLED_ETIMS_ADAPTER: EtimsAdapter = {
  key: "disabled",
  label: "Not connected",
  certified: false,
  configured: false,
  async submit() {
    return {
      outcome: "BLOCKED",
      code: "ETIMS_NOT_CONNECTED",
      reason:
        "No certified KRA eTIMS connection is configured. Invoices can be prepared and validated, but nothing is submitted and no control number is invented.",
    };
  },
  async health() {
    return {
      ok: false,
      state: "NOT_CONFIGURED",
      message: "No certified eTIMS connection. Invoices stay queued locally.",
    };
  },
};

/** Registry lookup. Unknown or uncertified keys fall back to the disabled adapter — never to a mock. */
export function etimsAdapter(
  env: Record<string, string | undefined> = process.env,
  registry: Record<string, EtimsAdapter> = {},
): EtimsAdapter {
  const key = String(env.ETIMS_ADAPTER_KEY ?? "").trim();
  if (!key) return DISABLED_ETIMS_ADAPTER;
  const candidate = registry[key];
  if (!candidate || !candidate.certified) return DISABLED_ETIMS_ADAPTER;
  return candidate;
}

export function validateEtimsPayload(payload: EtimsInvoicePayload): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!payload.invoiceId) errors.push("The invoice id is required so a resubmission cannot create a second fiscal document.");
  if (!payload.invoiceNumber) errors.push("An invoice number is required.");
  if (!(payload.issuedAt instanceof Date) || Number.isNaN(payload.issuedAt.getTime())) errors.push("An issue date is required.");
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) errors.push("At least one invoice line is required.");
  if (payload.lines?.some((line) => !line.taxTypeCode)) errors.push("Every line needs an eTIMS tax type code.");
  if (payload.lines?.some((line) => !line.description?.trim())) errors.push("Every line needs a description.");
  const lineSum = (payload.lines ?? []).reduce((total, line) => total + Number(line.lineTotalCents ?? 0), 0);
  if (lineSum !== payload.subtotalCents + payload.taxCents) {
    errors.push("The line totals do not add up to the invoice subtotal plus tax.");
  }
  if (payload.totalCents !== payload.subtotalCents + payload.taxCents) {
    errors.push("The invoice total does not equal subtotal plus tax.");
  }
  if (!/^[A-Z]{3}$/.test(String(payload.currencyCode ?? ""))) errors.push("Use a three-letter currency code.");
  return { ok: errors.length === 0, errors };
}

export function canTransitionEtims(from: string, to: string): boolean {
  const current = String(from ?? "NONE").toUpperCase();
  const next = String(to ?? "").toUpperCase();
  return (ALLOWED_TRANSITIONS[current] ?? []).includes(next);
}

/**
 * Submit one invoice and return the state to persist. This function never throws for a provider
 * problem: an invoice that cannot be submitted stays visibly unsubmitted rather than disappearing.
 */
export async function submitInvoiceToEtims(input: {
  adapter: EtimsAdapter;
  payload: EtimsInvoicePayload;
  currentStatus?: string;
}): Promise<{
  status: string;
  controlNumber: string | null;
  responseSource: string | null;
  response: unknown;
  reason: string | null;
}> {
  const current = String(input.currentStatus ?? "NONE").toUpperCase();
  const validation = validateEtimsPayload(input.payload);
  if (!validation.ok) {
    return { status: "REJECTED", controlNumber: null, responseSource: "LOCAL_VALIDATION", response: { errors: validation.errors }, reason: validation.errors[0] };
  }
  if (current === "ACCEPTED") {
    return { status: "ACCEPTED", controlNumber: null, responseSource: null, response: null, reason: "This invoice was already accepted. Submit a credit note instead of resubmitting." };
  }
  if (!input.adapter.configured || !input.adapter.certified) {
    return {
      status: current === "NOT_REQUIRED" ? "NOT_REQUIRED" : "QUEUED",
      controlNumber: null,
      responseSource: null,
      response: { adapter: input.adapter.key },
      reason: "No certified eTIMS connection is configured, so the invoice stays queued locally. Nothing was sent to KRA.",
    };
  }
  if (!canTransitionEtims(current, "SUBMITTING") && current !== "NONE" && current !== "QUEUED" && current !== "VALIDATED") {
    return { status: current, controlNumber: null, responseSource: null, response: null, reason: `An invoice that is ${current} cannot be submitted again.` };
  }

  let result: EtimsAdapterResult;
  try {
    result = await input.adapter.submit(input.payload);
  } catch {
    // A transport error is not a rejection. Anything else would risk a duplicate fiscal document.
    return { status: "UNCERTAIN", controlNumber: null, responseSource: null, response: null, reason: "The eTIMS request did not complete. Reconcile before resubmitting." };
  }

  if (result.outcome === "ACCEPTED") {
    const acceptance = assertAuthoritativeAcceptance({ status: "ACCEPTED", controlNumber: result.controlNumber, responseSource: result.responseSource });
    if (!acceptance.ok) {
      return { status: "UNCERTAIN", controlNumber: null, responseSource: result.responseSource ?? null, response: result.raw, reason: acceptance.reason };
    }
    return { status: "ACCEPTED", controlNumber: result.controlNumber, responseSource: result.responseSource, response: result.raw, reason: null };
  }
  if (result.outcome === "REJECTED") {
    return { status: "REJECTED", controlNumber: null, responseSource: null, response: result.raw, reason: result.reason };
  }
  if (result.outcome === "PENDING_ACK") {
    return { status: "PENDING_ACK", controlNumber: null, responseSource: null, response: result.raw, reason: result.detail };
  }
  if (result.outcome === "UNCERTAIN") {
    return { status: "UNCERTAIN", controlNumber: null, responseSource: null, response: null, reason: result.reason };
  }
  return { status: "QUEUED", controlNumber: null, responseSource: null, response: { code: result.code }, reason: result.reason };
}

/** What the compliance screen may say about submission, in one place, so no screen overstates it. */
export function etimsSubmissionPosture(env: Record<string, string | undefined> = process.env) {
  const enabled = etimsSubmissionEnabled(env);
  return {
    enabled,
    canSubmit: false,
    headline: enabled
      ? "An adapter key is configured, but this release ships no certified adapter, so invoices stay queued."
      : "eTIMS submission is off. Invoices are prepared and validated locally only.",
    requires: [
      "A certified eTIMS connection from KRA or a KRA-vetted integrator",
      "Credentials stored server-side, never in a browser bundle",
      "A sandbox run reconciled against the KRA taxpayer portal",
    ],
  };
}
