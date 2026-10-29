import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadMessagingOverview } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { Badge, EmptyState, Kpi, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { SENDER_STATUS_LABELS } from "@/lib/messaging/senderId";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Messaging overview.
 *
 * Campaign list plus the truth about the wallet: available credit is balance minus reservations,
 * delivery is what the provider reported, and "unknown" is shown rather than rounded down to zero.
 */
export default async function MessagingPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const overview = await loadMessagingOverview(businessId);
  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const sms = overview.connections.find((connection: any) => connection.channel === "SMS");
  const sender = overview.senders.find((row: any) => String(row.status) === "ACTIVE") ?? overview.senders[0] ?? null;
  const canSend = Boolean(sender && String(sender.status) === "ACTIVE" && sms && String(sms.status) === "ACTIVE");

  return (
    <>
      <PageHead
        title="Business messaging"
        description="SMS and WhatsApp campaigns with a durable queue, consent checks, cost estimates and provider-reported results."
        actions={
          <>
            <Link href={`${base}/customers`} className="erp-btn erp-btn-secondary erp-btn-sm">Customers</Link>
            <Link href={`${base}/sender-identity`} className="erp-btn erp-btn-secondary erp-btn-sm">Sender ID</Link>
            <Link href={`${base}/messaging/new`} className="erp-btn erp-btn-primary erp-btn-sm">New campaign</Link>
          </>
        }
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      {!canSend ? (
        <Notice
          tone="warn"
          action={{ href: `${base}/sender-identity`, label: "Set up sending" }}
        >
          <strong>You can prepare, but not send yet.</strong>{" "}
          {sender ? `Your Sender ID ${sender.requestedId} is ${SENDER_STATUS_LABELS[sender.status as keyof typeof SENDER_STATUS_LABELS] ?? humanise(sender.status)}.` : "You have no Sender ID yet."}{" "}
          {sms ? `SMS connection: ${humanise(sms.status)}.` : "No SMS provider is connected."} Drafts and cost estimates work normally.
        </Notice>
      ) : null}

      <dl className="erp-grid erp-grid-4">
        <Kpi label="Wallet available" value={formatCentsShort(overview.wallet.availableCents)} hint={`${formatCentsShort(overview.wallet.reservedCents)} reserved`} />
        <Kpi label="Delivered" value={String(overview.stats.delivered)} hint={`${overview.stats.failed} failed · ${overview.stats.unknown} unknown`} />
        <Kpi label="Contacts" value={String(overview.contacts)} hint={`${overview.audiences.length} saved audience${overview.audiences.length === 1 ? "" : "s"}`} />
        <Kpi label="Segments sent" value={String(overview.stats.segments)} hint="Each part is billed separately" />
      </dl>

      <section className="erp-card">
        <div className="erp-page-head">
          <div>
            <h2 style={{ marginBottom: 2 }}>Campaigns</h2>
            <p className="erp-card-sub" style={{ marginBottom: 0 }}>
              Draft → review → approved → dispatching. Nothing sends from a draft, and pausing stops new messages without recalling what the provider already accepted.
            </p>
          </div>
        </div>

        {overview.campaigns.length === 0 ? (
          <div style={{ marginTop: 14 }}>
            <EmptyState glyph="✉" title="No campaigns yet" action={{ href: `${base}/messaging/new`, label: "Draft a campaign" }}>
              You&apos;ll see the exact audience, the exclusions with reasons, and the estimated cost before approving anything.
            </EmptyState>
          </div>
        ) : (
          <div className="erp-table-wrap" style={{ marginTop: 14 }}>
            <table className="erp-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Channel / purpose</th>
                  <th>Status</th>
                  <th className="num">Eligible</th>
                  <th className="num">Excluded</th>
                  <th className="num">Estimated</th>
                  <th className="num">Actual</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overview.campaigns.map((campaign: any) => (
                  <tr key={campaign.id}>
                    <td>
                      <div className="erp-strong">{campaign.name}</div>
                      <div className="erp-muted erp-small">{formatDate(campaign.createdAt)}</div>
                    </td>
                    <td>{humanise(campaign.channel)}<div className="erp-muted erp-small">{humanise(campaign.purpose)}</div></td>
                    <td><Badge tone={StatusTone(campaign.status)}>{humanise(campaign.status)}</Badge></td>
                    <td className="num">{Number(campaign.eligibleRecipients ?? 0)}</td>
                    <td className="num">{Number(campaign.excludedRecipients ?? 0)}</td>
                    <td className="num">{formatCentsShort(campaign.estimatedCostCents)}</td>
                    <td className="num">{campaign.actualCostCents == null ? "—" : formatCentsShort(campaign.actualCostCents)}</td>
                    <td className="num"><Link href={`${base}/messaging/${campaign.id}`} className="erp-small erp-strong">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="erp-grid erp-grid-2">
        <div className="erp-card">
          <h2>Channels</h2>
          <p className="erp-card-sub">A channel must be connected and active before a message can leave. Sandbox connections never reach a real phone.</p>
          <ul className="erp-list">
            {overview.connections.length === 0 ? <li><span className="erp-muted">No channels configured yet.</span></li> : null}
            {overview.connections.map((connection: any) => (
              <li key={connection.id}>
                <div>
                  <div className="erp-strong">{humanise(connection.channel)}</div>
                  <div className="erp-muted erp-small">Provider: {connection.provider}</div>
                </div>
                <Badge tone={StatusTone(connection.status)}>{humanise(connection.status)}</Badge>
              </li>
            ))}
          </ul>
          <Link href={`${base}/sender-identity#channels`} className="erp-btn erp-btn-sm erp-btn-secondary" style={{ marginTop: 12 }}>Manage channels</Link>
        </div>

        <div className="erp-card">
          <h2>Templates</h2>
          <p className="erp-card-sub">Reusable wording with approved variables. WhatsApp messages require an approved template.</p>
          <ul className="erp-list">
            {overview.templates.slice(0, 6).map((template: any) => (
              <li key={template.id}>
                <div>
                  <div className="erp-strong">{template.name}</div>
                  <div className="erp-muted erp-small">{template.category} · v{template.version}</div>
                </div>
                <Badge tone="neutral">{template.channel}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="erp-card">
        <h2>What these numbers mean</h2>
        <ul className="erp-list">
          <li><span>Delivered</span><span className="erp-muted erp-small" style={{ maxWidth: "60ch", textAlign: "right" }}>The provider confirmed handset delivery. It does not mean the message was read or acted on.</span></li>
          <li><span>Unknown</span><span className="erp-muted erp-small" style={{ maxWidth: "60ch", textAlign: "right" }}>The provider timed out. We reconcile before retrying — a timeout is not proof that nothing was sent.</span></li>
          <li><span>Estimated cost</span><span className="erp-muted erp-small" style={{ maxWidth: "60ch", textAlign: "right" }}>Calculated from message parts and the configured reference tariff. Your provider invoice is authoritative.</span></li>
        </ul>
      </section>
    </>
  );
}
