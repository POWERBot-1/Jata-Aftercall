"use server";

/**
 * POS / ERP - PRO server actions.
 *
 * Every action re-authorises the session against the tenant and the permission, validates input on
 * the server, writes through the tested domain modules, audits the result, and redirects with a
 * plain-language message. A client-side form is a convenience; it is never the authorisation.
 */

import { randomUUID, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { erpBasePath, requireErpAccess, ErpAccessError, hasErpPermission } from "@/lib/erp/access";
import { logErpAudit } from "@/lib/erp/audit";
import { bootstrapErpWorkspace } from "@/lib/erp/bootstrap";
import { parseKesToCents, formatCentsShort } from "@/lib/erp/money";
import { postJournal, closePeriod, buildExpenseJournal, reopenPeriod } from "@/lib/erp/accounting";
import { createInvoice, issueInvoice, recordPayment, issueCreditNote } from "@/lib/erp/invoicing";
import { createAutomationRule, pauseAutomation, activateAutomation, runAutomation } from "@/lib/erp/automationActions";
import prisma from "@/lib/db";
import { parseStorefrontSettings, confirmStoreOrder, advanceStoreOrder } from "@/lib/erp/storefront";
import { validateSenderIdName, kycRequirements, SENDER_ID_FEES, applySenderIdOutcome, submitSenderApplication } from "@/lib/messaging/senderId";
import { parseCsv, guessMapping, validateImportRows, commitImport } from "@/lib/messaging/import";
import { consentDecision } from "@/lib/messaging/consent";
import { industryPack } from "@/lib/erp/industryPacks";
import { slugify } from "@/lib/slug";
import { setTeamRole } from "@/lib/erp/team";
import { createTask, updateTask } from "@/lib/erp/tasks";
import {
  createPurchaseOrder,
  submitPurchaseOrder,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  recordPurchaseBill,
} from "@/lib/erp/procurement";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/erp/notifications";
import {
  createRequisition,
  submitRequisition,
  decideRequisition,
  convertRequisition,
  cancelRequisition,
} from "@/lib/erp/requisitions";
import { createApprovalRequest, decideApprovalRequest, withdrawApprovalRequest, requireApprovalFor } from "@/lib/erp/approvals";
import { formatDate, formatNumber } from "@/lib/format";

class ActionError extends Error {}

function text(form: FormData, key: string, fallback = ""): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}
function bool(form: FormData, key: string): boolean {
  const value = form.get(key);
  return value === "on" || value === "true" || value === "1";
}
function cents(form: FormData, key: string): number {
  return parseKesToCents(text(form, key));
}
function back(base: string, path: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(`${base}${path}${query ? `?${query}` : ""}`);
}

