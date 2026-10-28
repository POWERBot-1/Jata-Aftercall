import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import prisma from "./db";
import { requestCache } from "./request-cache";

const SESSION_COOKIE = "jata_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET not configured");
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  userId: string;
  email: string;
  role: string;
  name?: string | null;
  /** Credentials reset increments the stored value to revoke every session issued before it. */
  sessionVersion?: number;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload, sessionVersion: payload.sessionVersion ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string" || typeof payload.email !== "string" || typeof payload.role !== "string") return null;
    if (payload.sessionVersion !== undefined && (!Number.isSafeInteger(payload.sessionVersion) || Number(payload.sessionVersion) < 0)) return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** Fail closed if the account is gone or the password-reset revocation check cannot reach Postgres. */
async function verifyCurrentSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { sessionVersion: true },
    });
    if (!user) return null;
    const tokenVersion = session.sessionVersion ?? 0;
    if (tokenVersion !== Number(user.sessionVersion ?? 0)) return null;
    return { ...session, sessionVersion: tokenVersion };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = await createSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
}

async function getSessionUncached(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return verifyCurrentSession(cookieStore.get(SESSION_COOKIE)?.value);
}

// M11 #418: one session read per request, shared by generateMetadata and page bodies so
// no uncached await lags the SSR root segment behind the head (see lib/request-cache.ts).
export const getSession = requestCache(getSessionUncached);

async function getCurrentUserUncached(): Promise<(SessionPayload & { id: string }) | null> {
  try {
    const session = await getSession();
    if (!session) return null;
    return {
      ...session,
      id: session.userId,
    };
  } catch {
    return null;
  }
}

export const getCurrentUser = requestCache(getCurrentUserUncached);

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}

// Helper for APIs that receive a session token directly; password-reset revocation applies here too.
export async function getSessionFromToken(token: string | undefined): Promise<SessionPayload | null> {
  return verifyCurrentSession(token);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
