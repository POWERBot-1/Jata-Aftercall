import Link from "next/link";
import { getSession } from "@/lib/auth";
import { loadErpBusinesses } from "@/lib/erp/loaders";
import { ERP_PLAN_COMMERCIALS, ERP_PLAN_EXCLUSIONS, ERP_PLAN_INCLUSIONS, ERP_PLAN_PRICE_KES } from "@/lib/erp/entitlement";
import { ERP_MODULES } from "@/lib/erp/navigation";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "POS / ERP - PRO" };

/**
 * Product landing page.
 *
 * It lists only businesses the signed-in person can already open, distinguishes a workspace that
 * has been set up from one that has not, and states the price and what is *not* included without
 * hiding it in a footnote.
 */
export default async function ErpIndexPage() {
  const session = await getSession();
  if (!session) {
    return (
      <div className="erp">
        <main className="erp-content">
          <section className="erp-card">
            <h1>POS / ERP - PRO</h1>
            <p className="erp-muted">Sign in to open your workspace.</p>
            <Link href="/login" className="erp-btn erp-btn-primary">Sign in</Link>
          </section>
        </main>
      </div>
    );
  }

  const businesses = await loadErpBusinesses(session.userId, session.role === "ADMIN");
  const ready = ERP_MODULES.filter((module) => module.status === "READY").length;
  const planned = ERP_MODULES.filter((module) => module.status === "PLANNED").length;

  return (
    <div className="erp">
      <main className="erp-content">
        <section className="erp-hero">
          <span className="erp-hero-chip">Premium product · KES {formatNumber(ERP_PLAN_PRICE_KES)}/month</span>
          <h1>Run sales, books and customer contact in one workspace.</h1>
          <p>
            POS / ERP - PRO adds double-entry accounting, invoices, a Kenya tax engine, your public ordering page and
            native SMS/WhatsApp campaigns to the Business POS you already use. Your existing POS keeps working exactly as it
            does today.
          </p>
          <div className="erp-actions">
            <Link href="/dashboard/pos" className="erp-btn erp-btn-secondary">Business POS (KES 499)</Link>
            <Link href="#businesses" className="erp-btn erp-btn-primary">Open a workspace</Link>
          </div>
        </section>

        <section className="erp-grid erp-grid-3" aria-label="What is included">
          <div className="erp-card">
            <h2>{ready} working modules</h2>
            <p className="erp-card-sub">Only working screens are listed. Everything else is marked as planned.</p>
            <ul className="erp-list">
              {ERP_MODULES.filter((module) => module.status === "READY").slice(0, 8).map((module) => (
                <li key={module.key}>
                  <span>{module.label}</span>
                  <span className="erp-muted erp-small">Ready</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="erp-card">
            <h2>What the price covers</h2>
            <ul className="erp-list">
              {ERP_PLAN_INCLUSIONS.map((item) => (
                <li key={item}><span>{item}</span></li>
              ))}
            </ul>
          </div>
          <div className="erp-card">
            <h2>What it does not cover</h2>
            <ul className="erp-list">
              {ERP_PLAN_EXCLUSIONS.map((item) => (
                <li key={item}><span>{item}</span></li>
              ))}
            </ul>
            <p className="erp-hint">{ERP_PLAN_COMMERCIALS.providerFeesNote}</p>
          </div>
        </section>

        <section id="businesses" className="erp-card">
          <h2>Your businesses</h2>
          <p className="erp-card-sub">{businesses.length === 0 ? "You don't have a business yet." : "Choose a business to open its PRO workspace."}</p>
          {businesses.length === 0 ? (
            <Link href="/onboarding/business" className="erp-btn erp-btn-primary">Create a business</Link>
          ) : (
            <div className="erp-card-grid">
              {businesses.map((business: any) => (
                <Link key={business.id} href={`/dashboard/erp/${business.id}`} className="erp-action-card">
                  <strong>{business.name}</strong>
                  <span>{business.location || "Kenya"}</span>
                  <div className="erp-card-foot">
                    <span className="erp-badge" data-tone={business.configured ? "good" : "warn"}>
                      {business.configured ? "Workspace set up" : "New workspace"}
                    </span>
                    <span className="erp-small erp-strong">{business.configured ? "Open" : "Start"} →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="erp-card">
          <h2>Planned next, and honestly labelled</h2>
          <p className="erp-card-sub">{planned} modules appear on the roadmap. They are not buttons that do nothing — they say what is missing.</p>
          <ul className="erp-list">
            {ERP_MODULES.filter((module) => module.status === "PLANNED").map((module) => (
              <li key={module.key}>
                <span>{module.label}</span>
                <span className="erp-muted erp-small" style={{ maxWidth: "52ch", textAlign: "right" }}>{module.plannedNote}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="erp-hint">
          Kenya tax and eTIMS notes describe the product&apos;s data model and readiness checks. They are not statutory advice, and
          KRA certification is not claimed.
        </p>
      </main>
    </div>
  );
}
