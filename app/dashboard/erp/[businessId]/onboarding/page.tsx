import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { Badge, Kpi, Notice, PageHead, humanise } from "@/components/erp/ErpBits";
import { bootstrapWorkspaceAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Guided setup.
 *
 * Mobile-first and honest: every step is derived from a stored fact, never from a "completed" flag
 * the customer ticked. A step that depends on somebody outside the business (a Sender ID review, a
 * channel connection) is shown as waiting, with what can be done in the meantime, instead of
 * blocking the rest of the setup.
 */
export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const base = workspace.basePath;
  const onboarding = workspace.onboarding;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const configured = Boolean(workspace.configuration);

  return (
    <>
      <PageHead
        title="Guided setup"
        description="Twelve short steps, in the order that gets you taking money and reaching customers soonest. Nothing sends or charges until you approve it."
        actions={<Badge tone={onboarding.percent === 100 ? "good" : "lime"}>{onboarding.completed} of {onboarding.total} done</Badge>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-3">
        <Kpi label="Progress" value={`${onboarding.percent}%`} hint={onboarding.headline} />
        <Kpi label="Next step" value={onboarding.nextStep ? humanise(onboarding.nextStep.key) : "Done"} hint={onboarding.nextStep ? onboarding.nextStep.effort : "Review the numbers instead"} />
        <Kpi label="Waiting on others" value={onboarding.waitingExternal ? "Yes" : "No"} hint={onboarding.waitingExternal ? "You can keep working; nothing is blocked" : "Nothing is waiting on a provider"} />
      </dl>

      <div className="erp-progress" role="progressbar" aria-valuenow={onboarding.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
        <span style={{ width: `${onboarding.percent}%` }} />
      </div>

      {!configured ? (
        <section className="erp-card" style={{ marginTop: 16 }}>
          <h2>Create the workspace</h2>
          <p className="erp-card-sub">This creates the chart of accounts, the Kenyan tax rules, a messaging wallet with no credit, and the ERP settings row. It is safe to run once; running it again changes nothing.</p>
          <form action={bootstrapWorkspaceAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <button type="submit" className="erp-btn erp-btn-primary">Create my workspace</button>
          </form>
          <p className="erp-hint">No payment, message or message credit is involved in this step.</p>
        </section>
      ) : null}

      <ol className="erp-steps">
        {onboarding.steps.map((step) => (
          <li key={step.key} className="erp-card" data-active={step.status === "NEXT" ? "true" : undefined} data-done={step.status === "DONE" ? "true" : undefined}>
            <div className="erp-row" style={{ alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span className="erp-step-number" aria-hidden="true">{step.index + 1}</span>
                <div>
                  <h3 style={{ margin: 0 }}>{step.label}</h3>
                  <p className="erp-small erp-muted" style={{ margin: "4px 0 0" }}>{step.description}</p>
                  {step.note ? <p className="erp-hint" style={{ marginTop: 6 }}>{step.note}</p> : null}
                  {step.meanwhile && step.status !== "DONE" ? (
                    <p className="erp-small" style={{ marginTop: 6 }}><strong>While you wait:</strong> {step.meanwhile}</p>
                  ) : null}
                </div>
              </div>
              <Badge tone={step.status === "DONE" ? "good" : step.status === "WAITING" ? "warn" : step.status === "NEXT" ? "lime" : "neutral"}>
                {step.status === "DONE" ? "Done" : step.status === "WAITING" ? "With provider" : step.status === "NEXT" ? "Next" : "To do"}
              </Badge>
            </div>
            <div className="erp-actions" style={{ marginTop: 10, justifyContent: "space-between" }}>
              <span className="erp-hint">{step.effort}</span>
              {step.status === "DONE" ? (
                <Link href={`${base}${step.path.split("#")[0]}`} className="erp-btn erp-btn-ghost erp-btn-sm">Review</Link>
              ) : (
                <Link href={`${base}${step.path.split("#")[0]}`} className={`erp-btn erp-btn-sm ${step.status === "NEXT" ? "erp-btn-primary" : "erp-btn-secondary"}`}>
                  {step.status === "WAITING" ? "Track it" : "Start"}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>

      <Notice tone="info">
        Safety comes before speed: nothing is sent to a customer until a Sender ID is active and a campaign is approved, and no invoice is marked paid from a notification alone. If a step is waiting on a provider, everything else still works.
      </Notice>
    </>
  );
}
