/**
 * POS / ERP - PRO access boundary (§3.1, §7)
 *
 * One server-side gate for every ERP page and API. The tenant comes from the authenticated
 * session — never a request body, header or client flag — and the permission check happens here,
 * before any tenant-owned row is read or written. Hiding a button in the UI is not authorisation.
 */

import prisma from "../db";
import type { SessionPayload } from "../auth";
import { assertBusinessOwnership, getBusinessRoleForUser, TenantError } from "../tenant";
import { SAFE_ERRORS } from "../safeError";
import { erpFeatureEnabled, syncErpEntitlement, type ErpEntitlementState } from "./entitlement";
import { logErpAudit } from "./audit";

export class ErpAccessError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 403, code = "FORBIDDEN") {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ErpAccessError";
  }
}

export const ERP_ROLES = ["OWNER", "ADMIN", "MANAGER", "FINANCE", "STAFF", "VIEWER"] as const;
export type ErpRole = (typeof ERP_ROLES)[number];

export const ERP_PERMISSIONS = [
  { key: "WORKSPACE_READ", label: "Use the workspace", risk: "low" },
  { key: "VIEW_FINANCE", label: "See financial reports", risk: "high" },
  { key: "POST_JOURNAL", label: "Post journals", risk: "high" },
  { key: "CLOSE_PERIOD", label: "Close an accounting period", risk: "high" },
  { key: "VIEW_INVOICES", label: "See invoices", risk: "low" },
  { key: "MANAGE_INVOICES", label: "Create invoices and record payments", risk: "medium" },
  { key: "VIEW_CUSTOMERS", label: "See customers", risk: "low" },
  { key: "MANAGE_CUSTOMERS", label: "Add and edit customers", risk: "medium" },
  { key: "VIEW_INVENTORY", label: "See products and stock", risk: "low" },
  { key: "MANAGE_INVENTORY", label: "Manage products and stock", risk: "medium" },
  { key: "VIEW_MESSAGING", label: "See campaigns, contacts and results", risk: "medium" },
  { key: "MANAGE_MESSAGING", label: "Create campaigns and manage contacts", risk: "high" },
  { key: "APPROVE_CAMPAIGNS", label: "Approve and send campaigns", risk: "high" },
  { key: "MANAGE_SENDER_ID", label: "Apply for a Sender ID", risk: "high" },
  { key: "VIEW_KYC", label: "See KYC documents", risk: "high" },
  { key: "VIEW_AUTOMATION", label: "See automation rules", risk: "medium" },
  { key: "MANAGE_AUTOMATION", label: "Create and run automation rules", risk: "high" },
  { key: "VIEW_COMPLIANCE", label: "See tax and compliance settings", risk: "medium" },
  { key: "MANAGE_COMPLIANCE", label: "Change tax and compliance settings", risk: "high" },
  { key: "VIEW_STORE", label: "See the online store", risk: "low" },
  { key: "MANAGE_STORE", label: "Manage the online store", risk: "medium" },
  { key: "VIEW_BILLING", label: "See plan, usage and billing", risk: "medium" },
  { key: "MANAGE_BILLING", label: "Change plan and payment settings", risk: "high" },
  { key: "MANAGE_TASKS", label: "Create and assign work", risk: "medium" },
  { key: "VIEW_AUDIT", label: "Read the audit trail", risk: "high" },
  { key: "EXPORT_DATA", label: "Export business data", risk: "high" },
  { key: "MANAGE_USERS", label: "Manage users and roles", risk: "high" },
  { key: "MANAGE_SETTINGS", label: "Change workspace settings", risk: "high" },
] as const;

export type ErpPermission = (typeof ERP_PERMISSIONS)[number]["key"];

const READ_ONLY: ErpPermission[] = [
  "WORKSPACE_READ",
  "VIEW_INVOICES",
  "VIEW_CUSTOMERS",
  "VIEW_INVENTORY",
  "VIEW_MESSAGING",
  "VIEW_AUTOMATION",
  "VIEW_COMPLIANCE",
  "VIEW_STORE",
  "VIEW_BILLING",
];

const ROLE_MATRIX: Record<ErpRole, ErpPermission[] | "all"> = {
  OWNER: "all",
  ADMIN: "all",
  MANAGER: [
    ...READ_ONLY,
    "VIEW_FINANCE",
    "POST_JOURNAL",
    "MANAGE_INVOICES",
    "MANAGE_CUSTOMERS",
    "MANAGE_INVENTORY",
    "MANAGE_MESSAGING",
    "APPROVE_CAMPAIGNS",
    "MANAGE_SENDER_ID",
    "VIEW_KYC",
    "MANAGE_AUTOMATION",
    "MANAGE_TASKS",
    "MANAGE_COMPLIANCE",
    "MANAGE_STORE",
    "VIEW_AUDIT",
  ],
  FINANCE: [
    ...READ_ONLY,
    "VIEW_FINANCE",
    "POST_JOURNAL",
    "CLOSE_PERIOD",
    "MANAGE_INVOICES",
    "MANAGE_CUSTOMERS",
    "MANAGE_COMPLIANCE",
    "MANAGE_TASKS",
    "EXPORT_DATA",
    "VIEW_AUDIT",
  ],
  STAFF: [...READ_ONLY, "MANAGE_INVOICES", "MANAGE_CUSTOMERS", "MANAGE_INVENTORY", "MANAGE_MESSAGING", "MANAGE_STORE", "MANAGE_TASKS"],
  VIEWER: READ_ONLY,
};

