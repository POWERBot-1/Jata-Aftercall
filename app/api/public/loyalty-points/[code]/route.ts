import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { walletForCardCode } from "@/lib/business-hub/loyaltyPoints";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };

/**
 * Customer-visible points wallet (Loyalty 2.0).
 *
 * The card code is the customer's bearer token, so this is the only public read of a points
 * record. It returns that wallet's own balance, history and the rewards it can afford — never a
 * contact value, never an owner note, never another customer's wallet, and nothing at all when the
 * business has not switched its points programme on.
 *
 * The code is normalised (trimmed, de-spaced, upper-cased) before the lookup, because a customer
 * types it by hand; and `?business=<slug>` scopes the answer to the business whose page asked, so a
 * code issued elsewhere is refused with the same 404 as a code that does not exist.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const limit = rateLimit(req, { key: "hub-points-wallet", max: 30, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429, headers: noStore });
  }

  const { code } = await params;
  // `business` is the slug of the page the customer is looking at. The wallet is refused when the
  // card belongs to a different business, so one business's page cannot open another's wallet.
  const expectedSlug = new URL(req.url).searchParams.get("business");
  const wallet = await walletForCardCode(code, { businessSlug: expectedSlug ?? undefined });
  if (!wallet) {
    return NextResponse.json(
      { error: "We couldn't find that loyalty card. Check the code on your card and try again." },
      { status: 404, headers: noStore },
    );
  }

  if (!("active" in wallet) || wallet.active !== true) {
    return NextResponse.json(
      {
        businessName: wallet.businessName,
        businessSlug: wallet.businessSlug,
        active: false,
        message: "This business has not switched on points yet.",
      },
      { status: 200, headers: noStore },
    );
  }

  return NextResponse.json(
    {
      ...wallet,
      message:
        wallet.status !== "ACTIVE"
          ? "This wallet is paused. Please speak to the business."
          : "Points are added by the business after it verifies your purchase. Your balance updates as soon as they do.",
    },
    { status: 200, headers: noStore },
  );
}
