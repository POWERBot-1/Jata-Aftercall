import { randomUUID } from "node:crypto";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadAutomation } from "@/lib/erp/loaders";
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, STARTER_RULES } from "@/lib/erp/automation";
import { Badge, EmptyState, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { createAutomationRuleAction, runAutomationRuleAction, toggleAutomationRuleAction } from "../actions";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Automation rules.
 *
 * A rule is created inactive, must pass validation, and runs in preview unless a person asks for it
 * to execute. High-impact actions are listed as not available rather than silently dropped, so the
 * catalogue never over-promises.
 */
export default async function AutomationPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadAutomation(businessId);
  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const implemented = AUTOMATION_ACTIONS.filter((action) => action.implemented);

  return (
    <>
      <PageHead
        title="Automation rules"
        description="When this happens, if these conditions hold, do that — with an approval step for anything that spends money or contacts customers."
        actions={<Badge tone="neutral">{data.rules.filter((rule: any) => rule.status === "ACTIVE").length} active</Badge>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <Notice tone="info">
        Execution is bounded: each rule has a daily run limit, runs are idempotent per event, and the platform safety switch pauses every rule when it is on.
      </Notice>

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>Your rules</h2>
          {data.rules.length === 0 ? (
            <EmptyState glyph="⚙" title="No rules yet">Start with one of the presets below, or create your own. A rule is a draft until you activate it.</EmptyState>
          ) : (
            <ul className="erp-list">
              {data.rules.map((rule: any) => (
                <li key={rule.id}>
                  <div>
                    <div className="erp-strong">{rule.name}</div>
                    <div className="erp-muted erp-small">{humanise(rule.trigger)} · {rule.requiresApproval ? "needs approval" : "no approval"} · limit {rule.maxRunsPerDay}/day</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    <Badge tone={StatusTone(rule.status)}>{humanise(rule.status)}</Badge>
                    <div className="erp-actions">
                      <form action={toggleAutomationRuleAction}>
                        <input type="hidden" name="businessId" value={businessId} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="state" value={rule.status === "ACTIVE" ? "paused" : "active"} />
                        <button type="submit" className="erp-btn erp-btn-sm erp-btn-secondary">{rule.status === "ACTIVE" ? "Pause" : "Activate"}</button>
                      </form>
                      <form action={runAutomationRuleAction}>
                        <input type="hidden" name="businessId" value={businessId} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="mode" value="preview" />
                        <input type="hidden" name="requestKey" value={randomUUID()} />
                        <input type="hidden" name="quantity" value="3" />
                        <input type="hidden" name="productName" value="Sample item" />
                        <input type="hidden" name="orderTotal" value="2500" />
                        <input type="hidden" name="daysOverdue" value="14" />
                        <button type="submit" className="erp-btn erp-btn-sm erp-btn-primary">Preview run</button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="erp-card">
          <h2>Run history</h2>
          <p className="erp-card-sub">Previews are recorded separately from executions.</p>
          {data.runs.length === 0 ? (
            <p className="erp-hint">No runs yet.</p>
          ) : (
            <ul className="erp-list">
              {data.runs.slice(0, 15).map((run: any) => (
                <li key={run.id}>
                  <div>
                    <div className="erp-strong">{humanise(run.trigger)}</div>
                    <div className="erp-muted erp-small">{formatDateTime(run.startedAt ?? run.createdAt)}</div>
                  </div>
                  <Badge tone={StatusTone(run.status)}>{humanise(run.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="erp-card">
        <h2>Create a rule</h2>
        <form action={createAutomationRuleAction}>
          <input type="hidden" name="businessId" value={businessId} />
          <div className="erp-row">
            <div className="erp-field" style={{ flex: "2 1 260px" }}>
              <label className="erp-label" htmlFor="name">Rule name</label>
              <input id="name" name="name" className="erp-input" required minLength={3} placeholder="Tell me when stock runs low" />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="trigger">When</label>
              <select id="trigger" name="trigger" className="erp-select" defaultValue="LOW_STOCK">
                {AUTOMATION_TRIGGERS.map((trigger) => (
                  <option key={trigger.key} value={trigger.key}>{trigger.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="erp-row">
            <div className="erp-field">
              <label className="erp-label" htmlFor="conditionField">Only if</label>
              <select id="conditionField" name="conditionField" className="erp-select" defaultValue="">
                <option value="">No extra condition</option>
                <option value="quantity">Quantity</option>
                <option value="orderTotalCents">Order total (cents)</option>
                <option value="daysOverdue">Days overdue</option>
              </select>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="conditionOperator">is</label>
              <select id="conditionOperator" name="conditionOperator" className="erp-select" defaultValue="lte">
                <option value="lte">at most</option>
                <option value="gte">at least</option>
                <option value="eq">exactly</option>
              </select>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="conditionValue">value</label>
              <input id="conditionValue" name="conditionValue" className="erp-input" inputMode="numeric" placeholder="5" />
            </div>
          </div>

          <div className="erp-row">
            <div className="erp-field">
              <label className="erp-label" htmlFor="actionType">Then</label>
              <select id="actionType" name="actionType" className="erp-select" defaultValue="NOTIFY">
                {implemented.map((action) => (
                  <option key={action.key} value={action.key}>{action.label}</option>
                ))}
              </select>
              <p className="erp-hint">Only actions that work are listed. Actions needing a provider or a second approval are marked “not available yet” in the catalogue below.</p>
            </div>
            <div className="erp-field" style={{ flex: "2 1 260px" }}>
              <label className="erp-label" htmlFor="actionTitle">Notification title</label>
              <input id="actionTitle" name="actionTitle" className="erp-input" placeholder="Stock is low" maxLength={80} />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="maxRunsPerDay">Daily limit</label>
              <input id="maxRunsPerDay" name="maxRunsPerDay" className="erp-input" type="number" min="1" max="200" defaultValue="50" />
            </div>
          </div>

          <div className="erp-field">
            <label className="erp-label" htmlFor="actionMessage">Notification body</label>
            <input id="actionMessage" name="actionMessage" className="erp-input" placeholder="A product reached its reorder level." maxLength={200} />
          </div>

          <label className="erp-check">
            <input type="checkbox" name="requiresApproval" value="on" defaultChecked />
            <span>A person must approve before a high-impact action runs.</span>
          </label>

          <button type="submit" className="erp-btn erp-btn-primary">Save as draft</button>
        </form>
      </section>

      <section className="erp-card">
        <h2>Presets and the catalogue</h2>
        <p className="erp-card-sub">Presets are examples, not switched-on rules. The catalogue below is the honest status of each action.</p>
        <div className="erp-grid erp-grid-2">
          <div>
            <h3>Starter presets</h3>
            <ul className="erp-list">
              {STARTER_RULES.map((rule) => (
                <li key={rule.name}>
                  <div>
                    <div className="erp-strong">{rule.name}</div>
                    <div className="erp-muted erp-small">{humanise(rule.trigger)} · {rule.actions.map((action) => humanise(action.type)).join(", ")}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Action status</h3>
            <ul className="erp-list">
              {AUTOMATION_ACTIONS.map((action) => (
                <li key={action.key}>
                  <span className="erp-small">{action.label}</span>
                  <Badge tone={action.implemented ? "good" : "neutral"}>{action.implemented ? "Available" : "Not yet"}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