async function access(businessId: string, permission: Parameters<typeof hasErpPermission>[1], options: { entitled?: boolean } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  try {
    return await requireErpAccess(businessId, session, { permission, requireEntitled: options.entitled });
  } catch (error) {
    if (error instanceof ErpAccessError) {
      const path = `/dashboard/erp/${encodeURIComponent(businessId)}`;
      redirect(`${path}?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

function businessIdFrom(form: FormData): string {
  const id = text(form, "businessId");
  if (!id) throw new ActionError("Choose a business first.");
  return id;
}

function actionErrorMessage(error: unknown): string {
  // Never swallow Next's control-flow errors (redirect/notFound) — they are not failures.
  if (error && typeof error === "object" && "digest" in error && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR)/.test(String((error as { digest?: unknown }).digest))) {
    throw error;
  }
  if (error instanceof ActionError) return error.message;
  const message = error instanceof Error ? error.message : "";
  if (/prisma|sql|stack|ECONN|invocation/i.test(message) || !message) return "We couldn't save that just now. Nothing was sent or charged. Please try again.";
  return message.slice(0, 300);
}

// ── Workspace and business profile ──────────────────────────────────────────────────────────
export async function bootstrapWorkspaceAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "WORKSPACE_READ");
    await bootstrapErpWorkspace(context.business.id, {
      businessId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      industryPackKey: text(form, "industryPackKey", "retail"),
    });
    revalidatePath(base);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "", { error });
  back(base, "", { ok: "Your workspace is ready." });
}

export async function saveBusinessProfileAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_SETTINGS");
    const legalName = text(form, "legalName");
    const kraPin = text(form, "kraPin").toUpperCase();
    const county = text(form, "county");
    const packKey = text(form, "industryPackKey", "retail");
    const timeZone = text(form, "timeZone", "Africa/Nairobi");
    const currencyCode = text(form, "currencyCode", "KES");
    if (legalName.length < 2) throw new ActionError("Enter the business name as it appears on your registration.");
    if (kraPin && !/^[A-Z]{1,2}\d{9}[A-Z]$/i.test(kraPin)) throw new ActionError("A KRA PIN looks like P051234567X — 11 characters. Check it and try again.");
    if (currencyCode !== "KES") throw new ActionError("Only KES is enabled in this release. The data model supports more currencies, but they are not tested.");
    if (!industryPack(packKey)) throw new ActionError("Choose an industry pack from the list.");

    await bootstrapErpWorkspace(context.business.id, { businessId, actorId: context.session.userId, actorName: context.session.name ?? null });
    await prisma.erpConfiguration.update({
      where: { businessId },
      data: { legalName, kraPin: kraPin || null, county: county || null, industryPackKey: packKey, timeZone, currencyCode },
    });
    await prisma.erpComplianceProfile.update({
      where: { businessId },
      data: { taxpayerName: legalName, kraPin: kraPin || null, county: county || null, sector: packKey },
    }).catch(() => null);
    await logErpAudit({ businessId, actorId: context.session.userId, actorName: context.session.name ?? null, action: "BUSINESS_PROFILE_UPDATED", targetType: "WORKSPACE", targetId: businessId, after: { legalName, county, packKey } });
    ok = "Business details saved.";
    revalidatePath(base);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/settings", { error });
  back(base, "/settings", { ok: ok ?? "Saved." });
}

// ── Channels and Sender ID ──────────────────────────────────────────────────────────────────
export async function connectSandboxChannelAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_SENDER_ID");
    const channel = text(form, "channel");
    if (!["SMS", "WHATSAPP", "EMAIL"].includes(channel)) throw new ActionError("Choose a channel.");
    await prisma.msgChannelConnection.upsert({
      where: { businessId_channel: { businessId, channel } },
      create: {
        businessId, channel, provider: "mock", status: "ACTIVE",
        configJson: JSON.stringify({ sandbox: true, connectedAt: new Date().toISOString() }),
        healthJson: JSON.stringify({ state: "HEALTHY", message: "Sandbox connector. No messages leave this environment." }),
        lastCheckedAt: new Date(),
      },
      update: {
        status: "ACTIVE", provider: "mock",
        configJson: JSON.stringify({ sandbox: true, connectedAt: new Date().toISOString() }),
        healthJson: JSON.stringify({ state: "HEALTHY", message: "Sandbox connector. No messages leave this environment." }),
        lastCheckedAt: new Date(),
      },
    });
    await logErpAudit({ businessId, actorId: context.session.userId, action: "CHANNEL_CONNECTED_SANDBOX", targetType: "CHANNEL", targetId: channel, after: { provider: "mock", status: "ACTIVE" } });
    revalidatePath(`${base}/sender-identity`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/sender-identity", { error });
  back(base, "/sender-identity", { ok: "Sandbox channel connected. No real messages will be sent from it." });
}

export async function createSenderApplicationAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_SENDER_ID");
    const requestedId = text(form, "requestedId");
    const existing = await prisma.msgSenderId.findMany({ where: { businessId }, select: { requestedId: true } });
    const validation = validateSenderIdName(requestedId, { existing: existing.map((row: any) => row.requestedId) });
    if (!validation.ok) throw new ActionError(validation.errors[0]);
    const sender = await prisma.msgSenderId.create({
      data: {
        businessId,
        requestedId: requestedId.toUpperCase(),
        network: text(form, "network", "MULTI") || "MULTI",
        purpose: text(form, "purpose", "TRANSACTIONAL") || "TRANSACTIONAL",
        status: "DRAFT",
        provider: "mock",
        channel: "SMS",
        replyCapable: false,
        feesJson: JSON.stringify(SENDER_ID_FEES),
      },
    });
    await prisma.msgSenderIdEvent.create({
      data: { businessId, senderIdId: sender.id, type: "DRAFT_CREATED", toStatus: "DRAFT", source: "CUSTOMER", actorId: context.session.userId, note: "Validation passed: this is a preliminary check, not approval." },
    });
    await logErpAudit({ businessId, actorId: context.session.userId, action: "SENDER_ID_DRAFT_CREATED", targetType: "SENDER_ID", targetId: sender.id, after: { requestedId: sender.requestedId } });
    ok = `Draft saved for ${sender.requestedId}. This is not an approval.`;
    revalidatePath(`${base}/sender-identity`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/sender-identity", { error });
  back(base, "/sender-identity", { ok: ok ?? "Draft saved." });
}

export async function submitSenderIdAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_SENDER_ID");
    const senderIdId = text(form, "senderIdId");
    const configuration = await prisma.erpConfiguration.findUnique({ where: { businessId } });
    const profile = await prisma.erpComplianceProfile.findUnique({ where: { businessId } });
    const provided = ["business_name", "business_registration", "kra_pin", "authorised_representative", "id_document", "brand_authority"].filter((key) => bool(form, `kyc_${key}`));
    const result = await submitSenderApplication(prisma, {
      businessId,
      senderIdId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      requirements: kycRequirements("SMS"),
      provided,
      businessProfileComplete: Boolean(configuration?.legalName && profile?.kraPin),
      feeAcknowledged: bool(form, "feeAcknowledged"),
      provider: {
        submitApplication: async () => ({
          ok: true,
          reference: `SANDBOX-${createHash("sha256").update(`${businessId}:${senderIdId}`).digest("hex").slice(0, 8).toUpperCase()}`,
          message: "Sandbox submission recorded. No application was sent to a network — connect an approved provider for a real submission.",
        }),
      },
    });
    if (!result.ok) throw new ActionError(`${result.message}${result.missing.length ? ` Missing: ${result.missing.join(", ")}.` : ""}`);
    ok = "Application submitted in the sandbox. It is not approved, and no network has received it.";
    revalidatePath(`${base}/sender-identity`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/sender-identity", { error });
  back(base, "/sender-identity", { ok: ok ?? "Submitted." });
}

/**
 * An authorised manual review decision. Restricted to a platform administrator AND only when the
 * deployment explicitly enables manual review; it is logged as MANUAL, never as a provider event.
 */
export async function recordManualSenderDecisionAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const session = await getSession();
    if (!session || session.role !== "ADMIN") throw new ActionError("Only a platform administrator can record a manual review.");
    if (process.env.ERP_ALLOW_MANUAL_SENDER_REVIEW !== "true") {
      throw new ActionError("Manual Sender ID review is disabled in this environment. Approval must come from the provider.");
    }
    const status = text(form, "status").toUpperCase() as any;
    if (!["UNDER_REVIEW", "APPROVED", "REJECTED", "ACTIVE", "SUSPENDED"].includes(status)) throw new ActionError("Choose a valid decision.");
    await applySenderIdOutcome(prisma, {
      businessId,
      senderIdId: text(form, "senderIdId"),
      status,
      actor: "ADMIN",
      actorId: session.userId,
      note: text(form, "note") || "Authorised manual review.",
      rejectionReason: text(form, "note") || null,
    });
    revalidatePath(`${base}/sender-identity`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/sender-identity", { error });
  back(base, "/sender-identity", { ok: "Manual review recorded. It is labelled as manual in the history." });
}

// ── Contacts and consent ───────────────────────────────────────────────────────────────────
export async function importContactsAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let summary = "";
  try {
    const context = await access(businessId, "MANAGE_MESSAGING");
    let csv = text(form, "csv");
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 2_000_000) throw new ActionError("That file is too large. Keep imports under 2 MB (about 20,000 rows).");
      if (!/\.csv$/i.test(file.name)) throw new ActionError("Upload a .csv file. Spreadsheet exports work: choose “Save as CSV”.");
      csv = await file.text();
    }
    if (!csv.trim()) throw new ActionError("Paste your rows or choose a CSV file first.");
    const parsed = parseCsv(csv);
    if (parsed.errors.length && parsed.rows.length === 0) throw new ActionError(parsed.errors[0]);
    const mapping = guessMapping(parsed.headers);
    if (mapping.phone === undefined) throw new ActionError("We couldn't find a phone column. Rename it to “phone” and try again.");
    const existing = await prisma.msgContact.findMany({ where: { businessId }, select: { phoneNormalized: true } });
    const preview = validateImportRows({ headers: parsed.headers, rows: parsed.rows, mapping, existingPhones: existing.map((row: any) => row.phoneNormalized) });
    if (preview.candidates.length === 0) {
      throw new ActionError(`Nothing could be imported. ${preview.issues[0]?.message ?? preview.duplicatesExisting[0]?.message ?? "Check the phone column."}`);
    }
    const result = await commitImport(prisma, { businessId, preview, actorId: context.session.userId, source: "CSV_IMPORT" });
    await logErpAudit({
      businessId,
      actorId: context.session.userId,
      action: "CONTACTS_IMPORTED",
      targetType: "CONTACT",
      after: { imported: result.imported, skipped: result.skipped, rejected: result.rejected, consentRecorded: result.consentRecorded },
    });
    summary = `Imported ${result.imported} · skipped ${result.skipped} · rejected ${result.rejected} · consent recorded for ${result.consentRecorded}.`;
    revalidatePath(`${base}/customers`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/customers", { error });
  back(base, "/customers", { ok: summary });
}

export async function addContactAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_MESSAGING");
    const { normalizeKePhone } = await import("@/lib/phone");
    const phone = normalizeKePhone(text(form, "phone"));
    if (!phone) throw new ActionError("Enter a valid Kenyan mobile number.");
    const name = text(form, "name");
    if (name.length < 2) throw new ActionError("Enter the customer's name.");
    const contact = await prisma.msgContact.upsert({
      where: { businessId_phoneNormalized: { businessId, phoneNormalized: phone } },
      create: { businessId, phoneNormalized: phone, name, source: "MANUAL", tagsJson: JSON.stringify(text(form, "tags").split(",").map((tag) => tag.trim()).filter(Boolean)) },
      update: { name },
    });
    if (bool(form, "marketingConsent")) {
      if (!text(form, "consentSource")) throw new ActionError("Record where the customer agreed to marketing, so the consent is evidence.");
      await prisma.msgConsentRecord.create({
        data: { businessId, contactId: contact.id, channel: "SMS", purpose: "MARKETING", granted: true, source: "MANUAL", wordingVersion: text(form, "consentSource"), capturedById: context.session.userId },
      });
    }
    revalidatePath(`${base}/customers`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/customers", { error });
  back(base, "/customers", { ok: "Customer saved." });
}

export async function recordConsentAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_MESSAGING");
    const contactId = text(form, "contactId");
    const channel = text(form, "channel", "SMS") as "SMS" | "WHATSAPP" | "EMAIL";
    const purpose = text(form, "purpose", "MARKETING") as "MARKETING" | "TRANSACTIONAL";
    const granted = bool(form, "granted");
    const source = text(form, "source");
    const wordingVersion = text(form, "wordingVersion");
    const decision = consentDecision({ channel, purpose, granted, source, wordingVersion });
    if (!decision.ok) throw new ActionError(decision.errors[0]);
    const contact = await prisma.msgContact.findUnique({ where: { id: contactId } });
    if (!contact || contact.businessId !== businessId) throw new ActionError("That contact was not found.");
    await prisma.msgConsentRecord.create({
      data: { businessId, contactId, channel, purpose, granted, source, wordingVersion: wordingVersion || null, capturedById: context.session.userId },
    });
    await logErpAudit({ businessId, actorId: context.session.userId, action: revokedOrGranted(granted), targetType: "CONSENT", targetId: contactId, after: { channel, purpose, source } });
    revalidatePath(`${base}/customers`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/customers", { error });
  back(base, "/customers", { ok: "Consent updated." });
}

function revokedOrGranted(granted: boolean): string {
  return granted ? "CONSENT_GRANTED" : "CONSENT_WITHDRAWN";
}

export async function suppressContactAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_MESSAGING");
    const contactId = text(form, "contactId");
    const contact = await prisma.msgContact.findUnique({ where: { id: contactId } });
    if (!contact || contact.businessId !== businessId) throw new ActionError("That contact was not found.");
    await prisma.msgSuppression.upsert({
      where: { businessId_phoneNormalized_channel: { businessId, phoneNormalized: contact.phoneNormalized, channel: "ALL" } },
      create: { businessId, phoneNormalized: contact.phoneNormalized, channel: "ALL", reason: "OPT_OUT", source: "STAFF", note: text(form, "note") || "Opt-out recorded by staff." },
      update: { reason: "OPT_OUT" },
    });
    await prisma.msgConsentRecord.create({
      data: { businessId, contactId, channel: "SMS", purpose: "MARKETING", granted: false, source: "STAFF", wordingVersion: "opt-out", capturedById: context.session.userId },
    });
    await logErpAudit({ businessId, actorId: context.session.userId, action: "CONTACT_SUPPRESSED", targetType: "CONTACT", targetId: contactId, reason: text(form, "note") || "Opt-out" });
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/customers", { error });
  back(base, "/customers", { ok: "Customer suppressed. They will not receive marketing from you." });
}

// ── Invoices, payments and expenses ────────────────────────────────────────────────────────
function invoiceLinesFrom(form: FormData) {
  const descriptions = form.getAll("itemDescription").map(String);
  const quantities = form.getAll("itemQuantity").map(String);
  const prices = form.getAll("itemPrice").map(String);
  const taxKeys = form.getAll("itemTaxKey").map(String);
  return descriptions
    .map((description, index) => ({
      description: description.trim(),
      quantity: Math.max(0.001, Number(quantities[index] ?? 1) || 1),
      unitAmountCents: parseKesToCents(prices[index] ?? "0"),
      taxKey: taxKeys[index] || "VAT_STANDARD",
    }))
    .filter((line) => line.description && line.unitAmountCents > 0);
}

export async function createInvoiceAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVOICES", { entitled: true });
    const lines = invoiceLinesFrom(form);
    if (!lines.length) throw new ActionError("Add at least one item with a description and a price.");
    const requestKey = text(form, "requestKey") || randomUUID();
    const created = await createInvoice(prisma, {
      businessId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      customerName: text(form, "customerName"),
      customerPhone: text(form, "customerPhone") || null,
      dueAt: text(form, "dueAt") || null,
      lines,
      notes: text(form, "notes") || null,
      idempotencyKey: `invoice:${requestKey}`,
      sourceType: "MANUAL",
    });
    if (bool(form, "issueNow")) {
      await issueInvoice(prisma, { businessId, invoiceId: created.invoice.id, actorId: context.session.userId, actorName: context.session.name ?? null });
      ok = `Invoice ${created.invoice.invoiceNumber} issued and posted to the ledger.`;
    } else {
      ok = `Draft ${created.invoice.invoiceNumber} saved. Issue it to post the receivable.`;
    }
    revalidatePath(`${base}/invoices`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/invoices", { error });
  back(base, "/invoices", { ok: ok ?? "Saved." });
}

export async function issueInvoiceAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVOICES", { entitled: true });
    await issueInvoice(prisma, { businessId, invoiceId: text(form, "invoiceId"), actorId: context.session.userId, actorName: context.session.name ?? null });
    revalidatePath(`${base}/invoices`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/invoices", { error });
  back(base, "/invoices", { ok: "Invoice issued and posted." });
}

export async function recordPaymentAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVOICES", { entitled: true });
    const amountCents = cents(form, "amount");
    if (amountCents <= 0) throw new ActionError("Enter the amount received.");
    const result = await recordPayment(prisma, {
      businessId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      invoiceId: text(form, "invoiceId") || null,
      amountCents,
      method: text(form, "method", "cash"),
      reference: text(form, "reference") || null,
      idempotencyKey: `payment:${text(form, "requestKey") || randomUUID()}`,
    });
    ok = `Receipt ${result.payment.receiptNumber} recorded.${result.unallocatedCents ? ` KES ${formatNumber(result.unallocatedCents / 100)} held as a customer deposit.` : ""}`;
    revalidatePath(`${base}/invoices`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/invoices", { error });
  back(base, "/invoices", { ok: ok ?? "Payment recorded." });
}

export async function creditNoteAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVOICES", { entitled: true });
    await issueCreditNote(prisma, {
      businessId,
      invoiceId: text(form, "invoiceId"),
      reason: text(form, "reason"),
      netCents: cents(form, "netAmount"),
      taxCents: cents(form, "taxAmount"),
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      idempotencyKey: `credit:${text(form, "requestKey") || randomUUID()}`,
    });
    revalidatePath(`${base}/invoices`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/invoices", { error });
  back(base, "/invoices", { ok: "Credit note issued and posted." });
}

export async function recordExpenseAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "POST_JOURNAL", { entitled: true });
    const amountCents = cents(form, "amount");
    const taxCents = cents(form, "tax");
    if (amountCents <= 0) throw new ActionError("Enter the amount spent.");
    if (taxCents > amountCents) throw new ActionError("VAT cannot be more than the total.");
    const description = text(form, "description");
    if (description.length < 3) throw new ActionError("Describe what the money was spent on.");
    const occurredAt = text(form, "occurredAt") ? new Date(text(form, "occurredAt")) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new ActionError("That date is not valid.");
    const category = text(form, "category", "Other");
    const accountCode = text(form, "accountCode", "5700");
    const paidFromCode = text(form, "paidFromCode", "1000");
    const requestKey = text(form, "requestKey") || randomUUID();
    const netCents = amountCents - taxCents;

    // Above this role's limit the expense is not posted: it becomes a request. An approval granted
    // earlier is spent here, once, inside the same write.
    const gate = await requireApprovalFor({
      client: prisma,
      businessId,
      requester: { userId: context.session.userId, name: context.session.name ?? null, role: context.role },
      kind: "SPEND",
      amountCents,
      title: `Expense: ${description}`,
      detail: `${formatCentsShort(amountCents)}${taxCents ? ` including ${formatCentsShort(taxCents)} VAT` : ""} · ${category}`,
      href: `${base}/expenses`,
      ref: `expense:${requestKey}`,
      actorName: context.session.name ?? null,
    });
    if (gate.blocked) {
      back(base, "/expenses", {
        ok: `${gate.gate.reason} Request sent for approval — nothing has been posted or paid yet.`,
      });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const journal = await postJournal(tx, {
        businessId,
        actorId: context.session.userId,
        actorName: context.session.name ?? null,
        entryDate: occurredAt,
        description: `Expense: ${description}`,
        sourceType: "EXPENSE",
        lines: buildExpenseJournal({ netCents, taxCents, description, expenseCode: accountCode, paidFromCode }),
        idempotencyKey: `expense-journal:${requestKey}`,
      });
      const expense = await tx.erpExpense.create({
        data: {
          businessId, category, accountCode, description, amountCents, taxCents,
          method: text(form, "method", "cash"), paidFromCode, occurredAt,
          status: "POSTED", journalId: journal.id, idempotencyKey: `expense:${requestKey}`,
          createdById: context.session.userId,
        },
      });
      return { expense, journal };
    });
    ok = `Expense recorded and posted as ${result.journal.journalNumber}.`;
    revalidatePath(`${base}/expenses`);
    revalidatePath(`${base}/accounting`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/expenses", { error });
  back(base, "/expenses", { ok: ok ?? "Expense recorded." });
}

export async function postJournalAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "POST_JOURNAL", { entitled: true });
    const accountCodes = form.getAll("accountCode").map(String);
    const debits = form.getAll("debit").map(String);
    const credits = form.getAll("credit").map(String);
    const lines = accountCodes
      .map((accountCode, index) => ({
        accountCode,
        debitCents: parseKesToCents(debits[index] ?? ""),
        creditCents: parseKesToCents(credits[index] ?? ""),
      }))
      .filter((line) => line.accountCode && (line.debitCents > 0 || line.creditCents > 0));
    if (lines.length < 2) throw new ActionError("Add at least two lines — a debit and a credit.");
    const totalCents = lines.reduce((sum, line) => sum + line.debitCents, 0);
    // A manual journal is a consequential write. Above the role limit it waits for a decision.
    const gate = await requireApprovalFor({
      client: prisma,
      businessId,
      requester: { userId: context.session.userId, name: context.session.name ?? null, role: context.role },
      kind: "JOURNAL",
      amountCents: totalCents,
      title: `Journal: ${text(form, "description").slice(0, 120) || "Manual journal"}`,
      detail: `${lines.length} lines · ${formatCentsShort(totalCents)}`,
      href: `${base}/accounting`,
      ref: `journal:${text(form, "requestKey") || randomUUID()}`,
      actorName: context.session.name ?? null,
    });
    if (gate.blocked) {
      back(base, "/accounting", {
        ok: `${gate.gate.reason} Request sent for approval — nothing has been posted.`,
      });
    }
    const entryDate = text(form, "entryDate") ? new Date(text(form, "entryDate")) : new Date();
    if (Number.isNaN(entryDate.getTime())) throw new ActionError("That date is not valid.");
    const journal = await postJournal(prisma, {
      businessId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      entryDate,
      description: text(form, "description"),
      sourceType: "MANUAL",
      lines,
      idempotencyKey: `journal:${text(form, "requestKey") || randomUUID()}`,
    });
    ok = `Journal ${journal.journalNumber} posted.`;
    revalidatePath(`${base}/accounting`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/accounting", { error });
  back(base, "/accounting", { ok: ok ?? "Journal posted." });
}

export async function closePeriodAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "CLOSE_PERIOD");
    const [year, month] = text(form, "period").split("-").map(Number);
    if (!year || !month) throw new ActionError("Choose the month to close.");
    if (text(form, "action") === "reopen") {
      await reopenPeriod(prisma, { businessId, fiscalYear: year, month, actorId: context.session.userId, actorName: context.session.name ?? null, reason: text(form, "reason") });
      revalidatePath(`${base}/accounting`);
    } else {
      await closePeriod(prisma, { businessId, fiscalYear: year, month, actorId: context.session.userId, actorName: context.session.name ?? null });
      revalidatePath(`${base}/accounting`);
    }
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/accounting", { error });
  back(base, "/accounting", { ok: "Accounting period updated." });
}

// ── Automation ─────────────────────────────────────────────────────────────────────────────
export async function createAutomationRuleAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_AUTOMATION");
    const actionType = text(form, "actionType", "NOTIFY") as any;
    const rule = await createAutomationRule(prisma, {
      businessId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      name: text(form, "name"),
      trigger: text(form, "trigger"),
      conditions: text(form, "conditionField") && text(form, "conditionValue")
        ? [{ field: text(form, "conditionField"), operator: (text(form, "conditionOperator", "gte") as any), value: Number(text(form, "conditionValue")) || text(form, "conditionValue") }]
        : [],
      actions: [{ type: actionType, params: { title: text(form, "actionTitle") || text(form, "name"), message: text(form, "actionMessage") || `Triggered by ${text(form, "name")}`, role: text(form, "actionRole", "OWNER") } }],
      requiresApproval: bool(form, "requiresApproval"),
      maxRunsPerDay: Number(text(form, "maxRunsPerDay", "50")) || 50,
      activate: false,
    });
    ok = `Rule “${rule.name}” saved as a draft. Activate it when you're ready.`;
    revalidatePath(`${base}/automation`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/automation", { error });
  back(base, "/automation", { ok: ok ?? "Rule saved." });
}

export async function toggleAutomationRuleAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_AUTOMATION");
    const ruleId = text(form, "ruleId");
    if (text(form, "state") === "active") {
      await activateAutomation(prisma, { businessId, ruleId, actorId: context.session.userId, actorName: context.session.name ?? null });
    } else {
      await pauseAutomation(prisma, { businessId, ruleId, actorId: context.session.userId, actorName: context.session.name ?? null, reason: text(form, "reason") || "Paused by owner." });
    }
    revalidatePath(`${base}/automation`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/automation", { error });
  back(base, "/automation", { ok: "Rule updated." });
}

export async function runAutomationRuleAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_AUTOMATION");
    const dryRun = text(form, "mode") !== "execute";
    const event = {
      quantity: Number(text(form, "quantity", "0")) || 0,
      productName: text(form, "productName") || "Stock item",
      orderTotalCents: cents(form, "orderTotal"),
      daysOverdue: Number(text(form, "daysOverdue", "0")) || 0,
    };
    const result = await runAutomation(prisma, {
      businessId,
      ruleId: text(form, "ruleId"),
      event,
      eventId: text(form, "requestKey") || randomUUID(),
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      dryRun,
      approved: false,
    });
    ok = `${dryRun ? "Preview" : "Run"}: ${result.reason}`;
    revalidatePath(`${base}/automation`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/automation", { error });
  back(base, "/automation", { ok: ok ?? "Done." });
}

// ── Store ─────────────────────────────────────────────────────────────────────────────────
export async function saveStorefrontAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_STORE");
    const { storefrontSecret } = await import("@/lib/erp/storefront");
    const enabled = bool(form, "enabled");
    const secret = storefrontSecret();
    if (enabled && !secret.secret) throw new ActionError("The store cannot be opened until STOREFRONT_REF_SECRET is configured on the server.");
    const current = await prisma.erpConfiguration.findUnique({ where: { businessId } });
    const desiredSlug = slugify(text(form, "slug") || current?.storefrontSlug || context.business.slug);
    if (!desiredSlug) throw new ActionError("Choose a shop address with letters and numbers.");
    if (desiredSlug !== current?.storefrontSlug) {
      const conflict = await prisma.erpConfiguration.findUnique({ where: { storefrontSlug: desiredSlug } });
      if (conflict) throw new ActionError("That shop address is already taken. Try another.");
    }
    const settings = {
      ...parseStorefrontSettings(current?.storefrontJson),
      enabled,
      headline: text(form, "headline").slice(0, 120),
      about: text(form, "about").slice(0, 400),
      deliveryFeeCents: cents(form, "deliveryFee"),
      minimumOrderCents: cents(form, "minimumOrder"),
      deliveryAreas: text(form, "deliveryAreas").split(",").map((area) => area.trim()).filter(Boolean).slice(0, 20),
      openHour: Math.min(23, Math.max(0, Number(text(form, "openHour", "8")) || 8)),
      closeHour: Math.min(24, Math.max(1, Number(text(form, "closeHour", "20")) || 20)),
      allowDelivery: bool(form, "allowDelivery"),
      allowPickup: bool(form, "allowPickup"),
    };
    if (settings.closeHour <= settings.openHour) throw new ActionError("Closing time must be after opening time.");
    await prisma.erpConfiguration.update({
      where: { businessId },
      data: { storefrontSlug: desiredSlug, storefrontJson: JSON.stringify(settings) },
    });
    await logErpAudit({ businessId, actorId: context.session.userId, action: "STOREFRONT_UPDATED", targetType: "STOREFRONT", after: { enabled, slug: desiredSlug } });
    ok = enabled ? "Your shop is open. Share the link or QR code." : "Shop settings saved. The shop is closed.";
    revalidatePath(`${base}/store`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/store", { error });
  back(base, "/store", { ok: ok ?? "Saved." });
}

export async function storeOrderAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_STORE");
    const orderId = text(form, "orderId");
    const action = text(form, "orderAction");
    if (action === "confirm") {
      const result = await confirmStoreOrder(prisma, { businessId, orderId, actorId: context.session.userId, actorName: context.session.name ?? null });
      ok = result.alreadyConfirmed ? "Order was already confirmed." : `Order ${result.order.orderNumber} confirmed and stock deducted.`;
    } else {
      const status = text(form, "status").toUpperCase() as any;
      await advanceStoreOrder(prisma, { businessId, orderId, status, actorId: context.session.userId, actorName: context.session.name ?? null, reason: text(form, "reason") || undefined });
      ok = `Order marked ${status.toLowerCase()}.`;
    }
    revalidatePath(`${base}/store`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/store", { error });
  back(base, "/store", { ok: ok ?? "Order updated." });
}

// ── Onboarding derived from a real upload count ───────────────────────────────────────────
export async function refreshChecklistAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  try {
    await access(businessId, "WORKSPACE_READ");
    revalidatePath(base);
  } catch (error) {
    if (error instanceof ErpAccessError) back(base, "", { error: error.message });
    throw error;
  }
  back(base, "", { ok: "Checklist refreshed." });
}

// ── Campaigns ──────────────────────────────────────────────────────────────────────────────
function audienceFrom(form: FormData) {
  const mode = text(form, "audienceMode", "ALL_ELIGIBLE");
  const tags = text(form, "audienceTags").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 5);
  return { mode: mode as any, tags: tags.length ? tags : undefined, contactIds: [] as string[] };
}

export async function createCampaignAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let campaignId: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_MESSAGING");
    const prisma = (await import("@/lib/db")).default;
    const { createCampaign } = await import("@/lib/messaging/campaigns");
    const channel = text(form, "channel", "SMS") as any;
    const purpose = text(form, "purpose", "MARKETING") as any;
    const body = text(form, "body");
    if (body.length < 5) throw new ActionError("Write the message you want to send.");
    const campaign = await createCampaign(prisma, {
      businessId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      name: text(form, "name") || `${channel === "WHATSAPP" ? "WhatsApp" : "SMS"} campaign ${formatDate(new Date())}`,
      channel,
      purpose,
      body,
      audience: audienceFrom(form),
      senderIdId: text(form, "senderIdId") || null,
      templateId: text(form, "templateId") || null,
      notes: text(form, "notes") || null,
      timeZone: "Africa/Nairobi",
    });
    campaignId = campaign.id;
    revalidatePath(`${base}/messaging`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/messaging/new", { error });
  back(base, `/messaging/${campaignId}`, { ok: "Draft saved. Check the audience and cost next." });
}

export async function planCampaignAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  const campaignId = text(form, "campaignId");
  let error: string | null = null;
  let ok: string | null = null;
  try {
    await access(businessId, "MANAGE_MESSAGING");
    const prisma = (await import("@/lib/db")).default;
    const { planCampaign } = await import("@/lib/messaging/campaigns");
    const result = await planCampaign(prisma, { businessId, campaignId });
    ok = `${result.preview.eligibleCount} recipients ready · ${result.preview.excludedCount} excluded · estimated ${formatNumber(Number(result.preview.estimatedCostCents) / 100)} KES.`;
    revalidatePath(`${base}/messaging/${campaignId}`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, `/messaging/${campaignId}`, { error });
  back(base, `/messaging/${campaignId}`, { ok: ok ?? "Audience planned." });
}

export async function testSendAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  const campaignId = text(form, "campaignId");
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_MESSAGING");
    const prisma = (await import("@/lib/db")).default;
    const { sendTestMessage } = await import("@/lib/messaging/testSend");
    const result = await sendTestMessage(prisma, {
      businessId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      to: text(form, "testTo"),
      body: text(form, "testBody") || text(form, "body"),
      channel: (text(form, "channel", "SMS") as any),
      senderIdId: text(form, "senderIdId") || null,
      campaignId: campaignId || null,
    });
    if (!result.ok) throw new ActionError(result.message);
    ok = result.message;
    revalidatePath(`${base}/messaging/${campaignId}`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, `/messaging/${campaignId}`, { error });
  back(base, `/messaging/${campaignId}`, { ok: ok ?? "Test sent." });
}

export async function approveCampaignAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  const campaignId = text(form, "campaignId");
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "APPROVE_CAMPAIGNS");
    const prisma = (await import("@/lib/db")).default;
    const { approveCampaign } = await import("@/lib/messaging/campaigns");
    const result = await approveCampaign(prisma, {
      businessId,
      campaignId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      role: context.role,
      costConfirmed: bool(form, "costConfirmed"),
      separationOfDuties: process.env.ERP_SEPARATION_OF_DUTIES !== "false",
    });
    ok = `Approved. ${formatNumber(result.reservedCents / 100)} KES reserved in your wallet. Nothing has been sent yet.`;
    revalidatePath(`${base}/messaging/${campaignId}`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, `/messaging/${campaignId}`, { error });
  back(base, `/messaging/${campaignId}`, { ok: ok ?? "Approved." });
}

