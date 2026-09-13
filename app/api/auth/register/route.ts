import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { validateEmail, validatePhone, sanitizeText } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let { name, email, phone, password } = body as { name?: string; email?: string; phone?: string; password?: string };

    name = sanitizeText(name || "", 80);
    email = (email || "").trim().toLowerCase();
    phone = (phone || "").trim();
    password = password || "";

    if (!name || name.length < 2) return NextResponse.json({ error: "Name is required (min 2)" }, { status: 400 });
    if (!validateEmail(email)) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    if (!validatePhone(phone)) return NextResponse.json({ error: "Valid phone required" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Password min 8 characters" }, { status: 400 });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });

    const passwordHash = await hashPassword(password);

    // Admin check via ADMIN_EMAILS env
    const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const role = adminEmails.includes(email) ? "ADMIN" : "CUSTOMER";

    const user = await prisma.user.create({
      data: { name, email, phone, passwordHash, role: role as any },
    });

    await logAudit({ actorId: user.id, action: "USER_REGISTERED", targetType: "USER", targetId: user.id });

    await setSessionCookie({ userId: user.id, email: user.email, role: user.role, name: user.name });

    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
