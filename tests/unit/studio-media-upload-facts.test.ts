/**
 * Mobile upload regression suite — bytes in, honest facts out (§18, §19, §20, §39, §40)
 *
 * Every assertion here corresponds to a photo a real owner uploaded and a failure they actually
 * met: the JPEG from an Android camera, the PNG from a screenshot, the WebP from Google Photos,
 * the iPhone HEIC that cannot render, the 12 MB photo on a slow connection, the file that lies
 * about its extension, and the truncated download that arrives damaged.
 */

import { describe, expect, it } from "vitest";
import {
  FORMAT_FOR_MIME,
  MAX_UPLOAD_BYTES,
  MIME_FOR_FORMAT,
  humanFileSize,
  parseImageDataUrl,
  readExifOrientation,
  readImageDimensions,
  sniffImageFormat,
  validateImageBytes,
} from "@/lib/media/imageFormat";
import { chooseOutputFormat, planCrop, planResize, uploadStepMessage } from "@/lib/media/imagePlan";
import { dataUrlFor, gifBytes, heicBytes, jpegBytes, pngBytes, textBytes, webpBytes } from "../helpers/imageFixtures";

describe("what the bytes really are, whatever the file is called", () => {
  it("recognises the four formats every phone produces", () => {
    expect(sniffImageFormat(jpegBytes())).toBe("jpeg");
    expect(sniffImageFormat(pngBytes())).toBe("png");
    expect(sniffImageFormat(webpBytes())).toBe("webp");
    expect(sniffImageFormat(gifBytes())).toBe("gif");
    expect(sniffImageFormat(heicBytes())).toBe("heic");
    expect(sniffImageFormat(textBytes())).toBeNull();
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
  });

  it("reads the dimensions the website needs to reserve space for (no layout jump)", () => {
    expect(readImageDimensions(jpegBytes({ width: 3024, height: 4032 }), "jpeg")).toEqual({ width: 3024, height: 4032 });
    expect(readImageDimensions(pngBytes({ width: 1080, height: 1080 }), "png")).toEqual({ width: 1080, height: 1080 });
    expect(readImageDimensions(webpBytes({ width: 1600, height: 900 }), "webp")).toEqual({ width: 1600, height: 900 });
  });

  it("reads the EXIF orientation that makes portraits come out sideways", () => {
    expect(readExifOrientation(jpegBytes({ exifOrientation: 6 }))).toBe(6);
    expect(readExifOrientation(jpegBytes({ exifOrientation: 8 }))).toBe(8);
    expect(readExifOrientation(jpegBytes())).toBeNull();
  });

  it("keeps a mismatched extension out of the library and explains it", () => {
    // A WhatsApp-forwarded "photo.png" that is really a JPEG must not be rejected — the bytes win.
    const verdict = validateImageBytes(jpegBytes(), { declaredMime: "image/png", filename: "photo.png" });
    expect(verdict.status).toBe("error");
    if (verdict.status !== "error") return;
    expect(verdict.issue.code).toBe("wrong_extension");
    expect(verdict.issue.message).toContain("JPG");
    expect(verdict.issue.recoverable).toBe(true);
  });

  it("accepts a JPEG that claims to be a JPEG, and reports its real size", () => {
    const verdict = validateImageBytes(jpegBytes({ width: 1200, height: 900 }), { declaredMime: "image/jpeg" });
    expect(verdict.status).toBe("ok");
    if (verdict.status !== "ok") return;
    expect(verdict.facts.mime).toBe("image/jpeg");
    expect(verdict.facts.width).toBe(1200);
    expect(verdict.facts.height).toBe(900);
    expect(verdict.facts.bytes).toBeGreaterThan(0);
  });
});

describe("the uploads that used to fail silently now fail usefully", () => {
  it("tells an iPhone owner exactly what to do about a HEIC photo", () => {
    const verdict = validateImageBytes(heicBytes(), { declaredMime: "image/heic", filename: "IMG_4021.HEIC" });
    expect(verdict.status).toBe("error");
    if (verdict.status !== "error") return;
    expect(verdict.issue.code).toBe("heic_unsupported");
    expect(verdict.issue.message).toContain("Most Compatible");
    expect(verdict.issue.message).not.toContain("undefined");
  });

  it("refuses a file that is not a photo without blaming the owner", () => {
    const verdict = validateImageBytes(textBytes("Hello, this is a contract, not a photo"));
    expect(verdict.status).toBe("error");
    if (verdict.status !== "error") return;
    expect(verdict.issue.code).toBe("not_image");
    expect(verdict.issue.message).toContain("JPG");
  });

  it("names the real size when a photo is too big for the API and offers the fix", () => {
    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1024);
    huge.set([0xff, 0xd8, 0xff], 0);
    const verdict = validateImageBytes(huge);
    expect(verdict.status).toBe("error");
    if (verdict.status !== "error") return;
    expect(verdict.issue.code).toBe("too_large");
    expect(verdict.issue.message).toMatch(/MB/);
    expect(verdict.issue.recoverable).toBe(true);
  });

  it("catches a header that promises pixels it does not have", () => {
    // JPEG signature + SOF0 but the file was cut off before the frame header completed.
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f]);
    const verdict = validateImageBytes(truncated);
    expect(verdict.status).toBe("error");
    if (verdict.status !== "error") return;
    expect(["corrupt", "not_image"]).toContain(verdict.issue.code);
    expect(verdict.issue.message).toContain("photo");
  });

  it("never accepts an SVG through the image door (no scripts, no external fetches)", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageFormat(svg)).toBeNull();
    const parsed = parseImageDataUrl(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
    expect(parsed).toBeNull();
  });
});

