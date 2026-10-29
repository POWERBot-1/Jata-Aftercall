/**
 * The notification centre and the dashboard work widgets, as a person receives them.
 *
 * The domain suites prove the rules and the PostgreSQL suite proves the constraints. This file proves
 * the rendered result: unread notices are marked, read ones are not offered a "mark as read" button
 * that would do nothing, an empty inbox says so, and the home screen's widgets link to screens that
 * exist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  role: "OWNER" as string,
  unread: 0,
  stored: 0,
  notifications: [] as any[],
  work: {
    myTasks: [] as any[],
    summary: { open: 0, overdue: 0, unassigned: 0 },
    approvals: { pending: 0, approved: 0, rejected: 0 },
    unread: 0,
    latest: [] as any[],
  },
}));

vi.mock("@/lib/erp/workspace", () => ({
  loadErpWorkspace: vi.fn(async () => ({
    role: state.role,
    basePath: "/dashboard/erp/biz-1",
    session: { userId: "u-1", email: "person@example.test", role: "OWNER" },
    business: { id: "biz-1", name: "Acme Depot" },
    pack: { label: "Retail", status: "TESTED", blurb: "Pack blurb.", modules: [] },
    plan: { priceKES: 3000, inclusions: [], exclusions: [], commercials: {} },
    entitlement: { entitled: true, status: "ACTIVE", lifecycle: "ACTIVE", reason: "", expiresAt: null },
    onboarding: { percent: 0, completed: 0, total: 12, headline: "", steps: [], nextStep: null },
    cards: [],
    notice: null,
    counts: { overdueInvoices: 0 },
  })),
}));

vi.mock("@/lib/erp/loaders", () => ({
  loadNotificationCentre: vi.fn(async () => ({
    notifications: state.notifications,
    unread: state.unread,
    scanned: state.notifications.length,
    stored: state.stored,
    unreadOnly: false,
  })),
  loadWorkDashboard: vi.fn(async () => state.work),
  loadAccounting: vi.fn(async () => ({ trialBalance: { balanced: true, rows: [] }, profitAndLoss: { netProfitCents: 0 } })),
  loadInvoices: vi.fn(async () => ({ invoices: [], ageing: { totalCents: 0 } })),
  loadMessagingOverview: vi.fn(async () => ({
    campaigns: [],
    wallet: { availableCents: 0 },
    stats: { delivered: 0, failed: 0, unknown: 0, spentCents: 0, segments: 0 },
  })),
}));

vi.mock("@/lib/db", () => ({ default: {} }));
vi.mock("@/lib/erp/notifications", async () => {
  const actual = await vi.importActual<typeof import("@/lib/erp/notifications")>("@/lib/erp/notifications");
  return { ...actual, sweepOverdueTasks: vi.fn(async () => ({ swept: 0, raised: 0 })) };
});
vi.mock("@/app/dashboard/erp/[businessId]/actions", () => ({
  markNotificationReadAction: "/dashboard/erp/biz-1/notifications/read",
  markAllNotificationsReadAction: "/dashboard/erp/biz-1/notifications/read-all",
}));

const { default: NotificationsPage } = await import("@/app/dashboard/erp/[businessId]/notifications/page");
const { default: ErpHomePage } = await import("@/app/dashboard/erp/[businessId]/page");

const NOW = new Date("2026-10-29T09:00:00.000Z");

function notice(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    businessId: "biz-1",
    kind: "TASK_ASSIGNED",
    title: "Assigned to you: count the shelves",
    body: "Due Friday. Open the board to start or finish it.",
    href: "/dashboard/erp/biz-1/tasks",
    priority: "HIGH",
    audienceRole: "ALL",
    recipientId: "u-1",
    read: false,
    deliveryStatus: "IN_APP",
    createdAt: NOW,
    ...overrides,
  };
}

async function renderNotifications(query: Record<string, string> = {}) {
  const element = await NotificationsPage({
    params: Promise.resolve({ businessId: "biz-1" }),
    searchParams: Promise.resolve(query as any),
  });
  return renderToStaticMarkup(element as any);
}

async function renderHome() {
  const element = await ErpHomePage({ params: Promise.resolve({ businessId: "biz-1" }) });
  return renderToStaticMarkup(element as any);
}

beforeEach(() => {
  state.role = "OWNER";
  state.unread = 0;
  state.stored = 0;
  state.notifications = [];
  state.work = { myTasks: [], summary: { open: 0, overdue: 0, unassigned: 0 }, approvals: { pending: 0, approved: 0, rejected: 0 }, unread: 0, latest: [] };
});

describe("notification centre", () => {
  it("shows an unread notice with its destination and a working mark-as-read control", async () => {
    state.unread = 1;
    state.stored = 1;
    state.notifications = [notice()];
    const html = await renderNotifications();
    expect(html).toContain("Assigned to you: count the shelves");
    expect(html).toContain("Open →");
    expect(html).toContain("Mark as read");
    expect(html).toContain("Mark all as read");
    expect(html).toContain("New");
  });

  it("does not offer to mark a read notice as read again", async () => {
    state.stored = 1;
    state.notifications = [notice({ read: true })];
    const html = await renderNotifications();
    expect(html).toContain("Assigned to you: count the shelves");
    expect(html).not.toContain(">Mark as read</button>");
    expect(html).not.toContain("Mark all as read");
    expect(html).toContain("Read");
  });

  it("says the inbox is empty rather than showing an empty shell", async () => {
    const html = await renderNotifications();
    expect(html).toContain("No notifications yet");
    expect(html).toContain("nothing here was sent by SMS, WhatsApp or email");
  });

  it("distinguishes an empty unread filter from an empty inbox", async () => {
    const html = await renderNotifications({ filter: "unread" });
    expect(html).toContain("Nothing unread");
  });

  it("surfaces the result of a mark-as-read action", async () => {
    const html = await renderNotifications({ ok: "Marked as read." });
    expect(html).toContain("Marked as read.");
    const failure = await renderNotifications({ error: "That notification is not in this workspace." });
    expect(failure).toContain("not in this workspace");
  });
});

describe("dashboard work widgets", () => {
  it("lists the person's own open work with its due state", async () => {
    state.work = {
      myTasks: [{ id: "t1", title: "Count the shelves", status: "OPEN", dueAt: new Date("2026-10-20T09:00:00.000Z"), overdue: true }],
      summary: { open: 4, overdue: 2, unassigned: 1 },
      approvals: { pending: 0, approved: 0, rejected: 0 },
      unread: 3,
      latest: [notice()],
    };
    const html = await renderHome();
    expect(html).toContain("What needs you today");
    expect(html).toContain("Count the shelves");
    expect(html).toContain("overdue");
    expect(html).toContain(">4<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
  });

  it("links every widget to a screen that exists", async () => {
    state.work = { myTasks: [], summary: { open: 0, overdue: 0, unassigned: 0 }, approvals: { pending: 0, approved: 0, rejected: 0 }, unread: 0, latest: [] };
    const html = await renderHome();
    expect(html).toContain("/dashboard/erp/biz-1/tasks");
    expect(html).toContain("/dashboard/erp/biz-1/notifications");
    expect(html).toContain("/dashboard/erp/biz-1/approvals");
    expect(html).toContain("My work");
  });

  it("shows the approval count the loader read, not a placeholder", async () => {
    state.work = { myTasks: [], summary: { open: 0, overdue: 0, unassigned: 0 }, approvals: { pending: 3, approved: 1, rejected: 0 }, unread: 0, latest: [] };
    const html = await renderHome();
    expect(html).toContain("Waiting approval");
    expect(html).toContain(">3<");
    expect(html).toContain("Decisions needed");
  });
});
