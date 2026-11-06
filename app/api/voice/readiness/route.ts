import { NextResponse } from "next/server";
import { getVoiceReadiness } from "@/lib/telnyx/voice-readiness";
export const dynamic = "force-dynamic";
export const revalidate = 0;
/** Public status only. Never returns provider credentials or internal endpoint details. */
export async function GET() {
  const readiness = getVoiceReadiness();
  return NextResponse.json({
    product: "JATA AFTERCALL Front Desk Voice",
    state: readiness.state,
    canReceiveCalls: readiness.canReceiveCalls,
    canSell: readiness.canSell,
    publicNumber: readiness.publicNumber,
    operatorMessage: readiness.operatorMessage,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
