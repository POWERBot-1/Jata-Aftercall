import { NextResponse } from "next/server";
import { getControlIdentity } from "@/lib/control/access";

/**
 * Legacy team-access administration is disabled until owner-authorized,
 * action-specific capabilities and approval records are implemented.
 * ADMIN role strings are not sufficient authority.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const access = await getControlIdentity();
  if (!access.ok) {
    return NextResponse.json(
      { error: access.code === "UNAUTHENTICATED" ? "Please sign in." : "Owner-authorized team administration is not enabled." , code: access.code },
      { status: access.status },
    );
  }
  return NextResponse.json(
    { error: "Team-access administration is disabled pending explicit owner-authorized capability enforcement.", code: "OWNER_POLICY_PENDING" },
    { status: 403 },
  );
}
