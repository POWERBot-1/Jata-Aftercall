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

import { isCategoryKey } from "./categories";

export const OTHER_CATEGORY = "other";

/** True when the business record has a real, chosen category (anything but missing or `other`). */
export function hasChosenCategory(businessCategory: string | null | undefined): boolean {
  return isCategoryKey(businessCategory) && businessCategory !== OTHER_CATEGORY;
}

export const CATEGORY_MISMATCH_CODE = "business_category_mismatch";
export const CATEGORY_REQUIRED_CODE = "category_required";

export const CATEGORY_MISMATCH_MESSAGE =
  "This website belongs to the kind of business on your business profile. Change your business type first — nothing was changed.";

/**
 * Result of deciding the category for a change-of-type (POST) request.
 *
 * `propagateToBusiness` is true when the owner explicitly chose a new type, which means the
 * business record must be updated in the same write so the tenant and its website stay in step.
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
  const stored = isCategoryKey(businessCategory) ? businessCategory : null;
  const asked = isCategoryKey(requested) ? requested : null;

  // The owner picked a type. Honour it, and make the tenant agree with it in the same request.
  if (asked !== null) {
    return {
      ok: true,
      categoryKey: asked,
      propagateToBusiness: asked !== stored,
      previousCategory: stored,
    };
  }

  // No choice supplied: keep whatever the business record already says.
  if (stored) return { ok: true, categoryKey: stored, propagateToBusiness: false, previousCategory: stored };

  return {
    ok: false,
    status: 400,
    code: CATEGORY_REQUIRED_CODE,
    error: "Choose the type of business you run.",
    businessCategory: null,
  };
}

/**
 * Decide the category for a content edit (PATCH). The business record wins; a request that tries
 * to change it through the content path is refused before anything is normalised or written.
 */
export function planContentCategory(
  businessCategory: string | null | undefined,
  requested: unknown,
): ContentCategoryPlan {
  const stored = isCategoryKey(businessCategory) ? businessCategory : null;
  const asked = isCategoryKey(requested) ? requested : null;

  if (asksForDifferentCategory(stored, asked, businessCategory)) {
    return {
      ok: false,
      status: 409,
      code: CATEGORY_MISMATCH_CODE,
      error: CATEGORY_MISMATCH_MESSAGE,
      businessCategory: stored,
    };
  }
  return { ok: true, categoryKey: (stored ?? asked ?? OTHER_CATEGORY) as string };
}

/**
 * A content edit may change the site's category only while the business record has not recorded a
 * real one yet (first-run onboarding). Once it has, the content path must not touch it.
 */
function asksForDifferentCategory(
  stored: string | null,
  asked: string | null,
  rawStored: string | null | undefined,
): boolean {
  if (asked === null) return false;
  if (hasChosenCategory(rawStored)) return asked !== stored;
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
): { categoryKey: string; mismatch: boolean } {
  const business = isCategoryKey(businessCategory) ? businessCategory : null;
  const stored = isCategoryKey(storedCategory) ? storedCategory : null;
  if (hasChosenCategory(business)) {
    return { categoryKey: business as string, mismatch: stored !== null && stored !== business };
  }
  if (stored) return { categoryKey: stored, mismatch: false };
  if (business) return { categoryKey: business, mismatch: false };
  return { categoryKey: OTHER_CATEGORY, mismatch: false };
}
