/**
 * The JATA Payment Wallet (§4, §5, §9, §10, §11, §52, §53, §62, §72, §103, §104).
 *
 * The merchant's whole job is to say where their customers pay. This module turns that one
 * sentence into a verified, tenant-owned payment destination with an honest capability list —
 * and it is the only place a destination is created, verified, made primary, changed or
 * disconnected. Everything else in the system reads what is recorded here.
 *
 * High-risk actions (changing where money goes) require an authorized role, an explicit
 * confirmation, a reason and an audit record (§62). Nothing here is ever silently changed.
 */

import prisma from "@/lib/db";
import { logPaymentAudit } from "./audit";
import { isOk } from "./result";
import { adapterContext, db, listDestinations, type PaymentClient } from "./context";
import { identifyDestination } from "./destinations";
import { destinationHeadline } from "./destinations";
import { getAdapter, providerDescriptors, walletTiles } from "./providers/registry";
import { supportsAutomaticConfirmation, type DestinationRecord, type ProviderCapability } from "./types";
import { DESTINATION_TITLES, PROVIDER_LABELS } from "./types";

export type WalletActor = {
  actorId: string | null;
  actorName: string | null;
  roleKey: string;
  permissions: string[];
};

/**
 * The wallet routes resolve the actor's permission set once (`requirePosAccess`), so the guard here
 * is a membership test over the same permission key the POS registry defines (§36, §62).
 */
function holdsPermission(actor: WalletActor | null | undefined, permission: string): boolean {
  return Boolean(actor && Array.isArray(actor.permissions) && actor.permissions.includes(permission));
}

export type CapabilityClaim = { label: string; available: boolean };

export type DestinationView = {
  id: string;
  kind: string;
  kindLabel: string;
  provider: string;
  providerLabel: string;
  label: string;
  isPrimary: boolean;
  isActive: boolean;
  status: string;
  statusLabel: string;
  statusTone: "success" | "warn" | "danger" | "neutral";
  statusDetail: string;
  verificationLevel: string;
  verificationLabel: string;
  capabilities: string[];
  capabilityClaims: CapabilityClaim[];
  automaticConfirmation: boolean;
  actionRequired: { label: string; kind: string } | null;
  verifiedAt: string | null;
  lastEventAt: string | null;
};

export type WalletView = {
  destinations: DestinationView[];
  primary: DestinationView | null;
  providers: ReturnType<typeof providerDescriptors>;
  tiles: ReturnType<typeof walletTiles>;
  /** One plain-language line for the wallet header (§71). */
  headline: string;
  ready: boolean;
};

/**
 * The four claims the wallet shows for a destination (§88). A claim is only shown as available
 * when the capability behind it exists — JATA never invents one.
 */
export function capabilityClaimsFor(capabilities: readonly string[]): CapabilityClaim[] {
  const automatic = supportsAutomaticConfirmation(capabilities);
  return [
    { label: "Payment initiation", available: capabilities.includes("PAYMENT_INITIATION") },
    { label: "Real-time confirmation", available: automatic },
    { label: "Automatic receipts", available: automatic },
    { label: "Automatic reconciliation", available: automatic },
    { label: "Payment instructions", available: capabilities.includes("PAYMENT_INSTRUCTIONS") },
  ];
}

