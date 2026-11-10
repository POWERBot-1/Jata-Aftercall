import { describe, expect, it } from "vitest";
import {
  MAX_ANNOTATION_CHARS,
  MAX_ANNOTATIONS_PER_CHECK,
  THUMBNAIL_TIERS,
  VIEWPORT_ORDER,
  chunkBase64,
  decodeVisualAnnotations,
  groupVisualAnnotations,
  isJpegComplete,
  isJpegStart,
  perViewportBudget,
  planVisualAnnotations,
} from "../../scripts/motion/visual-annotation.mjs";

// These tests exist because the previous emitter produced evidence that LOOKED
// published and could not be opened. Check run 130128893526 returned exactly 10
// annotations (GitHub's cap), truncating MOTION_VISUAL_360x800 mid-stream and
// dropping 390x844/430x932/768x1024/1366x768 entirely. Every decoded fragment
// lacked FFD9. Each assertion below pins one link in that chain so it cannot
// silently regress into "no independently inspectable evidence" again.
const jpeg = (markerBytes = 2048) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(markerBytes, 0x41),
  Buffer.from([0xff, 0xd9]),
]);

describe("six-viewport annotation publishing", () => {
  it("never plans more annotations than GitHub accepts per check run", () => {
    const parts = planVisualAnnotations(jpeg(4000).toString("base64"));
    expect(MAX_ANNOTATIONS_PER_CHECK).toBe(10);
    expect(parts.chunks.length).toBeLessThanOrEqual(MAX_ANNOTATIONS_PER_CHECK);
    expect(parts.fits).toBe(true);
    // 3000-char parts stay under the 4096-byte annotation message limit.
    for (const chunk of parts.chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_ANNOTATION_CHARS);
  });

  it("refuses an image that would overflow the remaining annotation budget", () => {
    const oversized = jpeg(90_000).toString("base64");
    const plan = planVisualAnnotations(oversized, { maxAnnotations: 1 });
    expect(plan.fits).toBe(false);
    expect(plan.reason).toMatch(/only 1 remain/);
    expect(plan.reason).toContain(`${MAX_ANNOTATIONS_PER_CHECK}-annotation cap`);
  });

  it("reserves budget for all six mandated viewports rather than the first two", () => {
    expect(perViewportBudget()).toBe(1);
    expect(perViewportBudget(6, { maxAnnotations: 12 })).toBe(2);
    expect(perViewportBudget(6, { maxAnnotations: 10, reserved: 4 })).toBe(1);
    // Never negative when prior annotations already consumed the budget.
    expect(perViewportBudget(6, { maxAnnotations: 10, reserved: 10 })).toBe(0);
    expect(VIEWPORT_ORDER).toEqual(["320x568", "360x800", "390x844", "430x932", "768x1024", "1366x768"]);
  });

  it("offers progressively smaller tiers so a thumbnail can be shrunk until it fits", () => {
    expect(THUMBNAIL_TIERS.length).toBeGreaterThan(1);
    for (let index = 1; index < THUMBNAIL_TIERS.length; index += 1) {
      expect(THUMBNAIL_TIERS[index].width).toBeLessThan(THUMBNAIL_TIERS[index - 1].width);
      expect(THUMBNAIL_TIERS[index].quality).toBeLessThan(THUMBNAIL_TIERS[index - 1].quality);
    }
    // A six-part image cannot fit a single annotation at any tier above 3000 chars.
    const sixParts = Buffer.alloc(3000 * 6 * 3 / 4, 0x41);
    expect(chunkBase64(sixParts.toString("base64")).length).toBe(6);
  });

  it("rejects a truncated stream instead of returning a plausible short prefix", () => {
    const whole = jpeg();
    const truncated = whole.subarray(0, whole.length - 2);
    expect(isJpegStart(whole)).toBe(true);
    expect(isJpegComplete(whole)).toBe(true);
    expect(isJpegComplete(truncated)).toBe(false);

    const decoded = decodeVisualAnnotations(chunkBase64(truncated.toString("base64")));
    expect(decoded.ok).toBe(false);
    expect(decoded.reason).toMatch(/truncated/);
    // The bytes are still returned for diagnosis — but never claimed as an image.
    expect(decoded.bytes.length).toBe(truncated.length);
  });

  it("round-trips a whole image through numbered parts and back", () => {
    const whole = jpeg(9000);
    const parts = chunkBase64(whole.toString("base64"));
    expect(parts.length).toBeGreaterThan(1);
    const decoded = decodeVisualAnnotations(parts);
    expect(decoded.ok).toBe(true);
    expect(Buffer.compare(decoded.bytes, whole)).toBe(0);
  });

  it("refuses empty, non-string and non-JPEG input", () => {
    expect(decodeVisualAnnotations([]).reason).toMatch(/no annotation parts/);
    expect(decodeVisualAnnotations([1, 2]).reason).toMatch(/must all be strings/);
    // Invalid base64 decodes to zero bytes; that is its own reason, not a JPEG verdict.
    expect(decodeVisualAnnotations(["!!!!!!!!"]).reason).toMatch(/zero bytes/);
    const notJpeg = decodeVisualAnnotations([Buffer.from("PNG-ish bytes").toString("base64")]);
    expect(notJpeg.ok).toBe(false);
    expect(notJpeg.reason).toMatch(/start-of-image/);
    expect(() => chunkBase64(null)).toThrow(TypeError);
    expect(() => chunkBase64("abcd", 0)).toThrow(RangeError);
    expect(() => planVisualAnnotations("abcd", { maxAnnotations: -1 })).toThrow(RangeError);
  });

  it("groups retrieved annotations per viewport and reports dropped parts", () => {
    const annotations = [
      { title: "MOTION_VISUAL_360x800_2_OF_2", message: "bbbb" },
      { title: "MOTION_VISUAL_360x800_1_OF_2", message: "aaaa" },
      { title: "MOTION_VISUAL_320x568_1_OF_1", message: "cccc" },
      { title: "Motion evidence summary", message: "{}" },
      // The exact shape observed in run 130128893526: a viewport whose second
      // part was never emitted because the 10-annotation cap was reached.
      { title: "MOTION_VISUAL_390x844_1_OF_3", message: "dddd" },
    ];
    const groups = groupVisualAnnotations(annotations);
    expect(groups.map((group) => group.viewport)).toEqual(["320x568", "360x800", "390x844"]);
    expect(groups[1].parts).toEqual(["aaaa", "bbbb"]);
    expect(groups[1].missing).toEqual([]);
    expect(groups[2].missing).toEqual([2, 3]);
    expect(groups.map((group) => group.viewport)).not.toContain("1366x768");
  });
});
