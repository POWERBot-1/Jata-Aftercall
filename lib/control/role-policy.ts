import { CONTROL_ROLE_NAMES } from "@/lib/control/permissions";

/** Provisional authorization state. No role/action mapping has owner approval. */
export const CONTROL_ROLE_POLICY_APPROVED = false as const;

/**
 * Provisional visibility only. These are not grants or approved role semantics.
 * The owner must approve each role/action/scope before any grant is provisioned.
 */
export const CONTROL_ROLE_POLICY = [
  { role: "SUPER_ADMIN", responsibility: "Proposed broad platform stewardship; exact authority and limits are unresolved." },
  { role: "PLATFORM_ADMIN", responsibility: "Proposed platform operations; exact modules, scope and separation from Super Admin are unresolved." },
  { role: "FINANCE_ADMIN", responsibility: "Proposed financial oversight; read visibility, adjustments, approvals and payout authority are unresolved." },
  { role: "SUPPORT_ADMIN", responsibility: "Proposed support operations; tenant access, customer-data visibility and business actions are unresolved." },
  { role: "SECURITY_ADMIN", responsibility: "Proposed security operations; identity, grant, session, incident and audit authority are unresolved." },
  { role: "READ_ONLY_AUDITOR", responsibility: "Proposed independent review; audit visibility, tenant scope and sensitive-data access are unresolved." },
] as const satisfies readonly { role: (typeof CONTROL_ROLE_NAMES)[number]; responsibility: string }[];

export const CONTROL_ROLE_POLICY_COLUMNS = [
  { label: "Read", value: "Pending owner-approved role/action mapping. No capability is granted by role name." },
  { label: "Write", value: "Denied until exact action, validation, scope and role grant are approved." },
  { label: "Approval", value: "Denied. No approval or dual-control authority is inferred." },
  { label: "Financial", value: "Pending policy. No amounts, adjustments, commissions or payout authority is inferred." },
  { label: "Tenant scope", value: "Unassigned. No global or tenant scope is inferred; unscoped access remains denied." },
  { label: "Sensitive administration", value: "Denied pending policy (identity/PII, role/grant changes, provider configuration and recovery)." },
  { label: "MFA", value: "All protected routes are currently denied while this matrix is pending. If owner policy is approved, the existing implementation requires TOTP; role-specific rules and recovery still require approval." },
  { label: "Audit", value: "Append-only logging is an engineering requirement for supported actions; role-specific audit visibility and retention require approval." },
] as const;

export const CONTROL_POLICY_BOUNDARIES = [
  {
    title: "Repository-authorized behavior",
    status: "Implemented requirements, not role grants",
    items: [
      "The six canonical role identifiers exist in the repository.",
      "Control access must use explicit database grants, deny by default, enforce tenant/resource scope on the server, and re-check current grants per request.",
      "Supported protected routes fail closed while the six-role matrix is pending; if approved, they require short-lived MFA. Durable session-version checks and self-session revocation are implemented, but cannot enable access ahead of policy approval.",
      "Supported administrative mutations require server-side validation, confirmation/reason where applicable, and append-only audit evidence.",
      "No role name, sign-in, page navigation or UI visibility alone grants a capability.",
    ],
  },
  {
    title: "Safe technical behavior",
    status: "May continue without policy approval",
    items: [
      "Keep every unapproved capability unavailable and show it as pending policy.",
      "Expose only authoritative records with server-side authorization and minimum necessary fields; show source, freshness and unavailable/error states.",
      "Reject cross-tenant access, stale/revoked grants, invalid input and unsupported actions before mutation; never substitute fixture or mock data for live operational data.",
      "Preserve append-only audit rows and capture actor, role, action, target, time, outcome, correlation and before/after state where relevant.",
    ],
  },
  {
    title: "Owner approval required",
    status: "Not approved; remains denied",
    items: [
      "Exact role-to-action matrix, tenant versus platform-wide scope, null-scope approval and cross-tenant incident access.",
      "Initial grant/bootstrap/provisioning authority, grant changes, dual approval, emergency access, duration and revocation workflow.",
      "User identity/PII visibility, account or agent status changes, role administration and another user's session revocation.",
      "Payment amounts/details, financial adjustments, commission rates/events/attribution/reversals, payable balances and payouts.",
      "Communications replay/recovery, provider configuration, destructive system operations, and business-suspension side effects.",
      "Role-specific MFA/recovery rules, sensitive-read audit scope, audit visibility/retention and personal-data retention/deletion policy.",
    ],
  },
] as const;
