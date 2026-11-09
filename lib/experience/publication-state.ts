/**
 * Website Studio 2.0 — per-website publication state machine.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * A business can own several Studio websites (`StudioWebsite.isDefault` marks the
 * one served at `/b/<businessSlug>`; the others are served at
 * `/b/<businessSlug>/<websiteSlug>`). Publication is a property of the WEBSITE, not
 * of the business: publishing one site must never publish, unpublish or blank a
 * sibling, and unpublishing a site must never disable the rest of the tenant.
 *
 * Before this module the public loader derived publication inline with two
 * business-wide flags (`business.isPublished`, one shared legacy row). That made
 * two distinct customer-visible defects possible:
 *
 *   1. provisioning a default Studio site silently dropped the live legacy page
 *      (the fallback was gated on "no Studio site exists" rather than "this site
 *      has never published"), taking a working customer website offline;
 *   2. unpublishing the DEFAULT site cleared `business.isPublished`, which the
 *      loader also used for SECONDARY sites, so a sibling site that was still
 *      published stopped rendering.
 *
 * Both are structural, not incidental: they follow from having no explicit notion
 * of "this site has never published" versus "this site was explicitly unpublished".
 * This module supplies that notion and is the ONLY place publication is decided.
 *
 * STATES
 * ------
 *   DRAFT        — exists, editable, has never been published. Nothing is public.
 *                  Legacy fallback IS permitted here for the default site: a tenant
 *                  that has been provisioned but not yet cut over keeps the website
 *                  its customers already had.
 *   PUBLISHED    — has an immutable published snapshot. This site is public (subject
 *                  to the tenant gate below).
 *   UNPUBLISHED  — was published and the owner explicitly took it down. Nothing is
 *                  public, and legacy fallback is FORBIDDEN: the owner asked for the
 *                  site to be gone, so an older snapshot must never reappear.
 *   SUSPENDED    — held by an operator. Nothing is public. Not resolvable at all,
 *                  including for its own history/preview surface.
 *
 * PERMITTED TRANSITIONS
 * ---------------------
 *   DRAFT       → PUBLISHED      publish a reviewed draft
 *   DRAFT       → SUSPENDED      operator suspension before first publication
 *   PUBLISHED   → PUBLISHED      publish a newer draft (new immutable version)
 *   PUBLISHED   → UNPUBLISHED    owner unpublish
 *   PUBLISHED   → SUSPENDED      operator suspension
 *   UNPUBLISHED → PUBLISHED      re-publish a reviewed draft
 *   UNPUBLISHED → SUSPENDED      operator suspension
 *   SUSPENDED   → DRAFT          operator reinstatement, never published
 *   SUSPENDED   → UNPUBLISHED    operator reinstatement, previously published
 *   Any         → any            rollback publishes a NEW version; it is a
 *                               PUBLISHED transition, never a rewrite of history.
 *
 * Anything not listed is rejected by `canTransitionStudioSite`.
 *
 * TENANT GATE (orthogonal and deliberately separate)
 * --------------------------------------------------
 * `business.isPublished === false` or `business.status === "SUSPENDED"` hides the
 * whole tenant. That flag is an operator/owner-level kill switch for the tenant; it
 * is NOT the publication state of an individual website. Publishing any site makes
 * the tenant publicly routable (`business.isPublished = true`); unpublishing a site
 * never clears it, because doing so would disable the tenant's other live sites.
 */

export const STUDIO_SITE_STATES = ["DRAFT", "PUBLISHED", "UNPUBLISHED", "SUSPENDED"] as const;
export type StudioSiteState = (typeof STUDIO_SITE_STATES)[number];

export const SITE_STATE_DRAFT: StudioSiteState = "DRAFT";
export const SITE_STATE_PUBLISHED: StudioSiteState = "PUBLISHED";
export const SITE_STATE_UNPUBLISHED: StudioSiteState = "UNPUBLISHED";
export const SITE_STATE_SUSPENDED: StudioSiteState = "SUSPENDED";

export function isStudioSiteState(value: unknown): value is StudioSiteState {
  return typeof value === "string" && (STUDIO_SITE_STATES as readonly string[]).includes(value);
}

/**
 * Normalise a stored status string. A stored value this module does not recognise
 * fails closed to SUSPENDED: an unknown state must never be treated as public, and
 * must never be treated as "never published" either, because that would re-enable a
 * legacy fallback nobody asked for.
 */
export function normalizeStudioSiteState(value: unknown): StudioSiteState {
  return isStudioSiteState(value) ? value : SITE_STATE_SUSPENDED;
}

const ALLOWED_TRANSITIONS: Record<StudioSiteState, readonly StudioSiteState[]> = {
  DRAFT: [SITE_STATE_PUBLISHED, SITE_STATE_SUSPENDED],
  PUBLISHED: [SITE_STATE_PUBLISHED, SITE_STATE_UNPUBLISHED, SITE_STATE_SUSPENDED],
  UNPUBLISHED: [SITE_STATE_PUBLISHED, SITE_STATE_SUSPENDED],
  SUSPENDED: [SITE_STATE_DRAFT, SITE_STATE_UNPUBLISHED],
};

export function canTransitionStudioSite(from: unknown, to: StudioSiteState): boolean {
  const current = normalizeStudioSiteState(from);
  return ALLOWED_TRANSITIONS[current].includes(to);
}

/** The record fields the state machine reads. `content` may be absent (never provisioned). */
export type StudioSitePublicationRecord = {
  status?: string | null;
  content?: { publishedJson?: string | null; publishedVersion?: number | null } | null;
};

