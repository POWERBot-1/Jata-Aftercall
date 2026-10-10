/**
 * Upload format and validation regressions for the image pipeline.
 *
 * Covers: the WebP output probe (must be false outside a browser so the JPEG path is used),
 * server-side signature checks for JPEG/PNG/WebP, HEIC rejection, malformed and oversize input,
 * and declared-MIME mismatches. Browser-side WebP encoding itself is not exercised here; it needs
 * a real canvas (see the browser check notes in the report).
 */
import { describe, expect, it } from "vitest";
import { browserCanEncodeWebp } from "@/lib/media/browserImage";
import { MAX_UPLOAD_BYTES, validateImageBytes } from "@/lib/media/imageFormat";
import { heicBytes, jpegBytes, pngBytes, textBytes, webpBytes } from "../helpers/imageFixtures";

describe("WebP output probe", () => {
  it("reports no WebP encode support outside a browser, so uploads keep the JPEG path", () => {
    expect(browserCanEncodeWebp()).toBe(false);
  });
});

describe("server re-validates every upload by signature", () => {
  it("accepts a real WebP when it is declared as WebP", () => {
    const verdict = validateImageBytes(webpBytes({ width: 640, height: 480 }), { declaredMime: "image/webp" });
    expect(verdict.status).toBe("ok");
    if (verdict.status === "ok") {
      expect(verdict.facts.format).toBe("webp");
      expect(verdict.facts.width).toBe(640);
      expect(verdict.facts.height).toBe(480);
    }
  });

  it("accepts JPEG and PNG as before", () => {
    expect(validateImageBytes(jpegBytes({ width: 800, height: 600 }), { declaredMime: "image/jpeg" }).status).toBe("ok");
    expect(validateImageBytes(pngBytes({ width: 320, height: 200 }), { declaredMime: "image/png" }).status).toBe("ok");
  });

  it("rejects WebP bytes that are declared as JPEG (content and declaration disagree)", () => {
    const verdict = validateImageBytes(webpBytes({ width: 64, height: 64 }), { declaredMime: "image/jpeg" });
    expect(verdict.status).toBe("error");
  });

  it("rejects HEIC with a clear unsupported-format error rather than accepting it", () => {
    const verdict = validateImageBytes(heicBytes(), { declaredMime: "image/heic" });
    expect(verdict.status).toBe("error");
    if (verdict.status === "error") expect(verdict.issue.code).toBe("heic_unsupported");
  });

  it("rejects plain text renamed to an image", () => {
    const verdict = validateImageBytes(textBytes(), { declaredMime: "image/png" });
    expect(verdict.status).toBe("error");
    if (verdict.status === "error") expect(verdict.issue.code).toBe("not_image");
  });

  it("rejects an empty file", () => {
    const verdict = validateImageBytes(new Uint8Array(0), { declaredMime: "image/webp" });
    expect(verdict.status).toBe("error");
    if (verdict.status === "error") expect(verdict.issue.code).toBe("empty");
  });

  it("rejects a truncated WebP that has a RIFF header but no image data", () => {
    const truncated = webpBytes({ width: 640, height: 480 }).slice(0, 12);
    const verdict = validateImageBytes(truncated, { declaredMime: "image/webp" });
    expect(verdict.status).toBe("error");
  });

  it("enforces the size limit for an oversize WebP", () => {
    const bytes = webpBytes({ width: 64, height: 64 });
    const verdict = validateImageBytes(bytes, { declaredMime: "image/webp", maxBytes: 16 });
    expect(verdict.status).toBe("error");
    if (verdict.status === "error") expect(verdict.issue.code).toBe("too_large");
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(bytes.length);
  });
});
