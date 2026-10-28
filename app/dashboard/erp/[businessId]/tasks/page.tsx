import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadTaskBoard } from "@/lib/erp/loaders";
import { Badge, EmptyState, Kpi, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { createTaskAction, updateTaskAction } from "../actions";
import { bucketTasks, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, normalizeTaskStatus, normalizeTaskPriority, isTerminalTaskStatus } from "@/lib/erp/tasks";
import { formatDate } from "@/lib/format";
import { hasErpPermission } from "@/lib/erp/access";

export const dynamic = "force-dynamic";

/**
 * Tasks and work.
 *
 * One board for everything somebody owns: what the automation engine raised, what compliance needs
 * renewed, what a person wrote down. Overdue work is first because that is the only ordering that
 * makes a board useful. Every figure on this page comes from `ErpTask` rows for this business.
 */
export default async function TasksPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const board = await loadTaskBoard(businessId);
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;

  const now = new Date();
  const buckets = bucketTasks(board.tasks, now);
  const canManage = hasErpPermission(workspace.role, "MANAGE_TASKS");

  const renderTask = (task: any) => {
    const status = normalizeTaskStatus(task.status);
    const priority = normalizeTaskPriority(task.priority);
    const overdue = Boolean(task.dueAt) && new Date(task.dueAt).getTime() < now.getTime() && !isTerminalTaskStatus(status);
    return (
      <li key={task.id} style={{ display: "grid", gap: 6, padding: "10px 0", borderBottom: "1px solid var(--erp-line)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong className="erp-small">{task.title}</strong>
          <Badge tone={status === "DONE" ? "good" : status === "CANCELLED" ? "neutral" : overdue ? "bad" : "warn"}>{TASK_STATUS_LABELS[status]}</Badge>
          <Badge tone={priority === "URGENT" || priority === "HIGH" ? "bad" : "neutral"}>{TASK_PRIORITY_LABELS[priority]}</Badge>
          {overdue ? <span className="erp-small erp-muted">Overdue since {formatDate(task.dueAt)}</span> : task.dueAt ? <span className="erp-small erp-muted">Due {formatDate(task.dueAt)}</span> : null}
          {task.sourceType && task.sourceType !== "MANUAL" ? <span className="erp-small erp-muted">· {humanise(task.sourceType)}</span> : null}
        </div>
        {task.detail ? <p className="erp-small erp-muted" style={{ margin: 0 }}>{task.detail}</p> : null}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="erp-small erp-muted">{board.assignees.find((person: any) => person.id === task.assignedTo)?.name ?? (task.assignedRole ? `Any ${humanise(task.assignedRole)}` : "Unassigned")}</span>
          {canManage && !isTerminalTaskStatus(status) ? (
            <>
              <form action={updateTaskAction} style={{ display: "inline" }}>
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="taskId" value={task.id} />
                {status === "OPEN" ? <input type="hidden" name="status" value="IN_PROGRESS" /> : null}
                {status === "IN_PROGRESS" ? <input type="hidden" name="status" value="DONE" /> : null}
                <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">
                  {status === "OPEN" ? "Start" : "Mark done"}
                </button>
              </form>
              {status === "OPEN" ? (
                <form action={updateTaskAction} style={{ display: "inline" }}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="status" value="DONE" />
                  <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Done</button>
                </form>
              ) : null}
              <form action={updateTaskAction} style={{ display: "inline", gap: 6 }}>
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="status" value="CANCELLED" />
                <input name="reason" className="erp-input erp-input-sm" placeholder="Why cancel?" required minLength={3} style={{ width: 150, display: "inline-block", minHeight: 32, padding: "4px 8px" }} />
                <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Cancel</button>
              </form>
            </>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHead
        title="Tasks and work"
        description="Everything somebody in this business owns, soonest due first. Automation raises tasks here; compliance renewals and order follow-ups land on the same board."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-3">
        <Kpi label="Open work" value={String(buckets.overdue.length + buckets.dueToday.length + buckets.upcoming.length + buckets.undated.length)} hint="Not finished and not cancelled" />
        <Kpi label="Overdue" value={String(buckets.overdue.length)} hint={buckets.overdue.length ? "Needs attention today" : "Nothing overdue"} />
        <Kpi label="Done" value={String(buckets.done.length)} hint={`${buckets.cancelled.length} cancelled`} />
      </dl>

      {canManage ? (
        <section className="erp-card">
          <h2>Add a task</h2>
          <form action={createTaskAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <div className="erp-row">
              <div className="erp-field" style={{ flex: "2 1 260px" }}>
                <label className="erp-label" htmlFor="title">What needs doing?</label>
                <input id="title" name="title" className="erp-input" required minLength={3} maxLength={140} placeholder="Renew the fire certificate for the depot" />
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="priority">Priority</label>
                <select id="priority" name="priority" className="erp-input" defaultValue="NORMAL">
                  {TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{TASK_PRIORITY_LABELS[priority]}</option>)}
                </select>
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="dueAt">Due</label>
                <input id="dueAt" name="dueAt" type="date" className="erp-input" />
              </div>
            </div>
            <div className="erp-row">
              <div className="erp-field" style={{ flex: "2 1 260px" }}>
                <label className="erp-label" htmlFor="detail">Detail (optional)</label>
                <input id="detail" name="detail" className="erp-input" maxLength={4000} placeholder="Who to call, what the certificate number is" />
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="assignedTo">Owner</label>
                <select id="assignedTo" name="assignedTo" className="erp-input" defaultValue="">
                  <option value="">Unassigned</option>
                  {board.assignees.map((person: any) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
                <p className="erp-hint">Only people who are members of this business can own work.</p>
              </div>
            </div>
            <button className="erp-btn erp-btn-primary" type="submit">Add task</button>
          </form>
        </section>
      ) : (
        <Notice tone="info">You can see this board, but only a manager, finance lead or staff member can add or change work.</Notice>
      )}

      {buckets.overdue.length ? (
        <section className="erp-card">
          <h2>Overdue</h2>
          <ul className="erp-list">{buckets.overdue.map(renderTask)}</ul>
        </section>
      ) : null}

      <section className="erp-card">
        <h2>Open</h2>
        {buckets.dueToday.length + buckets.upcoming.length + buckets.undated.length === 0 ? (
          <EmptyState glyph="✓" title="No open work">
            <p>Nothing is waiting. Add a task above, or let an automation rule raise one when something needs attention.</p>
          </EmptyState>
        ) : (
          <ul className="erp-list">{[...buckets.dueToday, ...buckets.upcoming, ...buckets.undated].map(renderTask)}</ul>
        )}
      </section>

      <section className="erp-card">
        <h2>Recently finished</h2>
        {buckets.done.length + buckets.cancelled.length === 0 ? (
          <p className="erp-muted erp-small">Nothing has been completed yet. Finished work stays here as evidence of who did what and when.</p>
        ) : (
          <ul className="erp-list">{[...buckets.done, ...buckets.cancelled].slice(0, 20).map(renderTask)}</ul>
        )}
      </section>

      <p className="erp-footer">
        Task changes are recorded in the audit trail with who made them, for every person who works in this business.
      </p>
    </>
  );
}
