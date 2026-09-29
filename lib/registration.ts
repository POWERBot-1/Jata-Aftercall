import prisma from "./db";
import { hashPassword, setSessionCookie, type SessionPayload } from "./auth";
import { logAudit } from "./audit";
import { sanitizeText, validateEmail, validatePhone } from "./validation";
import { slugify, validateSlug } from "./slug";
import { SAFE_ERRORS } from "./safeError";
import {
  claimReferralInTransaction,
  isSelfReferral,
  rejectReferralInTransaction,
  resolveReferralForRegistration,
  type ReferralResolution,
  type ReferrerSnapshot,
} from "./referral";

export type RegisterInput = {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  businessName?: string;
  /**
   * Stage 2: referral context for a self-service referral. Both values are hints only — the
   * referrer is always resolved server-side from the persisted attribution before anything is
   * recorded. Never trust them as an attribution record on their own.
   */
  referral?: { code?: unknown; token?: unknown };
};

export type RegisterSuccess = {
  ok: true;
  user: { id: string; email: string };
  business: { id: string; slug: string };
  /** Present only when a referral link was involved. Contains no other tenant's data. */
  referral?: { recorded: boolean; reason?: string };
};

export type RegisterFailure = {
  ok: false;
  status: number;
  error: string;
};

export function isRegisterFailure(result: { ok: boolean }): result is RegisterFailure {
  return result.ok === false;
}

type Tx = {
  user: {
    findUnique: (args: { where: { email: string } }) => Promise<{ id: string } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string; email: string; role: string; name: string | null }>;
  };
  business: {
    findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string; slug: string }>;
  };
  businessMember: {
    create: (args: { data: { userId: string; businessId: string; role: "OWNER" } }) => Promise<{ id: string }>;
  };
  /**
   * Stage 2: optional so the referral claim can join the same transaction as the business
   * creation. Absent on older/dependency-free callers, in which case no referral is recorded.
   */
  referral?: {
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  };
};

export type RegisterDeps = {
  hashPassword: (password: string) => Promise<string>;
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  logAudit: (params: { actorId?: string | null; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> }) => Promise<void>;
  issueSession: (payload: SessionPayload) => Promise<void>;
  adminEmails: string[];
  /** Stage 2: injected so registration stays testable without touching referral storage. */
  referral?: {
    resolve: (input: { code?: unknown; token?: unknown }) => Promise<ReferralResolution>;
    claim: (tx: Tx, params: { attributionId: string; referredUserId: string; referredBusinessId: string; now?: Date }) => Promise<{ recorded: boolean; reason?: string }>;
    reject: (tx: Tx, params: { attributionId: string; reason: string }) => Promise<void>;
  };
};

class DuplicateEmail extends Error {
  constructor() {
    super("duplicate-email");
    this.name = "DuplicateEmail";
  }
}

