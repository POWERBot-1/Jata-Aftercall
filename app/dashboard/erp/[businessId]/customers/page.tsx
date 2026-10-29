import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadContacts } from "@/lib/erp/loaders";
import { Badge, EmptyState, Kpi, Notice, PageHead } from "@/components/erp/ErpBits";
import { addContactAction, importContactsAction, recordConsentAction, suppressContactAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Customers and contacts.
 *
 * One list, with the consent state visible per person. Importing a spreadsheet never invents
 * consent: the consent column and its source must both be present, and the preview explains every
 * rejection before anything is written.
 */
export default async function CustomersPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadContacts(businessId);
  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const consented = data.contacts.filter((contact: any) => contact.marketingConsent.marketingSms).length;

  return (
    <>
      <PageHead
        title="Customers"
        description="Contacts, marketing consent and exclusions. A phone number on its own is never permission to market."
        actions={<Link href={`${base}/messaging/new`} className="erp-btn erp-btn-primary erp-btn-sm">New campaign</Link>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-4">
        <Kpi label="Contacts" value={String(data.contacts.length)} hint={`${data.customers.length} linked POS customers`} />
        <Kpi label="Marketing consent" value={String(consented)} hint="SMS, granted and sourced" />
        <Kpi label="Suppressed" value={String(data.suppressionCount)} hint="Opt-outs and complaints" />
        <Kpi label="Consent records" value={String(data.consentCount)} hint="Every grant and withdrawal kept" />
      </dl>

      <section className="erp-grid erp-grid-2">
        <div className="erp-card">
          <h2>Import a customer list</h2>
          <p className="erp-card-sub">CSV with a phone column. Add a consent column and its source to record permission — otherwise contacts are imported without marketing consent.</p>
          <form action={importContactsAction} encType="multipart/form-data">
            <input type="hidden" name="businessId" value={businessId} />
            <div className="erp-field">
              <label className="erp-label" htmlFor="file">CSV file</label>
              <input id="file" name="file" type="file" accept=".csv,text/csv" className="erp-input" />
              <p className="erp-hint">
                <a href="/erp/contacts-template.csv" download>Download the template</a> — it shows the consent wording we expect.
              </p>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="csv">…or paste rows</label>
              <textarea id="csv" name="csv" className="erp-textarea" placeholder={"name,phone,tags,consent,consent source\nJane Wanjiku,0712345678,VIP,yes,Shop sign-up form v2"} />
            </div>
            <button type="submit" className="erp-btn erp-btn-dark">Import contacts</button>
          </form>
        </div>

        <div className="erp-card">
          <h2>Add one customer</h2>
          <form action={addContactAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <div className="erp-field">
              <label className="erp-label" htmlFor="name">Name</label>
              <input id="name" name="name" className="erp-input" required minLength={2} />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="phone">Phone</label>
              <input id="phone" name="phone" className="erp-input" inputMode="tel" placeholder="07XXXXXXXX" required />
              <p className="erp-hint">Kenyan mobile numbers in any common format. We store one canonical number per business.</p>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="tags">Tags (comma separated)</label>
              <input id="tags" name="tags" className="erp-input" placeholder="vip, wholesale" />
            </div>
            <label className="erp-check">
              <input type="checkbox" name="marketingConsent" value="on" />
              <span>This customer agreed to receive marketing messages.</span>
            </label>
            <div className="erp-field">
              <label className="erp-label" htmlFor="consentSource">Where did they agree?</label>
              <input id="consentSource" name="consentSource" className="erp-input" placeholder="Sign-up form v2, 12 Oct 2026" />
              <p className="erp-hint">Required if you ticked the box: consent without evidence is not consent.</p>
            </div>
            <button type="submit" className="erp-btn erp-btn-primary">Save customer</button>
          </form>
        </div>
      </section>

      <section className="erp-card">
        <h2>Contact list</h2>
        <p className="erp-card-sub">Numbers are shortened on screen. Actions are logged against your user.</p>
        {data.contacts.length === 0 ? (
          <EmptyState glyph="☺" title="No contacts yet">Import a list above, or add one customer. You can still draft campaigns while the list is empty — they just have nobody to send to.</EmptyState>
        ) : (
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Number</th>
                  <th>Tags</th>
                  <th>Marketing</th>
                  <th>Status</th>
                  <th>Consent / exclusion</th>
                </tr>
              </thead>
              <tbody>
                {data.contacts.slice(0, 100).map((contact: any) => (
                  <tr key={contact.id}>
                    <td>
                      <div className="erp-strong">{contact.name ?? "Contact"}</div>
                      <div className="erp-muted erp-small">{contact.source?.toLowerCase().replace(/_/g, " ")}</div>
                    </td>
                    <td className="erp-mono">•••{String(contact.phoneNormalized).slice(-3)}</td>
                    <td className="erp-small">{contact.tags.length ? contact.tags.join(", ") : "—"}</td>
                    <td>{contact.marketingConsent.marketingSms ? <Badge tone="good">Consented</Badge> : <Badge>Not consented</Badge>}</td>
                    <td>{contact.suppressed ? <Badge tone="bad">Suppressed</Badge> : <Badge tone="neutral">{contact.status}</Badge>}</td>
                    <td>
                      <div className="erp-actions">
                        {contact.marketingConsent.marketingSms ? (
                          <form action={recordConsentAction}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="contactId" value={contact.id} />
                            <input type="hidden" name="channel" value="SMS" />
                            <input type="hidden" name="purpose" value="MARKETING" />
                            <input type="hidden" name="granted" value="false" />
                            <input type="hidden" name="source" value="STAFF" />
                            <input type="hidden" name="wordingVersion" value="customer request" />
                            <button type="submit" className="erp-btn erp-btn-sm erp-btn-secondary">Withdraw consent</button>
                          </form>
                        ) : (
                          <form action={recordConsentAction}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="contactId" value={contact.id} />
                            <input type="hidden" name="channel" value="SMS" />
                            <input type="hidden" name="purpose" value="MARKETING" />
                            <input type="hidden" name="granted" value="true" />
                            <input type="hidden" name="source" value="STAFF" />
                            <input type="hidden" name="wordingVersion" value="in person sign-up" />
                            <button type="submit" className="erp-btn erp-btn-sm erp-btn-secondary">Record consent</button>
                          </form>
                        )}
                        {!contact.suppressed ? (
                          <form action={suppressContactAction}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="contactId" value={contact.id} />
                            <button type="submit" className="erp-btn erp-btn-sm erp-btn-danger">Suppress</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.contacts.length > 100 ? <p className="erp-hint">Showing the 100 most recent of {data.contacts.length}. Exports include everyone.</p> : null}
      </section>

      <section className="erp-card">
        <h2>How eligibility is decided</h2>
        <ul className="erp-list">
          <li><span>Marketing consent</span><span className="erp-muted erp-small" style={{ maxWidth: "58ch", textAlign: "right" }}>Required for promotional messages, with the source and wording version stored.</span></li>
          <li><span>Quiet hours</span><span className="erp-muted erp-small" style={{ maxWidth: "58ch", textAlign: "right" }}>Messages are scheduled between 08:00 and 20:00 Nairobi time, not dropped.</span></li>
          <li><span>Frequency cap</span><span className="erp-muted erp-small" style={{ maxWidth: "58ch", textAlign: "right" }}>At most 4 marketing messages per contact in a rolling 30 days.</span></li>
          <li><span>Suppression</span><span className="erp-muted erp-small" style={{ maxWidth: "58ch", textAlign: "right" }}>An opt-out wins over everything, including a recorded consent.</span></li>
        </ul>
      </section>
    </>
  );
}
