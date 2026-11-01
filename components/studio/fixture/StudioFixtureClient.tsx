"use client";

/**
 * Website Studio fixture host — DEVELOPMENT ONLY.
 *
 * Renders the REAL Studio components (StudioIndexView, CreateExperienceForm, StudioCanvas,
 * CategoryImagePicker, PublishPanel) with fictional fixture data. Writes and publishes go through
 * simulators (lib/studio/fixtures/studioFixture.ts) that perform no I/O. Imported only by
 * app/dev/studio-fixture, which returns 404 in production.
 */

import { useCallback, useState } from "react";
import { StudioIndexView } from "@/components/studio/StudioIndexView";
import { StudioCanvas } from "@/components/studio/canvas/StudioCanvas";
import { CreateExperienceForm } from "@/components/dashboard/CreateExperienceForm";
import { PublishPanel } from "@/components/dashboard/PublishPanel";
import { CategoryImagePicker, type PickedImage } from "@/components/media/CategoryImagePicker";
import { galleryForExperienceCategory } from "@/lib/categoryImagery";
import { getExperienceProfile } from "@/lib/experience/categories";
import {
  FIXTURE_BUSINESS,
  FIXTURE_INDEX_BUSINESSES,
  FIXTURE_NOTICE,
  FIXTURE_PUBLISH_CHECKS,
  SIMULATED_LATENCY_MS,
  fixtureDirections,
  fixtureDocument,
  fixtureEntitlements,
  fixtureIndexExperience,
  fixtureThemes,
  simulateCreate,
  simulateDraftWrite,
  simulatePublish,
  type FixtureOutcome,
  type FixtureState,
} from "@/lib/studio/fixtures/studioFixture";

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function StudioFixtureClient({ state, outcome }: { state: FixtureState; outcome: FixtureOutcome }) {
  // Simulated write/publish transports. Latency is labelled fixture latency: it exists so the progress
  // presentation can be observed; production has no such delay.
  const submitWrite = useCallback(
    async (body: Record<string, unknown>) => {
      await wait(SIMULATED_LATENCY_MS);
      return simulateDraftWrite(outcome, body);
    },
    [outcome],
  );
  const submitPublish = useCallback(
    async () => {
      await wait(SIMULATED_LATENCY_MS);
      return simulatePublish(outcome);
    },
    [outcome],
  );
  const submitCreate = useCallback(
    async () => {
      await wait(SIMULATED_LATENCY_MS);
      return simulateCreate(outcome);
    },
    [outcome],
  );

  const [pickedSrc, setPickedSrc] = useState<string | null>(null);
  const [focal, setFocal] = useState<{ x: number; y: number } | null>(null);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const gallery = galleryForExperienceCategory("beauty");
  const profile = getExperienceProfile(FIXTURE_BUSINESS.category);
  const document = fixtureDocument();

  const banner = (
    <p role="note" className="jc-fixture-note rounded-xl border border-dashed px-3 py-2 text-sm font-semibold">
      {FIXTURE_NOTICE} Simulated outcome for the next write: <strong data-fixture-outcome={outcome}>{outcome}</strong>.
    </p>
  );

  if (state === "dashboard") {
    return (
      <section aria-label="Studio dashboard fixture" className="space-y-3">
        {banner}
        <StudioIndexView
          businesses={FIXTURE_INDEX_BUSINESSES}
          experienceByBusiness={fixtureIndexExperience()}
          entitlementByBusiness={fixtureEntitlements()}
          liveCount={1}
        />
      </section>
    );
  }

  if (state === "category") {
    return (
      <section aria-label="Category selection fixture" className="space-y-3">
        {banner}
        <CreateExperienceForm businessId={FIXTURE_BUSINESS.id} currentCategory={null} submitCreate={submitCreate} />
      </section>
    );
  }

  if (state === "editor") {
    return (
      <section aria-label="Studio editor fixture" className="space-y-3">
        {banner}
        <StudioCanvas
          businessId={FIXTURE_BUSINESS.id}
          slug={FIXTURE_BUSINESS.slug}
          businessName={FIXTURE_BUSINESS.name}
          categoryLabel={profile.label}
          document={document}
          draftVersion={7}
          publishedVersion={6}
          hasUnpublishedChanges
          directions={fixtureDirections()}
          themes={fixtureThemes()}
          currentDirectionKey={fixtureDirections()[0]?.key ?? null}
          currentThemeKey={document.themeKey}
          publicUrl="/dev/studio-fixture/site"
          submitWrite={submitWrite}
          previewSrcFor={({ mode, revision }) => `/dev/studio-fixture/site?preview=${mode}&v=${revision}`}
        />
      </section>
    );
  }

  if (state === "image") {
    return (
      <section aria-label="Image selection fixture" className="space-y-3">
        {banner}
        <CategoryImagePicker
          simulated
          gallery={gallery}
          value={pickedSrc}
          focal={focal}
          title="Opening image"
          description="Choose a suggested image for your kind of business. Nothing is uploaded or saved in this fixture."
          onUse={(image: PickedImage) => {
            setPickedSrc(image.src);
            setPickNote(`Simulated selection: “${image.alt}”. Nothing was saved.`);
          }}
          onRestore={() => {
            setPickedSrc(null);
            setPickNote("Simulated: restored the suggested image. Nothing was saved.");
          }}
          onRemove={() => {
            setPickedSrc(null);
            setPickNote("Simulated: image removed. Nothing was saved.");
          }}
          onFocalChange={(next) => {
            setFocal(next);
            setPickNote("Simulated: crop repositioned. Nothing was saved.");
          }}
        />
        {pickNote ? <p role="status" className="jata-hint">{pickNote}</p> : null}
      </section>
    );
  }

  // state === "publish"
  return (
    <section aria-label="Publishing fixture" className="space-y-3">
      {banner}
      <PublishPanel
        businessId={FIXTURE_BUSINESS.id}
        ready
        checks={FIXTURE_PUBLISH_CHECKS}
        published={false}
        draftVersion={7}
        publishedVersion={6}
        hasUnpublishedChanges
        entitled
        publicUrl="/dev/studio-fixture/site"
        submitPublish={submitPublish}
      />
    </section>
  );
}

export default StudioFixtureClient;
