import Link from "next/link";
import { notFound } from "next/navigation";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadCampaignDetail } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { calculateSegments } from "@/lib/messaging/segments";
import { Badge, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { approveCampaignAction, campaignLifecycleAction, dispatchCampaignAction, planCampaignAction, testSendAction } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Campaign detail — the review screen.
 *
 * Reviewers see the audience they are about to pay for, each exclusion with its reason, the money
 * already reserved, and what the provider reported. Approval, dispatch and test sends are
 * separate controls because they are separate decisions.
 */
export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; campaignId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { businessId, campaignId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const detail = await loadCampaignDetail(businessId, campaignId);
  if (!detail) notFound();

  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const { campaign, recipients, events, counts } = detail;
  const segments = calculateSegments(campaign.messageBody ?? "");
  const status = String(campaign.status);
  const canPlan = ["DRAFT", "PAUSED", "READY_FOR_REVIEW"].includes(status);
  const canApprove = ["READY_FOR_REVIEW", "PAUSED"].includes(status) && Number(campaign.eligibleRecipients ?? 0) > 0;
  const canSend = ["APPROVED", "SCHEDULED", "DISPATCHING"].includes(status);
  const queued = recipients.filter((recipient: any) => recipient.status === "QUEUED").length;
  const blocked = recipients.filter((recipient: any) => recipient.status === "BLOCKED");

  return (
    <>
      <PageHead
        title={campaign.name}
        description={`${humanise(campaign.channel)} · ${humanise(campaign.purpose)} · created ${new Date(campaign.createdAt).toLocaleDateString("en-KE")}`}
        actions={
          <>
            <Link href={`${base}/messaging`} className="erp-btn erp-btn-secondary erp-btn-sm">All campaigns</Link>
            <Badge tone={StatusTone(campaign.status)}>{humanise(campaign.status)}</Badge>
          </>
        }
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-4">
        <div className="erp-kpi"><dt>Eligible</dt><dd>{Number(campaign.eligibleRecipients ?? 0)}</dd><small>{Number(campaign.totalRecipients ?? 0)} in the audience</small></div>
        <div className="erp-kpi"><dt>Excluded</dt><dd>{Number(campaign.excludedRecipients ?? 0)}</dd><small>Each has a reason below</small></div>
        <div className="erp-kpi"><dt>Estimated</dt><dd>{formatCentsShort(campaign.estimatedCostCents)}</dd><small>{segments.segments} part{segments.segments === 1 ? "" : "s"} per message</small></div>
        <div className="erp-kpi"><dt>Actually charged</dt><dd>{campaign.actualCostCents == null ? "—" : formatCentsShort(campaign.actualCostCents)}</dd><small>{formatCentsShort(campaign.reservedCents)} still reserved</small></div>
      </dl>

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>The message</h2>
          <pre className="erp-mono" style={{ whiteSpace: "pre-wrap", background: "var(--erp-surface-2)", border: "1px solid var(--erp-line)", borderRadius: 10, padding: 12, margin: "10px 0" }}>{campaign.messageBody}</pre>
          <ul className="erp-list">
            <li><span className="erp-muted erp-small">Encoding</span><span className="erp-small erp-strong">{segments.encoding} · {segments.segments} part{segments.segments === 1 ? "" : "s"}</span></li>
            <li><span className="erp-muted erp-small">Sender</span><span className="erp-small erp-strong">{detail.sender ? `${detail.sender.requestedId} (${humanise(detail.sender.status)})` : "None"}</span></li>
            <li><span className="erp-muted erp-small">Template</span><span className="erp-small erp-strong">{detail.template ? detail.template.name : "Written from scratch"}</span></li>
            <li><span className="erp-muted erp-small">Test sent</span><span className="erp-small erp-strong">{campaign.testSentAt ? `${new Date(campaign.testSentAt).toLocaleString("en-KE")} → ${campaign.testSentTo}` : "Not yet"}</span></li>
          </ul>
        </div>

        <div className="erp-card">
          <h2>Next step</h2>
          <p className="erp-card-sub">Each step is separate on purpose. Approval reserves credit; dispatch hands messages to the provider.</p>

          {canPlan ? (
            <form action={planCampaignAction} style={{ marginBottom: 12 }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="campaignId" value={campaign.id} />
              <button type="submit" className="erp-btn erp-btn-secondary erp-btn-wide">
                {status === "READY_FOR_REVIEW" ? "Re-check audience and cost" : "Plan audience and price it"}
              </button>
            </form>
          ) : null}

          {status === "DRAFT" || status === "READY_FOR_REVIEW" ? (
            <form action={testSendAction} style={{ marginBottom: 12 }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="channel" value={campaign.channel} />
              <input type="hidden" name="senderIdId" value={campaign.senderIdId ?? ""} />
              <input type="hidden" name="testBody" value={campaign.messageBody} />
              <label className="erp-label" htmlFor="testTo">Send a test to your own phone</label>
              <input id="testTo" name="testTo" className="erp-input" placeholder="07XXXXXXXX" inputMode="tel" required />
              <p className="erp-hint">A test goes to one number and is prefixed [TEST]. It is not added to the campaign.</p>
              <button type="submit" className="erp-btn erp-btn-secondary erp-btn-wide" style={{ marginTop: 8 }}>Send test</button>
            </form>
          ) : null}

          {canApprove ? (
            <form action={approveCampaignAction}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="campaignId" value={campaign.id} />
              <label className="erp-check">
                <input type="checkbox" name="costConfirmed" value="on" required />
                <span>
                  I have reviewed the {Number(campaign.eligibleRecipients ?? 0)} recipients and I accept the estimated cost of{" "}
                  <strong>{formatCentsShort(campaign.estimatedCostCents)}</strong>. I understand this reserves wallet credit and that
                  provider fees are separate from the KES 3,000 subscription.
                </span>
              </label>
              <button type="submit" className="erp-btn erp-btn-primary erp-btn-wide" style={{ marginTop: 8 }}>Approve campaign</button>
            </form>
          ) : null}

          {canSend ? (
            <form action={dispatchCampaignAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="limit" value="25" />
              <button type="submit" className="erp-btn erp-btn-primary erp-btn-wide" disabled={queued === 0}>
                {queued === 0 ? "Nothing queued" : `Send the next batch (${Math.min(queued, 25)} of ${queued})`}
              </button>
              <p className="erp-hint">Running this again is safe: only messages still queued are claimed. The sandbox provider never reaches a real phone.</p>
            </form>
          ) : null}

          {counts.UNKNOWN ? (
            <form action={dispatchCampaignAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="mode" value="reconcile" />
              <button type="submit" className="erp-btn erp-btn-secondary erp-btn-wide">Reconcile {counts.UNKNOWN} unknown</button>
              <p className="erp-hint">A provider timeout is not proof of non-send. We ask before retrying.</p>
            </form>
          ) : null}

          {["APPROVED", "SCHEDULED", "DISPATCHING", "PAUSED"].includes(status) ? (
            <div className="erp-actions" style={{ marginTop: 12 }}>
              <form action={campaignLifecycleAction}>
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="campaignId" value={campaign.id} />
                <input type="hidden" name="lifecycle" value={status === "PAUSED" ? "resume" : "pause"} />
                <button type="submit" className="erp-btn erp-btn-sm erp-btn-secondary">{status === "PAUSED" ? "Resume" : "Pause"}</button>
              </form>
              <form action={campaignLifecycleAction}>
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="campaignId" value={campaign.id} />
                <input type="hidden" name="lifecycle" value="cancel" />
                <input type="hidden" name="reason" value="Cancelled from the campaign screen." />
                <button type="submit" className="erp-btn erp-btn-sm erp-btn-danger">Cancel campaign</button>
              </form>
            </div>
          ) : null}

          <p className="erp-hint" style={{ marginTop: 12 }}>
            Pausing stops new messages. It cannot recall messages the provider already accepted.
          </p>
        </div>
      </section>

      <section className="erp-card">
        <h2>Recipients</h2>
        <p className="erp-card-sub">{recipients.length} rows · {counts.QUEUED ?? 0} queued · {counts.SUBMITTED ?? 0} submitted · {counts.DELIVERED ?? 0} delivered · {counts.FAILED ?? 0} failed · {counts.UNKNOWN ?? 0} unknown</p>
        {recipients.length === 0 ? (
          <p className="erp-hint">Plan the audience to create recipient rows. A draft has no recipients and costs nothing.</p>
        ) : (
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Number</th>
                  <th>Status</th>
                  <th className="num">Parts</th>
                  <th className="num">Cost</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {recipients.slice(0, 60).map((recipient: any) => (
                  <tr key={recipient.id}>
                    <td>{recipient.name ?? "Contact"}</td>
                    <td className="erp-mono">•••{String(recipient.phoneNormalized).slice(-3)}</td>
                    <td><Badge tone={StatusTone(recipient.status)}>{humanise(recipient.status)}</Badge></td>
                    <td className="num">{Number(recipient.segments ?? 0)}</td>
                    <td className="num">{formatCentsShort(recipient.costCents)}</td>
                    <td className="erp-muted erp-small">{recipient.exclusionReason ?? recipient.failureReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {blocked.length > 0 ? (
          <p className="erp-hint">
            Excluded contacts are kept on the record with their reason, so nobody has to guess why a customer did not receive a message.
          </p>
        ) : null}
      </section>

      <section className="erp-card">
        <h2>Provider events</h2>
        <p className="erp-card-sub">Callbacks are signature-verified and de-duplicated. A repeated callback changes nothing.</p>
        {events.length === 0 ? (
          <p className="erp-hint">No callbacks yet. Delivery updates arrive after messages are handed to the provider.</p>
        ) : (
          <ul className="erp-list">
            {events.map((event: any) => (
              <li key={event.id}>
                <span className="erp-small">{humanise(event.type ?? event.status)}</span>
                <span className="erp-muted erp-small">{new Date(event.receivedAt ?? event.createdAt).toLocaleString("en-KE")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
