/**
 * JATA AFTERCALL design-system contract.
 *
 * This module is the single machine-readable source of truth for the global design system.
 * It is imported by the shared components, by the generated-product renderers and by the
 * enforcement tests, so a change here is a change to what the whole platform promises:
 *
 *   - `PLATFORM_TOKENS`         — the tokens every platform surface may use (app/globals.css).
 *   - `PRODUCT_FOUNDATION_TOKENS` — the tokens every *generated customer product* inherits,
 *                                 emitted by the Theme Engine for every theme and category.
 *   - `REQUIRED_STATES`         — the interaction states a component must define.
 *   - `TEMPLATE_CONTRACT`       — what a Website Studio template must provide to be publishable.
 *
 * Nothing in this file renders. It exists so compliance can be *tested* rather than asserted.
 */

export const DESIGN_SYSTEM_VERSION = "2026-10-13";

/** Tokens defined once in `app/globals.css` `:root` for every JATA platform surface. */
export const PLATFORM_TOKENS = [
  "--jata-ink",
  "--jata-paper",
  "--jata-card",
  "--jata-line",
  "--jata-muted",
  "--jata-accent",
  "--jata-live",
  "--jata-danger",
  "--jata-focus",
  "--jata-radius",
  "--jata-shadow",
  "--jata-space-1",
  "--jata-space-4",
  "--jata-space-6",
  "--jata-text-meta",
  "--jata-text-sm",
  "--jata-text-body",
  "--jata-text-lg",
  "--jata-text-title",
  "--jata-display",
  "--jata-radius-sm",
  "--jata-radius-md",
  "--jata-radius-lg",
  "--jata-radius-pill",
  "--jata-elevation-1",
  "--jata-elevation-2",
  "--jata-elevation-3",
  "--jata-success",
  "--jata-success-surface",
  "--jata-warning",
  "--jata-warning-surface",
  "--jata-info",
  "--jata-info-surface",
  "--jata-danger-surface",
  "--jata-focus-width",
  "--jata-focus-offset",
  "--jata-touch-target",
  "--jata-dur-fast",
  "--jata-dur-base",
  "--jata-ease-out",
] as const;

/**
 * Tokens every generated customer product inherits, whatever its category or theme.
 *
 * They are emitted by `themeCss()` (lib/experience/themes.ts) and applied as CSS custom
 * properties on the product root, so a shared design-system change reaches every published
 * product and every product an owner generates later — without per-template work.
 */
export const PRODUCT_FOUNDATION_TOKENS = [
  "--eb-space-1",
  "--eb-space-2",
  "--eb-space-3",
  "--eb-space-4",
  "--eb-space-5",
  "--eb-text-meta",
  "--eb-text-body",
  "--eb-radius-pill",
  "--eb-focus-width",
  "--eb-focus-offset",
  "--eb-touch-target",
  "--eb-dur-fast",
  "--eb-dur-base",
  "--eb-measure",
  "--eb-status-success",
  "--eb-status-success-surface",
  "--eb-status-warning",
  "--eb-status-warning-surface",
  "--eb-status-error",
  "--eb-status-error-surface",
] as const;

/** Interaction states every interactive component in the design system must define. */
export const REQUIRED_STATES = [
  "hover",
  "focus-visible",
  "pressed",
  "disabled",
  "loading",
  "empty",
  "error",
  "success",
] as const;

export type RequiredState = (typeof REQUIRED_STATES)[number];

/** The contract a Website Studio template and its rendered product must satisfy. */
export const TEMPLATE_CONTRACT = {
  /** The root element of every rendered product carries this class. */
  rootClass: "eb-scope",
  /** The Theme Engine injects the foundation tokens through `themeCss()`. */
  tokenSource: "lib/experience/themes.ts#themeCss",
  responsive: {
    /** Layouts must be usable from this width up without horizontal scrolling. */
    minSupportedWidthPx: 320,
    /** Touch targets: 44px minimum (WCAG 2.2 AA, 2.5.8). */
    minTouchTargetRem: 2.75,
  },
  accessibility: {
    /** WCAG 2.2 AA contrast for text and essential UI. */
    contrast: "AA",
    /** Keyboard reachable, visible focus, labelled controls, landmarks, one h1. */
    keyboard: true,
    /** Motion must be disableable and never required to complete a purchase. */
    reducedMotion: true,
  },
  performance: {
    /** Non-essential visualisations are lazily loaded, never blocking a transaction. */
    lazyNonEssentialVisuals: true,
  },
  /** Product-specific exceptions are declared here, never assumed. */
  exceptions: [] as string[],
} as const;

export type FoundationAudit = { ok: boolean; missing: string[] };

/**
 * Verifies that a set of resolved product CSS variables contains the shared foundation.
 * Used by the template-contract test and available to any renderer that wants to fail loudly
 * instead of shipping a product that silently drops the design system.
 */
export function auditProductFoundation(vars: Record<string, string>): FoundationAudit {
  const missing = PRODUCT_FOUNDATION_TOKENS.filter((token) => {
    const value = vars[token];
    return typeof value !== "string" || value.trim() === "";
  });
  return { ok: missing.length === 0, missing };
}

/** Every token the platform advertises must actually be defined somewhere. */
export function auditTokens(css: string, tokens: readonly string[]): FoundationAudit {
  const missing = tokens.filter((token) => !new RegExp(`${token}\\s*:`).test(css));
  return { ok: missing.length === 0, missing };
}