export function normalizeErpRole(raw: unknown): ErpRole {
  const value = String(raw ?? "").toUpperCase();
  if (value === "FINANCE_MANAGER" || value === "ACCOUNTANT") return "FINANCE";
  if ((ERP_ROLES as readonly string[]).includes(value)) return value as ErpRole;
  return "VIEWER";
}

export function hasErpPermission(role: ErpRole, permission: ErpPermission): boolean {
  const allowed = ROLE_MATRIX[role];
  return allowed === "all" ? true : allowed.includes(permission);
}

export function erpPermissionsFor(role: ErpRole): ErpPermission[] {
  const allowed = ROLE_MATRIX[role];
  return allowed === "all" ? ERP_PERMISSIONS.map((entry) => entry.key) : [...allowed];
}

/**
 * Approval authority in cents. A MANAGER may approve KES 10,000 of spend or messaging; a FINANCE
 * lead KES 50,000; only an owner or admin is unlimited. Used by campaigns, expenses and journals.
 */
export const ERP_APPROVAL_LIMITS_CENTS: Record<ErpRole, number> = {
  OWNER: Number.MAX_SAFE_INTEGER,
  ADMIN: Number.MAX_SAFE_INTEGER,
  MANAGER: 1_000_000,
  FINANCE: 5_000_000,
  STAFF: 0,
  VIEWER: 0,
};

export type ApprovalDecision = { allowed: boolean; reason: string };

export function approvalDecision(params: {
  role: ErpRole;
  amountCents: number;
  /** Configurable per-business threshold, defaulting to the role limit. */
  thresholdCents?: number;
  /** An initiator may not approve their own consequential action when policy forbids it. */
  initiatorId?: string | null;
  approverId?: string | null;
  separationOfDuties?: boolean;
}): ApprovalDecision {
  const limit = Math.min(params.thresholdCents ?? Number.MAX_SAFE_INTEGER, ERP_APPROVAL_LIMITS_CENTS[params.role] ?? 0);
  if (limit <= 0) return { allowed: false, reason: "Your role cannot approve spending. Ask an owner or manager." };
  if (params.amountCents > limit) {
    return { allowed: false, reason: "This amount is above your approval limit. Ask an owner to approve it." };
  }
  if (params.separationOfDuties && params.initiatorId && params.approverId && params.initiatorId === params.approverId) {
    return { allowed: false, reason: "You cannot approve your own request. Ask another authorised person." };
  }
  return { allowed: true, reason: "Approved." };
}

export type ErpContext = {
  session: SessionPayload;
  business: { id: string; name: string; slug: string; ownerId: string; phone: string | null; logoUrl: string | null };
  role: ErpRole;
  permissions: ErpPermission[];
  configuration: {
    id?: string;
    businessId: string;
    industryPackKey: string;
    countryCode: string;
    currencyCode: string;
    timeZone: string;
    legalName: string | null;
    kraPin: string | null;
    storefrontSlug: string | null;
    storefrontJson: string;
    featureFlagsJson: string;
    onboardingJson: string;
    messagingAllowanceSegments: number;
  } | null;
  entitlement: ErpEntitlementState;
};

export type ErpAccessOptions = {
  permission?: ErpPermission;
  requireEntitled?: boolean;
  /** Skip entitlement mirror writes for read-only screens. */
  fast?: boolean;
};

