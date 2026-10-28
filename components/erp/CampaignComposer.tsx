"use client";

/**
 * Campaign composer.
 *
 * Two things make this honest: the segment/cost figure is computed from the message the customer
 * actually typed (not a saved draft), and the audience count comes from the server, where consent,
 * suppression and permitted hours are evaluated. Nothing here can approve or send.
 */

import { useMemo, useState, useTransition } from "react";
import { calculateSegments, DEFAULT_SMS_TARIFFS } from "@/lib/messaging/segments";
import { formatNumber } from "@/lib/format";

type Option = { id: string; label: string; hint?: string };

type Props = {
  businessId: string;
  action: (formData: FormData) => void;
  templates: Array<{ id: string; name: string; channel: string; category: string; body: string }>;
  senders: Array<{ id: string; requestedId: string; status: string }>;
  channels: Array<{ channel: string; status: string }>;
  contacts: number;
};

type Preview = {
  eligibleCount: number;
  excludedCount: number;
  totalContacts: number;
  estimatedCostCents: number;
  segmentsPerMessage: number;
  encoding: string;
  perSegmentCents: number;
  costNote: string;
  excluded: Array<{ contactId: string; name: string | null; code: string; reason: string }>;
};

const AUDIENCE_MODES: Option[] = [
  { id: "ALL_ELIGIBLE", label: "Everyone eligible", hint: "Contacts with a valid number and permission for this purpose." },
  { id: "TAGS", label: "By tag", hint: "Only contacts carrying the tag you type." },
  { id: "OVERDUE_INVOICES", label: "Customers with overdue invoices", hint: "Uses issued invoices past their due date." },
];

const PURPOSES: Option[] = [
  { id: "MARKETING", label: "Marketing", hint: "Requires recorded marketing consent and an unsubscribe link." },
  { id: "TRANSACTIONAL", label: "Transactional", hint: "Receipts, reminders tied to a transaction. No promotional wording." },
];

