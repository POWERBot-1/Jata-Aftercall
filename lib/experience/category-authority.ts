/**
 * Category authority for the experience draft — the Website Studio editor's real save path.
 *
 * The business record is the single source of truth for "what kind of business is this". A
 * website's category decides which sections exist, which catalogue rules apply, which customer
 * flow (order, book, enquire) the storefront offers and which template families are legal. It is
 * tenant identity, not customer content.
 *
 * There are two different operations and they need two different rules:
 *
 *   1. **Choosing a business type.** Onboarding asks "what kind of business do you run?" and tells
 *      the owner "You can change it later." So an explicit `categoryKey` on the create/change-type
 *      request (POST) is a supported owner action. It must update the business record **and** the
 *      draft together — never one without the other, or the site and the tenant would disagree
 *      about what the business is. `planCreateCategory` expresses that.
 *
 *   2. **Editing website content.** Every other save (PATCH: brands, settings, sections, theme,
 *      templates) is content. A `categoryKey` smuggled into such a request is not a type change;
 *      it is either a stale client or an attempt to rewrite the tenant's identity through the
 *      content path. `planContentCategory` refuses it.
 *
 * Before this, `POST /api/experience` wrote the body's category into the draft and never touched
 * the business record, so the two could silently diverge: the site rendered one business's
 * sections and catalogue rules while the tenant, its invoices and its admin views said another.
 */

import { isCategoryKey, resolveExperienceProfile } from "./categories";
import type { CategoryKey } from "./types";

export const OTHER_CATEGORY = "other";

/**
 * A stored category can be a profile key (`food`) or a legacy free-text JATA category
 * (`Restaurant`). Both resolve to the same profile; only `other`/empty/unknown means the owner
 * has not chosen a real business type yet.
 */
function describeStoredCategory(raw: string | null | undefined): { raw: string | null; key: CategoryKey; chosen: boolean } {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return { raw: null, key: OTHER_CATEGORY, chosen: false };
  const key = resolveExperienceProfile(trimmed).key;
  return { raw: trimmed, key, chosen: key !== OTHER_CATEGORY };
}

/** True when the business record has a real, chosen category (anything but missing or `other`). */
export function hasChosenCategory(businessCategory: string | null | undefined): boolean {
  return describeStoredCategory(businessCategory).chosen;
}

export const CATEGORY_MISMATCH_CODE = "business_category_mismatch";
export const CATEGORY_REQUIRED_CODE = "category_required";

export const CATEGORY_MISMATCH_MESSAGE =
  "This website belongs to the kind of business on your business profile. Change your business type first — nothing was changed.";

/**
 * Result of deciding the category for a change-of-type (POST) request.
 *
 * `propagateToBusiness` is true when the business row must change in the same write: the owner
 * explicitly chose a different type, or a legacy free-text category needs normalising to its
 * profile key. `previousCategory` is the exact stored value for the compare-and-swap.
 */
// `strict` is off in this repository, so a bare `ok: boolean` does not narrow. The success member
// carries explicit `undefined` markers for the failure fields so callers can switch on `ok`.
export type CreateCategoryPlan =
  | { ok: true; categoryKey: string; propagateToBusiness: boolean; previousCategory: string | null; status?: undefined; code?: undefined; error?: undefined; businessCategory?: undefined }
  | { ok: false; status: number; code: string; error: string; businessCategory: string | null };

export type ContentCategoryPlan =
  | { ok: true; categoryKey: string; status?: undefined; code?: undefined; error?: undefined; businessCategory?: undefined }
  | { ok: false; status: number; code: string; error: string; businessCategory: string | null };

/**
 * Decide the category for a create / change-of-business-type request.
 *
 * @param businessCategory the category on the tenant's business row, read server-side
 * @param requested the category the owner picked (may be absent)
 */
