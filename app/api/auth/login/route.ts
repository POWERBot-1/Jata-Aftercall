import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const limit = rateLimit(req, { key: "auth-login", max: 20, windowMs: 60_000 });
  if (!limit.allowed) return limit.response ?? NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  try {
    const { email, password } = await req.json();
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized || !password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    await logAudit({ actorId: user.id, action: "USER_LOGIN", targetType: "USER", targetId: user.id });

    await setSessionCookie({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      sessionVersion: user.sessionVersion ?? 0,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