/**
 * Dispatch a bounded batch. The button is deliberately manual: the queue is durable, and running
 * this again is safe because claims are conditional on QUEUED.
 */
export async function dispatchCampaignAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  const campaignId = text(form, "campaignId");
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "APPROVE_CAMPAIGNS");
    const prisma = (await import("@/lib/db")).default;
    const { dispatchBatch, reconcileCampaign } = await import("@/lib/messaging/pipeline");
    if (text(form, "mode") === "reconcile") {
      const result = await reconcileCampaign(prisma, { businessId, campaignId });
      ok = `Checked ${result.checked} uncertain message${result.checked === 1 ? "" : "s"}: ${result.delivered} delivered, ${result.failed} failed, ${result.stillUnknown} still unknown. Nothing was resent.`;
    } else {
      const summary = await dispatchBatch(prisma, {
        businessId,
        campaignId,
        limit: Math.min(200, Math.max(1, Number(text(form, "limit", "25")) || 25)),
        providerMode: "sandbox",
      });
      ok = `${summary.submitted} sent to the sandbox · ${summary.blocked} blocked · ${summary.failed} failed · ${summary.unknown} unknown. ${summary.message}`;
      await logErpAudit({ businessId, actorId: context.session.userId, action: "CAMPAIGN_DISPATCH", targetType: "CAMPAIGN", targetId: campaignId, after: { ...summary } });
    }
    revalidatePath(`${base}/messaging/${campaignId}`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, `/messaging/${campaignId}`, { error });
  back(base, `/messaging/${campaignId}`, { ok: ok ?? "Queue processed." });
}

