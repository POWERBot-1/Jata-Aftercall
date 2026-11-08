import { describe, expect, it } from "vitest";
import { canStudioRolePerform, normalizeStudioRole } from "@/lib/experience/tenant-policy";

describe("Website Studio multi-tenant permission policy", () => {
  it("fails closed for missing and unknown roles", () => {
    expect(normalizeStudioRole(undefined)).toBeNull();
    expect(normalizeStudioRole("SUPERUSER")).toBeNull();
    expect(canStudioRolePerform({
      workspaceRole: "OWNER",
      websiteRole: null,
      businessRole: "OWNER",
      action: "read",
    })).toBe(false);
  });

  it("requires every permission layer to grant the requested action", () => {
    expect(canStudioRolePerform({
      workspaceRole: "EDITOR",
      websiteRole: "EDITOR",
      businessRole: "MANAGER",
      action: "edit",
    })).toBe(true);
    expect(canStudioRolePerform({
      workspaceRole: "EDITOR",
      websiteRole: "OWNER",
      businessRole: "OWNER",
      action: "publish",
    })).toBe(false);
    expect(canStudioRolePerform({
      workspaceRole: "PUBLISHER",
      websiteRole: "PUBLISHER",
      businessRole: "MANAGER",
      action: "publish",
    })).toBe(false);
  });

  it("does not allow workspace membership to grant access to an unlinked business role", () => {
    expect(canStudioRolePerform({
      workspaceRole: "OWNER",
      websiteRole: "OWNER",
      businessRole: null,
      action: "manage_workspace",
    })).toBe(false);
  });

  it("reserves workspace administration for the actual workspace owner", () => {
    expect(canStudioRolePerform({
      workspaceRole: "ADMIN",
      websiteRole: "OWNER",
      businessRole: "OWNER",
      action: "publish",
    })).toBe(true);
    expect(canStudioRolePerform({
      workspaceRole: "ADMIN",
      websiteRole: "OWNER",
      businessRole: "OWNER",
      action: "manage_workspace",
    })).toBe(false);
    expect(canStudioRolePerform({
      workspaceRole: "OWNER",
      websiteRole: "OWNER",
      businessRole: "OWNER",
      action: "manage_workspace",
    })).toBe(true);
  });

  it("separates editor, publisher, viewer and administrator capabilities", () => {
    const common = { workspaceRole: "PUBLISHER", websiteRole: "PUBLISHER", businessRole: "ADMIN" as const };
    expect(canStudioRolePerform({ ...common, action: "read" })).toBe(true);
    expect(canStudioRolePerform({ ...common, action: "publish" })).toBe(true);
    expect(canStudioRolePerform({ ...common, action: "edit" })).toBe(false);
    expect(canStudioRolePerform({ ...common, action: "manage_workspace" })).toBe(false);
    expect(canStudioRolePerform({
      workspaceRole: "VIEWER",
      websiteRole: "VIEWER",
      businessRole: "OWNER",
      action: "edit",
    })).toBe(false);
  });
});
