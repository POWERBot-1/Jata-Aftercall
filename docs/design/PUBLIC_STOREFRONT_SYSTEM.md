# Public storefront design system

**Status:** implemented · **Date:** 2026-11-06 · **Scope:** every public business page (`/b/[slug]`, Experience/website pages)

## Why this exists

The public Business Page and the Experience/website engine each carried their own token set, so two
pages of the same product could look like two products. This document records the single source of
truth that replaced the duplication, and the rules a storefront change must respect.

| Layer | File | Owns |
| --- | --- | --- |
| Identity constants, colour maths, category art, accent validation | `lib/storefront/tokens.ts` | platform palette, WCAG maths, `businessAccent()` |
| Theme resolution, legacy-theme inheritance, hero image safety | `lib/storefront/theme.ts` | `storefrontThemeFor()`, `accentForLegacyTheme()`, `resolveHeroImage()` |
| Presentation | `app/storefront.css` (`.st-*`) | one stylesheet, imported once by `app/layout.tsx` |
| Components | `components/storefront/public/StoreHero.tsx`, `StoreSection.tsx`, `StoreFooter.tsx` | hero, section shell, attribution |
| Engine bridge | `lib/experience/themes.ts` → `themeStyleVars()` | publishes the same `--st-*` tokens from an Experience theme |

`.st-*` classes are never written into `app/globals.css`: that file is pinned by
`tests/unit/original-design-restoration-2026.test.ts`, and the public system is a separate sheet.

## Two-layer branding

1. **Platform layer (always).** Graphite structure `#16181d`, lime highlight `#b6ff2e`, dark raised
   surfaces, high-contrast type (`#f4f6f0` / `#c2c8d1` / `#a8b0bc`), one spacing rhythm, one radius
   scale, one attribution footer. A business cannot change any of these.
2. **Business layer (guest).** Name, logo, description, services, products, offers, contacts,
   opening hours, imagery and — where the platform stores one — an accent colour.

A business accent is honoured **only** while it is a well-formed hex value that keeps ≥3:1 contrast
against the page canvas (`AA_LARGE_MINIMUM`). Anything else falls back to the platform lime, and
`accentFallbackReason` records why (`none` / `absent` / `invalid` / `low-contrast`). An accent never
reaches a radius, a spacing step, a type size or a layout rule. Legacy themes are inherited the same
way: `warm` contributes its amber `#F0A04B`; `clean` and `dark` contribute nothing, so they take the
platform lime rather than inventing a new one.

## IMAGE IS EVERYTHING

* The hero leads the page: full-bleed media, a graded scrim that keeps copy legible over any
  photograph, primary actions on top of it, responsive `720w` / `1100w` webp + jpg sources.
* Only imagery the platform actually holds for that business is used — an uploaded cover first, then
  a verified demo fixture's own illustrative photograph. Nothing is generated.
* Illustrative imagery is captioned as illustrative in the alt text **and** in a visible note. It is
  never presented as the business's own photography.
* No image at all renders an intentional composition: a category-toned graphite panel with the
  business monogram. Never an empty frame, never a stock photograph standing in for a business that
  never supplied one.
* Art direction is per category (`restaurant`, `beauty`, `automotive`, `property`, `retail`,
  `general`) and carried by one controlled tone over the same graphite structure — a restaurant, a
  salon and a garage must not look identical, but must all belong to JATA AFTERCALL.
* URLs are allow-listed before they reach an `src`: same-origin `/…` paths or `https://` only.

## Conversion and states

WhatsApp, call, quote, directions, share and QR destinations keep working unchanged; only their skin
changed (`.st-action--whatsapp|call|neutral`, `.st-actions__status`). Contact details always come
from the business record — no fixture or demo contact detail is written into a shared component.
Loyalty 2.0 (`LoyaltyRewardsSection`, `PointsWalletLookup`) renders through the same `.st-loyalty`
tokens; its inactive / active / unconfirmed states, card-code normalisation and tenant isolation are
untouched, and no programme is activated, no points issued and no balance changed.

## Tests

`tests/unit/public-storefront-system.test.tsx` covers identity constants, the accent guard, category
art direction, hero image safety and disclosure, section cohesion, and the Experience-engine token
bridge. Existing gates (`business-page-contrast`, `opening-hours`, `business-hub-boundaries`,
`storefront-motion-inheritance`, `public-loyalty-rewards-*`, `design-system`,
`original-design-restoration-2026`) continue to run unchanged.
