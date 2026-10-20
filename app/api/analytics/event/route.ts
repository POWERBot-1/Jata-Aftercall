import { NextResponse } from "next/server";
import { recordEvent, EVENT_TYPES, hashSession } from "@/lib/analytics";
import { rateLimit, trustedClientIp } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const limit = rateLimit(req, { key: "analytics-event", max: 100, windowMs: 60_000 });
  if (!limit.allowed) return limit.response ?? NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const ip = trustedClientIp(req.headers) ?? "unknown";

  try {
    const body = await req.json();
    const { businessId, eventType, source, subjectId } = body as { businessId?: string; eventType?: string; source?: string; subjectId?: string };
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
      // Optional subject (product/service id) for per-item analytics (§31, §32).
      subjectId: typeof subjectId === "string" ? subjectId.slice(0, 64) : null,
      sessionHash: hashSession({ ip, userAgent: req.headers.get("user-agent") }),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