export function planCreateCategory(
  businessCategory: string | null | undefined,
  requested: unknown,
): CreateCategoryPlan {
  const stored = describeStoredCategory(businessCategory);
  const asked = isCategoryKey(requested) ? requested : null;

  // The owner picked a type. Honour it, and make the tenant agree with it in the same request.
  // `previousCategory` stays the exact stored value for the compare-and-swap; `propagate` also
  // fires when a legacy value such as "Restaurant" needs normalising to its profile key.
  if (asked !== null) {
    return {
      ok: true,
      categoryKey: asked,
      propagateToBusiness: stored.raw !== asked,
      previousCategory: stored.raw,
    };
  }

  // No choice supplied: keep the business record's meaning. A legacy category is normalised on
  // this write so the website and the tenant agree on a profile key from now on.
  if (stored.chosen) {
    return {
      ok: true,
      categoryKey: stored.key,
      propagateToBusiness: stored.raw !== stored.key,
      previousCategory: stored.raw,
    };
  }

  return {
    ok: false,
    status: 400,
    code: CATEGORY_REQUIRED_CODE,
    error: "Choose the type of business you run.",
    businessCategory: stored.raw,
  };
}

/**
 * Decide the category for a content edit (PATCH). The business record wins; a request that tries
 * to change it through the content path is refused before anything is normalised or written.
 * `draftCategory` lets a legacy draft keep its existing category while the business record has
 * none, without letting the content path invent one.
 */
export function planContentCategory(
  businessCategory: string | null | undefined,
  requested: unknown,
  draftCategory?: string | null,
): ContentCategoryPlan {
  const stored = describeStoredCategory(businessCategory);
  const asked = isCategoryKey(requested) ? requested : null;

  if (stored.chosen) {
    if (asksForDifferentCategory(stored, asked)) {
      return {
        ok: false,
        status: 409,
        code: CATEGORY_MISMATCH_CODE,
        error: CATEGORY_MISMATCH_MESSAGE,
        businessCategory: stored.raw,
      };
    }
    return { ok: true, categoryKey: stored.key };
  }

  // No recorded business type. A content edit may echo the draft's existing category, but it must
  // not establish a new identity: only the create/change-type path may update the tenant record
  // and the draft together. This keeps a first content save from leaving the two disagreeing.
  const draft = describeStoredCategory(draftCategory);
  if (asked !== null && asked !== draft.key) {
    return {
      ok: false,
      status: 409,
      code: CATEGORY_MISMATCH_CODE,
      error: CATEGORY_MISMATCH_MESSAGE,
      businessCategory: stored.raw,
    };
  }
  return { ok: true, categoryKey: draft.chosen ? draft.key : OTHER_CATEGORY };
}

/**
 * A content edit may change the site's category only while the business record has not recorded a
 * real one yet (first-run onboarding). Once it has, the content path must not touch it.
 */
function asksForDifferentCategory(
  stored: { key: string; chosen: boolean },
  asked: string | null,
): boolean {
  if (asked === null) return false;
  if (stored.chosen) return asked !== stored.key;
  return false;
}

/**
 * The category to use for *reading* a stored draft. Reading never refuses: a stored draft is
 * customer content and must always be openable. A stored category that disagrees with the
 * business record is reported so the editor can show it, but the business record wins for
 * capabilities, so the owner is never locked out of their own site.
 */
export function categoryForRead(
  businessCategory: string | null | undefined,
  storedCategory: string | null | undefined,
): { categoryKey: CategoryKey; mismatch: boolean } {
  const business = describeStoredCategory(businessCategory);
  const stored = describeStoredCategory(storedCategory);
  if (business.chosen) {
    return { categoryKey: business.key, mismatch: stored.chosen && stored.key !== business.key };
  }
  if (stored.chosen) return { categoryKey: stored.key, mismatch: false };
  if (business.raw) return { categoryKey: business.key, mismatch: false };
  return { categoryKey: OTHER_CATEGORY, mismatch: false };
}
