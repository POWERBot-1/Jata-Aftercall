/**
 * Deliberate confirmation for high-risk money movement (§62).
 *
 * Changing where a business gets paid, or sending money back out, is not a click that can happen
 * by accident. JATA asks the signed-in account to confirm in the moment, and records who did it
 * and why. The check is server-side: a browser cannot assert that it re-authenticated.
 */

import { verifyPassword } from "@/lib/auth";
import { logPaymentAudit } from "./audit";
import { type PaymentClient, db } from "./context";

export type ConfirmationInput = {
  businessId: string;
  actorId: string | null;
  actorName: string | null;
  roleKey: string;
  /** The account password, when the merchant chose to re-enter it. */
  password?: unknown;
  /** …or the explicit confirmation of a person who is already signed in. */
  confirm?: unknown;
  client?: PaymentClient;
};

export type ConfirmationResult = { ok: true; method: "PASSWORD" | "CONFIRMED" } | { ok: false; code: string; message: string };

export async function confirmHighRiskAction(input: ConfirmationInput): Promise<ConfirmationResult> {
  const client = input.client ?? db();
  const password = typeof input.password === "string" ? input.password : "";
  if (password) {
    const user = await client.user?.findUnique?.({ where: { id: input.actorId } }).catch(() => null);
    if (user?.passwordHash && (await verifyPassword(password, user.passwordHash).catch(() => false))) {
      return { ok: true, method: "PASSWORD" };
    }
    await logPaymentAudit({
      businessId: input.businessId,
      actorKind: "MERCHANT_STAFF",
      actorId: input.actorId,
      actorName: input.actorName,
      action: "CONFIRMATION_REFUSED",
      summary: "A money-movement confirmation was refused.",
      afterState: { method: "PASSWORD" },
    }, client).catch(() => null);
    return { ok: false, code: "REAUTH_FAILED", message: "That password was not correct." };
  }

  if (input.confirm === true) return { ok: true, method: "CONFIRMED" };

  return {
    ok: false,
    code: "CONFIRMATION_REQUIRED",
    message: "Confirm this change before it takes effect.",
  };
}
