import { createHash, randomBytes } from "node:crypto";
import prisma from "./db";
import { hashPassword } from "./auth";
import { sendPasswordResetEmail } from "./password-reset-email";

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_COOLDOWN_MS = 15 * 60 * 1000;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72; // bcrypt's effective input limit; reject instead of silently truncating.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function validPasswordResetToken(token: unknown): token is string {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
  return Buffer.from(token, "base64url").length === 32;
}

export function validRecoveryPassword(password: unknown): password is string {
  return typeof password === "string" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    Buffer.byteLength(password, "utf8") <= PASSWORD_MAX_BYTES;
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * A generic response is returned for unknown accounts, account cooldowns, and SMTP delivery
 * failures. A valid raw token is sent only through the configured SMTP transport; only its digest
 * is persisted. The per-account cooldown is claimed with a conditional UPDATE, so parallel app
 * instances cannot send repeated messages within the window.
 */
export async function requestPasswordReset(email: string, now = new Date()): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) return;

  const admitted = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [
        { passwordResetRequestedAt: null },
        { passwordResetRequestedAt: { lte: new Date(now.getTime() - PASSWORD_RESET_COOLDOWN_MS) } },
      ],
    },
    data: { passwordResetRequestedAt: now },
  });
  if (admitted.count !== 1) return;

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = tokenDigest(rawToken);
  await prisma.passwordResetToken.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    },
    update: {
      tokenHash,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
      usedAt: null,
      createdAt: now,
    },
  });

  try {
    await sendPasswordResetEmail(user.email, rawToken);
  } catch {
    // Do not leave a live token if delivery failed. Never log the email address or token.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, tokenHash, usedAt: null },
      data: { usedAt: now },
    });
    console.error("Password reset email delivery failed; recovery token invalidated.");
  }
}

/** Atomically claims an unexpired, unused token and changes the credential/revokes old sessions. */
export async function completePasswordReset(
  token: string,
  password: string,
  now?: Date,
): Promise<string | null> {
  if (!validPasswordResetToken(token) || !validRecoveryPassword(password)) return null;
  const tokenHash = tokenDigest(token);
  const preflightNow = now ?? new Date();

  // Avoid an expensive bcrypt operation for random, expired, or replayed bearer guesses. This
  // read is only a preflight: the transaction below re-reads and conditionally claims the token.
  const preflight = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!preflight || preflight.usedAt || preflight.expiresAt.getTime() <= preflightNow.getTime()) return null;

  const newPasswordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const claimTime = now ?? new Date();
    const candidate = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!candidate || candidate.usedAt || candidate.expiresAt.getTime() <= claimTime.getTime()) return null;

    // This conditional write, not either preceding read, decides the winner under concurrent reuse.
    const claimed = await tx.passwordResetToken.updateMany({
      where: {
        id: candidate.id,
        userId: candidate.userId,
        tokenHash,
        usedAt: null,
        expiresAt: { gt: claimTime },
      },
      data: { usedAt: claimTime },
    });
    if (claimed.count !== 1) return null;

    await tx.user.update({
      where: { id: candidate.userId },
      data: {
        passwordHash: newPasswordHash,
        sessionVersion: { increment: 1 },
      },
      select: { id: true },
    });
    return candidate.userId;
  });
}
