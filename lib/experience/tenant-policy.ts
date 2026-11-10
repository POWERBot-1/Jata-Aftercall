import type { BusinessRole } from "@/lib/tenant";

export const STUDIO_ROLES = ["OWNER", "ADMIN", "EDITOR", "PUBLISHER", "VIEWER"] as const;
export type StudioRole = (typeof STUDIO_ROLES)[number];
export type StudioAction = "read" | "edit" | "publish" | "manage_workspace";

const STUDIO_PERMISSIONS: Record<StudioRole, readonly StudioAction[]> = {
  OWNER: ["read", "edit", "publish", "manage_workspace"],
  ADMIN: ["read", "edit", "publish"],
  EDITOR: ["read", "edit"],
  PUBLISHER: ["read", "publish"],
  VIEWER: ["read"],
};

const BUSINESS_PERMISSIONS: Record<BusinessRole, readonly StudioAction[]> = {
  OWNER: ["read", "edit", "publish", "manage_workspace"],
  ADMIN: ["read", "edit", "publish", "manage_workspace"],
  MANAGER: ["read", "edit"],
  STAFF: ["read"],
  VIEWER: ["read"],
};

export function normalizeStudioRole(value: unknown): StudioRole | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toUpperCase();
  return (STUDIO_ROLES as readonly string[]).includes(role) ? (role as StudioRole) : null;
}

/** Every layer must independently grant the action; unknown and missing roles deny. */
export function canStudioRolePerform(input: {
  workspaceRole: unknown;
  websiteRole: unknown;
  businessRole: BusinessRole | null;
  action: StudioAction;
}): boolean {
  const workspaceRole = normalizeStudioRole(input.workspaceRole);
  const websiteRole = normalizeStudioRole(input.websiteRole);
  if (!workspaceRole || !websiteRole || !input.businessRole) return false;

  return STUDIO_PERMISSIONS[workspaceRole].includes(input.action)
    && STUDIO_PERMISSIONS[websiteRole].includes(input.action)
    && BUSINESS_PERMISSIONS[input.businessRole].includes(input.action);
}
