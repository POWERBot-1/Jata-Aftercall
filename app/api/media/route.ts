/**
 * Media library API (§18, §19, §20, §41, §47)
 *
 * Register external references, search, re-tag and delete the images a business owns. The contract that the
 * Studio's mobile picker depends on:
 *
 *   POST { businessId, dataUrl | url, alt?, kind?, source?, label?, width?, height? }
 *        `dataUrl` remains a validated legacy input: its bytes are stored only when an approved
 *        durable media provider is configured (`lib/storage`), and refused before persistence
 *        otherwise; `url` accepts a hosted or local-path reference and creates metadata only.
 *   PATCH { id, expectedVersion, alt?, kind?, label? }
 *
 * Metadata edits use a monotonic version counter and a tenant-scoped conditional update, so stale
 * windows cannot silently replace newer descriptions.
 *
 * Legacy `dataUrl` uploads are still validated so clients get accurate format/corruption errors,
 * then either stored with the configured durable provider (bytes never enter Neon) or refused
 * with 503 when none is configured. Existing inline assets remain readable. `url` accepts
 * hosted/path references only; it never accepts a data URL.
 *
 * Raster formats are JPEG, PNG, WebP and GIF. SVG is refused outright — it is a script vector,
 * not a photograph. No new image bytes are written to Neon.
 *
 * Mutations require the business `configure` role; VIEWER access remains read-only.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { sanitizeText } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { safeUrl } from "@/lib/experience/document";
import { containsInlineImageDataUrl, INLINE_MEDIA_PERSISTENCE_CODE, INLINE_MEDIA_PERSISTENCE_MESSAGE, isInlineImageDataUrl } from "@/lib/media/persistence-policy";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_CHARS, humanFileSize, parseImageDataUrl, validateImageBytes, type ImageFacts } from "@/lib/media/imageFormat";
import { assertCanStore, CONTENT_TYPES_BY_KIND, resolveDurableStorageProvider, type ObjectStorageProvider, type StoredObjectRef } from "@/lib/storage";
import { checkStorageQuota, storageQuotaMessage } from "@/lib/media/storageQuota";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

const ALLOWED_KINDS = ["IMAGE", "LOGO", "HERO", "OTHER"];
const ALLOWED_SOURCES = ["UPLOAD", "AI_GENERATED", "AI_ENHANCED", "ENHANCED"];
const ALLOWED_LABELS = ["ACTUAL", "AI_GENERATED", "REPRESENTATIVE"];

const ASSET_SELECT = {
  id: true, url: true, kind: true, alt: true, width: true, height: true, bytes: true,
  mime: true, source: true, label: true, aiGenerationId: true, createdAt: true, version: true,
} as const;

/**
 * Stores validated upload bytes with the configured durable provider, under the caller's own
 * tenant prefix. Returns null (never throws) when the bytes cannot be stored honestly —
 * including a provider that answers with inline data or another tenant's key.
 */
async function putDurableUpload(
  provider: ObjectStorageProvider,
  businessId: string,
  bytes: Uint8Array,
  facts: ImageFacts,
): Promise<StoredObjectRef | null> {
  const extension = CONTENT_TYPES_BY_KIND["image-original"][facts.mime];
  if (!extension) return null;
  try {
    assertCanStore(provider, "image-original", bytes.length);
    const ref = await provider.put({
      businessId,
      kind: "image-original",
      name: `upload-${randomUUID()}.${extension}`,
      contentType: facts.mime,
      body: bytes,
    });
    if (/^data:/i.test(ref.url) || !ref.key.startsWith(`tenants/${businessId}/`)) {
      await provider.remove({ key: ref.key }).catch(() => undefined);
      return null;
    }
    return ref;
  } catch {
    return null;
  }
}

const MEDIA_VERSION_INVALID_CODE = "media_version_invalid";
const MEDIA_VERSION_INVALID_MESSAGE = "The image version is invalid. Reload the page and try again. Nothing was changed.";
const MEDIA_VERSION_CONFLICT_CODE = "media_version_conflict";
const MEDIA_VERSION_CONFLICT_MESSAGE = "This image changed in another window. Reload to see the latest version, then try again. Nothing was overwritten.";
const MAX_MEDIA_VERSION = 2_147_483_647;


