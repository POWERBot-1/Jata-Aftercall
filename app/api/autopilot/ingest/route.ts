import crypto from "crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertBusinessRole, TenantError } from "@/lib/tenant";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { getAutopilotConfig } from "@/lib/autopilot/actions";
import { getAutopilotEntitlement } from "@/lib/autopilot/entitlement";
import { isGlobalAutopilotKillSwitchActive } from "@/lib/autopilot/policy";
import {
  ALLOWED_INGEST_MIMES,
  ingestMultimodalArtifact,
  MAX_INGEST_BYTES,
  normalizeIngestMime,
} from "@/lib/autopilot/security";
import {
  releaseAutopilotBudgetReservation,
  reserveAutopilotBudget,
} from "@/lib/autopilot/usage";
import { recordAutopilotAudit } from "@/lib/autopilot/audit";
import { assertNoInlineImagePersistence } from "@/lib/media/persistence-policy";

export const dynamic = "force-dynamic";

// Maximum raw HTTP body envelope: allows base64-encoded 5 MB binary (~6.67 MB) + 64 KB JSON framing.
// Actual decoded file bytes, UTF-8 textContent, and declaredByteSize are all strictly capped at MAX_INGEST_BYTES (5 MB).
const MAX_RAW_REQUEST_ENVELOPE_BYTES = Math.ceil((MAX_INGEST_BYTES * 4) / 3) + 65_536;

const ALLOWED_JSON_KEYS = new Set([
  "businessId",
  "fileName",
  "mimeType",
  "textContent",
  "contentBase64",
  "byteSize",
  "metadataOnly",
  "declaredKind",
]);

const FLAT_BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

