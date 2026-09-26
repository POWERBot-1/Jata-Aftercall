import { NextResponse } from "next/server";
import { isRegisterFailure, registerOwner } from "@/lib/registration";
import { SAFE_ERRORS } from "@/lib/safeError";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: SAFE_ERRORS.registerUnreadable }, { status: 400 });
    }
    const result = await registerOwner({
      name: body.name,
      email: body.email,
      phone: body.phone,
      password: body.password,
      businessName: body.businessName,
    });
    if (isRegisterFailure(result)) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, user: result.user });
  } catch {
    console.error("registration failed");
    return NextResponse.json({ error: SAFE_ERRORS.registerUnexpected }, { status: 500 });
  }
}
