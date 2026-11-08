import type { BusinessRole } from "@/lib/tenant";

export const STUDIO_ROLES = ["OWNER", "ADMIN", "EDITOR", "PUBLISHER", "VIEWER"] as const;
export type StudioRole = (typeof STUDIO_ROLES)[number];
export type StudioAction = "read" | "edit" | "publish" | "manage_workspace";

const ROLE_WEIGHT: Record<StudioRole, number> = {
  VIEWER: 10,
  PUBLISHER: 15,
  EDITOR: 20,
  ADMIN: 30,
  OWNER: 40,
};

const ACTION_WEIGHT: Record<StudioAction, number> = {
  read: 10,
  edit: 20,
  publish: 15,
  manage_workspace: 30,
};

const BUSINESS_CAP: Record<BusinessRole, number> = {
  VIEWER: 10,
  STAFF: 10,
  MANAGER: 20,
  ADMIN: 40,
  OWNER: 40,
};

export function normalizeStudioRole(value: unknown): StudioRole | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toUpperCase();
  return (STUDIO_ROLES as readonly string[]).includes(role) ? (role as StudioRole) : null;
}

/**
 * Workspace/site roles can only narrow the user's existing business permission.
 * In particular, a workspace PUBLISHER cannot publish if their BusinessMember
 * role does not already carry the existing publish permission.
 */
export function canStudioRolePerform(input: {
  workspaceRole: unknown;
  websiteRole: unknown;
  businessRole: BusinessRole | null;
  action: StudioAction;
}): boolean {
  const workspaceRole = normalizeStudioRole(input.workspaceRole);
  const websiteRole = normalizeStudioRole(input.websiteRole);
  if (!workspaceRole || !websiteRole || !input.businessRole) return false;

  const studioWeight = Math.min(ROLE_WEIGHT[workspaceRole], ROLE_WEIGHT[websiteRole]);
  const businessWeight = BUSINESS_CAP[input.businessRole];
  const actionWeight = ACTION_WEIGHT[input.action];

  return studioWeight >= actionWeight && businessWeight >= actionWeight;
}
