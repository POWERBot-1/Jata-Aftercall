import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { authorizeOwner } from "@/lib/business-hub/guard";
// The PNG writer is server-only (`node:zlib`); the SVG and poster renderers are browser-safe and
// also power the on-page preview, so the two live in different modules on purpose.
import { qrPngBuffer } from "@/lib/qr/png";
import { businessQrMatrix, businessQrPoster, businessQrSvg, publicPageUrl } from "@/lib/business-hub/qrIdentity";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };

/**
 * Business QR identity: preview and download (Business Hub E).
 *
 * `?format=svg`      — the symbol alone, for embedding.
 * `?format=png`      — a print-ready greyscale PNG (12 px per module, 4-module quiet zone).
 * `?format=poster`   — the printable A4 poster: QR + business name + the URL it opens.
 * `&download=1`      — forces a file download with a stable filename.
 *
 * Nothing about the request can change what the code points at: the payload is always the
 * business's canonical public page URL, derived from its slug.
 */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: noStore });

  const business = await prisma.business
    .findUnique({ where: { id: businessId }, select: { slug: true, name: true } })
    .catch(() => null);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404, headers: noStore });

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "svg").toLowerCase();
  const download = searchParams.get("download") === "1";
  const url = publicPageUrl(business.slug);
  const filename = `${business.slug}-jata-qr`;

  if (format === "png") {
    const png = qrPngBuffer(businessQrMatrix(business.slug), {
      scale: Number(searchParams.get("scale")) || 12,
      margin: 4,
    });
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(png.byteLength),
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}.png"`,
        ...noStore,
      },
    });
  }

  if (format === "poster") {
    const poster = businessQrPoster(business.slug, { businessName: business.name, url });
    return new NextResponse(poster, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}-poster.svg"`,
        ...noStore,
      },
    });
  }

  const size = Math.max(120, Math.min(1200, Number(searchParams.get("size")) || 320));
  const svg = businessQrSvg(business.slug, { size });
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}.svg"`,
      ...noStore,
    },
  });
}
