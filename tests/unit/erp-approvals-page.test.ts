/**
 * The approvals screen, as each role receives it.
 *
 * The unit suite proves authority; this proves the rendered result: a manager is offered Approve and
 * Reject on a request they may decide, a staff member is offered Withdraw on their own pending request
 * and nothing on somebody else's, and a decided request offers no controls at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  role: "MANAGER" as string,
  requests: [] as any[],
  scope: "all" as "all" | "mine",
  canApprove: true,
  summary: { pending: 0, approved: 0, rejected: 0 },
}));

vi.mock("@/lib/erp/workspace", () => ({
  loadErpWorkspace: vi.fn(async () => ({
    role: state.role,
    basePath: "/dashboard/erp/biz-1",
    session: { userId: state.role === "MANAGER" ? "manager-1" : "staff-1", email: "person@example.test", role: "OWNER" },
  })),
}));

vi.mock("@/lib/erp/loaders", () => ({
  loadApprovalCentre: vi.fn(async () => ({
    requests: state.requests,
    pending: state.requests.filter((row) => row.status === "PENDING"),
    decided: state.requests.filter((row) => row.status !== "PENDING"),
    summary: state.summary,
    scope: state.scope,
    canApprove: state.canApprove,
  })),
}));

vi.mock("@/app/dashboard/erp/[businessId]/actions", () => ({
  requestApprovalAction: "/dashboard/erp/biz-1/approvals/request",
  decideApprovalAction: "/dashboard/erp/biz-1/approvals/decide",
  withdrawApprovalAction: "/dashboard/erp/biz-1/approvals/withdraw",
}));

const { default: ApprovalsPage } = await import("@/app/dashboard/erp/[businessId]/approvals/page");

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    businessId: "biz-1",
    kind: "SPEND",
    title: "Buy 40 bags of cement",
    detail: "MGAS bulk order",
    amountCents: 500_000,
    status: "PENDING",
    requestedBy: "staff-1",
    requestedName: "Staff One",
    approverRole: "MANAGER",
    approverId: null,
    decidedBy: null,
    decidedName: null,
    decidedAt: null,
    decisionNote: null,
    canDecide: true,
    createdAt: new Date("2026-10-29T09:00:00.000Z"),
    ...overrides,
  };
}

async function render(query: Record<string, string> = {}) {
  const element = await ApprovalsPage({
    params: Promise.resolve({ businessId: "biz-1" }),
    searchParams: Promise.resolve(query as any),
  });
  return renderToStaticMarkup(element as any);
}

beforeEach(() => {
  state.role = "MANAGER";
  state.requests = [];
  state.scope = "all";
  state.canApprove = true;
  state.summary = { pending: 0, approved: 0, rejected: 0 };
});

describe("approvals screen", () => {
  it("offers Approve and Reject on a request this manager may decide", async () => {
    state.requests = [request()];
    state.summary = { pending: 1, approved: 0, rejected: 0 };
    const html = await render();
    expect(html).toContain("Buy 40 bags of cement");
    expect(html).toContain(">Approve</button>");
    expect(html).toContain(">Reject</button>");
    expect(html).toContain("Why reject?");
    expect(html).toContain("KES 5,000");
  });

  it("offers a staff member Withdraw on their own request and nothing on somebody else's", async () => {
    state.role = "STAFF";
    state.canApprove = false;
    state.scope = "mine";
    state.requests = [
      request({ id: "req-1", requestedBy: "staff-1", canDecide: false }),
      request({ id: "req-2", title: "Somebody else's request", requestedBy: "owner-1", canDecide: false }),
    ];
    const html = await render();
    expect(html).toContain(">Withdraw</button>");
    expect(html).not.toContain(">Approve</button>");
    expect(html).toContain("Waiting for a Manager decision.");
  });

  it("offers no controls on a decided request and states who decided it", async () => {
    state.requests = [request({ status: "APPROVED", decidedName: "Manager One", decidedBy: "manager-1", decisionNote: "Within budget", canDecide: false })];
    state.summary = { pending: 0, approved: 1, rejected: 0 };
    const html = await render();
    expect(html).toContain("Approved by Manager One");
    expect(html).toContain("Within budget");
    expect(html).not.toContain(">Approve</button>");
    expect(html).not.toContain(">Withdraw</button>");
  });

  it("tells a role with no approval authority that it can ask but not decide", async () => {
    state.role = "STAFF";
    state.canApprove = false;
    state.scope = "mine";
    const html = await render();
    expect(html).toContain("You can ask; somebody with approval authority decides");
    expect(html).toContain("Nothing is waiting");
  });

  it("shows the decider their limit and that self-approval is refused", async () => {
    const html = await render();
    expect(html).toContain("KES 10,000");
    expect(html).toContain("Anything above that needs an owner");
  });

  it("surfaces the outcome of a decision", async () => {
    const ok = await render({ ok: "Approved and recorded." });
    expect(ok).toContain("Approved and recorded.");
    const failure = await render({ error: "You cannot approve your own request. Ask somebody else." });
    expect(failure).toContain("cannot approve your own request");
  });
});
