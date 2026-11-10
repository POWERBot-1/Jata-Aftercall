/**
 * Development-only acceptance harness for the integrated Website Studio.
 *
 * It uses the real generator, the real Studio components and the real storefront renderer,
 * so three generated layouts can be inspected side by side without a database or a login.
 * Production always returns 404.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { StudioPreview } from "@/components/studio/openpage/StudioPreview";
import { WebsiteStudio } from "@/components/studio/openpage/WebsiteStudio";
import { websiteStudioFixture } from "./fixture";

export const dynamic = "force-dynamic";
export const metadata = { title: "Website Studio verification fixture", robots: { index: false, follow: false } };

type View = "compare" | "editor" | "describe";

export default async function WebsiteStudioPreviewHarness({ searchParams }: { searchParams: Promise<{ view?: string; device?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const view: View = params.view === "editor" || params.view === "describe" ? params.view : "compare";
  const device = params.device === "mobile" || params.device === "tablet" ? params.device : "desktop";
  const fixture = websiteStudioFixture();
  const candidates = fixture.generated.candidates;

  if (view !== "compare") {
    return (
      <main className="mx-auto max-w-[1500px] p-4" data-fixture="website-studio">
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <Link href="/dev/website-studio-preview" className="jata-btn jata-btn-secondary">Compare layouts</Link>
          <Link href="/dev/website-studio-preview?view=describe" className="jata-btn jata-btn-ghost">Describe stage</Link>
          <Link href="/dev/website-studio-preview?view=editor" className="jata-btn jata-btn-ghost">Editor stage</Link>
        </div>
        <WebsiteStudio
          business={{ ...fixture.business, isPublished: false }}
          initialDocument={fixture.document}
          initialDraftVersion={3}
          publishedVersion={2}
          hasExperience={view === "editor"}
          hasUnpublishedChanges={false}
          entitlement={fixture.entitlement}
          validation={fixture.validation}
          previewBase={fixture.base}
          publicUrl={fixture.publicUrl}
          examples={fixture.examples}
        />
      </main>
    );
  }

  const fixtureJson = JSON.stringify({
    requirements: fixture.requirements,
    candidates: fixture.generated.candidates.map((candidate) => ({
      id: candidate.id, index: candidate.index, label: candidate.label, family: candidate.family,
      familyName: candidate.familyName, familyRationale: candidate.familyRationale,
      themeKey: candidate.themeKey, themeName: candidate.themeName, document: candidate.document,
      summary: candidate.summary, why: candidate.why, layoutPlan: candidate.layoutPlan,
      layoutVariants: candidate.layoutVariants, mapping: candidate.mapping,
      similarityToOthers: candidate.similarityToOthers, distinct: candidate.distinct,
      notes: candidate.notes, generationKind: candidate.generationKind,
    })),
  }).replace(/</g, "\\u003c");

  return (
    <main className="mx-auto max-w-[1800px] p-4" data-fixture="website-studio">
      <script id="studio-fixture" type="application/json" dangerouslySetInnerHTML={{ __html: fixtureJson }} />
      <header className="mb-4">
        <p className="jata-kicker">Development verification only</p>
        <h1 className="text-xl font-bold">Three materially distinct layouts from one brief</h1>
        <p className="text-sm text-zinc-600">
          {fixture.requirements.summary}. Rendered with the production <code>ExperienceSite</code> through <code>StudioPreview</code>; owner page-view tracking is disabled.
        </p>
        <nav className="mt-2 flex gap-2 text-sm">
          <Link href="/dev/website-studio-preview?view=describe" className="jata-btn jata-btn-secondary">Describe stage</Link>
          <Link href="/dev/website-studio-preview?view=editor" className="jata-btn jata-btn-secondary">Editor stage</Link>
          <Link href="/dev/website-studio-preview?device=mobile" className="jata-btn jata-btn-ghost">Mobile</Link>
        </nav>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        {candidates.map((candidate) => (
          <article key={candidate.id} className="jata-card" data-candidate={candidate.family}>
            <h2 className="text-sm font-bold">{candidate.label}</h2>
            <p className="text-[11px] text-zinc-600">{candidate.summary}</p>
            <p className="text-[11px] text-zinc-500">
              family {candidate.family} · similarity {candidate.similarityToOthers} · {candidate.mapping.mapped} blocks mapped · {candidate.mapping.unsupported} unsupported
            </p>
            <div className="mt-2" style={{ width: device === "mobile" ? 340 : 520, maxWidth: "100%" }}>
              <StudioPreview base={fixture.base} document={candidate.document} device={device} scale={device === "mobile" ? 0.8 : device === "tablet" ? 0.4 : 0.36} height={device === "mobile" ? 760 : 900} scroll={false} label={`${candidate.label} fixture preview`} />
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
