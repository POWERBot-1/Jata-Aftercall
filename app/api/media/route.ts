/**
 * Media library API (§18, §19, §20, §41, §47)
 *
 * Upload, search, re-tag, reuse and delete the images a business owns. The contract that the
 * Studio's mobile picker depends on:
 *
 *   POST { businessId, dataUrl | url, alt?, kind?, source?, label?, width?, height? }
 *   PATCH { id, expectedUpdatedAt, alt?, kind?, label? }
 *
 * `PATCH` is a compare-and-swap on `MediaAsset.updatedAt`. A client sends the version it read;
 * a missing or unparseable version is refused with 428, a stale one with 409, and the write
 * itself is conditional so a request cannot overwrite an edit that landed in between (§45).
 *
 * `dataUrl` is what the on-device pipeline produces after it has rotated, resized and
 * re-encoded the photo. `url` remains supported so an existing library asset can be reused
 * without re-uploading it. Both are validated by *content*: the bytes are sniffed, not the
 * filename or the browser's MIME guess, and a file whose real format contradicts its declared
 * type is rejected (§41).
 *
 * Only raster formats every phone renders are stored: JPEG, PNG, WebP and GIF. SVG is refused
 * outright — it is a script vector, not a photograph.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { sanitizeText } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { safeUrl } from "@/lib/experience/document";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_CHARS, humanFileSize, parseImageDataUrl, readImageDimensions, sniffImageFormat, validateImageBytes } from "@/lib/media/imageFormat";

export const dynamic = "force-dynamic";

const ALLOWED_KINDS = ["IMAGE", "LOGO", "HERO", "OTHER"];
const ALLOWED_SOURCES = ["UPLOAD", "AI_GENERATED", "AI_ENHANCED", "ENHANCED"];
const ALLOWED_LABELS = ["ACTUAL", "AI_GENERATED", "REPRESENTATIVE"];

const ASSET_SELECT = {
  id: true, url: true, kind: true, alt: true, width: true, height: true, bytes: true,
  mime: true, source: true, label: true, aiGenerationId: true, createdAt: true, updatedAt: true,
} as const;

// Optimistic concurrency for media edits (§45). The same contract the Studio's draft routes
// use: a write must name the version it was built from, so two windows cannot silently
// overwrite each other. "Version" here is `MediaAsset.updatedAt` — the existing column, no
// extra schema. A timestamp is coarser than a counter, so two writes landing inside the same
// millisecond are the one case this token cannot separate (documented, not hidden).
const MEDIA_VERSION_REQUIRED_CODE = "media_version_required";
const MEDIA_VERSION_REQUIRED_MESSAGE = "This change needs the version of the image it was made from. Reload the page and try again. Nothing was changed.";
const MEDIA_CHANGED_CODE = "media_version_conflict";
const MEDIA_CHANGED_MESSAGE = "This image changed in another window. Reload to see the latest version, then try again. Nothing was overwritten.";

function hashBytes(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

/** Parse the concurrency token a PATCH sends back. Anything that is not a real instant is invalid. */
function parseExpectedUpdatedAt(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 40) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Millisecond identity of a stored timestamp, tolerant of a string in place of a Date. */
function versionMillis(value: unknown): number {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return date.getTime();
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
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const kind = normalizeKind(body?.kind);
    const alt = sanitizeText(String(body?.alt || ""), 160);
    const source = normalizeSource(body?.source);
    const label = normalizeLabel(body?.label);
    const requestedWidth = Number(body?.width);
    const requestedHeight = Number(body?.height);

    // The picker sends `dataUrl`; older callers sent `url`, and library reuse sends a stored
    // URL. Accepting both names is what makes the mobile upload path work end to end (§19).
    const raw = String(body?.dataUrl || body?.url || "");

    let url = "";
    let hash: string | null = null;
    let bytes: number | null = null;
    let width: number | null = Number.isFinite(requestedWidth) && requestedWidth > 0 ? Math.round(requestedWidth) : null;
    let height: number | null = Number.isFinite(requestedHeight) && requestedHeight > 0 ? Math.round(requestedHeight) : null;
    let mime: string | null = null;

    if (raw.startsWith("data:")) {
      if (raw.length > MAX_UPLOAD_CHARS) {
        return NextResponse.json(
          { error: `This photo is too large (${humanFileSize((raw.length * 3) / 4)}). JATA can shrink it automatically — try again and we will optimize it.` },
          { status: 413 },
        );
      }
      const parsed = parseImageDataUrl(raw);
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
      url = raw;
      mime = verdict.facts.mime;
      bytes = verdict.facts.bytes;
      width = width ?? verdict.facts.width;
      height = height ?? verdict.facts.height;
      hash = hashBytes(parsed.bytes);
    } else {
      const safe = safeUrl(raw);
      if (!safe) {
        return NextResponse.json({ error: "That image could not be read. Upload a JPG, PNG or WebP photo." }, { status: 400 });
      }
      url = safe;
      if (safe.startsWith("data:")) {
        const parsed = parseImageDataUrl(safe);
        if (parsed) {
          mime = parsed.format === "jpeg" ? "image/jpeg" : `image/${parsed.format}`;
          bytes = parsed.bytes.length;
          hash = hashBytes(parsed.bytes);
          const dims = readImageDimensions(parsed.bytes, parsed.format);
          width = width ?? dims?.width ?? null;
          height = height ?? dims?.height ?? null;
        }
      }
    }

    // Identical pixels are reused rather than stored twice (§19).
    if (hash) {
      const existing = await prisma.mediaAsset.findFirst({
        where: { businessId, hash },
        select: { id: true, url: true, alt: true, width: true, height: true, source: true, label: true },
      });
      if (existing) {
        if (alt && alt !== existing.alt) {
          await prisma.mediaAsset.update({ where: { id: existing.id }, data: { alt, kind } });
        }
        return NextResponse.json({ asset: { ...existing, alt: alt || existing.alt, kind }, reused: true });
      }
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        businessId,
        url,
        kind,
        alt: alt || null,
        width,
        height,
        bytes,
        hash,
        mime,
        source,
        label,
        aiGenerationId: typeof body?.aiGenerationId === "string" ? body.aiGenerationId.slice(0, 40) : null,
      },
      select: ASSET_SELECT,
    });
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
 *
 * Every edit must name the `updatedAt` it was made from. That is what stops a second window
 * (or a second person with access) from silently replacing a description someone just wrote.
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
      select: { id: true, businessId: true, updatedAt: true },
    });
    if (!asset) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, asset.businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    // Authorization precedes the precondition, exactly like the Studio's draft routes: a caller
    // who may not touch this image learns nothing about its version. Without a usable token the
    // request cannot be applied, so it is refused before any validation or write (428).
    const expectedUpdatedAt = parseExpectedUpdatedAt(body?.expectedUpdatedAt);
    if (!expectedUpdatedAt) {
      return NextResponse.json({ error: MEDIA_VERSION_REQUIRED_MESSAGE, code: MEDIA_VERSION_REQUIRED_CODE }, { status: 428 });
    }

    const data: Record<string, unknown> = {};
    if (body?.alt !== undefined) data.alt = sanitizeText(String(body.alt || ""), 160) || null;
    if (body?.kind !== undefined) data.kind = normalizeKind(body.kind);
    if (body?.label !== undefined) data.label = normalizeLabel(body.label);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    // Fast path: a window that is already stale is refused before any write.
    if (versionMillis(asset.updatedAt) !== expectedUpdatedAt.getTime()) {
      return NextResponse.json({ error: MEDIA_CHANGED_MESSAGE, code: MEDIA_CHANGED_CODE }, { status: 409 });
    }

    // Compare-and-swap: the write applies only while the row still carries the version this
    // request read. Scoping by `businessId` as well means a tenant mix-up can never reach
    // another business's row even if the ownership check above were wrong. A concurrent edit
    // makes this match no row, and nothing is overwritten.
    const applied = await prisma.mediaAsset.updateMany({
      where: { id, businessId: asset.businessId, updatedAt: expectedUpdatedAt },
      data,
    });
    if (applied.count !== 1) {
      return NextResponse.json({ error: MEDIA_CHANGED_MESSAGE, code: MEDIA_CHANGED_CODE }, { status: 409 });
    }

    const updated = await prisma.mediaAsset.findUnique({ where: { id }, select: ASSET_SELECT });
    if (!updated) {
      // Deleted between the write and the read: the edit no longer has anything to describe.
      return NextResponse.json({ error: MEDIA_CHANGED_MESSAGE, code: MEDIA_CHANGED_CODE }, { status: 409 });
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
      const guard = await guardTenantMutation(session, first.businessId);
      if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
      const result = await prisma.mediaAsset.deleteMany({ where: { businessId: first.businessId, aiGenerationId: generationId } });
      await logAudit({ actorId: session.userId, action: "MEDIA_DELETED", targetType: "AI_GENERATION", targetId: generationId, metadata: { businessId: first.businessId, count: result?.count ?? rows.length } });
      return NextResponse.json({ ok: true, removed: result?.count ?? rows.length });
    }

    const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { id: true, businessId: true } });
    if (!asset) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, asset.businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    await prisma.mediaAsset.delete({ where: { id } });
    await logAudit({ actorId: session.userId, action: "MEDIA_DELETED", targetType: "MEDIA_ASSET", targetId: id, metadata: { businessId: asset.businessId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

/** Exposed for tests and for the Studio's own pre-flight checks. */