export async function campaignLifecycleAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  const campaignId = text(form, "campaignId");
  let error: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_MESSAGING");
    const prisma = (await import("@/lib/db")).default;
    const campaigns = await import("@/lib/messaging/campaigns");
    const action = text(form, "lifecycle");
    if (action === "pause") await campaigns.pauseCampaign(prisma, { businessId, campaignId, actorId: context.session.userId, actorName: context.session.name ?? null, reason: text(form, "reason") || "Paused by owner." });
    else if (action === "resume") await campaigns.resumeCampaign(prisma, { businessId, campaignId, actorId: context.session.userId, actorName: context.session.name ?? null });
    else if (action === "cancel") await campaigns.cancelCampaign(prisma, { businessId, campaignId, actorId: context.session.userId, actorName: context.session.name ?? null, reason: text(form, "reason") || "Cancelled by owner." });
    else throw new ActionError("Choose what to do with this campaign.");
    revalidatePath(`${base}/messaging/${campaignId}`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, `/messaging/${campaignId}`, { error });
  back(base, `/messaging/${campaignId}`, { ok: "Campaign updated." });
}

// ── Plan ───────────────────────────────────────────────────────────────────────────────────
/**
 * Begin a subscription purchase. This writes a PENDING subscription and sends the owner to the
 * existing, verified checkout. It never marks the plan active: only a paid, server-verified
 * Payment can do that, in `syncErpEntitlement`.
 */
