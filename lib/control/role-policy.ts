import { CONTROL_PERMISSIONS, isControlPermission, isControlRole, type ControlPermission, type ControlRoleName } from "@/lib/control/permissions";

/** Owner-authorized least-privilege read-only role matrix. No mutation or approval authority is delegated. */
export const CONTROL_ROLE_POLICY_APPROVED = true as const;
/** The gate is enabled, but every request still requires an explicit active DB grant, exact scope and MFA. */
export const CONTROL_ROLE_ACCESS_ENABLED = true as const;

export const CONTROL_ROLE_POLICY = [
  { role: "SUPER_ADMIN", responsibility: "Owner-designated platform oversight; read-only, tenant-scoped; no grant, identity, provider or financial mutation authority." },
  { role: "PLATFORM_ADMIN", responsibility: "Platform operations; tenant-scoped business/subscription reads and minimal global runtime health." },
  { role: "FINANCE_ADMIN", responsibility: "Finance oversight; tenant-scoped subscription, payment and immutable commission-ledger reads only." },
  { role: "SUPPORT_ADMIN", responsibility: "Customer support; tenant-scoped business and subscription reads only." },
  { role: "SECURITY_ADMIN", responsibility: "Security oversight; tenant-scoped audit reads and minimal global runtime health." },
  { role: "READ_ONLY_AUDITOR", responsibility: "Independent audit review; tenant-scoped append-only audit reads only." },
] as const satisfies readonly { role: ControlRoleName; responsibility: string }[];

export type ControlCapabilityDecision = "ALLOW" | "DENY";
const allDenied = Object.freeze(Object.fromEntries(CONTROL_PERMISSIONS.map((permission) => [permission, "DENY"])) as Record<ControlPermission, ControlCapabilityDecision>);
const policyFor = (allowed: readonly ControlPermission[]) => Object.freeze({
  ...allDenied,
  ...Object.fromEntries(allowed.map((permission) => [permission, "ALLOW" as const])),
});

export const CONTROL_ROLE_CAPABILITY_POLICY: Readonly<Record<ControlRoleName, Readonly<Record<ControlPermission, ControlCapabilityDecision>>>> = Object.freeze({
  SUPER_ADMIN: policyFor(["businesses.read", "subscriptions.read", "payments.read", "commissions.read", "audit.read", "system.health.read"]),
  PLATFORM_ADMIN: policyFor(["businesses.read", "subscriptions.read", "system.health.read"]),
  FINANCE_ADMIN: policyFor(["subscriptions.read", "payments.read", "commissions.read"]),
  SUPPORT_ADMIN: policyFor(["businesses.read", "subscriptions.read"]),
  SECURITY_ADMIN: policyFor(["audit.read", "system.health.read"]),
  READ_ONLY_AUDITOR: policyFor(["audit.read"]),
});

export function isControlCapabilityAllowed(role: unknown, permission: unknown): boolean {
  if (typeof role !== "string" || !isControlRole(role) || typeof permission !== "string" || !isControlPermission(permission)) return false;
  return CONTROL_ROLE_CAPABILITY_POLICY[role][permission] === "ALLOW";
}

export function filterControlRolePermissions(role: unknown, permissionKeys: unknown): ControlPermission[] {
  if (!Array.isArray(permissionKeys)) return [];
  return permissionKeys.filter((permission): permission is ControlPermission =>
    typeof permission === "string" && isControlCapabilityAllowed(role, permission));
}

export const CONTROL_ROLE_POLICY_COLUMNS = [
  { label: "Read", value: "Read-only: only explicit read capabilities in the six-role matrix; tenant-keyed sources require an exact business scope." },
  { label: "Write", value: "DENY for all six roles: no suspension, reinstatement, agent management, communications recovery or financial mutation." },
  { label: "Approval", value: "DENY. No financial, provider, identity, grant or dual-control approval authority is delegated." },
  { label: "Financial", value: "FINANCE_ADMIN and SUPER_ADMIN receive scoped payment and immutable-ledger reads only; no amounts may be changed and no payout is authorized." },
  { label: "Tenant scope", value: "Tenant-keyed reads require explicit business scope. Null/global grants are rejected for tenant data. Only minimal system-health reads are platform-wide." },
  { label: "Sensitive administration", value: "DENY: no identity/grant administration, PII export, provider secrets/configuration or emergency bypass." },
  { label: "MFA", value: "Every protected request still requires verified TOTP and a signed 15-minute MFA session bound to user and session version." },
  { label: "Audit", value: "Audit reads are tenant-scoped for SUPER_ADMIN, SECURITY_ADMIN and READ_ONLY_AUDITOR; writes remain immutable and transactionally audited." },
] as const;

export const CONTROL_POLICY_BOUNDARIES = [
  { title: "Authorization enforcement", status: "Active least-privilege policy", items: [
    "No JWT role or UI visibility grants access; every protected request requires an active exact-key database grant.",
    "Tenant data requires an explicit business scope; null/global scope cannot read tenant-keyed records.",
    "The database grant can narrow but never widen the six-role policy; unknown roles, capabilities and malformed grants are denied.",
    "Every protected operation requires current session, live grant check, exact scope and verified short-lived MFA.",
  ] },
  { title: "Explicitly denied operations", status: "No write or high-impact authority", items: [
    "Business suspension/reinstatement, agent management, communications recovery, provider configuration, identity/grant administration and other-user session revocation remain denied.",
    "Refunds, commission adjustments, settlement approval and payouts remain denied.",
    "Agent and communications sources without tenant keys remain unavailable to scoped grants.",
    "No break-glass, bootstrap bypass or production identity is created by this policy.",
  ] },
] as const;