function adminEmailList(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function validateRegisterInput(input: RegisterInput): { ok: true; value: { name: string; email: string; phone: string; password: string; businessName: string } } | RegisterFailure {
  const name = sanitizeText(input.name || "", 80);
  const email = (input.email || "").trim().toLowerCase();
  const phone = (input.phone || "").trim();
  const password = input.password || "";
  const businessName = sanitizeText(input.businessName || name, 80);

  if (!name || name.length < 2) return { ok: false, status: 400, error: SAFE_ERRORS.registerName };
  if (!validateEmail(email)) return { ok: false, status: 400, error: SAFE_ERRORS.registerEmail };
  if (!validatePhone(phone)) return { ok: false, status: 400, error: SAFE_ERRORS.registerPhone };
  if (password.length < 8) return { ok: false, status: 400, error: SAFE_ERRORS.registerPassword };
  if (!businessName || businessName.length < 2) return { ok: false, status: 400, error: "Please enter a business name (at least 2 characters)." };

  return { ok: true, value: { name, email, phone, password, businessName } };
}

async function allocateSlug(tx: Tx, rawName: string): Promise<string> {
  let base = slugify(rawName);
  if (!validateSlug(base).valid) {
    base = slugify(`${rawName} page`);
  }
  if (!validateSlug(base).valid) base = "business-page";

  for (let i = 1; i < 100; i++) {
    const suffix = i === 1 ? "" : `-${i}`;
    const candidate = `${base.slice(0, 50 - suffix.length)}${suffix}`;
    if (!validateSlug(candidate).valid) continue;
    const taken = await tx.business.findUnique({ where: { slug: candidate } });
    if (!taken) return candidate;
  }
  const fallback = `business-page-${Date.now().toString(36)}`.slice(0, 50);
  return validateSlug(fallback).valid ? fallback : "business-page";
}

export async function registerOwner(input: RegisterInput, deps?: Partial<RegisterDeps>): Promise<RegisterSuccess | RegisterFailure> {
  const validated = validateRegisterInput(input);
  if (isRegisterFailure(validated)) return validated;

  const resolved: RegisterDeps = {
    hashPassword,
    transaction: (fn) => prisma.$transaction(fn),
    logAudit,
    issueSession: setSessionCookie,
    adminEmails: adminEmailList(process.env.ADMIN_EMAILS),
    ...deps,
  };
  if (!resolved.referral) {
    resolved.referral = {
      resolve: (input) => resolveReferralForRegistration(input),
      claim: (tx, params) => claimReferralInTransaction(tx, params),
      reject: (tx, params) => rejectReferralInTransaction(tx, { attributionId: params.attributionId, reason: params.reason as never }),
    };
  }

  const { name, email, phone, password, businessName } = validated.value;
  const passwordHash = await resolved.hashPassword(password);
  const role = resolved.adminEmails.includes(email) ? "ADMIN" : "CUSTOMER";

  // Stage 2: resolve the referral (server-side) before the transaction. A resolution failure
  // must never block a signup — it simply means no referral is recorded.
  let referralResolution: ReferralResolution | null = null;
  const referralHint = input.referral;
  if (referralHint && (referralHint.code || referralHint.token) && resolved.referral) {
    try {
      referralResolution = await resolved.referral.resolve({ code: referralHint.code, token: referralHint.token });
    } catch {
      console.error("referral resolution failed before registration");
      referralResolution = null;
    }
  }

  let created: { user: { id: string; email: string; role: string; name: string | null }; business: { id: string; slug: string }; referral?: { recorded: boolean; reason?: string } };
  try {
    created = await resolved.transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new DuplicateEmail();

      const user = await tx.user.create({
        data: { name, email, phone, passwordHash, role },
      });
      const slug = await allocateSlug(tx, businessName);
      const business = await tx.business.create({
        data: {
          ownerId: user.id,
          slug,
          name: businessName,
          category: "Other",
          phone,
          whatsapp: phone,
          theme: "clean",
          isPublished: false,
          status: "PENDING",
          aftercallMsg: "Thanks for contacting us",
        },
      });
      await tx.businessMember.create({
        data: { userId: user.id, businessId: business.id, role: "OWNER" },
      });

      // Stage 2: the referral is recorded in the SAME transaction as the recipient's first
      // business, so attribution and business creation commit or roll back together.
      let referral: { recorded: boolean; reason?: string } | undefined;
      if (referralResolution?.decision === "convert" && resolved.referral) {
        const referrer: ReferrerSnapshot = referralResolution.referrer;
        if (isSelfReferral(referrer, { email, phone })) {
          await resolved.referral.reject(tx, { attributionId: referralResolution.attributionId, reason: "self_referral" });
          referral = { recorded: false, reason: "self_referral" };
        } else {
          referral = await resolved.referral.claim(tx, {
            attributionId: referralResolution.attributionId,
            referredUserId: user.id,
            referredBusinessId: business.id,
          });
        }
      } else if (referralResolution?.decision === "reject") {
        if (referralResolution.attributionId && resolved.referral) {
          await resolved.referral.reject(tx, { attributionId: referralResolution.attributionId, reason: referralResolution.reason });
        }
        referral = { recorded: false, reason: referralResolution.reason };
      } else if (referralResolution?.decision === "skip") {
        referral = { recorded: false, reason: referralResolution.reason };
      }
      return { user, business, referral };
    });
  } catch (error) {
    if (error instanceof DuplicateEmail) {
      return { ok: false, status: 409, error: SAFE_ERRORS.registerDuplicate };
    }
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "P2002") {
      return { ok: false, status: 409, error: SAFE_ERRORS.registerDuplicate };
    }
    console.error("registration transaction failed");
    return { ok: false, status: 500, error: SAFE_ERRORS.registerUnexpected };
  }

  try {
    await resolved.logAudit({
      actorId: created.user.id,
      action: "USER_REGISTERED",
      targetType: "USER",
      targetId: created.user.id,
      metadata: created.referral?.recorded
        ? { businessId: created.business.id, referralRecorded: true }
        : { businessId: created.business.id },
    });
  } catch {
    console.error("audit write failed after registration");
  }

  // Stage 2: a separate audit trail for attribution. Never contains recipient contact details.
  if (created.referral?.recorded && referralResolution?.decision === "convert") {
    try {
      await resolved.logAudit({
        actorId: created.user.id,
        action: "REFERRAL_RECORDED",
        targetType: "REFERRAL",
        targetId: referralResolution.attributionId,
        metadata: {
          referrerUserId: referralResolution.referrer.ownerId,
          referrerBusinessId: referralResolution.referrer.businessId,
          referredBusinessId: created.business.id,
        },
      });
    } catch {
      console.error("referral audit write failed after registration");
    }
  }

  try {
    await resolved.issueSession({
      userId: created.user.id,
      email: created.user.email,
      role: created.user.role,
      name: created.user.name,
    });
  } catch {
    console.error("session issuance failed after registration");
    return { ok: false, status: 500, error: SAFE_ERRORS.registerSession };
  }

  return {
    ok: true,
    user: { id: created.user.id, email: created.user.email },
    business: { id: created.business.id, slug: created.business.slug },
    ...(created.referral ? { referral: created.referral } : {}),
  };
}