export function CampaignComposer({ businessId, action, templates, senders, channels, contacts }: Props) {
  const [channel, setChannel] = useState<"SMS" | "WHATSAPP">("SMS");
  const [purpose, setPurpose] = useState<"MARKETING" | "TRANSACTIONAL">("MARKETING");
  const [audienceMode, setAudienceMode] = useState("ALL_ELIGIBLE");
  const [audienceTags, setAudienceTags] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [senderIdId, setSenderIdId] = useState(senders.find((sender) => sender.status === "ACTIVE")?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const segments = useMemo(() => calculateSegments(body), [body]);
  const rate = DEFAULT_SMS_TARIFFS.find((tariff) => tariff.network === "MULTI")!.perSegmentCents;
  const localCost = channel === "SMS" ? segments.segments * rate : 0;

  const channelActive = channels.find((entry) => entry.channel === channel)?.status === "ACTIVE";
  const activeSender = senders.find((sender) => sender.id === senderIdId);
  const canPrepare = contacts > 0;

  function checkAudience() {
    setPreviewError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/erp/${encodeURIComponent(businessId)}/messaging/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel, purpose, body, audience: { mode: audienceMode, tags: audienceTags.split(",").map((tag) => tag.trim()).filter(Boolean) } }),
        });
        const data = await response.json();
        if (!response.ok) {
          setPreview(null);
          setPreviewError(data?.error ?? "We couldn't check the audience just now.");
          return;
        }
        setPreview(data.preview as Preview);
      } catch {
        setPreview(null);
        setPreviewError("We couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((entry) => entry.id === id);
    if (template) {
      setBody(template.body);
      if (template.channel === "WHATSAPP") setChannel("WHATSAPP");
    }
  }

  return (
    <form action={action} className="erp-grid" style={{ gap: 16 }}>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="audienceMode" value={audienceMode} />
      <input type="hidden" name="audienceTags" value={audienceTags} />
      <input type="hidden" name="templateId" value={templateId} />

      <div className="erp-steps" aria-hidden="true">
        <div className="erp-step" data-active="true" data-done={Boolean(name)}>1. Details</div>
        <div className="erp-step" data-active={Boolean(name)} data-done={Boolean(body)}>2. Message</div>
        <div className="erp-step" data-active={Boolean(body)} data-done={Boolean(preview)}>3. Audience and cost</div>
      </div>

      <section className="erp-card">
        <h2>1. What is this campaign for?</h2>
        <div className="erp-field">
          <label className="erp-label" htmlFor="campaign-name">Campaign name</label>
          <input id="campaign-name" name="name" className="erp-input" placeholder="October restock reminder" maxLength={80} defaultValue={name} onChange={(event) => setName(event.target.value)} required />
          <p className="erp-hint">Only you see this name. It appears in your results and history.</p>
        </div>

        <div className="erp-row">
          <div className="erp-field" style={{ marginBottom: 0 }}>
            <span className="erp-label">Channel</span>
            <div className="erp-actions">
              {(["SMS", "WHATSAPP"] as const).map((value) => (
                <button key={value} type="button" className={channel === value ? "erp-btn erp-btn-sm erp-btn-primary" : "erp-btn erp-btn-sm erp-btn-secondary"} onClick={() => setChannel(value)} aria-pressed={channel === value}>
                  {value === "SMS" ? "SMS" : "WhatsApp"}
                </button>
              ))}
            </div>
            <p className="erp-hint">{channelActive ? "Channel connected." : "Not connected yet — you can still draft and price this campaign."}</p>
          </div>
          <div className="erp-field" style={{ marginBottom: 0 }}>
            <span className="erp-label">Purpose</span>
            <div className="erp-actions">
              {PURPOSES.map((option) => (
                <button key={option.id} type="button" className={purpose === option.id ? "erp-btn erp-btn-sm erp-btn-primary" : "erp-btn erp-btn-sm erp-btn-secondary"} onClick={() => setPurpose(option.id as "MARKETING" | "TRANSACTIONAL")} aria-pressed={purpose === option.id}>
                  {option.label}
                </button>
              ))}
            </div>
            <p className="erp-hint">{PURPOSES.find((option) => option.id === purpose)?.hint}</p>
          </div>
        </div>

        {channel === "SMS" ? (
          <div className="erp-field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label className="erp-label" htmlFor="sender">Sender ID</label>
            <select id="sender" name="senderIdId" className="erp-select" value={senderIdId} onChange={(event) => setSenderIdId(event.target.value)}>
              <option value="">No Sender ID yet</option>
              {senders.map((sender) => (
                <option key={sender.id} value={sender.id}>{sender.requestedId} — {sender.status.toLowerCase().replace(/_/g, " ")}</option>
              ))}
            </select>
            <p className="erp-hint">
              {activeSender
                ? "A branded alphanumeric Sender ID sends one way; replies need WhatsApp or a reply-capable number."
                : "Nothing can send until a Sender ID is active. Drafting is unaffected."}
            </p>
          </div>
        ) : null}
      </section>

      <section className="erp-card">
        <h2>2. The message</h2>
        {templates.length > 0 ? (
          <div className="erp-field">
            <label className="erp-label" htmlFor="template">Start from a saved template</label>
            <select id="template" className="erp-select" value={templateId} onChange={(event) => applyTemplate(event.target.value)}>
              <option value="">Write from scratch</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name} ({template.channel})</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="erp-field">
          <label className="erp-label" htmlFor="body">Message</label>
          <textarea id="body" name="body" className="erp-textarea" value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} required placeholder="Hi {{first_name}}, your order is ready for collection at our shop today. Reply STOP to opt out." />
          <div className="erp-actions" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <span className="erp-hint">
              {segments.segments} {segments.encoding === "GSM7" ? "SMS" : "Unicode SMS"} part{segments.segments === 1 ? "" : "s"} · {segments.charactersRemainingInLastSegment} characters left in the last part
            </span>
            <span className="erp-small erp-strong">{channel === "SMS" ? `About KES ${(localCost / 100).toFixed(2)} per recipient` : "Priced after WhatsApp approval"}</span>
          </div>
          <p className="erp-hint">
            Variables like <code className="erp-inline-code">{"{{first_name}}"}</code> are filled per contact. Marketing messages must include an unsubscribe link.
          </p>
        </div>

        <div className="erp-field" style={{ marginBottom: 0 }}>
          <label className="erp-label" htmlFor="notes">Internal note (optional)</label>
          <input id="notes" name="notes" className="erp-input" placeholder="Approved by the owner on the 12th" maxLength={200} />
        </div>
      </section>

      <section className="erp-card">
        <h2>3. Who receives it, and what it costs</h2>
        <div className="erp-field">
          <span className="erp-label">Audience</span>
          <div className="erp-actions">
            {AUDIENCE_MODES.map((mode) => (
              <button key={mode.id} type="button" className={audienceMode === mode.id ? "erp-btn erp-btn-sm erp-btn-primary" : "erp-btn erp-btn-sm erp-btn-secondary"} onClick={() => setAudienceMode(mode.id)} aria-pressed={audienceMode === mode.id}>
                {mode.label}
              </button>
            ))}
          </div>
          <p className="erp-hint">{AUDIENCE_MODES.find((mode) => mode.id === audienceMode)?.hint}</p>
          {audienceMode === "TAGS" ? (
            <input className="erp-input" placeholder="vip, wholesale" value={audienceTags} onChange={(event) => setAudienceTags(event.target.value)} style={{ marginTop: 8 }} />
          ) : null}
        </div>

        <button type="button" className="erp-btn erp-btn-dark" onClick={checkAudience} disabled={pending || !body}>
          {pending ? "Checking…" : "Check audience and cost"}
        </button>

        {previewError ? <p className="erp-hint" role="alert" style={{ color: "var(--erp-danger)" }}>{previewError}</p> : null}

        {preview ? (
          <div style={{ marginTop: 14 }} aria-live="polite">
            <dl className="erp-grid erp-grid-3">
              <div className="erp-kpi"><dt>Eligible</dt><dd>{preview.eligibleCount}</dd><small>of {preview.totalContacts} contacts</small></div>
              <div className="erp-kpi"><dt>Excluded</dt><dd>{preview.excludedCount}</dd><small>with a reason for each</small></div>
              <div className="erp-kpi"><dt>Estimated cost</dt><dd>KES {formatNumber(preview.estimatedCostCents / 100)}</dd><small>{preview.segmentsPerMessage} part{preview.segmentsPerMessage === 1 ? "" : "s"} at KES {(preview.perSegmentCents / 100).toFixed(2)}</small></div>
            </dl>
            <p className="erp-hint">{preview.costNote}</p>
            {preview.excluded.length > 0 ? (
              <details style={{ marginTop: 8 }}>
                <summary className="erp-small erp-strong" style={{ cursor: "pointer" }}>Why {preview.excludedCount} contacts are excluded</summary>
                <ul className="erp-list" style={{ marginTop: 6 }}>
                  {preview.excluded.slice(0, 12).map((row) => (
                    <li key={row.contactId}>
                      <span className="erp-small">{row.name ?? "Contact"}</span>
                      <span className="erp-muted erp-small" style={{ textAlign: "right", maxWidth: "38ch" }}>{row.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        <p className="erp-hint" style={{ marginTop: 12 }}>
          This saves a draft. Approval — a separate step on the next screen — reserves credit from your wallet. Nothing sends until a batch is dispatched.
        </p>

        <div className="erp-actions" style={{ marginTop: 10 }}>
          <button type="submit" className="erp-btn erp-btn-primary" disabled={!canPrepare}>
            Save draft and review
          </button>
          {!canPrepare ? <span className="erp-hint">Add a customer first — there is nobody to message yet.</span> : null}
        </div>
      </section>
    </form>
  );
}
