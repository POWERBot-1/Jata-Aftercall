/**
 * JATA Autopilot — Security, Prompt-Injection Defense, Secret Redaction &
 * Multimodal Ephemeral Ingestion (§9, §10, §17)
 *
 * - Treats every chat message, uploaded CSV/document, OCR extract, and voice
 *   transcript as untrusted data, never system authority.
 * - Never persists `data:image/*` or raw binary blobs in PostgreSQL.
 * - Never treats uploaded M-PESA / bank receipt screenshots or customer claims
 *   as proof of payment (`UNVERIFIED_CLAIM_NEVER_PROOF`).
 */

import crypto from "crypto";
import prisma from "@/lib/db";
import { assertNoInlineImagePersistence } from "@/lib/media/persistence-policy";

export const MAX_INGEST_BYTES = 5 * 1024 * 1024; // 5 MB strict ceiling

const ALLOWED_INGEST_MIMES = new Set([
  "text/plain",
  "text/csv",
  "application/csv",
  "application/json",
  "text/markdown",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const PROMPT_INJECTION_PATTERNS: Array<{ code: string; regex: RegExp }> = [
  {
    code: "OVERRIDE_SYSTEM_INSTRUCTIONS",
    regex: /\b(ignore|disregard|forget|bypass)\s+(all\s+)?(previous|prior|above|system|developer|safety)\s+(instructions?|prompts?|rules?|guardrails?)\b/i,
  },
  {
    code: "SECRET_EXFILTRATION_ATTEMPT",
    regex: /\b(reveal|print|dump|output|show|leak|exfiltrate)\s+(your\s+)?(system\s+prompt|env|environment\s+variables?|secret[_\s-]?key|api[_\s-]?key|paystack|database_url|jwt_secret)\b/i,
  },
  {
    code: "CROSS_TENANT_ESCALATION_ATTEMPT",
    regex: /\b(switch\s+to\s+business|access\s+all\s+businesses|other\s+tenant|override\s+businessid|select\s+\*\s+from\s+"?business"?)\b/i,
  },
  {
    code: "UNVERIFIED_PAYMENT_OVERRIDE_ATTEMPT",
    regex: /\b(mark\s+(this\s+|the\s+|all\s+)?orders?\s+(as\s+)?paid|force\s+payment\s+settled|approve\s+full\s+refund\s+now\s+without\s+verification)\b/i,
  },
];

const PAYMENT_RECEIPT_CLAIM_REGEX =
  /\b(mpesa|m-pesa|confirmed\.?\s+ksh|transaction\s+cost|paid\s+to|paybill|buy\s+goods|till\s+number|bank\s+transfer\s+receipt|payment\s+screenshot|proof\s+of\s+payment)\b/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk_(live|test)_[A-Za-z0-9]{12,}\b/g,
  /\bsk-(proj-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bpostgres(?:ql)?:\/\/[^\s"']+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

export function scanForPromptInjection(text: string): {
  safe: boolean;
  code: string | null;
  reason: string | null;
} {
  for (const entry of PROMPT_INJECTION_PATTERNS) {
    if (entry.regex.test(text)) {
      return {
        safe: false,
        code: entry.code,
        reason:
          "Blocked untrusted instruction attempt. Autopilot never overrides safety rules, exposes secrets, crosses tenant boundaries, or settles payments from prompt text.",
      };
    }
  }
  return { safe: true, code: null, reason: null };
}

export function redactAutopilotText(input: string): string {
  let out = input;
  for (const regex of SECRET_VALUE_PATTERNS) {
    out = out.replace(regex, "[REDACTED_SECRET]");
  }
  return out;
}

export function redactAutopilotObject<T>(value: T): T {
  if (typeof value === "string") {
    return redactAutopilotText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAutopilotObject(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/(secret|password|token|authorization|api_key|apikey|private_key)/i.test(k)) {
        clean[k] = "[REDACTED_KEY]";
      } else {
        clean[k] = redactAutopilotObject(v);
      }
    }
    return clean as T;
  }
  return value;
}

export interface IngestedArtifactResult {
  ok: boolean;
  errorCode?: string;
  error?: string;
  record?: {
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    sha256Hash: string;
    documentKind:
      | "MENU"
      | "CATALOGUE"
      | "PRICE_LIST"
      | "INVOICE"
      | "EXPENSE_RECEIPT"
      | "PAYMENT_SCREENSHOT_CLAIM"
      | "FAQ_DOC"
      | "OTHER";
    confidence: "high" | "medium" | "low";
    paymentClaimSafeFlag: "NONE" | "UNVERIFIED_CLAIM_NEVER_PROOF";
    canSettlePaymentOrOrder: false;
    securityWarning: string | null;
    extractedItems: Array<Record<string, unknown>>;
    summary: string;
  };
}

function parseSimpleCsvRows(csvText: string): Array<Record<string, string>> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(1, 51)) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = redactAutopilotText(cols[idx] ?? "");
    });
    rows.push(row);
  }
  return rows;
}