export async function startErpPlanAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let checkoutUrl: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_BILLING");
    const prisma = (await import("@/lib/db")).default;
    const { ERP_PLAN_KEY, ERP_PLAN_PRICE_KES, ERP_PLAN_DURATION_DAYS } = await import("@/lib/erp/entitlement");
    const { getCheckoutUrl } = await import("@/lib/subscriptionFlow");
    const plan = await prisma.planConfig.findUnique({ where: { key: ERP_PLAN_KEY } });
    if (!plan) throw new ActionError("The POS / ERP - PRO plan has not been configured on this deployment yet. Nothing was charged.");
    if (Number(plan.priceKES) !== ERP_PLAN_PRICE_KES || Number(plan.durationDays) !== ERP_PLAN_DURATION_DAYS) {
      throw new ActionError("The plan price on the server does not match the published price. Payment is blocked until an administrator corrects it.");
    }
    const existing = await prisma.erpSubscription.findUnique({ where: { businessId } });
    if (existing) {
      await prisma.erpSubscription.update({ where: { businessId }, data: { planId: plan.id, planKey: ERP_PLAN_KEY, status: existing.status === "ACTIVE" ? "ACTIVE" : "PENDING" } });
    } else {
      await prisma.erpSubscription.create({
        data: { businessId, userId: context.session.userId, planId: plan.id, planKey: ERP_PLAN_KEY, status: "PENDING" },
      });
    }
    await logErpAudit({ businessId, actorId: context.session.userId, action: "ERP_PLAN_CHECKOUT_STARTED", targetType: "SUBSCRIPTION", targetId: plan.id, outcome: "SUCCESS" });
    checkoutUrl = getCheckoutUrl(businessId, plan.id);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/settings", { error });
  redirect(String(checkoutUrl));
}