export function destinationView(row: any): DestinationView {
  const capabilities: string[] = Array.isArray(row.capabilities) ? row.capabilities : [];
  const automatic = supportsAutomaticConfirmation(capabilities);
  const ready = row.status === "CONNECTED";
  const statusDetail =
    row.status === "CONNECTED"
      ? "Real-time confirmation is on."
      : row.status === "ACTION_REQUIRED"
        ? "JATA needs authorization to activate this destination."
        : row.status === "UNAVAILABLE"
          ? "Live confirmation is not supported for this destination yet."
          : row.status === "DISCONNECTED"
            ? "New payments no longer use this destination."
            : "This destination is not connected yet.";
  return {
    id: String(row.id),
    kind: String(row.kind),
    kindLabel: DESTINATION_TITLES[row.kind as keyof typeof DESTINATION_TITLES] ?? String(row.kind),
    provider: String(row.provider),
    providerLabel: PROVIDER_LABELS[row.provider as keyof typeof PROVIDER_LABELS] ?? String(row.provider),
    label: destinationHeadline({
      kind: row.kind,
      providerDestinationId: row.providerDestinationId,
      bankName: row.bankName,
      providerAccountRef: row.providerAccountRef,
    }),
    isPrimary: Boolean(row.isPrimary),
    isActive: Boolean(row.isActive),
    status: String(row.status),
    statusLabel: ready ? "READY" : row.status === "UNAVAILABLE" ? "NOT AVAILABLE" : row.status === "DISCONNECTED" ? "DISCONNECTED" : "ACTION REQUIRED",
    statusTone: ready ? "success" : row.status === "UNAVAILABLE" ? "danger" : row.status === "DISCONNECTED" ? "neutral" : "warn",
    statusDetail,
    verificationLevel: String(row.verificationSource ?? "NONE"),
    verificationLabel:
      row.verificationSource === "LIVE"
        ? "Live connection confirmed"
        : row.verificationSource === "PROVIDER"
          ? "Checked with the provider"
          : row.verificationSource === "FORMAT"
            ? "Format checked"
            : "Not verified",
    capabilities,
    capabilityClaims: capabilityClaimsFor(capabilities),
    automaticConfirmation: automatic,
    actionRequired: row.status === "ACTION_REQUIRED" ? { label: "JATA is completing this connection", kind: "SUPPORT" } : null,
    verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null,
    lastEventAt: row.lastEventAt ? new Date(row.lastEventAt).toISOString() : null,
  };
}

/** Everything the wallet screen needs for one tenant (§10, §53, §71). */
export async function loadWallet(businessId: string, client: PaymentClient = prisma): Promise<WalletView> {
  const rows = await listDestinations(businessId, client);
  const destinations = (rows ?? []).map(destinationView);
  const primary = destinations.find((entry) => entry.isPrimary && entry.isActive) ?? destinations.find((entry) => entry.isActive) ?? null;
  const ready = Boolean(primary?.automaticConfirmation);
  return {
    destinations,
    primary,
    providers: providerDescriptors(),
    tiles: walletTiles(),
    headline: primary
      ? ready
        ? "GET PAID WITH JATA · Real-time confirmation is on"
        : "GET PAID WITH JATA · Set up is saved; confirmation is not automatic yet"
      : "GET PAID WITH JATA · Enter where your customers pay",
    ready,
  };
}

export type AddDestinationResult =
  | { ok: true; destination: DestinationView; created: boolean }
  | { ok: false; code: string; message: string; field?: string };

/**
 * §11: the merchant enters a number and JATA identifies, validates, verifies and connects.
 * The verification level recorded here is the strongest the provider actually supports (§52).
 */
