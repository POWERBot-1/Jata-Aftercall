/**
 * Unit contract for the per-website publication state machine.
 *
 * The two release-blocking defects this release fixed were both decisions this module
 * now owns, so they are pinned here independently of the database suites: the state
 * machine's transitions, the separation of per-site publication from the tenant kill
 * switch, and the exact conditions under which the legacy snapshot may render.
 */
import { describe, expect, it } from "vitest";
import {
  canTransitionStudioSite,
  describeSitePublication,
  isStudioSiteState,
  legacyDraftAllowed,
  normalizeStudioSiteState,
  resolvePublicDocument,
  STUDIO_SITE_STATES,
  tenantIsPubliclyVisible,
} from "@/lib/experience/publication-state";

const published = { publishedJson: "{}", publishedVersion: 3 };
const site = (status: string, content: any = { draftJson: null, ...published }) => ({ status, content });
const legacy = { publishedJson: '{"legacy":true}', status: "PUBLISHED" };

describe("publication state machine", () => {
  it("exposes exactly the four documented states and rejects unknown ones", () => {
    expect([...STUDIO_SITE_STATES]).toEqual(["DRAFT", "PUBLISHED", "UNPUBLISHED", "SUSPENDED"]);
    expect(isStudioSiteState("PUBLISHED")).toBe(true);
    expect(isStudioSiteState("published")).toBe(false);
    // An unrecognised stored value must never be treated as "never published", because
    // that would re-enable a legacy fallback nobody asked for.
    expect(normalizeStudioSiteState("ARCHIVED")).toBe("SUSPENDED");
    expect(normalizeStudioSiteState(null)).toBe("SUSPENDED");
  });

  it("permits only the documented transitions", () => {
    expect(canTransitionStudioSite("DRAFT", "PUBLISHED")).toBe(true);
    expect(canTransitionStudioSite("PUBLISHED", "PUBLISHED")).toBe(true);
    expect(canTransitionStudioSite("PUBLISHED", "UNPUBLISHED")).toBe(true);
    expect(canTransitionStudioSite("UNPUBLISHED", "PUBLISHED")).toBe(true);
    // A suspended site is reinstated by an operator, never republished by its owner.
    expect(canTransitionStudioSite("SUSPENDED", "PUBLISHED")).toBe(false);
    expect(canTransitionStudioSite("DRAFT", "UNPUBLISHED")).toBe(false);
    expect(canTransitionStudioSite("UNPUBLISHED", "DRAFT")).toBe(false);
  });

  it("separates the tenant kill switch from per-site publication", () => {
    expect(tenantIsPubliclyVisible({ isPublished: true, status: "ACTIVE" })).toBe(true);
    expect(tenantIsPubliclyVisible({ isPublished: true, status: "SUSPENDED" })).toBe(false);
    expect(tenantIsPubliclyVisible({ isPublished: false, status: "ACTIVE" })).toBe(false);
    expect(tenantIsPubliclyVisible(null)).toBe(false);
  });

  it("treats an unprovisioned tenant as pre-cutover, not as an error", () => {
    const view = describeSitePublication(null, { isDefaultRoute: true });
    expect(view.state).toBe("DRAFT");
    expect(view.publiclyPublished).toBe(false);
    expect(view.legacyFallbackAllowed).toBe(true);
  });

  it("allows the legacy snapshot only for a default site that has never published", () => {
    expect(describeSitePublication(site("DRAFT", {}), { isDefaultRoute: true }).legacyFallbackAllowed).toBe(true);
    // An explicit takedown is terminal: a taken-down site never falls back.
    expect(describeSitePublication(site("UNPUBLISHED"), { isDefaultRoute: true }).legacyFallbackAllowed).toBe(false);
    expect(describeSitePublication(site("SUSPENDED"), { isDefaultRoute: true }).legacyFallbackAllowed).toBe(false);
    // A secondary site never inherits the tenant's legacy page.
    expect(describeSitePublication(site("DRAFT", {}), { isDefaultRoute: false }).legacyFallbackAllowed).toBe(false);
  });

  it("reports a published site only when its snapshot exists and it is PUBLISHED", () => {
    expect(describeSitePublication(site("PUBLISHED"), { isDefaultRoute: true })).toMatchObject({
      publiclyPublished: true,
      publishedVersion: 3,
      legacyFallbackAllowed: false,
    });
    expect(describeSitePublication(site("PUBLISHED", { publishedJson: null, publishedVersion: 0 }), { isDefaultRoute: true })
      .publiclyPublished).toBe(false);
    expect(describeSitePublication(site("DRAFT"), { isDefaultRoute: true }).publiclyPublished).toBe(false);
  });

  describe("public document resolution", () => {
    const base = { isDefaultRoute: true, legacy, allowDraft: false, preferDraft: false, tenantVisible: true };

    it("prefers the site's own published snapshot", () => {
      expect(resolvePublicDocument({ ...base, site: site("PUBLISHED") })).toEqual({ json: "{}", source: "published" });
    });

    it("uses the legacy snapshot while a provisioned default site has never published", () => {
      expect(resolvePublicDocument({ ...base, site: site("DRAFT", {}) }))
        .toEqual({ json: '{"legacy":true}', source: "legacy" });
    });

    it("shows the authorised legacy draft before the live legacy fallback on a never-published default site", () => {
      const legacyWithDraft = { ...legacy, draftJson: '{"legacyDraft":true}' };
      expect(resolvePublicDocument({
        ...base,
        site: site("DRAFT", {}),
        legacy: legacyWithDraft,
        allowDraft: true,
        preferDraft: true,
      })).toEqual({ json: '{"legacyDraft":true}', source: "draft" });
    });

    it("does not let an authorised draft query expose legacy drafts after publication", () => {
      const legacyWithDraft = { ...legacy, draftJson: '{"legacyDraft":true}' };
      expect(resolvePublicDocument({
        ...base,
        site: site("PUBLISHED"),
        legacy: legacyWithDraft,
        allowDraft: true,
        preferDraft: true,
      })).toEqual({ json: "{}", source: "published" });
    });

    it("never resurfaces the legacy snapshot after an explicit unpublish", () => {
      expect(resolvePublicDocument({ ...base, site: site("UNPUBLISHED") })).toEqual({ json: null, source: null });
      expect(resolvePublicDocument({ ...base, site: site("SUSPENDED") })).toEqual({ json: null, source: null });
    });

    it("hides a published snapshot when the tenant is not publicly visible", () => {
      expect(resolvePublicDocument({ ...base, site: site("PUBLISHED"), tenantVisible: false }))
        .toEqual({ json: null, source: null });
      // …and the legacy row is not a substitute for it either.
      expect(resolvePublicDocument({ ...base, site: site("DRAFT", {}), tenantVisible: false }))
        .toEqual({ json: null, source: null });
    });

    it("never exposes a draft without an authorised preview", () => {
      const draftSite = { status: "PUBLISHED", content: { draftJson: '{"draft":true}', ...published } };
      expect(resolvePublicDocument({ ...base, site: draftSite })).toEqual({ json: "{}", source: "published" });
      expect(resolvePublicDocument({ ...base, site: draftSite, allowDraft: true, preferDraft: true }))
        .toEqual({ json: '{"draft":true}', source: "draft" });
    });

    it("shows the owner the draft they actually wrote, not the provisioning copy", () => {
      // A provisioned site keeps a copy of the legacy draft taken at provisioning time. The
      // owner then edits through the Studio editor, which writes the legacy row. If the copy
      // won, the preview would show text the owner had already replaced — the reported
      // "I edited it but the preview shows the old version" defect.
      const staleSite = { status: "DRAFT", content: { draftJson: '{"stale":true}', publishedJson: null, publishedVersion: 0, draftVersion: 1 } };
      const freshLegacy = { draftJson: '{"fresh":true}', draftVersion: 7 };
      expect(resolvePublicDocument({ ...base, site: staleSite, legacy: freshLegacy, allowDraft: true, preferDraft: true }))
        .toEqual({ json: '{"fresh":true}', source: "draft" });
      // The reverse case: a Studio-side draft newer than the legacy row must win.
      const freshSite = { status: "PUBLISHED", content: { draftJson: '{"site":true}', publishedJson: "{}", draftVersion: 9 } };
      expect(resolvePublicDocument({ ...base, site: freshSite, legacy: freshLegacy, allowDraft: true, preferDraft: true }))
        .toEqual({ json: '{"site":true}', source: "draft" });
      // A tie prefers the site's own copy; an unknown version never outranks a known one.
      const tied = { status: "DRAFT", content: { draftJson: '{"site":true}', publishedJson: null, publishedVersion: 0, draftVersion: 7 } };
      expect(resolvePublicDocument({ ...base, site: tied, legacy: freshLegacy, allowDraft: true, preferDraft: true }).json)
        .toBe('{"site":true}');
      // Anonymous visitors never see either draft.
      expect(resolvePublicDocument({ ...base, site: staleSite, legacy: freshLegacy, preferDraft: true }))
        .toEqual({ json: null, source: null });
    });

    it("never substitutes a sibling or the default site for a missing secondary site", () => {
      expect(resolvePublicDocument({ ...base, isDefaultRoute: false, site: null }))
        .toEqual({ json: null, source: null });
      expect(resolvePublicDocument({ ...base, isDefaultRoute: false, site: site("DRAFT", {}) }))
        .toEqual({ json: null, source: null });
    });
  });

  it("offers the legacy draft only where the legacy publication would be allowed", () => {
    expect(legacyDraftAllowed(site("DRAFT", {}), true)).toBe(true);
    expect(legacyDraftAllowed(site("UNPUBLISHED"), true)).toBe(false);
    expect(legacyDraftAllowed(site("PUBLISHED"), true)).toBe(false);
    expect(legacyDraftAllowed(site("DRAFT", {}), false)).toBe(false);
  });
});