// ── Team and roles ────────────────────────────────────────────────────────────────────────
export async function updateTeamRoleAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_USERS", { entitled: true });
    const result = await setTeamRole(prisma, {
      businessId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      actorRole: context.role,
      targetUserId: text(form, "userId"),
      role: text(form, "role"),
      ownerId: context.business.ownerId,
    });
    ok = `Role updated to ${result.role}. It applies the next time they open the workspace.`;
    revalidatePath(`${base}/settings`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/settings", { error, tab: "team" });
  back(base, "/settings", { ok: ok ?? "Role updated.", tab: "team" });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────────────────────────
// The task board is the one place "somebody owns this by a date" is recorded. Creation and status
// changes go through lib/erp/tasks, which validates, enforces the state machine and audits — the
// form is only a convenience.

export async function createTaskAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_TASKS", { entitled: true });
    const dueRaw = text(form, "dueAt");
    const result = await createTask(prisma, {
      businessId,
      title: text(form, "title"),
      detail: text(form, "detail") || null,
      priority: text(form, "priority", "NORMAL"),
      assignedTo: text(form, "assignedTo") || null,
      dueAt: dueRaw ? new Date(`${dueRaw}T12:00:00Z`) : null,
      sourceType: "MANUAL",
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
    });
    ok = result.created ? "Task added to the board." : "That task already existed.";
    revalidatePath(`${base}/tasks`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/tasks", { error });
  back(base, "/tasks", { ok: ok ?? "Task added." });
}

export async function updateTaskAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_TASKS", { entitled: true });
    const taskId = text(form, "taskId");
    if (!taskId) throw new ActionError("Choose a task.");
    const status = text(form, "status");
    const priority = text(form, "priority");
    const dueRaw = text(form, "dueAt");
    const assignee = form.get("assignedTo");
    const result = await updateTask(prisma, {
      businessId,
      taskId,
      status: status ? status : undefined,
      priority: priority ? priority : undefined,
      dueAt: dueRaw === "" ? null : dueRaw ? new Date(dueRaw) : undefined,
      assignedTo: assignee === null ? undefined : String(assignee),
      reason: text(form, "reason") || null,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
    });
    ok = result.changed ? "Task updated." : "Nothing changed.";
    revalidatePath(`${base}/tasks`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/tasks", { error });
  back(base, "/tasks", { ok: ok ?? "Task updated." });
}

/**
 * Mark one notification read for the signed-in person.
 *
 * Reading is per person, so this writes a `ErpNotificationRead` row rather than flipping a flag on the
 * notice. The domain function refuses a row from another tenant and a row this person cannot see;
 * this action only decides that the caller may open the workspace at all.
 */
export async function markNotificationReadAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  const filter = text(form, "filter") === "unread" ? "unread" : "all";
  const path = `/notifications${filter === "unread" ? "?filter=unread" : ""}`;
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "WORKSPACE_READ", { entitled: true });
    const notificationId = text(form, "notificationId");
    if (!notificationId) throw new ActionError("Choose a notification.");
    const result = await markNotificationRead(prisma, {
      businessId,
      notificationId,
      viewer: { userId: context.session.userId, role: context.role },
    });
    ok = result.marked ? "Marked as read." : "That was already read.";
    revalidatePath(`${base}/notifications`);
    revalidatePath(base);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, path.includes("?") ? path.split("?")[0] : path, { error, ...(filter === "unread" ? { filter } : {}) });
  back(base, "/notifications", { ok: ok ?? "Marked as read.", ...(filter === "unread" ? { filter } : {}) });
}

