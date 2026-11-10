/**
 * Business QR Identity (Business Hub feature E).
 *
 * Every published Business Page gets a QR code that opens that page. Three properties matter and
 * are enforced here:
 *
 *  1. The encoded URL is the page's CANONICAL public URL — `https://jataaftercall.co.ke/b/<slug>`
 *     (or the configured public app origin). It is never a dashboard URL, never a preview host and
 *     never a URL containing a business id, reference or customer detail. A preview deployment
 *     must not print QR codes pointing at itself, so `getBaseUrl()`'s ephemeral Vercel host is
 *     deliberately not used here.
 *  2. The code is derived from the SLUG, so editing the profile, the catalogue or a promotion
 *     cannot change where it points. Nothing needs re-printing after a content change.
 *  3. The symbol is a real QR code (ISO/IEC 18004, byte mode, ECC level M) produced by
 *     `lib/qr/encoder.ts` — scannable by the stock Android and iOS camera apps.
 */

import { encodeQrMatrix, type QrErrorCorrectionLevel, type QrMatrix } from "../qr/encoder";
import { qrPosterSvg, qrSvg } from "../qr/render";

/** The official public origin used for printed material (§E). */
export const QR_PUBLIC_ORIGIN_FALLBACK = "https://jataaftercall.co.ke";

export const QR_ERROR_CORRECTION: QrErrorCorrectionLevel = "M";
/** Print sizes: 4-module quiet zone (spec minimum) and >=10 px per module at A4. */
export const QR_PRINT_SCALE = 12;
export const QR_SCREEN_SIZE = 320;

/**
 * The canonical public URL a printed QR must open.
 *
 * An ephemeral host — localhost, a Vercel preview, a sandbox URL — would be a broken poster the
 * moment the preview expires, so only an explicitly configured public origin is honoured and
 * every preview host is refused by name; everything else falls back to the official domain.
 */
export function publicPageUrl(slug: string, env: NodeJS.ProcessEnv = process.env): string {
  const cleanSlug = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
  const configured = (env.NEXT_PUBLIC_APP_URL || env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const usable =
    configured &&
    !/localhost|127\.0\.0\.1|0\.0\.0\.0|\.vercel\.app|\.e2b\.app|\.ngrok(-free)?\.(app|io|dev)/i.test(configured) &&
    /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(configured)
      ? configured
      : QR_PUBLIC_ORIGIN_FALLBACK;
  return `${usable}/b/${encodeURIComponent(cleanSlug)}`;
}

export function businessQrMatrix(slug: string, ecLevel: QrErrorCorrectionLevel = QR_ERROR_CORRECTION): QrMatrix {
  return encodeQrMatrix(publicPageUrl(slug), { ecLevel });
}

/** Screen/embed SVG (owner preview, customer page section). */
export function businessQrSvg(slug: string, options: { size?: number; margin?: number } = {}): string {
  return qrSvg(businessQrMatrix(slug), { size: options.size ?? QR_SCREEN_SIZE, margin: options.margin ?? 4 });
}

/** Print-ready poster: QR + business name + the URL it opens. Contains public information only. */
export function businessQrPoster(
  slug: string,
  options: { businessName: string; caption?: string; url?: string },
): string {
  const url = options.url || publicPageUrl(slug);
  return qrPosterSvg(businessQrMatrix(slug), {
    businessName: options.businessName,
    url,
    caption: options.caption ?? "Scan to open this business page",
  });
}

/**
 * The URL a customer-facing "share this page" action uses — the live host, not the print origin,
 * because it is only ever followed from a device that is already on this page.
 */
export function shareablePageUrl(slug: string, origin?: string): string {
  const base = (origin || "").replace(/\/+$/, "");
  const path = `/b/${String(slug || "").trim().replace(/^\/+|\/+$/g, "")}`;
  return base ? `${base}${path}` : path;
}
