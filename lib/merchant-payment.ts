/**
 * Merchant Payment Configuration & Credential Encryption (§10, §14).
 *
 * Separates:
 * - Public customer payment instructions (Paybill, Till, Pochi, Account Number, Bank details,
 *   Payment link, Payment instructions) -> safe for customer display and Business Brain.
 * - Private provider credentials (API keys, secrets, webhook secrets) -> AES-256-GCM encrypted
 *   at rest and NEVER exposed to the AI, browser, logs, or API responses.
 *
 * Never substitutes JATA's payment destination for a merchant's payment destination (§14).
 */

import crypto from "crypto";
import prisma from "./db";
import { logAudit } from "./audit";

export type MerchantPublicPaymentInfo = {
  method: "MPESA_PAYBILL" | "MPESA_TILL" | "MPESA_POCHI" | "BANK" | "PAYMENT_LINK" | "CASH_ON_DELIVERY";
  paybillNumber?: string | null;
  accountNumber?: string | null;
  tillNumber?: string | null;
  pochiNumber?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  paymentLink?: string | null;
  instructions?: string | null;
};

function getEncryptionKey(): Buffer {
  const raw = process.env.MERCHANT_CREDENTIAL_KEY || process.env.NEXTAUTH_SECRET || "jata-merchant-credential-key-v1";
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptMerchantCredentials(credentials: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function formatPublicPaymentSummary(info: MerchantPublicPaymentInfo | string): string {
  if (typeof info === "string") return info.trim();
  const parts: string[] = [];
  if (info.paybillNumber) {
    parts.push(`M-Pesa Paybill: ${info.paybillNumber}${info.accountNumber ? ` (Account: ${info.accountNumber})` : ""}`);
  }
  if (info.tillNumber) {
    parts.push(`M-Pesa Buy Goods Till: ${info.tillNumber}`);
  }
  if (info.pochiNumber) {
    parts.push(`Pochi la Biashara: ${info.pochiNumber}`);
  }
  if (info.bankName && info.bankAccountNumber) {
    parts.push(`Bank: ${info.bankName} (Acc: ${info.bankAccountNumber})`);
  }
  if (info.paymentLink) {
    parts.push(`Payment Link: ${info.paymentLink}`);
  }
  if (info.instructions) {
    parts.push(info.instructions.trim());
  }
  return parts.join(" | ") || `Payment method: ${info.method}`;
}

export async function getPublicMerchantPaymentConfig(businessId: string) {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  const config = await prisma.merchantPaymentConfig?.findUnique?.({
    where: { businessId },
    select: {
      id: true,
      businessId: true,
      publicInfo: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  }).catch(() => null);

  return config || null;
}

export async function saveMerchantPaymentConfig(params: {
  businessId: string;
  publicInfo: MerchantPublicPaymentInfo | string;
  privateCredentials?: Record<string, unknown> | string | null;
  isActive?: boolean;
  actorId?: string | null;
}) {
  if (!params.businessId) throw new Error("businessId required — tenant isolation enforced.");

  const formattedPublic = formatPublicPaymentSummary(params.publicInfo);
  if (!formattedPublic) {
    throw new Error("Public payment instructions are required.");
  }

  // Guard against accidentally putting JATA subscription settlement destination as merchant destination (§14)
  if (/jata\s+platform\s+subscription/i.test(formattedPublic)) {
    throw new Error("Cannot substitute JATA's subscription payment destination for the merchant's customer payment destination.");
  }

  let encryptedCredentials: string | undefined;
  if (params.privateCredentials) {
    encryptedCredentials =
      typeof params.privateCredentials === "string"
        ? encryptMerchantCredentials({ raw: params.privateCredentials })
        : encryptMerchantCredentials(params.privateCredentials);
  }

  const saved = await prisma.merchantPaymentConfig.upsert({
    where: { businessId: params.businessId },
    update: {
      publicInfo: formattedPublic,
      ...(encryptedCredentials !== undefined ? { encryptedCredentials } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    create: {
      businessId: params.businessId,
      publicInfo: formattedPublic,
      encryptedCredentials: encryptedCredentials || null,
      isActive: params.isActive !== undefined ? params.isActive : true,
    },
    select: {
      id: true,
      businessId: true,
      publicInfo: true,
      isActive: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actorId: params.actorId || null,
    action: "MERCHANT_PAYMENT_CONFIG_UPDATED",
    targetType: "MERCHANT_PAYMENT_CONFIG",
    targetId: saved.id,
    metadata: {
      businessId: params.businessId,
      publicInfo: saved.publicInfo,
      hasEncryptedCredentials: Boolean(encryptedCredentials),
    },
  });

  return saved;
}
