/**
 * Canonical customer-facing product names.
 *
 * The stored plan key (`INTERACTIVE_BUSINESS`) and the database `PlanConfig` row are the billing
 * source of truth and never change. Customers, however, see the product under one consistent
 * brand — "Website Studio" — across the homepage, workspace, entitlement messages and help text.
 * Centralising the display name here means a surface cannot drift back to the legacy
 * "Interactive Business" wording, and a source-guard test can prove it.
 *
 * Use this constant for prose and labels shown to an owner or customer. Do not use it as a plan
 * key, an id or a stored value.
 */
export const WEBSITE_STUDIO_NAME = "Website Studio";

/**
 * The AI Business Front Desk keeps its full product name. This constant exists so the two
 * add-on products share one naming module and neither is hard-coded in scattered copy.
 */
export const AI_FRONT_DESK_NAME = "AI Business Front Desk";
