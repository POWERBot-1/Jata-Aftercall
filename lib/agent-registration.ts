import { createHmac, randomInt } from "node:crypto";
import prisma from "@/lib/db";
import { trustedClientIp } from "@/lib/rate-limit";
import { validateEmail } from "@/lib/validation";
import { validateAgentApplication } from "@/lib/agent-application";

export function agentRegistrationEnabled(): boolean {
  return process.env.AGENT_SELF_SERVICE_REGISTRATION_ENABLED === "true";
}

type Registration = { fullName: string; phoneE164: string; email: string; password: string };
export function validateAgentRegistration(input: unknown): Registration | null {
  const application = validateAgentApplication(input);
  if (!application || !input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (typeof body.email !== "string" || typeof body.password !== "string" || body.termsAccepted !== true) return null;
  const email = body.email.trim().toLowerCase();
  // bcrypt uses only the first 72 bytes. Reject longer passwords rather than silently truncating.
  const bytes = Buffer.byteLength(body.password, "utf8");
  if (email.length > 254 || !validateEmail(email) || body.password.length < 8 || bytes > 72) return null;
  return { ...application, email, password: body.password };
}

/** Database-backed fixed-window limiter; failures must fail closed. */
export async function allowAgentRegistration(request: Request): Promise<boolean> {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Registration limiter unavailable");
  // Untrusted proxy headers never become identities. Unknown clients share a conservative bucket.
  const identity = trustedClientIp(request.headers) ?? "untrusted-proxy";
  const key = createHmac("sha256", secret).update(`agent-registration:v1:${identity}`).digest("hex");
  // Opportunistic expiry cleanup bounds stored fingerprints without a separate scheduler. Cleanup
  // failure fails the request closed, and the expiry index keeps it efficient.
  if (randomInt(100) === 0) {
    await prisma.agentRegistrationThrottle.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
  }
  const rows: Array<{ count: number }> = await prisma.$queryRaw`
    INSERT INTO "AgentRegistrationThrottle" ("key", "count", "expiresAt")
    VALUES (${key}, 1, NOW() + INTERVAL '15 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AgentRegistrationThrottle"."expiresAt" <= NOW() THEN 1 ELSE "AgentRegistrationThrottle"."count" + 1 END,
      "expiresAt" = CASE WHEN "AgentRegistrationThrottle"."expiresAt" <= NOW() THEN NOW() + INTERVAL '15 minutes' ELSE "AgentRegistrationThrottle"."expiresAt" END
    WHERE "AgentRegistrationThrottle"."expiresAt" <= NOW() OR "AgentRegistrationThrottle"."count" < 5
    RETURNING "count"`;
  return rows.length === 1;
}

/** Read a small JSON body without trusting Content-Length or allocating an unbounded buffer. */
export async function readSmallJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error("Body too large"); }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}