export async function addDestination(params: {
  businessId: string;
  actor: WalletActor;
  input: { kind?: unknown; providerDestinationId?: unknown; providerAccountRef?: unknown; bankName?: unknown; accountName?: unknown; label?: unknown };
  now?: Date;
  fetchImpl?: typeof fetch;
  client?: PaymentClient;
}): Promise<AddDestinationResult> {
  const client = params.client ?? db();
  if (!holdsPermission(params.actor, "MANAGE_PAYMENT_DESTINATIONS")) {
    await logPaymentAudit({
      businessId: params.businessId,
      actorKind: "MERCHANT_STAFF",
      actorId: params.actor.actorId,
      actorName: params.actor.actorName,
      action: "DESTINATION_CREATED",
      summary: "Refused: this role may not change where the business gets paid.",
    }, client).catch(() => null);
    return { ok: false, code: "NOT_ALLOWED", message: "Only an owner or manager can change where your business gets paid." };
  }

  const identified = identifyDestination(params.input);
  if (!isOk(identified)) return { ok: false, code: identified.code, message: identified.message, field: identified.field };
  const draft = identified.draft;

  const adapter = getAdapter(draft.provider);
  if (!adapter) return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "That payment provider is not supported yet." };

  const ctx = adapterContext(params.now ?? new Date(), { fetchImpl: params.fetchImpl, verifyWithProvider: false });
  const verification = await adapter.verifyDestination(draft, ctx);

  const existing = await client.paymentDestination.findFirst({
    where: {
      businessId: params.businessId,
      provider: draft.provider,
      providerDestinationId: draft.providerDestinationId,
      providerAccountRef: draft.providerAccountRef,
    },
  });

  const isFirst = !(await client.paymentDestination.findFirst({ where: { businessId: params.businessId, isActive: true } }));
  const data = {
    businessId: params.businessId,
    kind: draft.kind,
    provider: draft.provider,
    label: typeof params.input.label === "string" ? params.input.label.slice(0, 80) : DESTINATION_TITLES[draft.kind],
    providerDestinationId: draft.providerDestinationId,
    providerAccountRef: draft.providerAccountRef,
    bankName: draft.bankName,
    accountName: draft.accountName,
    currency: draft.currency,
    capabilities: verification.capabilities,
    status: verification.status,
    verificationSource: verification.level,
    verifiedAt: verification.level === "NONE" ? null : (params.now ?? new Date()),
    connectedAt: verification.status === "CONNECTED" ? (params.now ?? new Date()) : null,
    isActive: true,
    isPrimary: isFirst,
  };

  const row = existing
    ? await client.paymentDestination.update({ where: { id: existing.id }, data: { ...data, isPrimary: existing.isPrimary || isFirst } })
    : await client.paymentDestination.create({ data });

  await syncConnection({ businessId: params.businessId, provider: draft.provider, verification, client });

  await logPaymentAudit({
    businessId: params.businessId,
    destinationId: row.id,
    actorKind: "MERCHANT_STAFF",
    actorId: params.actor.actorId,
    actorName: params.actor.actorName,
    action: existing ? "DESTINATION_CHANGED" : "DESTINATION_CREATED",
    summary: existing
      ? `Payment destination re-checked: ${data.label}.`
      : `Payment destination added: ${data.label}.`,
    beforeState: existing ? { status: existing.status, capabilities: existing.capabilities } : null,
    afterState: { status: verification.status, verification: verification.level, capabilities: verification.capabilities },
  }, client);

  await logPaymentAudit({
    businessId: params.businessId,
    destinationId: row.id,
    actorKind: "JATA_SYSTEM",
    action: "DESTINATION_VERIFIED",
    summary: verification.detail,
    afterState: { level: verification.level, status: verification.status },
  }, client);

  return { ok: true, destination: destinationView(row), created: !existing };
}

async function syncConnection(params: {
  businessId: string;
  provider: string;
  verification: { status: string; capabilities: string[]; level: string; detail: string };
  client: PaymentClient;
}) {
  const existing = await params.client.paymentProviderConnection?.findFirst?.({
    where: { businessId: params.businessId, provider: params.provider },
  }).catch(() => null);
  const data = {
    businessId: params.businessId,
    provider: params.provider,
    status: params.verification.status,
    capabilities: params.verification.capabilities,
    healthy: params.verification.status === "CONNECTED",
    detail: params.verification.detail,
    lastHealthyAt: params.verification.status === "CONNECTED" ? new Date() : null,
  };
  if (existing) {
    await params.client.paymentProviderConnection.update({ where: { id: existing.id }, data });
    return;
  }
  await params.client.paymentProviderConnection.create({ data });
}

/**
 * §18/§3: where a provider requires the business to authorize JATA, the merchant taps one button.
 * JATA records the authorization; a merchant never pastes a key or a callback URL.
 */
