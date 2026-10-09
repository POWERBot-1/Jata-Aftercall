import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { describeMpesaConfig } from "@/lib/payments/config";

/**
 * JATA internal: is the M-PESA connector ready in this deployment, and if not, which variable
 * fails which rule (§73).
 *
 * Admin only and read-only. It reports the environment, whether collections and reversals are
 * ready, the names of missing variables, the *rule* each malformed one broke, and the callback
 * URLs with their token redacted — never a credential, a passkey, a SecurityCredential or the
 * token itself. That is what makes it safe to use during a go-live check: an operator can confirm
 * the production connector without anyone reading a secret.
 *
 * It never calls Safaricom and never changes anything.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  return NextResponse.json({ mpesa: describeMpesaConfig() }, { headers: { "Cache-Control": "no-store" } });
}