export function erpFeatureFlags(json: string | null | undefined): Record<string, boolean> {
  try {
    const parsed = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * ERP roles are assigned in `ErpConfiguration.teamRolesJson`, not in the shared
 * `BusinessMember.role` column: that column also drives the Business POS, so writing "FINANCE" into
 * it would quietly change what the same person can do at the till.
 */
function teamAssignedRole(raw: unknown, userId: string): ErpRole | null {
  try {
    const map = JSON.parse(String(raw ?? "{}"));
    const value = String(map?.[userId] ?? "").toUpperCase();
    // Ownership is never granted from configuration.
    if (value === "OWNER") return null;
    return (ERP_ROLES as readonly string[]).includes(value) ? (value as ErpRole) : null;
  } catch {
    return null;
  }
}

export function resolveErpRole(input: {
  ownerId: string | null | undefined;
  userId: string | null | undefined;
  membershipRole: string | null | undefined;
  teamRolesJson: string | null | undefined;
}): ErpRole {
  if (input.userId && input.ownerId === input.userId) return "OWNER";
  return teamAssignedRole(input.teamRolesJson, String(input.userId ?? "")) ?? normalizeErpRole(input.membershipRole);
}

export async function requireErpAccess(
  businessId: string | null | undefined,
  session: SessionPayload | null,
  options: ErpAccessOptions = {},
): Promise<ErpContext> {
  if (!session) throw new ErpAccessError(SAFE_ERRORS.signIn, 401, "UNAUTHENTICATED");
  const id = String(businessId ?? "").trim();
  if (!id) throw new ErpAccessError(SAFE_ERRORS.chooseBusiness, 400, "MISSING_BUSINESS");

  const business = await prisma.business.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, ownerId: true, phone: true, logoUrl: true },
  });
  if (!business) throw new ErpAccessError(SAFE_ERRORS.notFound, 404, "NOT_FOUND");

  try {
    await assertBusinessOwnership(id, session);
  } catch (error) {
    await logErpAudit({
      businessId: id,
      actorId: session.userId,
      action: "ERP_ACCESS_DENIED",
      targetType: "BUSINESS",
      targetId: id,
      outcome: "DENIED",
      reason: error instanceof TenantError ? "TENANT_ISOLATION" : "UNKNOWN",
    });
    if (error instanceof TenantError && error.status === 404) throw new ErpAccessError(SAFE_ERRORS.notFound, 404, "NOT_FOUND");
    throw new ErpAccessError(SAFE_ERRORS.noAccess, 403, "TENANT_ISOLATION");
  }

  const [memberRole, configuration] = await Promise.all([
    getBusinessRoleForUser(id, session).catch(() => null),
    prisma.erpConfiguration.findUnique({ where: { businessId: id } }).catch(() => null),
  ]);

  const role = resolveErpRole({
    ownerId: business.ownerId,
    userId: session.userId,
    membershipRole: memberRole,
    teamRolesJson: (configuration as any)?.teamRolesJson ?? null,
  });
  if (business.ownerId !== session.userId && !memberRole && session.role !== "ADMIN") {
    throw new ErpAccessError(SAFE_ERRORS.noAccess, 403, "NO_ROLE");
  }

  const entitlement = options.fast
    ? await deriveQuietly(id)
    : await syncErpEntitlement(id).catch(() => deriveUnavailable());

  if (!erpFeatureEnabled()) {
    throw new ErpAccessError(
      "POS / ERP - PRO is not switched on for this environment yet. Your data is safe; nothing has been sent or charged.",
      503,
      "PRODUCT_DISABLED",
    );
  }

  if (options.requireEntitled && !entitlement.entitled) {
    await logErpAudit({
      businessId: id,
      actorId: session.userId,
      action: "ERP_ACCESS_DENIED",
      targetType: "ENTITLEMENT",
      targetId: id,
      outcome: "DENIED",
      reason: entitlement.status,
    });
    throw new ErpAccessError(entitlement.reason, 402, "PAYMENT_REQUIRED");
  }

  if (options.permission && !hasErpPermission(role, options.permission)) {
    await logErpAudit({
      businessId: id,
      actorId: session.userId,
      actorName: session.name ?? null,
      action: "ERP_ACCESS_DENIED",
      targetType: "PERMISSION",
      targetId: options.permission,
      outcome: "DENIED",
      reason: role,
    });
    throw new ErpAccessError("Your role does not allow that action. Ask the business owner for access.", 403, "PERMISSION");
  }

  const context: ErpContext = {
    session,
    business,
    role,
    permissions: erpPermissionsFor(role),
    configuration: configuration as ErpContext["configuration"],
    entitlement,
  };
  return context;
}

async function deriveQuietly(businessId: string): Promise<ErpEntitlementState> {
  try {
    const subscription = await prisma.erpSubscription.findUnique({ where: { businessId } });
    const entitlement = await prisma.erpEntitlement.findUnique({ where: { businessId } });
    const configuration = await prisma.erpConfiguration.findUnique({ where: { businessId } });
    const { deriveErpEntitlement } = await import("./entitlement");
    return deriveErpEntitlement({ subscription, entitlement, configured: Boolean(configuration) });
  } catch {
    return deriveUnavailable();
  }
}

export function deriveUnavailable(): ErpEntitlementState {
  return {
    entitled: false,
    status: "NONE",
    lifecycle: "SETUP",
    planKey: "ERP_PRO",
    priceKES: 3000,
    expiresAt: null,
    graceUntil: null,
    reason: "We couldn't load your plan just now. Refresh to try again.",
    nextAction: "none",
    inGrace: false,
  };
}

export function erpBasePath(businessId: string): string {
  return `/dashboard/erp/${encodeURIComponent(businessId)}`;
}

/** Map an ERP error to an HTTP status and a safe message. Never returns a stack or SQL. */
export function erpErrorResponse(error: unknown, fallback = "We couldn't complete that. Please try again."): { status: number; message: string; code: string } {
  if (error instanceof ErpAccessError) return { status: error.status, message: error.message, code: error.code };
  const status = typeof (error as { status?: unknown })?.status === "number" ? Number((error as { status: number }).status) : 500;
  if (status >= 400 && status < 500) return { status, message: fallback, code: "BAD_REQUEST" };
  return { status: 500, message: fallback, code: "SERVER_ERROR" };
}
