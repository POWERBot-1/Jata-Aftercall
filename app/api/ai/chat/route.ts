/**
 * AI Chat / Q&A (§20, §21, §25) — retrieval-augmented response engine.
 * Uses the Business Brain (structured records) as the authoritative source (§95).
 * Never invents prices, inventory, or policies (§9, §32, §101).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { getBusinessBrain } from "@/lib/ai-business-brain";
import { getAIPackageStatus } from "@/lib/ai-entitlement";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";

/** Basic keyword-based retrieval from structured business brain. */
function retrieveFromBrain(question: string, brain: Awaited<ReturnType<typeof getBusinessBrain>>) {
  const q = question.toLowerCase();
  const answers: string[] = [];

  // Check for inventory-related questions (§10)
  if (q.includes("available") || q.includes("stock") || q.includes("have") || q.includes("in stock") || q.includes("out of stock")) {
    const productMatches = brain.products.filter((p) => {
      const nameMatch = p.name.toLowerCase().includes(q.split(" ").filter((w) => w.length > 2).join(" ") || q);
      return nameMatch;
    });
    for (const product of productMatches) {
      answers.push(`Product: ${product.name} — Status: ${product.stockStatus} — Price: KES ${product.basePriceKES ?? product.variantPriceKES}`);
    }
    if (answers.length === 0 && brain.products.length > 0) {
      answers.push("I couldn't confirm the exact product you're asking about. Please specify the product name or check our available products.");
    }
  }

  // Check for price questions (§11)
  if (q.includes("price") || q.includes("cost") || q.includes("how much") || q.includes("price is")) {
    for (const product of brain.products) {
      if (product.name.toLowerCase().includes(q) || q.includes(product.category?.toLowerCase() || "")) {
        answers.push(`${product.name}: KES ${product.basePriceKES ?? product.variantPriceKES ?? "See details"}`);
      }
    }
  }

  // Check opening hours (§11, §61)
  if (q.includes("open") || q.includes("hours") || q.includes("close") || q.includes("when are you open")) {
    try {
      const business = brain.business;
      if (business.openingHours) {
        const hours = JSON.parse(business.openingHours);
        answers.push(`Opening hours: ${JSON.stringify(hours)}`);
      } else {
        answers.push("Opening hours have not been configured yet.");
      }
    } catch {
      answers.push("Opening hours information is not available in a readable format.");
    }
  }

  // Check delivery (§5, §11)
  if (q.includes("deliver") || q.includes("delivery") || q.includes("shipping")) {
    answers.push("Delivery information: configured per business settings. Please ask specifically about zones or fees for accurate details.");
  }

  // Check FAQs (§8)
  for (const faq of brain.faqs) {
    if (faq.question.toLowerCase().includes(q.split(" ").find((w) => w.length > 3) || "") || q.includes(faq.question.toLowerCase())) {
      answers.push(`FAQ: ${faq.question} — ${faq.approvedAnswer}`);
    }
  }

  // If nothing retrieved specifically, provide a generic structured response based on business identity (§100, §101)
  if (answers.length === 0) {
    answers.push(`This is the AI assistant for ${brain.business.name || "this business"}. I can help with products, prices, availability, delivery info, and orders. What would you like to know?`);
  }

  return answers;
}

export async function POST(req: Request) {
  const session = await getSession();
  // Preview mode: no session required for preview; live mode requires entitlement.
  // The spec requires preview does not create real orders or notify live numbers (§52).
  const url = new URL(req.url);
  const businessId = (await req.json()).businessId || url.searchParams.get("businessId") || "";

  try {
    const body = await req.json();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!businessId) return NextResponse.json({ error: "Business context required." }, { status: 400 });
    if (!question || question.length < 2) return NextResponse.json({ error: "Please ask a question." }, { status: 400 });
    if (question.length > 1000) return NextResponse.json({ error: "Question too long." }, { status: 400 });

    // For preview mode (no session), we allow read-only brain access but enforce no mutation.
    // For live mode, enforce entitlement (§49, §50).
    let entitlementActive = false;
    if (session) {
      const guard = await guardTenantMutation(session, businessId);
      if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
      const status = await getAIPackageStatus(businessId);
      entitlementActive = status.active;
    }

    const brain = await getBusinessBrain(businessId);
    const retrieved = retrieveFromBrain(question, brain);

    // Response policy (§25): distinguish between KNOWN, UNKNOWN, ACTION REQUIRED.
    const hasSpecificAnswer = retrieved.some((a) => !a.includes("couldn't confirm") && !a.includes("not available") && !a.includes("What would you like"));

    return NextResponse.json({
      businessId,
      question,
      answers: retrieved,
      grounding: {
        sourcesUsed: ["structured_business_data"],
        structuredUsed: brain.products.length > 0 || brain.services.length > 0 || brain.faqs.length > 0,
        confidence: hasSpecificAnswer ? "high" : "low",
      },
      mode: session ? (entitlementActive ? "live" : "entitlement_required") : "preview",
    });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
