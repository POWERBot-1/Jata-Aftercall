import { describe, expect, it } from "vitest";
import {
  assertNoInlineImagePersistence,
  containsInlineImageDataUrl,
  imageUrlForNewRecord,
  INLINE_MEDIA_PERSISTENCE_CODE,
  INLINE_MEDIA_PERSISTENCE_MESSAGE,
  InlineMediaPersistenceError,
  inlineImageDataUrlValues,
  isInlineImageDataUrl,
} from "@/lib/media/persistence-policy";

const legacyImage = "data:image/png;base64,iVBORw0KGgo=";

describe("inline media persistence policy", () => {
  it("detects raster data URLs in nested objects, arrays and serialized documents", () => {
    expect(containsInlineImageDataUrl({ brand: { heroImageUrl: legacyImage } })).toBe(true);
    expect(containsInlineImageDataUrl([{ imageUrl: legacyImage }])).toBe(true);
    expect(containsInlineImageDataUrl(JSON.stringify({ images: [{ url: legacyImage }] }))).toBe(true);
    expect(isInlineImageDataUrl(legacyImage)).toBe(true);
    expect(isInlineImageDataUrl(" DATA:IMAGE/JPEG;BASE64,AA== ")).toBe(true);
  });

  it("blocks every image data scheme, not only base64 raster formats", () => {
    const unsupportedButStillInline = "data:image/svg+xml,%3Csvg%3E";
    expect(containsInlineImageDataUrl({ imageUrl: unsupportedButStillInline })).toBe(true);
    expect(containsInlineImageDataUrl(JSON.stringify({ imageUrl: "data:image/avif;base64,AAAA" }))).toBe(true);
    expect(containsInlineImageDataUrl({ imageUrl: "data:image/png" })).toBe(true);
    expect(isInlineImageDataUrl(unsupportedButStillInline)).toBe(true);
    expect(inlineImageDataUrlValues({ imageUrl: unsupportedButStillInline })).toEqual([unsupportedButStillInline]);
  });

  it("detects escaped and Unicode-escaped slashes inside JSON-bearing text columns", () => {
    const escapedSlashJson = String.raw`{"gallery":[{"url":"data:image\/png;base64,AA=="}]}`;
    const unicodeSlashJson = String.raw`{"options":{"thumbnail":"data:image\u002fpng;base64,AA=="}}`;
    expect(containsInlineImageDataUrl(escapedSlashJson)).toBe(true);
    expect(containsInlineImageDataUrl(unicodeSlashJson)).toBe(true);
    expect(inlineImageDataUrlValues(unicodeSlashJson)).toHaveLength(1);
    expect(imageUrlForNewRecord(String.raw`data:image\/png;base64,AA==`)).toBeNull();
  });

  it("detects fully escaped prefixes and Unicode slashes beyond the bounded JSON parse size", () => {
    const escape = String.fromCharCode(92);
    const largeJson = `{"padding":"${"x".repeat(65_540)}","image":"data:image${escape}u002fpng;base64,AA=="}`;
    const encodedPrefix = `${escape}u0064ata:${escape}u0069mage${escape}u002fpng;base64,AA==`;

    expect(largeJson.length).toBeGreaterThan(65_536);
    expect(containsInlineImageDataUrl(largeJson)).toBe(true);
    expect(containsInlineImageDataUrl(encodedPrefix)).toBe(true);
  });

  it("does not flag ordinary hosted URLs or descriptive text", () => {
    expect(containsInlineImageDataUrl({ imageUrl: "https://cdn.example.test/photo.png" })).toBe(false);
    expect(containsInlineImageDataUrl({ body: "A photo of a blue bowl." })).toBe(false);
    expect(isInlineImageDataUrl("https://cdn.example.test/photo.png")).toBe(false);
  });

  it("throws a stable, non-sensitive refusal before an inline media write", () => {
    try {
      assertNoInlineImagePersistence({ imageUrl: legacyImage });
      throw new Error("expected policy refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(InlineMediaPersistenceError);
      expect((error as InlineMediaPersistenceError).status).toBe(503);
      expect((error as InlineMediaPersistenceError).code).toBe(INLINE_MEDIA_PERSISTENCE_CODE);
      expect((error as Error).message).toBe(INLINE_MEDIA_PERSISTENCE_MESSAGE);
      expect((error as Error).message).not.toContain("iVBOR");
    }
  });

  it("omits only inline URLs from optional new-record image snapshots", () => {
    expect(imageUrlForNewRecord(legacyImage)).toBeNull();
    expect(imageUrlForNewRecord("https://cdn.example.test/photo.png")).toBe("https://cdn.example.test/photo.png");
    expect(imageUrlForNewRecord(null)).toBeNull();
    expect(inlineImageDataUrlValues({ url: legacyImage, title: "A" })).toEqual([legacyImage]);
  });
});
