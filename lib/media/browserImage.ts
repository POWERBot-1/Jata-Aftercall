/**
 * The on-device photo pipeline (§19, §20)
 *
 * Owners build their websites on phones, so the phone does the heavy lifting: decode once,
 * correct orientation, resize, optionally enhance, then re-encode as a web-ready JPG that the
 * server can accept without hitting a size wall. Everything that can fail has a sentence for
 * the owner and a way to try again — the owner's typing is never lost because a photo failed.
 *
 * Browser-only. The decisions it follows live in `imageFormat.ts` and `imagePlan.ts`, which are
 * unit-tested in Node.
 */

import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_CHARS,
  MAX_SOURCE_BYTES,
  decodeFailureIssue,
  humanFileSize,
  parseImageDataUrl,
  sniffImageFormat,
  validateImageBytes,
  type ImageFormat,
  type UploadIssue,
} from "./imageFormat";
import {
  DEFAULT_MAX_EDGE,
  chooseOutputFormat,
  planEnhancement,
  planResize,
  uploadStepMessage,
  type AspectRatio,
  type EnhanceStrength,
} from "./imagePlan";

export type PipelineStep = "reading" | "checking" | "optimizing" | "uploading" | "saving" | "done";

export type PipelineProgress = { step: PipelineStep; percent: number; message: string };

export type PreparedUpload = {
  dataUrl: string;
  mime: string;
  format: ImageFormat;
  width: number;
  height: number;
  bytes: number;
  sourceBytes: number;
  /** Plain-language notes worth showing the owner: "Shrunk 8.1 MB to 380 KB". */
  notes: string[];
};

/** A Blob-safe view of the bytes (keeps TypeScript's newer Uint8Array generics happy). */
function blobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export type PrepareResult = { status: "ok"; upload: PreparedUpload } | { status: "error"; issue: UploadIssue };

type Decoded = { bitmap: CanvasImageSource; width: number; height: number; revoke?: () => void };

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function report(onProgress: ((progress: PipelineProgress) => void) | undefined, step: PipelineStep, percent: number) {
  onProgress?.({ step, percent: Math.max(0, Math.min(100, Math.round(percent))), message: uploadStepMessage(step) });
}

export async function fileToBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Decodes a file into something drawable.
 *
 * `createImageBitmap(..., { imageOrientation: "from-image" })` is the modern path and applies
 * the EXIF rotation. The `<img>` fallback covers older Android/WebView builds, where browsers
 * also honour EXIF when drawing — but if the decoded size proves the rotation was ignored, the
 * caller is told so it can correct the pixels explicitly.
 */
async function decodeFile(file: File | Blob): Promise<Decoded> {
  const withOrientation = typeof createImageBitmap === "function";
  if (withOrientation) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { bitmap, width: bitmap.width, height: bitmap.height };
    } catch (error) {
      const message = (error as Error)?.message || "";
      if (/heic|heif/i.test(message)) throw error;
      // Fall through to the <img> path: some browsers expose createImageBitmap but cannot take
      // a File directly.
    }
  }
  if (!isBrowser()) throw new Error("no_dom");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode_failed"));
      element.decoding = "sync";
      element.src = url;
    });
    return {
      bitmap: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      revoke: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/**
 * Applies a 3×3 unsharp mask. Only run on images below 4 MP so an older phone stays responsive;
 * skipped images are still improved by the filter pass.
 */
function sharpenCanvas(canvas: HTMLCanvasElement, strength: number): boolean {
  if (strength <= 0) return false;
  if (canvas.width * canvas.height > 4_000_000) return false;
  const context = canvas.getContext("2d");
  if (!context) return false;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const source = new Uint8ClampedArray(image.data);
  const target = image.data;
  const width = canvas.width;
  const height = canvas.height;
  const amount = Math.max(0, Math.min(1, strength));
  const centre = 1 + 4 * amount;
  const edge = -amount;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const i = index + channel;
        const value =
          centre * source[i] +
          edge * source[i - 4] +
          edge * source[i + 4] +
          edge * source[i - width * 4] +
          edge * source[i + width * 4];
        target[i] = value < 0 ? 0 : value > 255 ? 255 : value;
      }
    }
  }
  context.putImageData(image, 0, 0);
  return true;
}

