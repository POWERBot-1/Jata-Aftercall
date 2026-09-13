import { NextResponse } from "next/server";
import { recordEvent, EVENT_TYPES } from "@/lib/analytics";

// Rate limit in-memory (zero-cost)
const hits = new Map<string, { count: number; reset: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now > e.reset) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  e.count++;
  return e.count > 100;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  try {
    const body = await req.json();
    const { businessId, eventType, source } = body as { businessId?: string; eventType?: string; source?: string };
    if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });
    if (!eventType || !(EVENT_TYPES as readonly string[]).includes(eventType)) {
      return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
    }

    await recordEvent({
      businessId,
      eventType: eventType as any,
      ip,
      userAgent: req.headers.get("user-agent"),
      source,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
