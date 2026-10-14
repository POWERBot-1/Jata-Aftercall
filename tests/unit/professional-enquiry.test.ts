import React from "react";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { describe, expect, it } from "vitest";
import { EnquiryClient } from "@/components/storefront/EnquiryClient";
import { validateEnquiryInput } from "@/lib/experience/enquiries";
import { professionalEnquiryHref, isBookableConsultation } from "@/lib/experience/professionalWorkflow";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import { seedNewDocument } from "@/lib/experience/variant";
import { validateExperienceDocument } from "@/lib/experience/schema";
import { businessRecipeFor, documentBusinessRecipe, recipeCatalogue, defaultBusinessRecipe } from "@/lib/experience/businessRecipes";
import type { StorefrontItem } from "@/lib/experience/storefront";
const valid = { slug: "owned-pro", serviceId: "owned-service", customerName: "QA customer", customerPhone: "0712345678", customerEmail: "qa@test.invalid", notes: "Requirements", idempotencyKey: "qa-replay-key-123456" };
const quote = { id: "owned-service", name: "Owner quote work", description: "Owner scope", kind: "service" as const, price: null, pricingType: "QUOTE" as const, bookingEnabled: false };
const router = { bfcacheId: "qa-router-fixture", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const render = (preview = false) => renderToString(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(EnquiryClient, { slug: "owned-pro", services: [quote], preview })));

describe("professional service requests", () => {
  it("accepts only valid bounded contact/service requests without dates, money or tenant authority", () => {
    const parsed = validateEnquiryInput(valid); expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") { expect(parsed.input.serviceId).toBe(quote.id); expect(parsed.input).not.toHaveProperty("date"); }
  });
  it("locks the authenticated runner's exact payload shapes (slugify slug, runId idempotency key, cuid service)", () => {
    // scripts/browser/studio-authenticated.check.mjs sends exactly these formats in production mode.
    const runnerBody = { slug: "qa-professional-a1b2c3d4", serviceId: "cm0abc123def456ghi789jkl", customerName: "QA Draft requester",
      customerPhone: "0700111222", idempotencyKey: "draft-a1b2c3d4-request-123" };
    const parsed = validateEnquiryInput(runnerBody); expect(parsed.kind).toBe("ok");
    expect(validateEnquiryInput({ ...runnerBody, idempotencyKey: "draft-a1b2c3d4.request.123" }).kind).toBe("error");
    expect(validateEnquiryInput({ ...runnerBody, slug: "QA-Professional-2026" }).kind).toBe("error");
  });
  it.each([{ customerName: "A" }, { customerPhone: "12" }, { customerEmail: "invalid" }, { notes: "x".repeat(1001) }, { serviceId: "../foreign" }, { idempotencyKey: "short" }, { customerPhone: "javascript:0712345678" }])("rejects invalid customer fields: %j", (patch) => {
    expect(validateEnquiryInput({ ...valid, ...patch }).kind).toBe("error");
  });
  it("rejects all authority/executable/marketing fields rather than normalizing them away", () => {
    for (const key of ["businessId", "amount", "depositKES", "status", "code", "subscribe", "marketing", "date"]) expect(validateEnquiryInput({ ...valid, [key]: "FORGED" }).kind).toBe("error");
  });
  it("renders actual quote service/contact fields and explicit request-only/no-JS semantics, without slots or dummy products", () => {
    const html = render();
    expect(html).toContain("Owner quote work"); expect(html).toContain("Owner scope"); expect(html).toContain('id="eq-name"'); expect(html).toContain('id="eq-phone"');
    expect(html).toContain("Send enquiry"); expect(html).toContain("not a confirmed booking"); expect(html).toContain("Call or WhatsApp");
    expect(html).not.toContain("Choose a date"); expect(html).not.toContain("Choose a time"); expect(html).not.toContain("bk-service"); expect(html).not.toContain("KES 0");
  });
  it("disables unpublished preview writes while keeping the same real service facts readable", () => {
    const html = render(true); expect(html).toContain("Owner quote work"); expect(html).toContain("cannot be submitted"); expect(html).toContain('disabled=""');
  });
  it("differentiates server-backed bookable consultations from quotation/nonbookable work", () => {
    expect(isBookableConsultation(quote)).toBe(false);
    expect(isBookableConsultation({ ...quote, price: 900, pricingType: "FIXED", bookingEnabled: true })).toBe(true);
    expect(isBookableConsultation({ ...quote, price: 900, pricingType: "FIXED", bookingEnabled: false })).toBe(false);
    expect(professionalEnquiryHref("owned-pro", "owned-service")).toBe("/b/owned-pro/enquire?service=owned-service");
  });
  it("seeds only new professional v2 documents with exact versioned service recipe; never normalizes legacy into it", () => {
    const legacy = createExperienceDocument({ categoryKey: "professional", businessName: "Owner practice" });
    expect(documentBusinessRecipe(normalizeExperienceDocument(legacy))).toBeNull();
    const seeded = seedNewDocument(legacy, "QA-PROFESSIONAL").document;
    expect(documentBusinessRecipe(seeded)).toEqual({ version: 1, key: "professional-enquiry", details: ["staff", "duration", "deposit"] });
    expect(validateExperienceDocument(seeded).ok).toBe(true);
    const service = { ...quote, variants: [], addOns: [] } as unknown as StorefrontItem;
    const product = { ...service, id: "irrelevant-product", kind: "product" as const };
    expect(recipeCatalogue({ services: [service], items: [product] }, defaultBusinessRecipe(businessRecipeFor("professional")!))).toEqual([service]);
  });
});
