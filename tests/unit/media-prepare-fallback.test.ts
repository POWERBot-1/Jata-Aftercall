/**
 * prepareUpload in a non-browser runtime: there is no canvas or image decoder, so the optional
 * optimisation step always fails. That exercises the fallback path directly.
 *
 * Expected behaviour:
 *   - a complete JPEG / PNG / WebP / GIF is uploaded as the original (usable photo is not lost).
 *     Fixtures are synthetic headers, so "complete" versions get a real PNG end chunk and WebP length,
 *   - a truncated file with a valid signature is NOT uploaded (it would be a broken image),
 *   - HEIC keeps its specific conversion instruction,
 *   - text renamed to an image is rejected as not an image.
 *
 * Real-browser decode and WebP encoding are verified separately (see the release report).
 */
import { describe, expect, it } from "vitest";
import { prepareUpload } from "@/lib/media/browserImage";
import { gifBytes, heicBytes, jpegBytes, pngBytes, textBytes, webpBytes } from "../helpers/imageFixtures";

function fileOf(bytes: Uint8Array, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** The fixture PNG has no end chunk. A real PNG always ends with IEND, so add it. */
function completePng(bytes: Uint8Array): Uint8Array {
  const iend = new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const out = new Uint8Array(bytes.length + iend.length);
  out.set(bytes, 0);
  out.set(iend, bytes.length);
  return out;
}

/** The fixture WebP header carries a placeholder RIFF size. A real file's size is length - 8. */
function completeWebp(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes);
  const riff = out.length - 8;
  out[4] = riff & 0xff;
  out[5] = (riff >> 8) & 0xff;
  out[6] = (riff >> 16) & 0xff;
  out[7] = (riff >> 24) & 0xff;
  return out;
}

describe("prepareUpload falls back to the original when optimisation is unavailable", () => {
  it("uploads a complete JPEG as the original", async () => {
    const bytes = jpegBytes({ width: 640, height: 480 });
    const result = await prepareUpload(fileOf(bytes, "photo.jpg", "image/jpeg"));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.upload.mime).toBe("image/jpeg");
      expect(result.upload.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
      expect(result.upload.bytes).toBe(bytes.length);
      expect(result.upload.notes.join(" ")).toMatch(/uploaded the original/);
    }
  });

  it("uploads a complete PNG as the original", async () => {
    const result = await prepareUpload(fileOf(completePng(pngBytes({ width: 320, height: 200 })), "shot.png", "image/png"));
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.upload.mime).toBe("image/png");
  });

  it("uploads a complete WebP as the original (Android camera output)", async () => {
    const bytes = completeWebp(webpBytes({ width: 2400, height: 1600 }));
    const result = await prepareUpload(fileOf(bytes, "scenery.webp", "image/webp"));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.upload.mime).toBe("image/webp");
      expect(result.upload.width).toBe(2400);
    }
  });

  it("uploads a complete GIF as the original", async () => {
    const result = await prepareUpload(fileOf(gifBytes({ width: 40, height: 40 }), "loop.gif", "image/gif"));
    expect(result.status).toBe("ok");
  });

  it("does not upload a truncated JPEG, even though its signature is valid", async () => {
    const full = jpegBytes({ width: 640, height: 480 });
    const truncated = full.slice(0, Math.floor(full.length / 2));
    const result = await prepareUpload(fileOf(truncated, "cut.jpg", "image/jpeg"));
    expect(result.status).toBe("error");
  });

  it("does not upload a truncated WebP whose RIFF length no longer matches the file", async () => {
    const full = completeWebp(webpBytes({ width: 640, height: 480 }));
    const result = await prepareUpload(fileOf(full.slice(0, full.length - 8), "cut.webp", "image/webp"));
    expect(result.status).toBe("error");
  });

  it("keeps the HEIC conversion instruction and never falls back for HEIC", async () => {
    const result = await prepareUpload(fileOf(heicBytes(), "IMG_0001.HEIC", "image/heic"));
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.issue.code).toBe("heic_unsupported");
      expect(result.issue.message).toMatch(/Most Compatible|screenshot/);
    }
  });

  it("rejects text renamed to a photo", async () => {
    const result = await prepareUpload(fileOf(textBytes(), "invoice.jpg", "image/jpeg"));
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.issue.code).toBe("not_image");
  });

  it("rejects an empty file", async () => {
    const result = await prepareUpload(fileOf(new Uint8Array(0), "empty.jpg", "image/jpeg"));
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.issue.code).toBe("empty");
  });
});