async function canvasToDataUrl(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<string> {
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), mime, quality));
    if (blob) return blobToDataUrl(blob);
  }
  return canvas.toDataURL(mime, quality);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Encodes with adaptive quality: if the payload would exceed what the API accepts, the same
 * pixels are re-encoded smaller instead of failing the upload (§20, §39).
 */
async function encodeWithinBudget(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<{ dataUrl: string; attempts: number }> {
  let currentQuality = quality;
  let attempts = 0;
  let dataUrl = await canvasToDataUrl(canvas, mime, currentQuality);
  attempts += 1;
  while (dataUrl.length > MAX_UPLOAD_CHARS && currentQuality > 0.55 && attempts < 4) {
    currentQuality = Math.max(0.55, currentQuality - 0.12);
    dataUrl = await canvasToDataUrl(canvas, mime, currentQuality);
    attempts += 1;
  }
  return { dataUrl, attempts };
}

export type PrepareOptions = {
  /** Long edge the normalizer targets. 1600 for the website, 480 for a thumbnail. */
  maxEdge?: number;
  purpose?: "upload" | "generated" | "enhanced";
  enhance?: EnhanceStrength | null;
  aspect?: AspectRatio | number;
  focusX?: number;
  focusY?: number;
  onProgress?: (progress: PipelineProgress) => void;
};

/**
 * The mobile upload path: file → validated, rotated, resized, web-ready data URL.
 * This is what fixes the "photo never leaves the phone" failure (§19).
 */
export async function prepareUpload(file: File, options: PrepareOptions = {}): Promise<PrepareResult> {
  report(options.onProgress, "reading", 5);
  if (!file || file.size === 0) {
    return { status: "error", issue: { code: "empty", message: "That file is empty. Please choose the photo again.", recoverable: true } };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return {
      status: "error",
      issue: {
        code: "too_large",
        message: `This photo is ${humanFileSize(file.size)} — larger than JATA can open on a phone. Try taking it again, or pick another photo.`,
        recoverable: true,
      },
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = await fileToBytes(file);
  } catch {
    return { status: "error", issue: decodeFailureIssue("read_failed") };
  }

  report(options.onProgress, "checking", 15);
  const declaredMime = file.type || null;
  const verdict = validateImageBytes(bytes, { declaredMime, filename: file.name });
  if (verdict.status !== "ok") return { status: "error", issue: verdict.issue };

  // A HEIC file that the browser *can* decode (Safari) is fine: we are about to convert it.
  const format = sniffImageFormat(bytes) as ImageFormat;
  const isHeic = format === "heic";
  if (isHeic && !browserCanDecodeHeic()) {
    return {
      status: "error",
      issue: {
        code: "heic_unsupported",
        message:
          "This iPhone HEIC photo can't be converted in this browser. Take a screenshot of it and upload that, or switch Settings › Camera › Formats to “Most Compatible”.",
        recoverable: false,
      },
    };
  }

  let decoded: Decoded;
  try {
    decoded = await decodeFile(file);
  } catch (error) {
    return { status: "error", issue: decodeFailureIssue((error as Error)?.message) };
  }

  try {
    report(options.onProgress, "optimizing", 35);
    const resize = planResize(
      { width: decoded.width, height: decoded.height, exifOrientation: verdict.facts.exifOrientation },
      { maxEdge: options.maxEdge ?? DEFAULT_MAX_EDGE, format },
    );
    const rotated = alsoNeedsManualRotation(decoded, verdict.facts.exifOrientation, isHeic);
    const canvas = createCanvas(rotated ? resize.height : resize.width, rotated ? resize.width : resize.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no_canvas");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const enhancePlan = options.enhance ? planEnhancement(options.enhance) : null;
    if (enhancePlan) context.filter = enhancePlan.filter;

    const notes: string[] = [];
    if (rotated) {
      notes.push("Straightened the photo.");
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(Math.PI / 2);
      context.drawImage(decoded.bitmap, -canvas.height / 2, -canvas.width / 2, canvas.height, canvas.width);
    } else {
      context.drawImage(decoded.bitmap, 0, 0, canvas.width, canvas.height);
    }
    context.filter = "none";

    if (options.aspect !== undefined && options.aspect !== "free") {
      const cropCanvas = cropToAspect(canvas, options.aspect, options.focusX, options.focusY);
      return await finish(cropCanvas, {
        source: bytes.length,
        notes,
        purpose: options.purpose,
        sharpen: enhancePlan?.sharpen ?? 0,
        quality: enhancePlan?.quality,
        onProgress: options.onProgress,
        resized: resize.scaled,
      });
    }

    return await finish(canvas, {
      source: bytes.length,
      notes,
      purpose: options.purpose,
      sharpen: enhancePlan?.sharpen ?? 0,
      quality: enhancePlan?.quality,
      onProgress: options.onProgress,
      resized: resize.scaled,
    });
  } catch (error) {
    return { status: "error", issue: decodeFailureIssue((error as Error)?.message) };
  } finally {
    decoded.revoke?.();
  }
}

function alsoNeedsManualRotation(decoded: Decoded, orientation: number | null, isHeic: boolean): boolean {
  if (!orientation || isHeic) return false;
  const swap = orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
  if (!swap) return false;
  // If the browser applied EXIF, the decoded bitmap is already portrait. If the long edge is
  // still on the wrong axis, we rotate the pixels ourselves.
  return decoded.width > decoded.height;
}

function browserCanDecodeHeic(): boolean {
  if (!isBrowser()) return false;
  const ua = navigator.userAgent || "";
  // Safari and iOS WebViews can decode HEIC; Chromium on Android cannot.
  return /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR/i.test(ua);
}

function cropToAspect(canvas: HTMLCanvasElement, aspect: AspectRatio | number, focusX?: number, focusY?: number): HTMLCanvasElement {
  const ratio =
    typeof aspect === "number"
      ? aspect
      : aspect === "square"
        ? 1
        : aspect === "portrait"
          ? 4 / 5
          : aspect === "wide"
            ? 16 / 9
            : 3 / 2;
  const width = canvas.width;
  const height = canvas.height;
  let sw = width;
  let sh = Math.round(width / ratio);
  if (sh > height) {
    sh = height;
    sw = Math.round(height * ratio);
  }
  const sx = Math.max(0, Math.round((width - sw) * (focusX ?? 0.5)));
  const sy = Math.max(0, Math.round((height - sh) * (focusY ?? 0.5)));
  const target = createCanvas(sw, sh);
  const context = target.getContext("2d");
  if (context) context.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return target;
}

async function finish(
  canvas: HTMLCanvasElement,
  options: {
    source: number;
    notes: string[];
    purpose?: "upload" | "generated" | "enhanced";
    sharpen: number;
    quality?: number;
    resized: boolean;
    onProgress?: (progress: PipelineProgress) => void;
  },
): Promise<PrepareResult> {
  report(options.onProgress, "uploading", 70);
  const notes = [...options.notes];
  if (options.sharpen > 0 && sharpenCanvas(canvas, options.sharpen)) {
    notes.push("Sharpened fine detail.");
  }
  const choice = chooseOutputFormat({
    format: "jpeg",
    width: canvas.width,
    height: canvas.height,
    pixelsSource: options.purpose ?? "upload",
  });
  const { dataUrl, attempts } = await encodeWithinBudget(canvas, choice.mime, options.quality ?? choice.quality);
  if (attempts > 1) notes.push("Compressed a little further to keep your site fast.");
  if (dataUrl.length > MAX_UPLOAD_CHARS) {
    // Never hand the API something it will refuse: the owner is told now, while their photo is
    // still on screen, instead of after a failed upload (§39).
    return {
      status: "error",
      issue: {
        code: "too_large",
        message: "This photo has too much fine detail for JATA to shrink on your phone. Try a slightly smaller photo.",
        recoverable: true,
      },
    };
  }

  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    return { status: "error", issue: { code: "corrupt", message: "We couldn't prepare that photo. Please try again.", recoverable: true } };
  }
  const verdict = validateImageBytes(parsed.bytes, { declaredMime: parsed.mime, maxBytes: MAX_UPLOAD_BYTES });
  if (verdict.status !== "ok") return { status: "error", issue: verdict.issue };

  if (options.resized || parsed.bytes.length < options.source) {
    notes.unshift(`Optimized ${humanFileSize(options.source)} to ${humanFileSize(parsed.bytes.length)}.`);
  }
  report(options.onProgress, "saving", 85);
  return {
    status: "ok",
    upload: {
      dataUrl,
      mime: parsed.mime,
      format: parsed.format,
      width: verdict.facts.width ?? canvas.width,
      height: verdict.facts.height ?? canvas.height,
      bytes: parsed.bytes.length,
      sourceBytes: options.source,
      notes,
    },
  };
}

/** Improves an existing photo in the media library (§14) — same pipeline, enhancement on. */
export async function enhanceDataUrl(
  dataUrl: string,
  options: { strength?: EnhanceStrength; maxEdge?: number; aspect?: AspectRatio; onProgress?: (progress: PipelineProgress) => void } = {},
): Promise<PrepareResult> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    return { status: "error", issue: { code: "corrupt", message: "This image can't be improved — it may be damaged. Try uploading it again.", recoverable: true } };
  }
  const blob = new Blob([blobPart(parsed.bytes)], { type: parsed.mime });
  const file = new File([blob], "photo.jpg", { type: parsed.mime });
  return prepareUpload(file, {
    maxEdge: options.maxEdge ?? DEFAULT_MAX_EDGE,
    purpose: "enhanced",
    enhance: options.strength ?? "balanced",
    aspect: options.aspect,
    onProgress: options.onProgress,
  });
}

