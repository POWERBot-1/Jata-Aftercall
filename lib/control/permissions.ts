/**
 * Capability vocabulary for controls explicitly described by the owner requirements.
 * These are not role defaults: no ControlRole implicitly receives any capability. An
 * owner-approved grant must name each exact capability and an optional tenant scope.
 */
export const CONTROL_PERMISSIONS = [
  "businesses.read",
  "businesses.suspend",
  "businesses.reinstate",
  "subscriptions.read",
  "payments.read",
  "agents.read",
  "agents.manage",
  "commissions.read",
  "communications.read",
  "communications.recover",
  "providers.read",
  "providers.configure",
  "audit.read",
  "exceptions.read",
  "system.health.read",
] as const;

export type ControlPermission = (typeof CONTROL_PERMISSIONS)[number];

export const CONTROL_ROLE_NAMES = [
  "SUPER_ADMIN",
  "PLATFORM_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
  "SECURITY_ADMIN",
  "READ_ONLY_AUDITOR",
] as const;
export type ControlRoleName = (typeof CONTROL_ROLE_NAMES)[number];

export function isControlPermission(value: string): value is ControlPermission {
  return (CONTROL_PERMISSIONS as readonly string[]).includes(value);
}

export function isControlRole(value: string): value is ControlRoleName {
  return (CONTROL_ROLE_NAMES as readonly string[]).includes(value);
}
