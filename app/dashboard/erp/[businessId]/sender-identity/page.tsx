import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadSenderIdentity } from "@/lib/erp/loaders";
import { Badge, EmptyState, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { SENDER_ID_FEES, kycRequirements, replyCapability, senderIdCanSend } from "@/lib/messaging/senderId";
import { connectSandboxChannelAction, createSenderApplicationAction, recordManualSenderDecisionAction, submitSenderIdAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Sender Identity Centre.
 *
 * The customer sees the whole path: the name they want, the evidence the provider will ask for,
 * the fees (disclosed, not charged), and a timeline of every status change with its source. Nothing
 * here can approve itself, and the two-way limitation of a branded alphanumeric Sender ID is stated
 * where the customer chooses the name — not buried in a help page.
 */
export default async function SenderIdentityPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadSenderIdentity(businessId);
  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const requirements = kycRequirements("SMS");
  const primary = data.primary;
  const canSend = senderIdCanSend(primary);
  const reply = primary ? replyCapability({ replyCapable: primary.replyCapable, channel: primary.channel }) : null;
  const profileComplete = Boolean(data.configuration?.legalName && data.configuration?.kraPin);
  const nextStatus = primary ? nextStatusFor(String(primary.status)) : null;

  return (
    <>
      <PageHead
        title="Sender Identity Centre"
        description="Apply for the name customers see on their phone, upload the evidence, and follow the provider's decision."
        actions={<Badge tone={canSend.ok ? "good" : "warn"}>{canSend.ok ? "Ready to send" : "Not sending yet"}</Badge>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      {!profileComplete ? (
        <Notice tone="warn" action={{ href: `${base}/settings#business`, label: "Complete profile" }}>
          Add your legal name and KRA PIN before submitting an application. Providers reject incomplete submissions, and we will not invent the missing details.
        </Notice>
      ) : null}

      {primary ? (
        <section className="erp-card">
          <div className="erp-page-head">
            <div>
              <h2 style={{ marginBottom: 2 }}>{primary.requestedId}</h2>
              <p className="erp-card-sub" style={{ marginBottom: 0 }}>
                {humanise(primary.network)} · {humanise(primary.purpose)} · {primary.channel === "WHATSAPP" ? "WhatsApp" : "SMS"} · applied {new Date(primary.createdAt).toLocaleDateString("en-KE")}
              </p>
            </div>
            <Badge tone={StatusTone(primary.status)}>{humanise(primary.status)}</Badge>
          </div>

          <ul className="erp-list" style={{ marginTop: 12 }}>
            <li><span className="erp-muted erp-small">Application reference</span><span className="erp-mono">{primary.applicationRef ?? "Not submitted"}</span></li>
            <li><span className="erp-muted erp-small">Can send today</span><span className="erp-small">{canSend.reason}</span></li>
            <li><span className="erp-muted erp-small">Replies</span><span className="erp-small" style={{ maxWidth: "52ch", textAlign: "right" }}>{reply?.note}</span></li>
            <li><span className="erp-muted erp-small">Fees</span><span className="erp-small">{primary.feeAcknowledgedAt ? `Acknowledged ${new Date(primary.feeAcknowledgedAt).toLocaleDateString("en-KE")}` : "Not acknowledged"}</span></li>
          </ul>

          {primary.missingItemsJson && primary.missingItemsJson !== "[]" ? (
            <Notice tone="warn">
              <strong>The provider needs more information.</strong> Please supply: {data.missingItems.join(", ") || "the items listed in the timeline"}.
            </Notice>
          ) : null}

          {String(primary.status) === "DRAFT" || String(primary.status) === "INFORMATION_REQUIRED" || String(primary.status) === "CHANGES_REQUESTED" ? (
            <form action={submitSenderIdAction} style={{ marginTop: 16 }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="senderIdId" value={primary.id} />
              <h3>Submit with the required evidence</h3>
              <p className="erp-hint">Tick each item you have supplied. This records your declaration; documents are stored against the application and are not sent anywhere until a provider is connected.</p>
              {requirements.map((requirement) => (
                <label key={requirement.key} className="erp-check">
                  <input type="checkbox" name={`kyc_${requirement.key}`} value="on" required={requirement.required} />
                  <span>
                    <strong>{requirement.label}</strong>
                    <br />
                    <span className="erp-muted erp-small">{requirement.explanation}</span>
                  </span>
                </label>
              ))}
              <div className="erp-field" style={{ marginTop: 12 }}>
                <span className="erp-label">Fees, disclosed before you confirm</span>
                <ul className="erp-list">
                  {SENDER_ID_FEES.map((fee) => (
                    <li key={fee.code}>
                      <span className="erp-small">{fee.label}</span>
                      <span className="erp-small erp-strong">KES {(fee.amountCents / 100).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                <p className="erp-hint">{SENDER_ID_FEES[0].note}</p>
                <label className="erp-check">
                  <input type="checkbox" name="feeAcknowledged" value="on" required />
                  <span>I understand the provider may charge a registration fee, and that it is separate from the KES 3,000 ERP subscription.</span>
                </label>
              </div>
              <button type="submit" className="erp-btn erp-btn-primary">Submit application</button>
              <p className="erp-hint">Submitting is not approval. Status changes only when the provider tells us.</p>
            </form>
          ) : null}

          {nextStatus === "UNDER_REVIEW" || nextStatus === "APPROVED" ? (
            <div className="erp-notice" style={{ marginTop: 14 }}>
              <div>
                <strong>What happens next.</strong> Your application is with the provider. You can keep preparing campaigns; sending stays switched off until the status here says Active. This page never simulates an approval.
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="erp-card">
          <h2>Apply for your Sender ID</h2>
          <p className="erp-card-sub">3 to 11 letters and numbers. Choose the brand your customers will recognise.</p>
          <form action={createSenderApplicationAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <div className="erp-row">
              <div className="erp-field">
                <label className="erp-label" htmlFor="requestedId">Sender ID</label>
                <input id="requestedId" name="requestedId" className="erp-input" minLength={3} maxLength={11} pattern="[A-Za-z0-9]{3,11}" placeholder="NYUMBANI" required />
                <p className="erp-hint">No spaces. Names reserved for regulators, networks or other brands are refused.</p>
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="network">Network</label>
                <select id="network" name="network" className="erp-select" defaultValue="MULTI">
                  <option value="MULTI">All networks</option>
                  <option value="SAFARICOM">Safaricom</option>
                  <option value="AIRTEL">Airtel</option>
                  <option value="TELKOM">Telkom</option>
                </select>
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="purpose">Main use</label>
                <select id="purpose" name="purpose" className="erp-select" defaultValue="TRANSACTIONAL">
                  <option value="TRANSACTIONAL">Transactional (receipts, reminders)</option>
                  <option value="MARKETING">Marketing (offers, launches)</option>
                  <option value="BOTH">Both</option>
                </select>
              </div>
            </div>
            <div className="erp-notice" data-tone="warn" style={{ marginBottom: 14 }}>
              <div>
                <strong>A branded alphanumeric Sender ID sends one way.</strong> Customers cannot reply to it. For two-way conversations, connect
                WhatsApp Business or a reply-capable number. Nothing in this workspace automates the personal WhatsApp app.
              </div>
            </div>
            <button type="submit" className="erp-btn erp-btn-primary">Save the draft</button>
            <p className="erp-hint">Saving a draft is not a submission and does not reserve the name.</p>
          </form>
        </section>
      )}

      <section className="erp-card" id="channels">
        <h2>Sending channels</h2>
        <p className="erp-card-sub">A channel must be connected and active before anything sends. The sandbox connector never reaches a real phone.</p>
        <div className="erp-table-wrap">
          <table className="erp-table">
            <thead>
              <tr><th>Channel</th><th>Provider</th><th>Status</th><th>Last checked</th><th /></tr>
            </thead>
            <tbody>
              {data.connections.length === 0 ? (
                <tr><td colSpan={5} className="erp-muted">No channels configured yet.</td></tr>
              ) : null}
              {data.connections.map((connection: any) => (
                <tr key={connection.id}>
                  <td className="erp-strong">{humanise(connection.channel)}</td>
                  <td>{connection.provider}</td>
                  <td><Badge tone={StatusTone(connection.status)}>{humanise(connection.status)}</Badge></td>
                  <td className="erp-small erp-muted">{connection.lastCheckedAt ? new Date(connection.lastCheckedAt).toLocaleString("en-KE") : "Never"}</td>
                  <td className="num">
                    <form action={connectSandboxChannelAction}>
                      <input type="hidden" name="businessId" value={businessId} />
                      <input type="hidden" name="channel" value={connection.channel} />
                      <button type="submit" className="erp-btn erp-btn-sm erp-btn-secondary">
                        {String(connection.status) === "ACTIVE" ? "Re-test sandbox" : "Connect sandbox"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="erp-hint" style={{ marginTop: 10 }}>
          Connecting the sandbox proves the queue, cost estimate and status model work. It is not a live provider and the UI says so everywhere results appear.
        </p>
      </section>

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>Application history</h2>
          <p className="erp-card-sub">Every status change with who caused it. Provider events are labelled as provider events.</p>
          {data.events.length === 0 ? (
            <p className="erp-hint">No history yet.</p>
          ) : (
            <ul className="erp-list">
              {data.events.map((event: any) => (
                <li key={event.id}>
                  <div>
                    <div className="erp-strong">{humanise(event.type)}</div>
                    <div className="erp-muted erp-small">{event.note ?? `${humanise(event.fromStatus)} → ${humanise(event.toStatus)}`}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Badge tone={event.source === "PROVIDER" ? "good" : "neutral"}>{humanise(event.source)}</Badge>
                    <div className="erp-muted erp-small">{new Date(event.createdAt).toLocaleString("en-KE")}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="erp-card">
          <h2>Evidence on file</h2>
          <p className="erp-card-sub">Only metadata is listed here. Document contents stay access-restricted.</p>
          {data.documents.length === 0 ? (
            <EmptyState glyph="▤" title="No documents uploaded">Uploads are disabled until secure storage is configured. The declaration you tick on submission is recorded instead.</EmptyState>
          ) : (
            <ul className="erp-list">
              {data.documents.map((document: any) => (
                <li key={document.id}>
                  <span className="erp-small">{humanise(document.kind)}</span>
                  <Badge tone={StatusTone(document.status)}>{humanise(document.status)}</Badge>
                </li>
              ))}
            </ul>
          )}

          {workspace.role === "ADMIN" && process.env.NODE_ENV !== "production" ? (
            <form action={recordManualSenderDecisionAction} style={{ marginTop: 14 }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="senderIdId" value={primary?.id ?? ""} />
              <h3>Manual review (platform staff only)</h3>
              <p className="erp-hint">Disabled unless ERP_ALLOW_MANUAL_SENDER_REVIEW=true. Recorded as MANUAL, never as a provider event.</p>
              <select name="status" className="erp-select" defaultValue="UNDER_REVIEW" aria-label="Manual decision">
                <option value="UNDER_REVIEW">Under review</option>
                <option value="APPROVED">Approved</option>
                <option value="ACTIVE">Activated</option>
                <option value="REJECTED">Rejected</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
              <input name="note" className="erp-input" placeholder="Why? (required)" style={{ marginTop: 8 }} />
              <button type="submit" className="erp-btn erp-btn-secondary erp-btn-wide" style={{ marginTop: 8 }}>Record decision</button>
            </form>
          ) : null}
        </div>
      </section>
    </>
  );
}

function nextStatusFor(status: string): string | null {
  const map: Record<string, string> = {
    DRAFT: "SUBMITTED",
    INFORMATION_REQUIRED: "SUBMITTED",
    SUBMITTED: "UNDER_REVIEW",
    UNDER_REVIEW: "APPROVED",
    APPROVED: "ACTIVE",
    ACTIVE: "ACTIVE",
  };
  return map[status] ?? null;
}