export type SitePublicationView = {
  state: StudioSiteState;
  /** A published snapshot exists and the site is not held or taken down. */
  publiclyPublished: boolean;
  /** The site exists in a state that may be publicly resolved at all. */
  resolvable: boolean;
  publishedVersion: number;
  /**
   * Whether the pre-cutover BusinessExperience snapshot may stand in for this site.
   * Only the default site, only before its first publication, never after an
   * explicit unpublish or suspension.
   */
  legacyFallbackAllowed: boolean;
};

export function describeSitePublication(record: StudioSitePublicationRecord | null, options: {
  isDefaultRoute: boolean;
}): SitePublicationView {
  // A tenant that has never been provisioned for Studio has no site row at all. That is
  // the ordinary pre-cutover estate, not an error: the legacy BusinessExperience remains
  // its website. Only an EXISTING row can be in an unrecognised state, and that fails
  // closed to SUSPENDED below.
  if (!record) {
    return {
      state: SITE_STATE_DRAFT,
      publiclyPublished: false,
      resolvable: true,
      publishedVersion: 0,
      legacyFallbackAllowed: options.isDefaultRoute,
    };
  }
  const state = normalizeStudioSiteState(record?.status);
  const publishedVersion = Number(record?.content?.publishedVersion ?? 0);
  const hasSnapshot = Boolean(record?.content?.publishedJson);
  const publiclyPublished = state === SITE_STATE_PUBLISHED && hasSnapshot;
  return {
    state,
    publiclyPublished,
    resolvable: state !== SITE_STATE_SUSPENDED,
    publishedVersion: Number.isFinite(publishedVersion) && publishedVersion > 0 ? publishedVersion : 0,
    // "Never published" is the only state in which the legacy row may render, and DRAFT
    // is exactly that state; UNPUBLISHED and SUSPENDED explicitly refuse it.
    //
    // This is deliberately keyed on the STATE and not on "has no snapshot": migrating a
    // tenant copies its legacy document into `StudioWebsiteContent.publishedJson` (see
    // lib/experience/site-content.ts) long before the owner publishes in Studio. Treating
    // that copy as "has published" is what silently took live customer websites offline
    // the moment they were simply provisioned for Studio. A migrated copy is not a
    // publication; the site publishes only when the owner publishes it.
    legacyFallbackAllowed: options.isDefaultRoute && state === SITE_STATE_DRAFT,
  };
}

/**
 * The tenant gate. Deliberately independent of any single website's state.
 * `suspended` is checked first: a suspended tenant is never publicly resolvable.
 */
export function tenantIsPubliclyVisible(business: {
  isPublished: boolean;
  status: string;
} | null): boolean {
  if (!business) return false;
  if (business.status === "SUSPENDED") return false;
  return business.isPublished === true;
}

/**
 * Decide which JSON document (if any) the public storefront renders for a site.
 *
 * Order is total and every branch is explicit, so no caller can accidentally read a
 * draft, a taken-down snapshot or a sibling's content:
 *
 *   1. an authorised preview of this exact site's draft (`allowDraft`), which is
 *      resolved from the session by the route and never from a URL parameter;
 *   2. this site's own published snapshot, when the site is PUBLISHED and the
 *      tenant is visible;
 *   3. the legacy BusinessExperience snapshot — default route only, and only while
 *      the default site has never published (see `legacyFallbackAllowed`).
 *
 * A site that is UNPUBLISHED or SUSPENDED returns no document at all: the owner
 * asked for it to be gone (or an operator held it), so neither a newer published
 * snapshot nor the legacy row may reappear.
 */
export function resolvePublicDocument(input: {
  site: StudioSitePublicationRecord | null;
  isDefaultRoute: boolean;
  legacy: { publishedJson?: string | null; status?: string | null } | null;
  allowDraft: boolean;
  preferDraft: boolean;
  tenantVisible: boolean;
}): { json: string | null; source: "draft" | "published" | "legacy" | null } {
  const view = describeSitePublication(input.site, { isDefaultRoute: input.isDefaultRoute });
  const draftJson = input.allowDraft ? readDraft(input.site) : null;

  // 1. Authorised owner preview. `preferDraft` only ever arrives with `allowDraft`.
  if (draftJson && input.preferDraft) return { json: draftJson, source: "draft" };

  // 2. This site's own published snapshot, still behind the tenant gate.
  if (view.publiclyPublished && input.tenantVisible) {
    return { json: input.site?.content?.publishedJson ?? null, source: "published" };
  }

  // 3. Bounded legacy fallback. `legacyFallbackAllowed` already encodes "default
  //    route, never published, not taken down, not held".
  if (
    input.tenantVisible &&
    view.legacyFallbackAllowed &&
    input.legacy?.publishedJson &&
    input.legacy.status === "PUBLISHED"
  ) {
    return { json: input.legacy.publishedJson, source: "legacy" };
  }

  // Nothing public. An authorised owner still sees their own draft if one exists.
  if (draftJson) return { json: draftJson, source: "draft" };
  return { json: null, source: null };
}

/** Narrow helper: the recorded draft of a site, or null. */
export function readDraft(site: StudioSitePublicationRecord | null): string | null {
  const draft = (site as { content?: { draftJson?: string | null } } | null)?.content?.draftJson;
  return draft || null;
}

/**
 * Whether the legacy BusinessExperience draft may back an authorised preview while
 * the default site has never been published. Mirrors the fallback rule so preview and
 * public rendering can never diverge.
 */
export function legacyDraftAllowed(record: StudioSitePublicationRecord | null, isDefaultRoute: boolean): boolean {
  return describeSitePublication(record, { isDefaultRoute }).legacyFallbackAllowed;
}
