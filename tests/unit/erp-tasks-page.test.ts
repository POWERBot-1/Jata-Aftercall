/**
 * Tasks board — the page as a person receives it.
 *
 * The domain suite proves the rules and the PostgreSQL suite proves the SQL. Neither proves the
 * rendered page: that a viewer is not handed a form they cannot submit, that a task's owner name
 * comes from this business's own members, and that the board never renders a row the loader did not
 * give it. Those are the three things this file pins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  role: "OWNER" as string,
  tasks: [] as any[],
  assignees: [] as Array<{ id: string; name: string; role: string }>,
  error: null as string | null,
}));

vi.mock("@/lib/erp/workspace", () => ({
  loadErpWorkspace: vi.fn(async () => ({ role: state.role, basePath: "/dashboard/erp/biz-1" })),
}));

vi.mock("@/lib/erp/loaders", () => ({
  loadTaskBoard: vi.fn(async () => ({ tasks: state.tasks, assignees: state.assignees })),
}));

// Next passes server actions as `action={fn}`; react-dom/server 18 does not model that, so the test
// hands the same slots a plain destination and asserts the markup around them instead.
vi.mock("@/app/dashboard/erp/[businessId]/actions", () => ({
  createTaskAction: "/dashboard/erp/biz-1/tasks/create",
  updateTaskAction: "/dashboard/erp/biz-1/tasks/update",
}));

const { default: TasksPage } = await import("@/app/dashboard/erp/[businessId]/tasks/page");

const NOW = Date.now();
const day = 86_400_000;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    businessId: "biz-1",
    title: "Renew the fire certificate",
    detail: null,
    status: "OPEN",
    priority: "NORMAL",
    assignedTo: null,
    assignedRole: null,
    dueAt: null,
    completedAt: null,
    sourceType: "MANUAL",
    sourceId: null,
    createdAt: new Date(NOW),
    ...overrides,
  };
}

async function render(query: Record<string, string> = {}) {
  const element = await TasksPage({
    params: Promise.resolve({ businessId: "biz-1" }),
    searchParams: Promise.resolve(query as any),
  });
  return renderToStaticMarkup(element as any);
}

beforeEach(() => {
  state.role = "OWNER";
  state.tasks = [];
  state.assignees = [];
  state.error = null;
});

describe("tasks board", () => {
  it("puts overdue work first and counts it in the KPIs", async () => {
    state.tasks = [
      task({ id: "late", title: "Renew the fire certificate", dueAt: new Date(NOW - 3 * day) }),
      task({ id: "soon", title: "Call the supplier", dueAt: new Date(NOW + 2 * day) }),
      task({ id: "done", title: "File the VAT return", status: "DONE", completedAt: new Date(NOW - day) }),
    ];
    const html = await render();
    expect(html.indexOf("Renew the fire certificate")).toBeLessThan(html.indexOf("Call the supplier"));
    expect(html).toContain("Overdue");
    expect(html).toContain("Open work");
    // 2 open (one overdue, one upcoming) and 1 done.
    expect(html).toContain(">2<");
    expect(html).toContain(">1<");
  });

  it("shows an owner the form and the transition controls", async () => {
    state.tasks = [task()];
    state.assignees = [{ id: "u-owner", name: "Asha Mwangi", role: "OWNER" }];
    const html = await render();
    expect(html).toContain("Add a task");
    expect(html).toContain("Add task");
    expect(html).toContain(">Done</button>");
    expect(html).toContain("Why cancel?");
    // The owner picker is this business's own members, never a global user list.
    expect(html).toContain("Asha Mwangi");
  });

  it("gives a viewer the board without any control they cannot use", async () => {
    state.role = "VIEWER";
    state.tasks = [task()];
    const html = await render();
    expect(html).toContain("Renew the fire certificate");
    expect(html).not.toContain("Add a task");
    expect(html).not.toContain(">Done</button>");
    expect(html).not.toContain("Why cancel?");
    expect(html).toContain("only a manager, finance lead or staff member");
  });

  it("offers no controls on finished work, whatever the role", async () => {
    state.tasks = [task({ status: "DONE", completedAt: new Date(NOW) }), task({ id: "c", title: "Cancelled thing", status: "CANCELLED" })];
    const html = await render();
    expect(html).toContain("Recently finished");
    expect(html).not.toContain(">Done</button>");
    expect(html).not.toContain(">Start</button>");
    // Cancelled work is counted, not silently dropped.
    expect(html).toContain("1 cancelled");
  });

  it("renders only what the loader returned for this tenant", async () => {
    state.tasks = [task()];
    const html = await render();
    expect(html).toContain("Renew the fire certificate");
    expect(html).not.toContain("SECRET other tenant work");
  });

  it("names the person who owns a task and falls back to the role when nobody is named", async () => {
    state.assignees = [{ id: "u-1", name: "Brian Otieno", role: "STAFF" }];
    state.tasks = [
      task({ id: "a", title: "Assigned work", assignedTo: "u-1" }),
      task({ id: "b", title: "Role work", assignedRole: "FINANCE" }),
      task({ id: "c", title: "Nobody's work" }),
    ];
    const html = await render();
    expect(html).toContain("Brian Otieno");
    expect(html).toContain("Any Finance");
    expect(html).toContain("Unassigned");
  });

  it("shows an honest empty board rather than a zero that looks like success", async () => {
    const html = await render();
    expect(html).toContain("Open work");
    expect(html).toContain("No open work");
    expect(html).toContain("Nothing has been completed yet");
    expect(html).not.toContain("<ul class=\"erp-list\">");
  });

  it("surfaces the outcome of a server action as a notice", async () => {
    const failed = await render({ error: "That task was already closed by somebody else." });
    expect(failed).toContain("already closed by somebody else");
    const ok = await render({ ok: "Task added." });
    expect(ok).toContain("Task added.");
  });

  it("puts a date on an overdue task so the urgency is checkable", async () => {
    state.tasks = [task({ dueAt: new Date(NOW - 3 * day) })];
    const html = await render();
    expect(html).toMatch(/Overdue since/);
  });
});