function parseContentLengthHeader(
  headerValue: string | null,
): { ok: true; value: number | null } | { ok: false } {
  if (headerValue === null || headerValue.trim() === "") {
    return { ok: true, value: null };
  }
  const trimmed = headerValue.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false };
  }
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num < 0) {
    return { ok: false };
  }
  return { ok: true, value: num };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  // 1. Immediate API-boundary Content-Length check before buffering or reserving resources.
  const parsedHeaderLen = parseContentLengthHeader(req.headers.get("content-length"));
  if (parsedHeaderLen.ok === false) {
    return NextResponse.json(
      {
        error: "Malformed Content-Length header.",
        code: "MALFORMED_INGEST_REQUEST",
      },
      { status: 400 },
    );
  }
  if (
    parsedHeaderLen.value !== null &&
    parsedHeaderLen.value > MAX_RAW_REQUEST_ENVELOPE_BYTES
  ) {
    return NextResponse.json(
      {
        error: `Request payload exceeds the 5 MB safety limit (${MAX_INGEST_BYTES} bytes).`,
        code: "FILE_TOO_LARGE",
      },
      { status: 413 },
    );
  }

  const contentType = (req.headers.get("content-type") || "application/json").toLowerCase();

  let businessId = "";
  let fileName = "";
  let mimeType = "text/plain";
  let textContent: string | undefined;
  let rawBytes: Uint8Array | undefined;
  let declaredByteSize: number | undefined;
  let metadataOnly = false;
  let declaredKind: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        {
          error: "Malformed multipart/form-data upload.",
          code: "MALFORMED_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }

    const rawBiz = formData.get("businessId");
    if (typeof rawBiz !== "string" || !rawBiz.trim()) {
      return NextResponse.json(
        {
          error: "businessId and file are required.",
          code: "INVALID_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }
    businessId = rawBiz.trim();

    const rawDeclaredSize = formData.get("byteSize");
    if (rawDeclaredSize !== null) {
      if (typeof rawDeclaredSize !== "string" || !/^-?\d+(\.\d+)?$/.test(rawDeclaredSize.trim())) {
        return NextResponse.json(
          {
            error: "byteSize must be a finite positive integer.",
            code: "INVALID_BYTE_SIZE",
          },
          { status: 400 },
        );
      }
      declaredByteSize = Number(rawDeclaredSize.trim());
    }

    const rawKind = formData.get("declaredKind");
    if (typeof rawKind === "string" && rawKind.trim()) {
      declaredKind = rawKind.trim();
    }

    const uploadedFile = formData.get("file");
    if (!uploadedFile || typeof uploadedFile === "string") {
      return NextResponse.json(
        {
          error: "Multipart ingestion requires a binary file part.",
          code: "MISSING_ARTIFACT_BYTES",
        },
        { status: 400 },
      );
    }

    fileName = (
      typeof formData.get("fileName") === "string" && (formData.get("fileName") as string).trim()
        ? (formData.get("fileName") as string).trim()
        : uploadedFile.name || ""
    ).trim();
    mimeType =
      (typeof formData.get("mimeType") === "string" && (formData.get("mimeType") as string).trim()) ||
      uploadedFile.type ||
      "application/octet-stream";

    if (uploadedFile.size > MAX_INGEST_BYTES) {
      return NextResponse.json(
        {
          error: `Uploaded file (${uploadedFile.size} bytes) exceeds the 5 MB safety limit (${MAX_INGEST_BYTES} bytes).`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 },
      );
    }
    rawBytes = new Uint8Array(await uploadedFile.arrayBuffer());
  } else {
    const rawBodyText = await req.text();
    const rawEnvelopeBytes = Buffer.byteLength(rawBodyText, "utf8");
    if (rawEnvelopeBytes > MAX_RAW_REQUEST_ENVELOPE_BYTES) {
      return NextResponse.json(
        {
          error: `Request payload exceeds the 5 MB safety limit (${MAX_INGEST_BYTES} bytes).`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 },
      );
    }
    if (!rawBodyText.trim()) {
      return NextResponse.json(
        {
          error: "Invalid JSON body.",
          code: "MALFORMED_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBodyText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json(
          {
            error: "Invalid JSON body.",
            code: "MALFORMED_INGEST_REQUEST",
          },
          { status: 400 },
        );
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        {
          error: "Invalid JSON body.",
          code: "MALFORMED_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }

    for (const key of Object.keys(body)) {
      if (!ALLOWED_JSON_KEYS.has(key)) {
        return NextResponse.json(
          {
            error: `Unexpected ingestion field: ${key}.`,
            code: "MALFORMED_INGEST_REQUEST",
          },
          { status: 400 },
        );
      }
    }

    if (typeof body.businessId !== "string" || !body.businessId.trim()) {
      return NextResponse.json(
        {
          error: "businessId and fileName are required.",
          code: "INVALID_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }
    if (
      typeof body.fileName !== "string" ||
      !body.fileName.trim() ||
      body.fileName.includes("\0") ||
      body.fileName.trim().length > 255
    ) {
      return NextResponse.json(
        {
          error: "businessId and a valid fileName (<= 255 characters) are required.",
          code: "INVALID_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }

    businessId = body.businessId.trim();
    fileName = body.fileName.trim();

    if (body.mimeType !== undefined) {
      if (typeof body.mimeType !== "string" || !body.mimeType.trim()) {
        return NextResponse.json(
          {
            error: "mimeType must be a non-empty string when provided.",
            code: "MALFORMED_INGEST_REQUEST",
          },
          { status: 400 },
        );
      }
      mimeType = body.mimeType.trim();
    }

    if (body.declaredKind !== undefined) {
      if (typeof body.declaredKind !== "string") {
        return NextResponse.json(
          {
            error: "declaredKind must be a string when provided.",
            code: "MALFORMED_INGEST_REQUEST",
          },
          { status: 400 },
        );
      }
      declaredKind = body.declaredKind;
    }

    if (body.metadataOnly !== undefined) {
      if (typeof body.metadataOnly !== "boolean") {
        return NextResponse.json(
          {
            error: "metadataOnly must be a boolean when provided.",
            code: "MALFORMED_INGEST_REQUEST",
          },
          { status: 400 },
        );
      }
      metadataOnly = body.metadataOnly;
    }

    if (body.byteSize !== undefined) {
      if (
        typeof body.byteSize !== "number" ||
        !Number.isFinite(body.byteSize) ||
        !Number.isInteger(body.byteSize) ||
        body.byteSize < 0
      ) {
        return NextResponse.json(
          {
            error: "byteSize must be a finite non-negative integer.",
            code: "INVALID_BYTE_SIZE",
          },
          { status: 400 },
        );
      }
      declaredByteSize = body.byteSize;
    }

    if (body.textContent !== undefined && typeof body.textContent !== "string") {
      return NextResponse.json(
        {
          error: "textContent must be a string when provided.",
          code: "MALFORMED_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }

    if (body.contentBase64 !== undefined && typeof body.contentBase64 !== "string") {
      return NextResponse.json(
        {
          error: "contentBase64 must be a base64 string when provided.",
          code: "MALFORMED_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }

    if (body.textContent !== undefined && body.contentBase64 !== undefined) {
      return NextResponse.json(
        {
          error: "Provide either textContent or contentBase64, not both.",
          code: "AMBIGUOUS_INGEST_CONTENT",
        },
        { status: 400 },
      );
    }

    if (typeof body.textContent === "string") {
      textContent = body.textContent;
    }

    if (typeof body.contentBase64 === "string") {
      const trimmedB64 = body.contentBase64.trim();
      if (/^data:/i.test(trimmedB64)) {
        return NextResponse.json(
          {
            error:
              "Inline data: URLs are forbidden; supply raw RFC 4648 base64 bytes in contentBase64.",
            code: "INLINE_IMAGE_DATA_FORBIDDEN",
          },
          { status: 400 },
        );
      }
      const compactB64 = trimmedB64.replace(/\s+/g, "");
      if (
        compactB64.length === 0 ||
        compactB64.length % 4 !== 0 ||
        !FLAT_BASE64_REGEX.test(compactB64)
      ) {
        return NextResponse.json(
          {
            error: "contentBase64 is empty or not valid base64.",
            code: "MALFORMED_BASE64_CONTENT",
          },
          { status: 400 },
        );
      }
      const paddingChars = compactB64.endsWith("==") ? 2 : compactB64.endsWith("=") ? 1 : 0;
      const expectedDecodedBytes = (compactB64.length / 4) * 3 - paddingChars;
      if (expectedDecodedBytes > MAX_INGEST_BYTES) {
        return NextResponse.json(
          {
            error: `Decoded artifact (${expectedDecodedBytes} bytes) exceeds the 5 MB safety limit (${MAX_INGEST_BYTES} bytes).`,
            code: "FILE_TOO_LARGE",
          },
          { status: 413 },
        );
      }
      rawBytes = new Uint8Array(Buffer.from(compactB64, "base64"));
    }
  }

  // 2. Enforce MAX_INGEST_BYTES, declared-vs-actual byte matching, and real-bytes rules BEFORE reserving budget.
  if (!businessId || !fileName || fileName.includes("\0") || fileName.length > 255) {
    return NextResponse.json(
      {
        error: "businessId and a valid fileName are required.",
        code: "INVALID_INGEST_REQUEST",
      },
      { status: 400 },
    );
  }

  if (declaredByteSize !== undefined) {
    if (
      !Number.isFinite(declaredByteSize) ||
      !Number.isInteger(declaredByteSize) ||
      declaredByteSize < 0
    ) {
      return NextResponse.json(
        {
          error: "byteSize must be a finite positive integer.",
          code: "INVALID_BYTE_SIZE",
        },
        { status: 400 },
      );
    }
    if (declaredByteSize === 0) {
      return NextResponse.json(
        {
          error: "Declared artifact size cannot be 0 bytes.",
          code: "EMPTY_ARTIFACT",
        },
        { status: 400 },
      );
    }
    if (declaredByteSize > MAX_INGEST_BYTES) {
      return NextResponse.json(
        {
          error: `Declared artifact size (${declaredByteSize} bytes) exceeds the 5 MB safety limit (${MAX_INGEST_BYTES} bytes).`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 },
      );
    }
  }

  const cleanMime = normalizeIngestMime(mimeType);
  if (!ALLOWED_INGEST_MIMES.has(cleanMime)) {
    return NextResponse.json(
      {
        error: `Unsupported file type (${cleanMime}). Upload CSV, JSON, plain text, PDF, or standard JPEG/PNG/WebP.`,
        code: "UNSUPPORTED_MEDIA_TYPE",
      },
      { status: 400 },
    );
  }

  let verifiedPayloadDigest: string | null = null;

  if (rawBytes !== undefined) {
    if (metadataOnly) {
      return NextResponse.json(
        {
          error: "metadataOnly cannot be combined with file bytes.",
          code: "MALFORMED_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }
    if (rawBytes.byteLength === 0) {
      return NextResponse.json(
        {
          error: "Uploaded file payload is empty.",
          code: "EMPTY_ARTIFACT",
        },
        { status: 400 },
      );
    }
    if (rawBytes.byteLength > MAX_INGEST_BYTES) {
      return NextResponse.json(
        {
          error: `Artifact (${rawBytes.byteLength} bytes) exceeds the 5 MB safety limit (${MAX_INGEST_BYTES} bytes).`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 },
      );
    }
    if (declaredByteSize !== undefined && declaredByteSize !== rawBytes.byteLength) {
      return NextResponse.json(
        {
          error: `Declared byteSize (${declaredByteSize}) does not match actual byte length (${rawBytes.byteLength}).`,
          code: "BYTE_SIZE_MISMATCH",
        },
        { status: 400 },
      );
    }
    verifiedPayloadDigest = crypto
      .createHash("sha256")
      .update(Buffer.from(rawBytes))
      .digest("hex");
  } else if (textContent !== undefined) {
    if (metadataOnly) {
      return NextResponse.json(
        {
          error: "metadataOnly cannot be combined with textContent.",
          code: "MALFORMED_INGEST_REQUEST",
        },
        { status: 400 },
      );
    }
    try {
      assertNoInlineImagePersistence(textContent);
    } catch {
      return NextResponse.json(
        {
          error: "Inline base64 image data URLs are prohibited in database records.",
          code: "INLINE_IMAGE_DATA_FORBIDDEN",
        },
        { status: 400 },
      );
    }
    const utf8Buf = Buffer.from(textContent, "utf8");
    if (utf8Buf.byteLength === 0 || textContent.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Uploaded text payload cannot be empty.",
          code: "EMPTY_ARTIFACT",
        },
        { status: 400 },
      );
    }
    if (utf8Buf.byteLength > MAX_INGEST_BYTES) {
      return NextResponse.json(
        {
          error: `Artifact (${utf8Buf.byteLength} bytes) exceeds the 5 MB safety limit (${MAX_INGEST_BYTES} bytes).`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 },
      );
    }
    if (declaredByteSize !== undefined && declaredByteSize !== utf8Buf.byteLength) {
      return NextResponse.json(
        {
          error: `Declared byteSize (${declaredByteSize}) does not match actual UTF-8 byte length (${utf8Buf.byteLength}).`,
          code: "BYTE_SIZE_MISMATCH",
        },
        { status: 400 },
      );
    }
    verifiedPayloadDigest = crypto.createHash("sha256").update(utf8Buf).digest("hex");
  } else if (metadataOnly) {
    if (declaredByteSize === undefined) {
      return NextResponse.json(
        {
          error: "metadataOnly ingestion requires a valid positive integer byteSize.",
          code: "MISSING_DECLARED_BYTE_SIZE",
        },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json(
      {
        error:
          "Actual artifact bytes (contentBase64 or multipart file) or non-empty textContent are required for verified ingestion.",
        code: "MISSING_ARTIFACT_BYTES",
      },
      { status: 400 },
    );
  }

  const rl = rateLimitByIdentity(`${session.userId}:${businessId}`, {
    key: "autopilot_ingest",
    max: 15,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Upload rate limit reached. Try again in a minute.", code: "RATE_LIMITED" },
      { status: 429 },
    );
  }

  try {
    await assertBusinessRole(businessId, session, "configure");

    if (isGlobalAutopilotKillSwitchActive()) {
      return NextResponse.json(
        {
          error:
            "Platform-wide JATA Autopilot kill switch is active; document ingestion is paused.",
          code: "GLOBAL_KILL_SWITCH_ACTIVE",
        },
        { status: 409 },
      );
    }

    const [config, entitlement] = await Promise.all([
      getAutopilotConfig(businessId),
      getAutopilotEntitlement(businessId),
    ]);
    if (config.operationalStatus === "PAUSED") {
      return NextResponse.json(
        {
          error:
            "Emergency Pause is active for this business; resume Autopilot before ingesting documents.",
          code: "TENANT_AUTOPILOT_PAUSED",
        },
        { status: 409 },
      );
    }

    const effectiveBytesForUnits =
      rawBytes?.byteLength ??
      (textContent !== undefined
        ? Buffer.byteLength(textContent, "utf8")
        : declaredByteSize ?? 1);
    const idempotencyIdentity =
      verifiedPayloadDigest ?? `unverified-meta:${declaredByteSize ?? 0}`;
    const digestSeed = crypto
      .createHash("sha256")
      .update(`${businessId}:${fileName}:${cleanMime}:${idempotencyIdentity}`)
      .digest("hex")
      .slice(0, 24);
    const budgetKey = `ingest_${digestSeed}`;

    const budget = await reserveAutopilotBudget({
      businessId,
      tierKey: entitlement.entitled ? entitlement.tier : "PREVIEW",
      capability: "VISION_EXTRACT",
      provider: "jata-multimodal-guard",
      idempotencyKey: budgetKey,
      dailySpendCapMinorKES: config.dailySpendCapMinorKES,
      unitsIn: effectiveBytesForUnits,
      unitsOut: 1,
      allowZeroCostReadOnlyPreviewFallback: false,
    });
    if (budget.allowed === false) {
      const budgetStatus =
        budget.code === "BUDGET_VERIFICATION_UNAVAILABLE"
          ? 503
          : budget.code === "IDEMPOTENCY_TENANT_CONFLICT"
            ? 409
            : 429;
      return NextResponse.json(
        { error: budget.reason, code: budget.code, usage: budget.summary },
        { status: budgetStatus },
      );
    }

    let result;
    try {
      result = await ingestMultimodalArtifact({
        businessId,
        uploadedByUserId: session.userId,
        fileName,
        mimeType: cleanMime,
        textContent,
        rawBytes,
        declaredByteSize,
        metadataOnly,
        declaredKind,
        requirePersistence: true,
      });
    } catch {
      await releaseAutopilotBudgetReservation(budgetKey, businessId);
      return NextResponse.json(
        {
          error: "Unable to persist ingestion verification record. Upload failed closed.",
          code: "INGEST_PERSISTENCE_UNAVAILABLE",
        },
        { status: 503 },
      );
    }

    if (!result.ok || !result.record) {
      await releaseAutopilotBudgetReservation(budgetKey, businessId);
      return NextResponse.json(
        { error: result.error, code: result.errorCode },
        { status: result.httpStatus ?? 400 },
      );
    }

    await recordAutopilotAudit({
      businessId,
      actorKind: "OWNER",
      actorUserId: session.userId,
      action: "autopilot.ingest.processed",
      targetType: "AutopilotIngestionRecord",
      targetId: result.record.id,
      metadata: {
        fileName: result.record.fileName,
        mimeType: result.record.mimeType,
        byteSize: result.record.byteSize,
        sha256Hash: result.record.sha256Hash,
        sha256Verified: result.record.sha256Verified,
        digestStatus: result.record.digestStatus,
        documentKind: result.record.documentKind,
        paymentClaimSafeFlag: result.record.paymentClaimSafeFlag,
      },
    });

    return NextResponse.json({ record: result.record });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Document could not be ingested safely." },
      { status: 500 },
    );
  }
}