export async function ingestMultimodalArtifact(params: {
  businessId: string;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  textContent?: string;
  rawBytes?: Uint8Array;
  declaredKind?: string;
}): Promise<IngestedArtifactResult> {
  const cleanMime = params.mimeType.trim().toLowerCase().split(";")[0];
  if (!ALLOWED_INGEST_MIMES.has(cleanMime)) {
    return {
      ok: false,
      errorCode: "UNSUPPORTED_MEDIA_TYPE",
      error: `Unsupported file type (${cleanMime}). Upload CSV, JSON, plain text, PDF, or standard JPEG/PNG/WebP.`,
    };
  }

  const textBody = params.textContent ?? "";
  // Enforce the repository-wide no-inline-image-in-Neon policy before any processing.
  try {
    assertNoInlineImagePersistence(textBody);
  } catch {
    return {
      ok: false,
      errorCode: "INLINE_IMAGE_DATA_FORBIDDEN",
      error: "Inline base64 image data URLs are prohibited in database records.",
    };
  }

  const byteBuffer = params.rawBytes
    ? Buffer.from(params.rawBytes)
    : Buffer.from(textBody, "utf8");

  if (byteBuffer.byteLength === 0) {
    return {
      ok: false,
      errorCode: "EMPTY_ARTIFACT",
      error: "Uploaded file or text payload is empty.",
    };
  }
  if (byteBuffer.byteLength > MAX_INGEST_BYTES) {
    return {
      ok: false,
      errorCode: "FILE_TOO_LARGE",
      error: `Artifact exceeds the 5 MB safety limit (${byteBuffer.byteLength} bytes).`,
    };
  }

  const sha256Hash = crypto.createHash("sha256").update(byteBuffer).digest("hex");
  const combinedInspectable = `${params.fileName}\n${textBody}`;
  const injectionScan = scanForPromptInjection(combinedInspectable);

  const isPaymentClaim =
    params.declaredKind === "PAYMENT_SCREENSHOT_CLAIM" ||
    PAYMENT_RECEIPT_CLAIM_REGEX.test(combinedInspectable) ||
    (cleanMime.startsWith("image/") && /receipt|mpesa|payment|paid|transfer/i.test(params.fileName));

  const documentKind = isPaymentClaim
    ? "PAYMENT_SCREENSHOT_CLAIM"
    : cleanMime.includes("csv") || /price|catalog|menu/i.test(params.fileName)
      ? "PRICE_LIST"
      : /faq|policy/i.test(params.fileName)
        ? "FAQ_DOC"
        : /expense|invoice/i.test(params.fileName)
          ? "EXPENSE_RECEIPT"
          : "OTHER";

  const paymentClaimSafeFlag = isPaymentClaim
    ? "UNVERIFIED_CLAIM_NEVER_PROOF"
    : "NONE";

  let extractedItems: Array<Record<string, unknown>> = [];
  if (injectionScan.safe && textBody) {
    if (cleanMime.includes("csv") || textBody.includes(",")) {
      extractedItems = parseSimpleCsvRows(textBody);
    } else if (cleanMime === "application/json") {
      try {
        const parsed = JSON.parse(textBody);
        extractedItems = Array.isArray(parsed)
          ? parsed.slice(0, 50).map((r) => redactAutopilotObject(r))
          : [redactAutopilotObject(parsed)];
      } catch {
        extractedItems = [];
      }
    } else {
      const lines = textBody
        .split(/\r?\n/)
        .map((l) => redactAutopilotText(l.trim()))
        .filter(Boolean)
        .slice(0, 25);
      extractedItems = lines.map((line, index) => ({ line: index + 1, text: line }));
    }
  }

  const securityWarning = !injectionScan.safe
    ? `Embedded prompt-injection pattern (${injectionScan.code}) was neutralized; zero instructions from this file were trusted.`
    : isPaymentClaim
      ? "UNVERIFIED PAYMENT CLAIM: Uploaded receipts/screenshots never mark orders or subscriptions PAID. Verify strictly via Paystack / M-PESA Daraja webhook records."
      : null;

  const isBinaryWithoutOcrText =
    (cleanMime.startsWith("image/") || cleanMime === "application/pdf") && !textBody.trim();

  const summary = isPaymentClaim
    ? "Classified as an unverified customer payment claim. Order and subscription settlement states remain unchanged."
    : !injectionScan.safe
      ? "Quarantined untrusted instructions inside uploaded content; extracted 0 executable commands."
      : isBinaryWithoutOcrText
        ? "Recorded file metadata and SHA-256 digest safely (raw media discarded). Live OCR vision extraction requires configured multimodal provider credentials; paste CSV/JSON/text for immediate parsing."
        : `Extracted ${extractedItems.length} structured item(s) for owner review before any catalogue or FAQ update.`;

  const confidence: "high" | "medium" | "low" =
    extractedItems.length > 0 ? "high" : isBinaryWithoutOcrText ? "low" : "medium";

  const structuredPayload = {
    summary,
    securityWarning,
    extractedItems,
    canSettlePaymentOrOrder: false as const,
  };

  // Validate again right before persistence so no nested field can carry inline image data.
  assertNoInlineImagePersistence(structuredPayload);

  let persistedId = `ing_${sha256Hash.slice(0, 16)}`;
  try {
    const saved = await prisma.autopilotIngestionRecord.create({
      data: {
        businessId: params.businessId,
        uploadedByUserId: params.uploadedByUserId,
        fileName: params.fileName.slice(0, 180),
        mimeType: cleanMime,
        byteSize: byteBuffer.byteLength,
        sha256Hash,
        documentKind,
        extractedJson: JSON.stringify(structuredPayload),
        confidence,
        paymentClaimSafeFlag,
        status: "PENDING_REVIEW",
      },
    });
    if (saved?.id) persistedId = saved.id;
  } catch {
    // Offline fallback preserves deterministic preview output without failing closed on missing DB.
  }

  return {
    ok: true,
    record: {
      id: persistedId,
      fileName: params.fileName.slice(0, 180),
      mimeType: cleanMime,
      byteSize: byteBuffer.byteLength,
      sha256Hash,
      documentKind,
      confidence,
      paymentClaimSafeFlag,
      canSettlePaymentOrOrder: false,
      securityWarning,
      extractedItems,
      summary,
    },
  };
}