/** Mark everything this person can see as read. */
export async function markAllNotificationsReadAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  const filter = text(form, "filter") === "unread" ? "unread" : "all";
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "WORKSPACE_READ", { entitled: true });
    const result = await markAllNotificationsRead(prisma, {
      businessId,
      viewer: { userId: context.session.userId, role: context.role },
    });
    ok = result.marked === 0 ? "Everything was already read." : `${result.marked} notification${result.marked === 1 ? "" : "s"} marked as read.`;
    revalidatePath(`${base}/notifications`);
    revalidatePath(base);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/notifications", { error, ...(filter === "unread" ? { filter } : {}) });
  back(base, "/notifications", { ok: ok ?? "All caught up.", ...(filter === "unread" ? { filter } : {}) });
}

/**
 * Raise an approval request. Any member of the workspace may ask — that is the point of the object —
 * and the amount is parsed from KES into integer cents before it reaches the domain.
 */
export async function requestApprovalAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "WORKSPACE_READ", { entitled: true });
    const result = await createApprovalRequest(prisma, {
      businessId,
      kind: text(form, "kind", "SPEND"),
      title: text(form, "title"),
      detail: text(form, "detail") || null,
      amountCents: text(form, "amount") ? cents(form, "amount") : 0,
      approverRole: text(form, "approverRole", "OWNER"),
      requestedBy: context.session.userId,
      requestedName: context.session.name ?? context.session.email,
      requestedRole: context.role,
    });
    ok = result.created ? "Sent for approval." : "That request already existed.";
    revalidatePath(`${base}/approvals`);
    revalidatePath(base);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/approvals", { error });
  back(base, "/approvals", { ok: ok ?? "Sent for approval." });
}

/** Decide a request. Authority is re-derived on the server from the role, the amount and the limits. */
export async function decideApprovalAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "APPROVE_SPEND", { entitled: true });
    const requestId = text(form, "requestId");
    if (!requestId) throw new ActionError("Choose a request.");
    const decision = text(form, "decision").toUpperCase() === "REJECT" ? "REJECT" : "APPROVE";
    const result = await decideApprovalRequest(prisma, {
      businessId,
      requestId,
      decision,
      note: text(form, "note") || null,
      decider: { userId: context.session.userId, role: context.role, name: context.session.name ?? context.session.email },
    });
    ok = result.status === "APPROVED" ? "Approved and recorded." : "Rejected and recorded.";
    revalidatePath(`${base}/approvals`);
    revalidatePath(base);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/approvals", { error });
  back(base, "/approvals", { ok: ok ?? "Recorded." });
}

/** Take back a request that has not been decided. Only the person who asked may do this. */
export async function withdrawApprovalAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "WORKSPACE_READ", { entitled: true });
    const requestId = text(form, "requestId");
    if (!requestId) throw new ActionError("Choose a request.");
    await withdrawApprovalRequest(prisma, {
      businessId,
      requestId,
      requester: { userId: context.session.userId, name: context.session.name ?? context.session.email },
    });
    ok = "Request withdrawn.";
    revalidatePath(`${base}/approvals`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/approvals", { error });
  back(base, "/approvals", { ok: ok ?? "Request withdrawn." });
}

/* ── Procurement ────────────────────────────────────────────────────────────────────────────────
 * Requisition → order → goods received → supplier bill. The heavy lifting (authority, single-use
 * approvals, stock movements, the balanced bill journal) lives in lib/erp/procurement.ts; these
 * actions only parse the form, check the permission and report back in a sentence.
 */

function purchaseOrderLinesFrom(form: FormData) {
  const products = form.getAll("lineProduct").map(String);
  const descriptions = form.getAll("lineDescription").map(String);
  const quantities = form.getAll("lineQuantity").map(String);
  const costs = form.getAll("lineUnitCost").map(String);
  const rates = form.getAll("lineTaxRate").map(String);
  const lines = descriptions.map((description, index) => ({
    productId: products[index] || null,
    description,
    quantity: Number(quantities[index] ?? 0),
    unitCostCents: parseKesToCents(costs[index] ?? ""),
    taxRateBps: Number(rates[index] ?? 0) || 0,
  }));
  // Blank template rows are normal in a form; they are not an error.
  return lines.filter((line) => line.description.trim() || line.productId);
}

export async function createPurchaseOrderAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    const supplierId = text(form, "supplierId");
    if (!supplierId) throw new ActionError("Choose the supplier you are buying from.");
    const expectedRaw = text(form, "expectedAt");
    const result = await createPurchaseOrder(prisma, {
      businessId,
      supplierId,
      expectedAt: expectedRaw || null,
      notes: text(form, "notes") || null,
      lines: purchaseOrderLinesFrom(form),
      requestedBy: context.session.userId,
      requestedName: context.session.name ?? context.session.email,
      idempotencyKey: text(form, "requestKey") || randomUUID(),
    });
    ok = `${result.order.orderNumber} saved as a draft. Submit it when you are ready to buy.`;
    revalidatePath(`${base}/procurement`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/procurement", { error });
  back(base, "/procurement", { ok: ok ?? "Purchase order saved." });
}

export async function submitPurchaseOrderAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    const orderId = text(form, "orderId");
    if (!orderId) throw new ActionError("Choose a purchase order.");
    const result = await submitPurchaseOrder(prisma, {
      businessId,
      orderId,
      requester: { userId: context.session.userId, name: context.session.name ?? null, role: context.role },
    });
    ok = result.approved
      ? "Approved. Mark it ordered once you have actually sent it to the supplier."
      : `${result.reason} It is waiting for a decision — nothing has been bought yet.`;
    revalidatePath(`${base}/procurement`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/procurement", { error });
  back(base, "/procurement", { ok: ok ?? "Submitted." });
}

export async function orderPurchaseOrderAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    await markPurchaseOrderOrdered(prisma, {
      businessId,
      orderId: text(form, "orderId"),
      actorId: context.session.userId,
      actorName: context.session.name ?? context.session.email,
    });
    ok = "Marked as ordered. Record what arrives so stock stays true.";
    revalidatePath(`${base}/procurement`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/procurement", { error });
  back(base, "/procurement", { ok: ok ?? "Marked as ordered." });
}

