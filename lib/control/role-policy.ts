import { CONTROL_PERMISSIONS, CONTROL_ROLE_NAMES, isControlPermission, isControlRole, type ControlPermission, type ControlRoleName } from "@/lib/control/permissions";

/**
 * Overall consent authorizes the least-privilege implementation work, not any particular ALLOW.
 * Until a role's duties and exact tenant/data scope are substantiated, the effective assignment is
 * DENY. This switch therefore stays false; an ALLOW requires a separate explicit owner decision
 * and acceptance evidence.
 */
export const CONTROL_ROLE_POLICY_APPROVED = false as const;

/**
 * Provisional role descriptions only. No capability follows from a role name.
 * These labels are not assignments and do not authorize an identity or grant.
 */
export const CONTROL_ROLE_POLICY = [
  { role: "SUPER_ADMIN", responsibility: "Proposed broad platform stewardship; exact authority and limits are unresolved." },
  { role: "PLATFORM_ADMIN", responsibility: "Proposed platform operations; exact modules, scope and separation from Super Admin are unresolved." },
  { role: "FINANCE_ADMIN", responsibility: "Proposed financial oversight; read visibility, adjustments, approvals and payout authority are unresolved." },
  { role: "SUPPORT_ADMIN", responsibility: "Proposed support operations; tenant access, customer-data visibility and business actions are unresolved." },
  { role: "SECURITY_ADMIN", responsibility: "Proposed security operations; identity, grant, session, incident and audit authority are unresolved." },
  { role: "READ_ONLY_AUDITOR", responsibility: "Proposed independent review; audit visibility, tenant scope and sensitive-data access are unresolved." },
] as const satisfies readonly { role: ControlRoleName; responsibility: string }[];

export type ControlCapabilityDecision = "ALLOW" | "DENY";

// The conservative effective matrix is explicit at the role level. Shared all-deny cells are
// intentional: no role purpose, tenant scope, sensitive-data need, or high-impact permission was
// supplied with sufficient precision to justify an ALLOW. New roles/capabilities are denied unless
// deliberately added here, and unknown values fail closed in isControlCapabilityAllowed().
const denyAllCapabilities = Object.freeze(Object.fromEntries(
  CONTROL_PERMISSIONS.map((permission) => [permission, "DENY"]),
) as Record<ControlPermission, ControlCapabilityDecision>);

export const CONTROL_ROLE_CAPABILITY_POLICY: Readonly<Record<ControlRoleName, Readonly<Record<ControlPermission, ControlCapabilityDecision>>>> = Object.freeze({
  SUPER_ADMIN: denyAllCapabilities,
  PLATFORM_ADMIN: denyAllCapabilities,
  FINANCE_ADMIN: denyAllCapabilities,
  SUPPORT_ADMIN: denyAllCapabilities,
  SECURITY_ADMIN: denyAllCapabilities,
  READ_ONLY_AUDITOR: denyAllCapabilities,
});

/** A DB grant can only narrow this policy; it can never widen it. */
export function isControlCapabilityAllowed(role: unknown, permission: unknown): boolean {
  if (typeof role !== "string" || !isControlRole(role) || typeof permission !== "string" || !isControlPermission(permission)) return false;
  return CONTROL_ROLE_CAPABILITY_POLICY[role][permission] === "ALLOW";
}

/** Remove unapproved, malformed, or unknown capabilities before building a request identity. */
export function filterControlRolePermissions(role: unknown, permissionKeys: unknown): ControlPermission[] {
  if (!Array.isArray(permissionKeys)) return [];
  return permissionKeys.filter((permission): permission is ControlPermission =>
    typeof permission === "string" && isControlCapabilityAllowed(role, permission));
}

export const CONTROL_ROLE_POLICY_COLUMNS = [
  { label: "Read", value: "DENY for all six roles until exact purpose, fields and tenant/resource scope are established." },
  { label: "Write", value: "DENY for all six roles; supported and unsupported mutations remain unavailable." },
  { label: "Approval", value: "DENY. No approval, dual-control or financial authority is inferred." },
  { label: "Financial", value: "DENY. Amounts, adjustments, commission policy, refunds and payouts are unavailable." },
  { label: "Tenant scope", value: "No scope assigned. Tenant-keyed access and platform-wide/null scope are both denied." },
  { label: "Sensitive administration", value: "DENY: identities, grants, PII, provider configuration and recovery are unavailable." },
  { label: "MFA", value: "DENY while the global policy gate remains false. If a future ALLOW is approved, existing protected-route checks require verified TOTP and a signed 15-minute MFA session bound to user and session version." },
  { label: "Audit", value: "DENY audit-data visibility. Any future sensitive operation must emit an immutable, correctly attributed outcome in the same transaction where applicable; denials must never be represented as success." },
] as const;

export const CONTROL_POLICY_BOUNDARIES = [
  {
    title: "Repository-authorized behavior",
    status: "Technical constraints, not role grants",
    items: [
      "The six canonical role identifiers and 15 capability keys exist in the repository.",
      "Control access must use exact database grants, deny by default, enforce tenant/resource scope on the server, and re-check current grants per request.",
      "Protected routes fail closed while CONTROL_ROLE_POLICY_APPROVED is false; a future role/capability ALLOW must also pass current-session, active-grant, exact-scope and short-lived MFA checks.",
      "Supported administrative mutations require server-side validation, confirmation/reason where applicable, and append-only audit evidence.",
      "No role name, sign-in, page navigation or UI visibility alone grants a capability.",
    ],
  },
  {
    title: "Effective least-privilege policy",
    status: "All 90 role/capability cells are DENY",
    items: [
      "The overall consent authorizes policy work but does not specify any role's individual duties, permitted data fields, tenant relationship or high-impact authority.",
      "Every capability is explicitly DENY for every canonical role until its precise action, fields, scope and owner decision are documented; there are no wildcard, implicit, inherited or platform-wide grants.",
      "Unknown roles, unknown capabilities, missing grants, empty/revoked grants, invalid or expired sessions, missing/invalid MFA and unsupported routes remain denied.",
    ],
  },
  {
    title: "Owner clarification required before any ALLOW",
    status: "Unresolved; no access is enabled",
    items: [
      "Role purpose and separation of duties for each canonical role; do not infer duties from labels.",
      "Which exact capability, if any, each role may use; route/action, required fields, tenant/resource scope, null-scope rule, conditions and business effects.",
      "Whether platform-wide access is needed for agent, communications, provider, exception, audit or system-health data; current scope is denied.",
      "Business suspension/reinstatement side effects; financial visibility and authority; agent management; communications recovery; provider configuration; identity/grant administration; emergency access.",
      "Role-specific MFA freshness, enrollment/recovery, session duration, grant revocation latency, audit-read scope, retention/export and denial-event policy.",
    ],
  },
] as const;
