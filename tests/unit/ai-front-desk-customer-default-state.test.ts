/**
 * F3 regression — the customer-facing AI Front Desk must never default to LIVE.
 *
 * The review of PR #66 found `publicationState = "LIVE"` as the component's default parameter.
 * No caller relied on it (the only caller, `app/b/[slug]/ai/page.tsx`, always passes the
 * server-derived value), so it was unreachable — but it is exactly the anti-pattern this branch
 * exists to remove: a missing prop, a null prop or a future caller could paint a live badge on a
 * desk that was never published or paid for.
 *
 * These are rendering tests, not screenshots: they assert what the server-rendered markup says
 * about the desk's lifecycle.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AIFrontDeskCustomerClient from "@/components/AIFrontDeskCustomerClient";

const root = path.resolve(__dirname, "../..");

const business = {
  id: "biz_a",
  slug: "savanna-bakery",
  name: "Savanna Bakery",
  category: "Bakery",
  description: "Fresh cakes, bread and samosas baked daily in Kitengela.",
  location: "Kitengela, Kajiado",
  phone: "0712345678",
  whatsapp: "0712345678",
  openingHours: "Mon-Sat 8am-6pm",
};

type Props = React.ComponentProps<typeof AIFrontDeskCustomerClient>;

function baseProps(): Props {
  return {
    business,
    products: [{ id: "p1", name: "Black Forest Cake", priceKES: 2500, stockStatus: "IN_STOCK" } as any],
    services: [],
    deliveryZones: [{ name: "Kitengela", feeKES: 200 } as any],
    greetingMessage: "Karibu Savanna Bakery! Ask about cakes, prices or delivery.",
    suggestedActions: ["How much is the Black Forest Cake?"],
    operationalStatus: "LIVE",
    pauseAllOrdering: false,
    qrSvg: "<svg aria-hidden=\"true\"></svg>",
    shareUrl: "https://jata.test/b/savanna-bakery/ai",
  };
}

/** The status pill's exact rendered text, e.g. "AI Front Desk · Draft". */
const LIVE_PILL = "AI Front Desk · Live";

/** Renders the component with `publicationState` omitted entirely (the F3 defect) or set. */
function render(publicationState?: Props["publicationState"]) {
  const props = baseProps() as Record<string, unknown>;
  if (publicationState === undefined) delete props.publicationState;
  else props.publicationState = publicationState;
  return renderToStaticMarkup(
    React.createElement(AIFrontDeskCustomerClient, props as unknown as Props),
  );
}

describe("publication state defaults", () => {
  it("renders the desk as a draft when no publication state is supplied", () => {
    const html = render();
    expect(html).toContain("AI Front Desk · Draft");
    expect(html).not.toContain(LIVE_PILL);
  });

  it("keeps an explicit DRAFT a draft", () => {
    const html = render("DRAFT");
    expect(html).toContain("AI Front Desk · Draft");
    expect(html).not.toContain(LIVE_PILL);
  });

  it("still renders a server-confirmed LIVE desk as live", () => {
    const html = render("LIVE");
    expect(html).toContain(LIVE_PILL);
    expect(html).not.toContain("AI Front Desk · Draft");
  });

  it("renders every other server state truthfully", () => {
    expect(render("PREVIEW")).toContain("AI Front Desk · Private preview");
    expect(render("PAUSED")).toContain("AI Front Desk · Paused");
    expect(render("MAINTENANCE")).toContain("AI Front Desk · Maintenance");
    expect(render("SUSPENDED")).toContain("AI Front Desk · Not live");
    for (const state of ["PREVIEW", "PAUSED", "MAINTENANCE", "SUSPENDED"] as const) {
      expect(render(state), state).not.toContain(LIVE_PILL);
    }
  });

  it("never claims LIVE for a null or unrecognised state", () => {
    // A server bug that passes null must degrade to the state that promises a customer nothing.
    for (const value of [null, "", "SOMETHING_ELSE"] as unknown as Props["publicationState"][]) {
      const html = render(value);
      expect(html, String(value)).not.toContain(LIVE_PILL);
    }
  });

  it("has no LIVE default left in the source", () => {
    const source = readFileSync(path.join(root, "components/AIFrontDeskCustomerClient.tsx"), "utf8");
    expect(source).not.toContain('publicationState = "LIVE"');
    expect(source).toContain('publicationState = "DRAFT"');
  });

  it("is only ever given a server-derived state by its one caller", () => {
    const caller = readFileSync(path.join(root, "app/b/[slug]/ai/page.tsx"), "utf8");
    // The page derives the state from the server publication and prefers DRAFT when absent.
    expect(caller).toContain('data.publication?.state ?? (isPreviewRequested ? "PREVIEW" : "DRAFT")');
    expect(caller).toContain("publicationState={publicationState}");
  });
});