export async function receivePurchaseOrderAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    const orderId = text(form, "orderId");
    if (!orderId) throw new ActionError("Choose a purchase order.");
    const lines: Array<{ lineId: string; quantity: number }> = [];
    for (const [key, value] of form.entries()) {
      if (!key.startsWith("qty:") || typeof value !== "string") continue;
      const quantity = Number(value);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      lines.push({ lineId: key.slice(4), quantity: Math.round(quantity * 1000) / 1000 });
    }
    if (lines.length === 0) throw new ActionError("Enter how much arrived on at least one line.");
    const result = await receivePurchaseOrder(prisma, {
      businessId,
      orderId,
      lines,
      actorId: context.session.userId,
      actorName: context.session.name ?? context.session.email,
      note: text(form, "note") || null,
      idempotencyKey: text(form, "requestKey") || randomUUID(),
    });
    ok = result.order.status === "RECEIVED"
      ? "Whole order received. Stock has been updated."
      : "Part of the order received. Stock has been updated; the rest is still outstanding.";
    revalidatePath(`${base}/procurement`);
    revalidatePath(`${base}/dashboard/pos/${businessId}/inventory`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/procurement", { error });
  back(base, "/procurement", { ok: ok ?? "Goods received." });
}

export async function cancelPurchaseOrderAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    await cancelPurchaseOrder(prisma, {
      businessId,
      orderId: text(form, "orderId"),
      reason: text(form, "reason"),
      actorId: context.session.userId,
      actorName: context.session.name ?? context.session.email,
    });
    ok = "Purchase order cancelled. Nothing was bought.";
    revalidatePath(`${base}/procurement`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/procurement", { error });
  back(base, "/procurement", { ok: ok ?? "Purchase order cancelled." });
}

export async function recordPurchaseBillAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "POST_JOURNAL", { entitled: true });
    const result = await recordPurchaseBill(prisma, {
      businessId,
      orderId: text(form, "orderId"),
      billNumber: text(form, "billNumber"),
      netCents: parseKesToCents(text(form, "net")),
      taxCents: parseKesToCents(text(form, "tax")),
      dueAt: text(form, "dueAt") || null,
      actorId: context.session.userId,
      actorName: context.session.name ?? context.session.email,
    });
    const variance = result.varianceCents;
    ok = `Bill posted as ${result.journal.journalNumber}.${variance === 0 ? " It matches the order exactly." : ` It is ${formatCentsShort(Math.abs(variance))} ${variance > 0 ? "more" : "less"} than the order — that difference is recorded.`}`;
    revalidatePath(`${base}/procurement`);
    revalidatePath(`${base}/accounting`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/procurement", { error });
  back(base, "/procurement", { ok: ok ?? "Bill posted." });
}

// ── Requisitions ───────────────────────────────────────────────────────────────────────────
function requisitionLinesFrom(form: FormData) {
  const products = form.getAll("lineProduct").map(String);
  const descriptions = form.getAll("lineDescription").map(String);
  const quantities = form.getAll("lineQuantity").map(String);
  const costs = form.getAll("lineUnitCost").map(String);
  const rates = form.getAll("lineTaxRate").map(String);
  const lines = descriptions.map((description, index) => ({
    productId: products[index] || null,
    description,
    quantity: Number(quantities[index] ?? 0),
    estimatedUnitCostCents: parseKesToCents(costs[index] ?? ""),
    taxRateBps: Number(rates[index] ?? 0) || 0,
  }));
  return lines.filter((line) => line.description.trim() || line.productId);
}

export async function createRequisitionAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    const result = await createRequisition(prisma, {
      businessId,
      title: text(form, "title"),
      justification: text(form, "justification") || null,
      department: text(form, "department") || null,
      priority: text(form, "priority") || "NORMAL",
      neededBy: text(form, "neededBy") || null,
      supplierId: text(form, "supplierId") || null,
      supplierName: text(form, "supplierName") || null,
      lines: requisitionLinesFrom(form),
      requestedBy: context.session.userId,
      requestedName: context.session.name ?? context.session.email,
      idempotencyKey: text(form, "requestKey") || randomUUID(),
    });
    ok = `${result.request.requisitionNumber} saved. Submit it when it is ready to be decided.`;
    revalidatePath(`${base}/requisitions`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/requisitions", { error });
  back(base, "/requisitions", { ok: ok ?? "Request saved." });
}

export async function submitRequisitionAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    const requisitionId = text(form, "requisitionId");
    if (!requisitionId) throw new ActionError("Choose a request.");
    const request = await submitRequisition(prisma, {
      businessId,
      requisitionId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
    });
    ok = `${request.requisitionNumber} is waiting for a decision. Nothing has been ordered.`;
    revalidatePath(`${base}/requisitions`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/requisitions", { error });
  back(base, "/requisitions", { ok: ok ?? "Submitted." });
}

export async function decideRequisitionAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    // The permission is checked here as well as in the domain module: a hidden button is not a
    // control, and an action invoked directly must still be refused.
    const context = await access(businessId, "APPROVE_SPEND", { entitled: true });
    const requisitionId = text(form, "requisitionId");
    if (!requisitionId) throw new ActionError("Choose a request.");
    const decision = text(form, "decision") === "REJECT" ? "REJECT" : "APPROVE";
    const request = await decideRequisition(prisma, {
      businessId,
      requisitionId,
      decision,
      approverRole: context.role,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
      note: text(form, "note") || null,
    });
    ok = decision === "APPROVE"
      ? `${request.requisitionNumber} approved. Turn it into a purchase order when you are ready.`
      : `${request.requisitionNumber} rejected. The requester has been told.`;
    revalidatePath(`${base}/requisitions`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/requisitions", { error });
  back(base, "/requisitions", { ok: ok ?? "Decision recorded." });
}

export async function convertRequisitionAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    const requisitionId = text(form, "requisitionId");
    if (!requisitionId) throw new ActionError("Choose a request.");
    const result = await convertRequisition(prisma, {
      businessId,
      requisitionId,
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
    });
    if (!result.order) throw new ActionError("That request was already converted but its order could not be read.");
    ok = result.alreadyConverted
      ? `Already converted to ${result.order.orderNumber}.`
      : `${result.order.orderNumber} raised from the request. Submit the order to buy.`;
    revalidatePath(`${base}/requisitions`);
    revalidatePath(`${base}/procurement`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/requisitions", { error });
  back(base, "/requisitions", { ok: ok ?? "Converted." });
}

export async function cancelRequisitionAction(form: FormData) {
  const businessId = businessIdFrom(form);
  const base = erpBasePath(businessId);
  let error: string | null = null;
  let ok: string | null = null;
  try {
    const context = await access(businessId, "MANAGE_INVENTORY", { entitled: true });
    const requisitionId = text(form, "requisitionId");
    if (!requisitionId) throw new ActionError("Choose a request.");
    const request = await cancelRequisition(prisma, {
      businessId,
      requisitionId,
      reason: text(form, "reason"),
      actorId: context.session.userId,
      actorName: context.session.name ?? null,
    });
    ok = `${request.requisitionNumber} cancelled.`;
    revalidatePath(`${base}/requisitions`);
  } catch (err) {
    error = actionErrorMessage(err);
  }
  if (error) back(base, "/requisitions", { error });
  back(base, "/requisitions", { ok: ok ?? "Cancelled." });
}
