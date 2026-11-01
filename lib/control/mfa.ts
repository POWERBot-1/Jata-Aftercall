import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const TOTP_STEP_SECONDS = 30;
const MFA_SESSION_SECONDS = 15 * 60;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function authSecret(): Buffer {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("AUTH_SECRET must contain at least 32 bytes for control MFA");
  return Buffer.from(secret, "utf8");
}

function deriveKey(label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", authSecret(), Buffer.from("jata-aftercall-control"), Buffer.from(label), 32));
}

export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function encodeBase32(input: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, "");
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error("Invalid Base32 secret");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function encryptTotpSecret(secret: Uint8Array): { secretCiphertext: string; secretIv: string; secretTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("totp-aes-256-gcm-v1"), iv);
  cipher.setAAD(Buffer.from("jata-control-totp-v1"));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return {
    secretCiphertext: ciphertext.toString("base64url"),
    secretIv: iv.toString("base64url"),
    secretTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptTotpSecret(record: { secretCiphertext: string; secretIv: string; secretTag: string }): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", deriveKey("totp-aes-256-gcm-v1"), Buffer.from(record.secretIv, "base64url"));
  decipher.setAAD(Buffer.from("jata-control-totp-v1"));
  decipher.setAuthTag(Buffer.from(record.secretTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(record.secretCiphertext, "base64url")), decipher.final()]);
}

function hotp(secret: Uint8Array, counter: bigint): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

export function matchingTotpStep(secret: Uint8Array, code: string, nowMs = Date.now(), lastAcceptedStep?: bigint | null): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = BigInt(Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS));
  const supplied = Buffer.from(code, "utf8");
  for (const delta of [BigInt(-1), BigInt(0), BigInt(1)]) {
    const step = current + delta;
    if (step < BigInt(0) || (lastAcceptedStep != null && step <= lastAcceptedStep)) continue;
    const expected = Buffer.from(hotp(secret, step), "utf8");
    if (timingSafeEqual(expected, supplied)) return step;
  }
  return null;
}

export function totpUri(secret: Uint8Array, account: string): string {
  const label = encodeURIComponent(`JATA AFTERCALL Control:${account}`);
  const query = new URLSearchParams({ secret: encodeBase32(secret), issuer: "JATA AFTERCALL Control", algorithm: "SHA1", digits: "6", period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export type ControlMfaIdentity = { userId: string; sessionVersion: number };

export function createControlMfaSession(identity: ControlMfaIdentity, nowMs = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...identity, issuedAt: Math.floor(nowMs / 1000), expiresAt: Math.floor(nowMs / 1000) + MFA_SESSION_SECONDS })).toString("base64url");
  const signature = createHmac("sha256", deriveKey("mfa-session-hmac-v1")).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyControlMfaSession(token: string | undefined, identity: ControlMfaIdentity, nowMs = Date.now()): boolean {
  if (!token || token.length > 2048) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  try {
    const expected = createHmac("sha256", deriveKey("mfa-session-hmac-v1")).update(payload).digest();
    const received = Buffer.from(signature, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(expected, received)) return false;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const now = Math.floor(nowMs / 1000);
    return claims.userId === identity.userId
      && claims.sessionVersion === identity.sessionVersion
      && Number.isSafeInteger(claims.issuedAt)
      && Number.isSafeInteger(claims.expiresAt)
      && Number(claims.issuedAt) <= now + 5
      && Number(claims.expiresAt) > now
      && Number(claims.expiresAt) - Number(claims.issuedAt) <= MFA_SESSION_SECONDS;
  } catch {
    return false;
  }
}
