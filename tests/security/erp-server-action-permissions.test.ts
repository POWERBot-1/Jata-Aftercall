/**
 * R-TI-04 — server actions are public POST endpoints and need the same role checks as API routes.
 *
 * R-TI-03 pinned role checks on every app/api write. A Next "use server" export is reachable by a
 * POST from any signed-in browser whether or not its form is rendered, so hiding the button is not
 * authorization. The sweep of app/dashboard/erp/[businessId]/actions.ts (the only "use server" file)
 * found `bootstrapWorkspaceAction` behind WORKSPACE_READ, a permission every member, including a
 * read-only VIEWER, holds. Bootstrapping creates the ERP configuration (industry pack and feature
 * flags) and re-creates default tax rules, templates and channels that an owner removed, so it now
 * needs MANAGE_SETTINGS, the same permission as saveBusinessProfileAction, which runs the same
 * bootstrap.
 *
 * Pinned two ways:
 *   1. statically: every exported action authorizes through access(businessId, "<PERMISSION>") or an
 *      explicit platform-admin check. WORKSPACE_READ is allowed only on a short, justified list of
 *      actions that write nothing or touch only the caller's own records. A new "use server" file
 *      fails the test until it is reviewed and added here.
 *   2. behaviourally: bootstrapWorkspaceAction is invoked for each role against the real ERP role
 *      matrix (hasErpPermission). Only OWNER and ADMIN reach the bootstrap.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACTIONS_FILE = "app/dashboard/erp/[businessId]/actions.ts";
const REVIEWED_SERVER_ACTION_FILES = [ACTIONS_FILE];

/** WORKSPACE_READ is enough only where the action writes nothing or touches the caller's own rows. */
const WORKSPACE_READ_ALLOWED: Record<string, string> = {
  refreshChecklistAction: "revalidates the page only; writes nothing",
  markNotificationReadAction: "marks the caller's own notification as read (viewer-scoped in lib/erp/notifications)",
  markAllNotificationsReadAction: "marks the caller's own notifications as read (viewer-scoped)",
  requestApprovalAction: "raising a request is the low-privilege path by design; deciding needs APPROVE_SPEND",
  withdrawApprovalAction: "withdrawApprovalRequest refuses anyone but the original requester (403)",
};

function exportedActions(source: string): Array<{ name: string; body: string }> {
  const parts = source.split(/^(?=export async function )/m).slice(1);
  return parts.map((body) => ({ name: /^export async function (\w+)/.exec(body)![1], body }));
}

describe("R-TI-04 server-action permissions (static)", () => {
  it("only reviewed files declare \"use server\"", () => {
    const listed = execFileSync("git", ["grep", "-l", "-E", "^[\"']use server[\"']", "--", "app", "lib"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(listed).toEqual([...REVIEWED_SERVER_ACTION_FILES].sort());
  });

  const actions = exportedActions(readFileSync(ACTIONS_FILE, "utf8"));

  it("scans every exported ERP action", () => {
    expect(actions.length).toBeGreaterThan(40);
  });

  it.each(actions.map((a) => [a.name, a.body] as const))("%s authorizes with a named permission or a platform-admin check", (name, body) => {
    const permission = /\baccess\(\s*businessId\s*,\s*"([A-Z_]+)"/.exec(body)?.[1];
    const platformAdmin = /session\.role\s*!==\s*"ADMIN"/.test(body);
    expect(permission || platformAdmin, `${name} has no authorization`).toBeTruthy();
    if (permission === "WORKSPACE_READ") {
      expect(Object.keys(WORKSPACE_READ_ALLOWED), `${name} writes with only WORKSPACE_READ`).toContain(name);
    }
  });

  it("bootstrapWorkspaceAction requires MANAGE_SETTINGS, like saveBusinessProfileAction", () => {
    const body = actions.find((a) => a.name === "bootstrapWorkspaceAction")!.body;
    expect(body).toMatch(/access\(\s*businessId\s*,\s*"MANAGE_SETTINGS"\s*\)/);
    const profile = actions.find((a) => a.name === "saveBusinessProfileAction")!.body;
    expect(profile).toMatch(/access\(\s*businessId\s*,\s*"MANAGE_SETTINGS"\s*\)/);
  });
});

// ── Behavioural: the real role matrix decides who reaches the bootstrap ──────────────────────
const state = vi.hoisted(() => ({ role: "VIEWER" as string, bootstrapped: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
}));
vi.mock("@/lib/db", () => ({ default: {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ userId: "user-1", email: "u@example.test", role: "USER" }) }));
vi.mock("@/lib/dashboard-login-redirect", () => ({ redirectToDashboardLogin: async () => { throw new Error("signed out"); } }));
vi.mock("@/lib/erp/bootstrap", () => ({
  bootstrapErpWorkspace: async () => {
    state.bootstrapped += 1;
    return { created: true };
  },
}));
vi.mock("@/lib/erp/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/erp/access")>();
  return {
    ...actual,
    // Same contract as the real requireErpAccess after tenant and membership checks pass: the
    // resolved role must hold the permission, otherwise ErpAccessError (403).
    requireErpAccess: async (businessId: string, session: any, options: { permission?: any } = {}) => {
      if (options.permission && !actual.hasErpPermission(state.role as any, options.permission)) {
        throw new actual.ErpAccessError("You do not have permission to do that.", 403, "FORBIDDEN" as any);
      }
      return { business: { id: businessId }, session, role: state.role };
    },
  };
});

describe("R-TI-04 bootstrapWorkspaceAction (behavioural, real ERP role matrix)", () => {
  beforeEach(() => {
    state.bootstrapped = 0;
  });

  async function run(role: string) {
    state.role = role;
    const { bootstrapWorkspaceAction } = await import("@/app/dashboard/erp/[businessId]/actions");
    const form = new FormData();
    form.set("businessId", "biz-a");
    form.set("industryPackKey", "retail");
    return bootstrapWorkspaceAction(form).then(() => "returned", (error: Error) => error.message);
  }

  it.each(["VIEWER", "STAFF", "MANAGER", "FINANCE"])("%s is refused and nothing is bootstrapped", async (role) => {
    const outcome = await run(role);
    expect(outcome).toMatch(/^REDIRECT \/dashboard\/erp\/biz-a\?error=/);
    expect(state.bootstrapped).toBe(0);
  });

  it.each(["OWNER", "ADMIN"])("%s reaches the bootstrap", async (role) => {
    const outcome = await run(role);
    expect(outcome).toMatch(/ok=/);
    expect(state.bootstrapped).toBe(1);
  });
});
