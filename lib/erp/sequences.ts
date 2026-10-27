/**
 * Tenant-scoped document numbering (§2.1, §5.4)
 *
 * Numbers come from one atomic increment per business and document type. A number is never
 * derived from a count of existing rows — deleting a draft must not hand a used number to a new
 * invoice, and two cashiers checking out at once must not receive the same receipt number.
 */

import prisma from "../db";

export type SequenceKey = "journal" | "invoice" | "receipt" | "credit_note" | "order" | "supplier_bill";

export const SEQUENCE_PREFIXES: Record<SequenceKey, string> = {
  journal: "JV",
  invoice: "INV",
  receipt: "RCT",
  credit_note: "CN",
  order: "ORD",
  supplier_bill: "BILL",
};

export function formatDocumentNumber(prefix: string, value: number, pad = 6): string {
  return `${prefix}-${String(Math.max(1, Math.round(value))).padStart(pad, "0")}`;
}

export async function nextDocumentNumber(
  client: any,
  businessId: string,
  key: SequenceKey,
  prefix: string = SEQUENCE_PREFIXES[key],
): Promise<string> {
  const row = await client.erpSequence.upsert({
    where: { businessId_key: { businessId, key } },
    create: { businessId, key, prefix, value: 1 },
    update: { value: { increment: 1 } },
  });
  return formatDocumentNumber(prefix, Number(row.value ?? 1));
}

/** Used by tests and by the bootstrap screen to show the next number without consuming it. */
export async function peekDocumentNumber(
  client: any,
  businessId: string,
  key: SequenceKey,
  prefix: string = SEQUENCE_PREFIXES[key],
): Promise<string> {
  const row = await client.erpSequence.findUnique({ where: { businessId_key: { businessId, key } } }).catch(() => null);
  return formatDocumentNumber(prefix, Number(row?.value ?? 0) + 1);
}