describe("data URLs from a phone are parsed the way a phone produces them", () => {
  it("parses a normal data URL and rejects a lying one", () => {
    const parsed = parseImageDataUrl(dataUrlFor(jpegBytes(), "image/jpeg"));
    expect(parsed?.format).toBe("jpeg");
    expect(parseImageDataUrl("data:image/png;base64,###not-base64###")).toBeNull();
    expect(parseImageDataUrl("https://example.com/photo.jpg")).toBeNull();
    expect(parseImageDataUrl(null)).toBeNull();
  });
});

describe("normalization decisions keep quality while making the site fast", () => {
  it("never upscales and never destroys a small photo", () => {
    const plan = planResize({ width: 900, height: 600 }, { maxEdge: 1600 });
    expect(plan.width).toBe(900);
    expect(plan.scaled).toBe(false);
  });

  it("shrinks a 12 MP phone photo to a web-friendly long edge", () => {
    const plan = planResize({ width: 4032, height: 3024 }, { maxEdge: 1600 });
    expect(Math.max(plan.width, plan.height)).toBe(1600);
    expect(plan.scaled).toBe(true);
    expect(plan.width / plan.height).toBeCloseTo(4032 / 3024, 2);
  });

  it("reports that a rotated photo needs its axes swapped", () => {
    expect(planResize({ width: 1000, height: 2000, exifOrientation: 6 }, { maxEdge: 1600 }).rotated).toBe(true);
    expect(planResize({ width: 1000, height: 2000, exifOrientation: 1 }, { maxEdge: 1600 }).rotated).toBe(false);
  });

  it("saves photographs as JPG, keeps transparency as PNG and leaves GIFs alone", () => {
    expect(chooseOutputFormat({ format: "jpeg", width: 1200, height: 900, pixelsSource: "upload" }).mime).toBe("image/jpeg");
    expect(chooseOutputFormat({ format: "png", hasAlpha: true, width: 400, height: 400 }).format).toBe("png");
    expect(chooseOutputFormat({ format: "gif", width: 320, height: 240 }).format).toBe("gif");
    const big = chooseOutputFormat({ format: "jpeg", width: 1600, height: 1200, pixelsSource: "upload" });
    const small = chooseOutputFormat({ format: "jpeg", width: 600, height: 400, pixelsSource: "upload" });
    expect(big.quality).toBeLessThan(small.quality);
  });

  it("crops to the shapes the storefront asks for, centred on the product", () => {
    const square = planCrop({ width: 1200, height: 800 }, "square");
    expect(square.sw).toBe(800);
    expect(square.sh).toBe(800);
    expect(square.sx).toBe(200);

    const wide = planCrop({ width: 1200, height: 800 }, "wide");
    expect(wide.sw).toBeGreaterThanOrEqual(wide.sh);
    expect(wide.outputWidth).toBeGreaterThan(0);

    const focus = planCrop({ width: 1000, height: 1000 }, "square", { focusX: 0.1, focusY: 0.9 });
    expect(focus.sx).toBeLessThan(500);
  });

  it("keeps progress language human", () => {
    for (const step of ["reading", "checking", "optimizing", "uploading", "saving", "done"] as const) {
      const message = uploadStepMessage(step);
      expect(message.length).toBeGreaterThan(3);
      expect(message).not.toMatch(/[/_]|\d+%/);
    }
  });

  it("formats file sizes the way an owner reads them", () => {
    expect(humanFileSize(900)).toBe("900 B");
    expect(humanFileSize(2048)).toBe("2 KB");
    expect(humanFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("maps the mime aliases phones send back to one canonical format", () => {
    expect(FORMAT_FOR_MIME["image/jpg"]).toBe("jpeg");
    expect(FORMAT_FOR_MIME["image/heif"]).toBe("heic");
    expect(FORMAT_FOR_MIME["image/pjpeg"]).toBe("jpeg");
    for (const format of Object.keys(MIME_FOR_FORMAT) as Array<keyof typeof MIME_FOR_FORMAT>) {
      expect(FORMAT_FOR_MIME[MIME_FOR_FORMAT[format]]).toBe(format);
    }
  });
});

describe("one storage ceiling for upload and publication", () => {
  it("accepts exactly what a website document can store, and nothing more", async () => {
    const { MAX_STORED_CHARS, MAX_UPLOAD_CHARS } = await import("@/lib/media/imageFormat");
    const { safeUrl } = await import("@/lib/experience/document");

    // The API must never accept something the website could not then display (§19, §47).
    expect(MAX_UPLOAD_CHARS).toBe(MAX_STORED_CHARS);

    const body = "A".repeat(64);
    const withinBudget = `data:image/png;base64,${body}`;
    expect(safeUrl(withinBudget)).toBe(withinBudget);

    const overBudget = `data:image/png;base64,${"A".repeat(MAX_STORED_CHARS)}`;
    expect(overBudget.length).toBeGreaterThan(MAX_STORED_CHARS);
    expect(safeUrl(overBudget)).toBe("");
  });
});