/** Re-crops or re-frames an existing image without touching the original asset. */
export async function cropDataUrl(
  dataUrl: string,
  options: { aspect: AspectRatio; focusX?: number; focusY?: number; maxEdge?: number; onProgress?: (progress: PipelineProgress) => void },
): Promise<PrepareResult> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    return { status: "error", issue: { code: "corrupt", message: "This image can't be cropped — it may be damaged.", recoverable: true } };
  }
  const blob = new Blob([blobPart(parsed.bytes)], { type: parsed.mime });
  const file = new File([blob], "photo.jpg", { type: parsed.mime });
  return prepareUpload(file, {
    maxEdge: options.maxEdge ?? DEFAULT_MAX_EDGE,
    purpose: "upload",
    aspect: options.aspect,
    focusX: options.focusX,
    focusY: options.focusY,
    onProgress: options.onProgress,
  });
}

/** Uploads a prepared data URL to the media library, with progress and retry semantics. */
export async function uploadPreparedImage(params: {
  businessId: string;
  upload: PreparedUpload;
  alt?: string;
  kind?: "IMAGE" | "LOGO" | "HERO" | "OTHER";
  source?: string;
  label?: string | null;
  onProgress?: (progress: PipelineProgress) => void;
}): Promise<{ status: "ok"; asset: { id: string; url: string; width: number | null; height: number | null; alt: string | null } } | { status: "error"; error: string; issue?: UploadIssue }> {
  report(params.onProgress, "saving", 88);
  try {
    const response = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: params.businessId,
        dataUrl: params.upload.dataUrl,
        alt: params.alt || "",
        kind: params.kind || "IMAGE",
        source: params.source,
        label: params.label ?? null,
        width: params.upload.width,
        height: params.upload.height,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        error: typeof data?.error === "string" ? data.error : "We couldn't save that photo. Please try again.",
      };
    }
    report(params.onProgress, "done", 100);
    return { status: "ok", asset: data.asset };
  } catch {
    return {
      status: "error",
      error: "We couldn't reach JATA. Your photo is still on your screen — try again.",
      issue: { code: "decode_failed", message: "Connection lost while uploading.", recoverable: true },
    };
  }
}
