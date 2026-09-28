import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const OG_PATH = path.join(root, "public", "og.jpg");

/**
 * Minimal dependency-free JPEG header parse.
 * Walks the marker segments to find the Start-Of-Frame (SOFn) marker,
 * which encodes the image height/width. Returns null for anything that
 * is not a well-formed baseline JPEG with an SOFn.
 */
function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI
  let offset = 2;
  while (offset + 9 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    // RSTn / standalone markers without a length payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    // SOFn markers carry precision + height + width.
    const isSOF = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

describe("static OG image (public/og.jpg)", () => {
  const buf = readFileSync(OG_PATH);

  it("is a committed static asset (no dynamic next/og renderer)", () => {
    expect(buf.length).toBeGreaterThan(0);
    // A dynamic ImageResponse route would live at app/**/opengraph-image.*; there is none.
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });

  it("is exactly 1200x630 (OG standard)", () => {
    const dims = jpegDimensions(buf);
    expect(dims).not.toBeNull();
    expect(dims!.width).toBe(1200);
    expect(dims!.height).toBe(630);
  });

  it("is a compact JPEG under the 100KB budget", () => {
    // SOI ... EOI framing
    expect(buf.readUInt16BE(0)).toBe(0xffd8);
    expect(buf.readUInt16BE(buf.length - 2)).toBe(0xffd9);
    expect(buf.length).toBeLessThan(100_000);
  });
});

describe("business page metadata references the OG asset", () => {
  const page = readFileSync(path.join(root, "app", "b", "[slug]", "page.tsx"), "utf8");

  it("supplies openGraph.images pointing at /og.jpg", () => {
    expect(page).toContain("openGraph:");
    expect(page).toContain('url: "/og.jpg"');
    expect(page).toContain("width: 1200");
    expect(page).toContain("height: 630");
  });

  it("uses twitter summary_large_image with the same asset", () => {
    expect(page).toContain("twitter:");
    expect(page).toContain('card: "summary_large_image"');
  });

  it("still relies on the shared metadataBase/PUBLIC_BASE_URL mechanism", () => {
    const layout = readFileSync(path.join(root, "app", "layout.tsx"), "utf8");
    expect(layout).toContain("metadataBase: new URL(getBaseUrl())");
  });
});