/** Parse a non-negative PostgreSQL INTEGER version token without coercing timestamps or fractions. */
function parseExpectedVersion(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= MAX_MEDIA_VERSION ? value : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^\d{1,10}$/.test(raw)) return null;
  const parsed = Number(raw);
  return parsed <= MAX_MEDIA_VERSION ? parsed : null;
}

/** Old/test fixtures without the additive field resolve to its schema default, version 0. */
function storedVersion(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_MEDIA_VERSION ? parsed : 0;
}

function normalizeKind(value: unknown): string {
  const raw = String(value || "").toUpperCase();
  return ALLOWED_KINDS.includes(raw) ? raw : "IMAGE";
}

function normalizeSource(value: unknown): string {
  const raw = String(value || "").toUpperCase();
  return ALLOWED_SOURCES.includes(raw) ? raw : "UPLOAD";
}

function normalizeLabel(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).toUpperCase();
  return ALLOWED_LABELS.includes(raw) ? raw : null;
}

/** GET — the library, with the search and filters the media page offers (§18). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const businessId = params.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });
  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  const query = sanitizeText(params.get("q") || "", 60);
  const kind = params.get("kind") ? normalizeKind(params.get("kind")) : "";
  const source = params.get("source") ? normalizeSource(params.get("source")) : "";
  const take = Math.max(1, Math.min(120, Number(params.get("limit")) || 120));

  try {
    // The library is small by design (a business website needs tens of images, not thousands),
    // so search runs over the tenant's own rows rather than a search index (§51: no extra API).
    const where: Record<string, unknown> = { businessId };
    if (kind) where.kind = kind;
    if (source) where.source = source;
    if (query) {
      where.OR = [
        { alt: { contains: query, mode: "insensitive" } },
        { label: { contains: query, mode: "insensitive" } },
        { source: { contains: query, mode: "insensitive" } },
      ];
    }
    const [assets, counts] = await Promise.all([
      prisma.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, take, select: ASSET_SELECT }),
      prisma.mediaAsset
        .groupBy({ by: ["source"], where: { businessId }, _count: { _all: true } })
        .catch(() => [] as Array<{ source: string; _count: { _all: number } }>),
    ]);
    const bySource: Record<string, number> = { UPLOAD: 0, AI_GENERATED: 0, AI_ENHANCED: 0, ENHANCED: 0 };
    for (const row of counts as Array<{ source: string; _count: { _all: number } }>) {
      bySource[String(row.source)] = row._count?._all ?? 0;
    }
    return NextResponse.json({ assets, total: assets.length, bySource, query: query || null });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const guard = await guardTenantMutation(session, businessId, "configure");
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const kind = normalizeKind(body?.kind);
    const alt = sanitizeText(String(body?.alt || ""), 160);
    if (containsInlineImageDataUrl(alt)) {
      return NextResponse.json({ error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE }, { status: 503 });
    }
    const source = normalizeSource(body?.source);
    const label = normalizeLabel(body?.label);

    // Legacy clients may still submit `dataUrl`. Validate supported formats and corruption for
    // an actionable response, but never write those bytes into Neon. When an approved durable
    // storage provider is configured the validated bytes go there instead, and the metadata row
    // below records only the durable URL; without one the upload keeps failing closed (503).
    // Existing library rows remain readable through GET either way.
    const raw = String(body?.dataUrl || body?.url || "");
    const candidate = raw.trim();
    let durableProvider: ObjectStorageProvider | null = null;
    let durableRef: StoredObjectRef | null = null;
    let durableWidth: number | null = null;
    let durableHeight: number | null = null;
    if (/^data:/i.test(candidate)) {
      if (candidate.length > MAX_UPLOAD_CHARS) {
        return NextResponse.json(
          { error: `This photo is too large (${humanFileSize((candidate.length * 3) / 4)}). JATA can shrink it automatically — try again and we will optimize it.` },
          { status: 413 },
        );
      }
      const parsed = parseImageDataUrl(candidate);
      if (!parsed) {
        return NextResponse.json(
          { error: "We couldn't read that image. Upload a JPG, PNG, WebP or GIF photo." },
          { status: 400 },
        );
      }
      const verdict = validateImageBytes(parsed.bytes, { declaredMime: parsed.mime, maxBytes: MAX_UPLOAD_BYTES });
      if (verdict.status !== "ok") {
        return NextResponse.json({ error: verdict.issue.message, code: verdict.issue.code }, { status: verdict.issue.code === "too_large" ? 413 : 400 });
      }
      const provider = resolveDurableStorageProvider();
      if (!provider) {
        return NextResponse.json(
          { error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE },
          { status: 503 },
        );
      }
      // $0-first ceilings (250 MB per business, 5 GB global) are enforced before any byte is
      // accepted. 507 = the storage itself cannot take more; the message says what to do.
      const quota = await checkStorageQuota({ businessId, incomingBytes: parsed.bytes.length });
      if (!quota.ok) {
        return NextResponse.json(
          { error: storageQuotaMessage(quota.scope ?? "unavailable"), code: "storage_quota_exceeded", scope: quota.scope ?? "unavailable" },
          { status: 507 },
        );
      }
      durableProvider = provider;
      durableRef = await putDurableUpload(provider, businessId, parsed.bytes, verdict.facts);
      if (!durableRef) {
        return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
      }
      durableWidth = verdict.facts.width;
      durableHeight = verdict.facts.height;
    }

    const url = durableRef ? durableRef.url : safeUrl(candidate);
    if (!url) {
      return NextResponse.json({ error: "That image could not be read. Upload a JPG, PNG or WebP photo." }, { status: 400 });
    }
    // Defense in depth for schemes accepted by the URL normalizer.
    if (isInlineImageDataUrl(url)) {
      return NextResponse.json(
        { error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE },
        { status: 503 },
      );
    }

    const widthValue = Number(body?.width);
    const heightValue = Number(body?.height);
    const width = durableWidth ?? (Number.isFinite(widthValue) && widthValue > 0 ? Math.round(widthValue) : null);
    const height = durableHeight ?? (Number.isFinite(heightValue) && heightValue > 0 ? Math.round(heightValue) : null);
    const bytes: number | null = durableRef ? durableRef.bytes : null;
    const mime: string | null = durableRef ? durableRef.contentType : null;
    const assetData = {
      businessId,
      url,
      kind,
      alt: alt || null,
      width,
      height,
      bytes,
      hash: null,
      mime,
      source,
      label,
      aiGenerationId: typeof body?.aiGenerationId === "string" ? body.aiGenerationId.slice(0, 40) : null,
    };
    // Check the exact row immediately before persistence: aiGenerationId is caller-controlled
    // metadata, even when the image URL itself is a safe path.
    if (containsInlineImageDataUrl(assetData)) {
      if (durableProvider && durableRef) await durableProvider.remove({ key: durableRef.key }).catch(() => undefined);
      return NextResponse.json({ error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE }, { status: 503 });
    }

    let asset;
    try {
      asset = await prisma.mediaAsset.create({
        data: assetData,
        select: ASSET_SELECT,
      });
    } catch (error) {
      // Metadata could not be recorded: do not leave an orphaned object in durable storage.
      if (durableProvider && durableRef) await durableProvider.remove({ key: durableRef.key }).catch(() => undefined);
      throw error;
    }
    await logAudit({
      actorId: session.userId,
      action: "MEDIA_UPLOADED",
      targetType: "MEDIA_ASSET",
      targetId: asset.id,
      metadata: { businessId, kind, bytes, source, mime },
    });
    return NextResponse.json({ asset }, { status: 201 });
  } catch {
    console.error("media upload failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

/**
 * PATCH — alt text, folder/kind and the "is this the real product?" label (§18, §27).
 * A library asset id is never trusted: the stored row decides which tenant may change it.
 * Every edit carries the version it was made from and writes only if that version is still current.
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "Choose an image to update." }, { status: 400 });

    const asset = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, businessId: true, version: true },
    });
    if (!asset) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, asset.businessId, "configure");
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    // Authorization intentionally precedes version validation so unauthorized callers do not
    // learn the row's concurrency state. Version-aware clients send the snapshot they edited;
    // omission remains compatible with older API callers and uses the version just read below.
    const hasExpectedVersion = Object.prototype.hasOwnProperty.call(body, "expectedVersion");
    const parsedExpectedVersion = parseExpectedVersion(body?.expectedVersion);
    if (hasExpectedVersion && parsedExpectedVersion === null) {
      return NextResponse.json(
        { error: MEDIA_VERSION_INVALID_MESSAGE, code: MEDIA_VERSION_INVALID_CODE },
        { status: 400 },
      );
    }
    const currentVersion = storedVersion(asset.version);
    const expectedVersion = parsedExpectedVersion ?? currentVersion;

    const data: Record<string, unknown> = {};
    if (body?.alt !== undefined) data.alt = sanitizeText(String(body.alt || ""), 160) || null;
    if (body?.kind !== undefined) data.kind = normalizeKind(body.kind);
    if (body?.label !== undefined) data.label = normalizeLabel(body.label);

    if (containsInlineImageDataUrl(data)) {
      return NextResponse.json({ error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE }, { status: 503 });
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    if (currentVersion !== expectedVersion) {
      return NextResponse.json(
        { error: MEDIA_VERSION_CONFLICT_MESSAGE, code: MEDIA_VERSION_CONFLICT_CODE },
        { status: 409 },
      );
    }

    // The condition and increment are part of the same UPDATE. The earlier read is only a fast
    // path; this tenant-scoped compare-and-swap is what prevents a concurrent last-writer-wins.
    const applied = await prisma.mediaAsset.updateMany({
      where: { id, businessId: asset.businessId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (applied.count !== 1) {
      return NextResponse.json(
        { error: MEDIA_VERSION_CONFLICT_MESSAGE, code: MEDIA_VERSION_CONFLICT_CODE },
        { status: 409 },
      );
    }

    const updated = await prisma.mediaAsset.findUnique({ where: { id }, select: ASSET_SELECT });
    if (!updated) {
      return NextResponse.json(
        { error: MEDIA_VERSION_CONFLICT_MESSAGE, code: MEDIA_VERSION_CONFLICT_CODE },
        { status: 409 },
      );
    }
    await logAudit({
      actorId: session.userId,
      action: "MEDIA_UPDATED",
      targetType: "MEDIA_ASSET",
      targetId: id,
      metadata: { businessId: asset.businessId, fields: Object.keys(data) },
    });
    return NextResponse.json({ asset: updated });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = params.get("id")?.trim() || "";
  // Bulk removal of everything an AI generation produced, so "delete these images" is one tap.
  const generationId = params.get("generationId")?.trim() || "";
  if (!id && !generationId) return NextResponse.json({ error: "Choose an image to remove." }, { status: 400 });

  try {
    if (generationId) {
      const rows = await prisma.mediaAsset.findMany({
        where: { businessId: params.get("businessId")?.trim() || "", aiGenerationId: generationId },
        select: { id: true, businessId: true },
      });
      const first = rows[0];
      if (!first) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
      const guard = await guardTenantMutation(session, first.businessId, "configure");
      if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
      const result = await prisma.mediaAsset.deleteMany({ where: { businessId: first.businessId, aiGenerationId: generationId } });
      await logAudit({ actorId: session.userId, action: "MEDIA_DELETED", targetType: "AI_GENERATION", targetId: generationId, metadata: { businessId: first.businessId, count: result?.count ?? rows.length } });
      return NextResponse.json({ ok: true, removed: result?.count ?? rows.length });
    }

    const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { id: true, businessId: true } });
    if (!asset) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, asset.businessId, "configure");
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    await prisma.mediaAsset.delete({ where: { id } });
    await logAudit({ actorId: session.userId, action: "MEDIA_DELETED", targetType: "MEDIA_ASSET", targetId: id, metadata: { businessId: asset.businessId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
