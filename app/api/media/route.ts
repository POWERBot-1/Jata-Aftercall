/**
 * Media library API (§19, §47)
 *
 * Upload, preview, replace, delete, reuse. Identical uploads are detected by content hash
 * and reused instead of stored twice (§19). Only raster image data URLs are accepted —
 * no SVG (script vector), no remote fetch, no executable content (§47).
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

export const dynamic = "force-dynamic";

const MAX_UPLOAD_CHARS = 3_000_000; // ≈2 MB of image data
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i;

function hashContent(dataUrl: string): string {
  return crypto.createHash("sha256").update(dataUrl).digest("hex").slice(0, 32);
}

/** Best-effort inline image dimensions, so the storefront can reserve space and avoid CLS. */
function dimensionsOf(payload: string, mime: string): { width?: number; height?: number } {
  try {
    const buffer = Buffer.from(payload, "base64");
    if (mime === "image/png" && buffer.length > 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === "image/gif" && buffer.length > 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if ((mime === "image/jpeg" || mime === "image/jpg") && buffer.length > 4) {
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
  } catch {
    // Dimensions are an optimisation; never fail an upload because of them.
  }
  return {};
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });
  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
  try {
    const assets = await prisma.mediaAsset.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: { id: true, url: true, kind: true, alt: true, width: true, height: true, bytes: true, createdAt: true },
    });
    return NextResponse.json({ assets });
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

    const kind = ["IMAGE", "LOGO", "HERO", "OTHER"].includes(String(body?.kind)) ? String(body.kind) : "IMAGE";
    const alt = sanitizeText(String(body?.alt || ""), 160);
    const raw = String(body?.url || "");

    let url = "";
    let hash: string | null = null;
    let bytes: number | null = null;
    let width: number | null = null;
    let height: number | null = null;

    const dataMatch = IMAGE_DATA_URL.exec(raw);
    if (dataMatch) {
      if (raw.length > MAX_UPLOAD_CHARS) {
        return NextResponse.json({ error: "That image is too large. Try a photo under 2 MB." }, { status: 400 });
      }
      url = raw;
      hash = hashContent(raw);
      bytes = Math.round((dataMatch[2].length * 3) / 4);
      const dimensions = dimensionsOf(dataMatch[2], dataMatch[1].toLowerCase());
      width = dimensions.width ?? null;
      height = dimensions.height ?? null;
    } else {
      url = safeUrl(raw);
      if (!url) return NextResponse.json({ error: "That image could not be read. Upload a JPG, PNG or WebP photo." }, { status: 400 });
    }

    // Reuse an identical asset instead of storing it twice (§19).
    if (hash) {
      const existing = await prisma.mediaAsset.findFirst({ where: { businessId, hash }, select: { id: true, url: true, alt: true, width: true, height: true } });
      if (existing) {
        if (alt && alt !== existing.alt) {
          await prisma.mediaAsset.update({ where: { id: existing.id }, data: { alt, kind } });
        }
        return NextResponse.json({ asset: { ...existing, alt: alt || existing.alt, kind }, reused: true });
      }
    }

    const asset = await prisma.mediaAsset.create({
      data: { businessId, url, kind, alt: alt || null, width, height, bytes, hash },
      select: { id: true, url: true, kind: true, alt: true, width: true, height: true, bytes: true, createdAt: true },
    });
    await logAudit({ actorId: session.userId, action: "MEDIA_UPLOADED", targetType: "MEDIA_ASSET", targetId: asset.id, metadata: { businessId, kind, bytes } });
    return NextResponse.json({ asset }, { status: 201 });
  } catch {
    console.error("media upload failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ error: "Choose an image to remove." }, { status: 400 });
  try {
    const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { id: true, businessId: true } });
    if (!asset) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, asset.businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    await prisma.mediaAsset.delete({ where: { id } });
    await logAudit({ actorId: session.userId, action: "MEDIA_DELETED", targetType: "MEDIA_ASSET", targetId: id });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