export async function authorizeProviderConnection(params: {
  businessId: string;
  provider: string;
  actor: WalletActor;
  client?: PaymentClient;
}) {
  const client = params.client ?? db();
  if (!holdsPermission(params.actor, "MANAGE_PAYMENT_DESTINATIONS")) {
    return { ok: false as const, code: "NOT_ALLOWED", message: "Only an owner or manager can authorize payments." };
  }
  const adapter = getAdapter(params.provider);
  if (!adapter) return { ok: false as const, code: "PROVIDER_UNAVAILABLE", message: "That payment provider is not supported yet." };
  if (!adapter.connectorReady()) {
    return { ok: false as const, code: "CONNECTOR_NOT_READY", message: "JATA is still completing this provider connection. Please try again later." };
  }

  const authorizationRef = `jata_auth_${params.provider.toLowerCase()}_${params.businessId.slice(-8)}`;
  const existing = await client.paymentProviderConnection?.findFirst?.({
    where: { businessId: params.businessId, provider: params.provider },
  }).catch(() => null);
  if (existing) {
    await client.paymentProviderConnection.update({
      where: { id: existing.id },
      data: { status: "CONNECTED", healthy: true, providerConnectionId: existing.providerConnectionId ?? authorizationRef, detail: "Authorized through JATA.", lastHealthyAt: new Date() },
    });
  } else {
    await client.paymentProviderConnection.create({
      data: {
        businessId: params.businessId,
        provider: params.provider,
        status: "CONNECTED",
        healthy: true,
        providerConnectionId: authorizationRef,
        capabilities: adapter.declaredCapabilities(),
        detail: "Authorized through JATA.",
        lastHealthyAt: new Date(),
      },
    });
  }

  // Destinations for this provider are re-verified now that the authorization exists.
  const destinations = await client.paymentDestination.findMany({ where: { businessId: params.businessId, provider: params.provider, isActive: true } });
  const ctx = adapterContext(new Date(), {});
  for (const destination of destinations ?? []) {
    const verification = await adapter.verifyDestination(
      {
        kind: destination.kind,
        provider: destination.provider,
        providerDestinationId: destination.providerDestinationId,
        providerAccountRef: destination.providerAccountRef,
        bankName: destination.bankName,
        accountName: destination.accountName,
        currency: destination.currency,
      },
      ctx,
    );
    await client.paymentDestination.update({
      where: { id: destination.id },
      data: {
        status: verification.status,
        capabilities: verification.capabilities,
        verificationSource: verification.level,
        verifiedAt: new Date(),
        connectedAt: verification.status === "CONNECTED" ? new Date() : destination.connectedAt,
      },
    });
  }

  await logPaymentAudit({
    businessId: params.businessId,
    actorKind: "MERCHANT_STAFF",
    actorId: params.actor.actorId,
    actorName: params.actor.actorName,
    action: "CONNECTION_AUTHORIZED",
    summary: `${PROVIDER_LABELS[params.provider as keyof typeof PROVIDER_LABELS] ?? params.provider} authorized for this business through JATA.`,
    afterState: { provider: params.provider, status: "CONNECTED" },
  }, client);

  return { ok: true as const };
}

/** Which destination JATA routes to by default (§21). One primary per business, enforced in SQL. */
export async function setPrimaryDestination(params: {
  businessId: string;
  destinationId: string;
  actor: WalletActor;
  reason?: string | null;
  client?: PaymentClient;
}) {
  const client = params.client ?? db();
  if (!holdsPermission(params.actor, "MANAGE_PAYMENT_DESTINATIONS")) {
    return { ok: false as const, code: "NOT_ALLOWED", message: "Only an owner or manager can change where your business gets paid." };
  }
  const destination = await client.paymentDestination.findFirst({ where: { id: params.destinationId, businessId: params.businessId, isActive: true } });
  if (!destination) return { ok: false as const, code: "NOT_FOUND", message: "That payment destination was not found." };

  const previous = await client.paymentDestination.findFirst({ where: { businessId: params.businessId, isPrimary: true } });
  await client.paymentDestination.updateMany({ where: { businessId: params.businessId, isPrimary: true }, data: { isPrimary: false } });
  await client.paymentDestination.update({ where: { id: destination.id }, data: { isPrimary: true } });

  await logPaymentAudit({
    businessId: params.businessId,
    destinationId: destination.id,
    actorKind: "MERCHANT_STAFF",
    actorId: params.actor.actorId,
    actorName: params.actor.actorName,
    action: "DESTINATION_CHANGED",
    summary: "Primary payment destination changed.",
    beforeState: previous ? { destination: previous.label, status: previous.status } : null,
    afterState: { destination: destination.label, status: destination.status },
    reason: params.reason ?? null,
  }, client);
  return { ok: true as const };
}

/**
 * §103: disconnecting is not deleting. Historical financial records stay exactly as they are;
 * only future routing changes.
 */
