/**
 * Shared M-PESA webhook handler (§35, §111).
 *
 * The central callback URL is a family of paths: `/stk` (STK prompt result), `/confirmation`
 * and `/validation` (C2B over the counter), `/result` and `/timeout` (C2B reversal outcome,
 * registered by the adapter), plus the bare path as the documented union endpoint. Every
 * member of the family runs this exact same code — a size-bounded JSON body, adapter
 * authentication, then the shared pipeline — so no member can drift out of sync or accept
 * something the others refuse. Nothing here trusts the payload: the adapter verifies the
 * event first, and only then does the pipeline decide whether a payment is confirmed.
 *
 * The same handler is served under two path families: the neutral `/api/payments/webhooks/daraja/*`
 * that JATA registers by default (Daraja guidance says URLs containing "mpesa"/"safaricom" are
 * filtered), and the legacy `/api/payments/webhooks/mpesa/*`, which remains authenticated and live.
 */

import { NextResponse } from "next/server";
import { applyProviderEvent, type WebhookResult } from "@/lib/payments/webhooks";

export async function mpesaWebhookHandler(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 128_000) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const result = await applyProviderEvent({
    provider: "MPESA",
    rawBody,
    payload,
    headers: request.headers,
    url: new URL(request.url),
  });

  const reply = darajaAcknowledgement(new URL(request.url).pathname, result);
  return NextResponse.json(reply.body, { status: reply.status });
}

/**
 * What Safaricom is told. Daraja expects an acknowledgement body — `{"ResultCode":0,"ResultDesc":"Accepted"}`
 * — and for C2B *validation* that body is the decision itself: ResultCode "0" lets the customer's
 * payment proceed, a `C2B000xx` code rejects it. JATA's own outcome travels alongside it in `status`.
 *
 * Refusals (bad token, malformed body) and server errors are not acknowledgements: they keep their
 * own status and body, and a refused request is never told it was "Accepted".
 */
export function darajaAcknowledgement(
  pathname: string,
  result: Pick<WebhookResult, "status" | "httpStatus" | "body">,
): { body: Record<string, unknown>; status: number } {
  if (result.status === "rejected" || result.status === "failed") {
    return { body: result.body, status: result.httpStatus };
  }
  const path = pathname.replace(/\/+$/, "");
  if (path.endsWith("/validation")) {
    // Accept unless the validation payload itself was unusable; a repeated validation (already
    // processed) is accepted again, since the first answer is what the customer's payment awaits.
    const rejected = result.body.reason === "VALIDATION_INCOMPLETE";
    return {
      body: rejected ? { ResultCode: "C2B00016", ResultDesc: "Rejected" } : { ResultCode: "0", ResultDesc: "Accepted" },
      status: 200,
    };
  }
  return { body: { ResultCode: 0, ResultDesc: "Accepted", ...result.body }, status: result.httpStatus };
}

/** Some C2B configurations issue a GET validation probe; it is answered without side effects. */
export function mpesaWebhookProbe(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