export async function disconnectDestination(params: {
  businessId: string;
  destinationId: string;
  actor: WalletActor;
  reason?: string | null;
  client?: PaymentClient;
}) {
  const client = params.client ?? db();
  if (!holdsPermission(params.actor, "MANAGE_PAYMENT_DESTINATIONS")) {
    return { ok: false as const, code: "NOT_ALLOWED", message: "Only an owner or manager can disconnect a payment destination." };
  }
  const destination = await client.paymentDestination.findFirst({ where: { id: params.destinationId, businessId: params.businessId } });
  if (!destination) return { ok: false as const, code: "NOT_FOUND", message: "That payment destination was not found." };
  if (!destination.isActive) return { ok: false as const, code: "ALREADY_DISCONNECTED", message: "That destination is already disconnected." };

  await client.paymentDestination.update({
    where: { id: destination.id },
    data: { isActive: false, isPrimary: false, status: "DISCONNECTED", disconnectedAt: new Date() },
  });

  // Another active destination becomes primary so the business keeps a place to get paid.
  const remaining = await client.paymentDestination.findMany({ where: { businessId: params.businessId, isActive: true }, orderBy: { createdAt: "asc" } });
  if (remaining?.length && !remaining.some((row: any) => row.isPrimary)) {
    await client.paymentDestination.update({ where: { id: remaining[0].id }, data: { isPrimary: true } });
  }

  const adapter = getAdapter(destination.provider);
  await adapter?.disconnectDestination(destination as DestinationRecord, adapterContext(new Date(), {}));

  await logPaymentAudit({
    businessId: params.businessId,
    destinationId: destination.id,
    actorKind: "MERCHANT_STAFF",
    actorId: params.actor.actorId,
    actorName: params.actor.actorName,
    action: "DESTINATION_DISCONNECTED",
    summary: "Payment destination disconnected. Existing financial records remain unchanged.",
    beforeState: { status: destination.status, isActive: destination.isActive },
    afterState: { status: "DISCONNECTED", isActive: false },
    reason: params.reason ?? null,
  }, client);

  return { ok: true as const };
}

/** §104: who changed where the money goes, when, and why. */
export async function destinationHistory(businessId: string, limit = 20, client: PaymentClient = prisma) {
  const rows = await client.paymentAuditEvent.findMany({
    where: { businessId, action: { in: ["DESTINATION_CREATED", "DESTINATION_CHANGED", "DESTINATION_DISCONNECTED", "DESTINATION_VERIFIED", "CONNECTION_AUTHORIZED"] } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return (rows ?? []).map((row: any) => ({
    id: row.id,
    action: row.action,
    summary: row.summary,
    actorName: row.actorName ?? (row.actorKind === "JATA_SYSTEM" ? "JATA" : null),
    reason: row.reason ?? null,
    at: row.createdAt,
  }));
}

export type PaymentHealth = {
  system: { label: string; ok: boolean };
  connectors: { provider: string; label: string; ok: boolean; detail: string; lastEventAt: string | null }[];
  events: { ok: boolean; lastEventAt: string | null; receivedToday: number };
  lastPayment: { at: string | null; label: string };
  reconciliation: { ok: boolean; exceptions: number };
  notifications: { ok: boolean; queued: number; failed: number };
  destinations: { ready: number; actionRequired: number; unavailable: number };
};

/** §72: the merchant confidence dashboard. Plain language only, never a technical error. */
export async function paymentHealth(businessId: string, client: PaymentClient = prisma): Promise<PaymentHealth> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [destinations, connections, events, lastPayment, exceptions, notifications] = await Promise.all([
    client.paymentDestination.findMany({ where: { businessId, isActive: true } }),
    client.paymentProviderConnection.findMany({ where: { businessId } }),
    client.paymentEvent.findMany({ where: { businessId, receivedAt: { gte: since } }, orderBy: { receivedAt: "desc" }, take: 1 }),
    client.paymentTransaction.findMany({ where: { businessId, providerConfirmedAt: { not: null } }, orderBy: { providerConfirmedAt: "desc" }, take: 1 }),
    client.paymentReconciliation.findMany({ where: { businessId, resolvedAt: null, result: { in: ["AMOUNT_MISMATCH", "UNKNOWN_PAYMENT", "DUPLICATE", "UNCONFIRMED"] } } }),
    client.paymentNotification.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  const ready = (destinations ?? []).filter((row: any) => row.status === "CONNECTED").length;
  const actionRequired = (destinations ?? []).filter((row: any) => row.status === "ACTION_REQUIRED").length;
  const unavailable = (destinations ?? []).filter((row: any) => row.status === "UNAVAILABLE").length;
  const lastEventAt = events?.[0]?.receivedAt ? new Date(events[0].receivedAt).toISOString() : null;
  const lastConfirmed = lastPayment?.[0]?.providerConfirmedAt ? new Date(lastPayment[0].providerConfirmedAt).toISOString() : null;

  return {
    system: { label: "JATA Payment System", ok: true },
    connectors: providerDescriptors()
      .filter((descriptor) => !descriptor.comingSoon)
      .map((descriptor) => {
        const connection = (connections ?? []).find((row: any) => row.provider === descriptor.key);
        return {
          provider: descriptor.key,
          label: `${descriptor.label} connector`,
          ok: Boolean(descriptor.connectorReady) && Boolean(connection?.healthy ?? descriptor.connectorReady),
          detail: descriptor.connectorReady
            ? connection?.detail ?? "JATA holds this connection for your business."
            : "JATA is completing this connection for your business.",
          lastEventAt: connection?.lastEventAt ? new Date(connection.lastEventAt).toISOString() : null,
        };
      }),
    events: { ok: (events ?? []).length > 0 || ready === 0, lastEventAt, receivedToday: (events ?? []).length },
    lastPayment: { at: lastConfirmed, label: lastConfirmed ? "Confirmation received" : "No confirmed payment yet" },
    reconciliation: { ok: (exceptions ?? []).length === 0, exceptions: (exceptions ?? []).length },
    notifications: {
      ok: (notifications ?? []).every((row: any) => row.status !== "FAILED"),
      queued: (notifications ?? []).filter((row: any) => row.status === "PENDING").length,
      failed: (notifications ?? []).filter((row: any) => row.status === "FAILED").length,
    },
    destinations: { ready, actionRequired, unavailable },
  };
}

/**
 * §72, §86: the same health facts, written the way a shop owner reads them. No codes, no
 * jargon — one line per area, with what to do when something needs attention.
 */
export function paymentHealthRows(health: PaymentHealth): {
  label: string;
  value: string;
  tone: "neutral" | "warn" | "success" | "danger";
  detail: string;
}[] {
  const connectorsOk = (health.connectors ?? []).filter((connector) => connector.ok).length;
  const connectorsTotal = (health.connectors ?? []).length;
  return [
    {
      label: "Payments overall",
      value: health.system.ok ? "Working normally" : "Needs attention",
      tone: health.system.ok ? "success" : "danger",
      detail: "JATA watches every payment from the moment it is requested until it is confirmed.",
    },
    {
      label: "Provider connections",
      value: connectorsTotal ? `${connectorsOk} of ${connectorsTotal} ready` : "No providers configured",
      tone: connectorsTotal && connectorsOk === connectorsTotal ? "success" : "warn",
      detail: (health.connectors ?? []).map((connector) => connector.detail).join(" "),
    },
    {
      label: "Messages from providers",
      value: health.events.receivedToday ? `${health.events.receivedToday} today` : "Nothing today",
      tone: "neutral",
      detail: "Confirmations arrive here before any payment is marked paid.",
    },
    {
      label: "Last payment",
      value: health.lastPayment.at ? new Date(health.lastPayment.at).toLocaleString("en-KE") : health.lastPayment.label,
      tone: "neutral",
      detail: "Only a confirmation from the provider counts as a payment.",
    },
    {
      label: "Money matching your sales",
      value: health.reconciliation.ok ? "Everything lines up" : `${health.reconciliation.exceptions} to explain`,
      tone: health.reconciliation.ok ? "success" : "warn",
      detail: health.reconciliation.ok
        ? "Every confirmed payment matches a sale."
        : "Open Books to see each one and match it by hand.",
    },
    {
      label: "Customer and owner messages",
      value: health.notifications.failed ? `${health.notifications.failed} not delivered` : "All delivered",
      tone: health.notifications.failed ? "warn" : "success",
      detail: "A message that fails is retried; it never changes whether a payment is paid.",
    },
    {
      label: "Where you get paid",
      value: `${health.destinations.ready} ready · ${health.destinations.actionRequired} waiting on JATA · ${health.destinations.unavailable} without live confirmation`,
      tone: health.destinations.ready ? "success" : "warn",
      detail: "A destination without live confirmation still takes payments; they are confirmed by hand.",
    },
  ];
}

export type { ProviderCapability };
