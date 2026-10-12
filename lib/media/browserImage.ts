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
  MIME_FOR_FORMAT,
  decodeFailureIssue,
  humanFileSize,
  parseImageDataUrl,
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

import { inspectLocalSource, jpegDecodeCopy, orientationMatrix, MAX_DERIVATIVE_EDGE } from "./sourceSafety";

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

/** Decode an admitted local copy with native resize hints, finite wait and resource cleanup.
 * JPEG metadata is removed only from the temporary copy; exact EXIF transforms follow below.
 * Native decode cancellation cannot promise instant OS allocation release; late bitmaps are closed.
 */
async function decodeFile(file: Blob, target: { width: number; height: number }, signal?: AbortSignal): Promise<Decoded> {
  if (signal?.aborted) throw new Error("preparation_cancelled");
  if (typeof createImageBitmap === "function") {
    let stopped = false;
    try {
      const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
        const finish = (error?: Error, value?: ImageBitmap) => {
          if (stopped) { value?.close(); return; }
          stopped = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
          if (error) reject(error); else resolve(value!);
        };
        const abort = () => finish(new Error("preparation_cancelled"));
        const timer = setTimeout(() => finish(new Error("decode_timeout")), 12000);
        signal?.addEventListener("abort", abort, { once: true });
        try {
          createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" }).then(value => finish(undefined, value), error => finish(error));
        } catch (error) { finish(error as Error); }
      });
      return { bitmap, width: bitmap.width, height: bitmap.height, revoke: () => bitmap.close() };
    } catch (error) {
      if (/cancelled|timeout/.test(String((error as Error)?.message))) throw error;
      // Older WebViews can expose a partial bitmap API: use the bounded/admitted image fallback.
    }
  }
  if (!isBrowser()) throw new Error("no_dom");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      const finish = (error?: Error) => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort); element.onload = element.onerror = null;
        if (error) { element.src = ""; reject(error); } else resolve(element);
      };
      const abort = () => finish(new Error("preparation_cancelled"));
      const timer = setTimeout(() => finish(new Error("decode_timeout")), 12000);
      signal?.addEventListener("abort", abort, { once: true });
      element.onload = () => finish(); element.onerror = () => finish(new Error("decode_failed"));
      element.decoding = "async"; element.src = url;
    });
    return { bitmap: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, revoke: () => { image.src = ""; URL.revokeObjectURL(url); } };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
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

let webpEncodeSupport: boolean | null = null;

/**
 * Probes whether this browser really encodes WebP. Some browsers silently fall back to PNG when
 * asked for WebP, so the probe checks the produced data-URL prefix rather than trusting the request.
 * The result is cached for the page lifetime.
 */
export function browserCanEncodeWebp(): boolean {
  if (webpEncodeSupport !== null) return webpEncodeSupport;
  try {
    if (typeof document === "undefined") return false;
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    webpEncodeSupport = probe.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpEncodeSupport = false;
  }
  return webpEncodeSupport;
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
  /** Cancels local preparation; does not issue a provider request or authorize persistence. */
  signal?: AbortSignal;
};

/**
 * The mobile upload path: file → validated, rotated, resized, web-ready data URL.
 * This is what fixes the "photo never leaves the phone" failure (§19).
 */
/** Owner deferred original storage. Preparation failure must NEVER substitute original bytes inline. */
function preparationIssue(error: unknown): PrepareResult {
  const message = String((error as Error)?.message || error);
  if (/cancelled/.test(message)) return { status: "error", issue: { code: "decode_failed", message: "Photo preparation was cancelled. Your original file has not been changed or uploaded.", recoverable: true } };
  if (/timeout/.test(message)) return { status: "error", issue: { code: "decode_failed", message: "Opening this photo took too long. Retry with a smaller copy; your original file is unchanged.", recoverable: true } };
  return { status: "error", issue: decodeFailureIssue(message) };
}

export async function prepareUpload(file: File, options: PrepareOptions = {}): Promise<PrepareResult> {
  report(options.onProgress, "reading", 5);
  if (options.signal?.aborted) return preparationIssue(new Error("preparation_cancelled"));
  if ((options.maxEdge !== undefined && (!Number.isFinite(options.maxEdge) || options.maxEdge < 64 || options.maxEdge > MAX_DERIVATIVE_EDGE)) ||
      (typeof options.aspect === "number" && (!Number.isFinite(options.aspect) || options.aspect < 0.2 || options.aspect > 5)) ||
      [options.focusX, options.focusY].some(value => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1))) {
    return { status: "error", issue: { code: "corrupt", message: "Choose a valid photo size and crop before retrying.", recoverable: true } };
  }
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
  const verdict = inspectLocalSource(bytes, { type: file.type, name: file.name });
  if (verdict.status !== "ok") return { status: "error", issue: verdict.issue };

  const format = verdict.facts.format;
  let source: { bytes: Uint8Array; orientation: number };
  try { source = format === "jpeg" ? jpegDecodeCopy(bytes) : { bytes, orientation: 1 }; } catch (error) { return preparationIssue(error); }
  const target = planResize({ width: verdict.facts.width!, height: verdict.facts.height! }, { maxEdge: options.maxEdge ?? DEFAULT_MAX_EDGE });
  const decodeBlob = new Blob([blobPart(source.bytes)], { type: verdict.facts.mime });

  let decoded: Decoded;
  try {
    decoded = await decodeFile(decodeBlob, target, options.signal);
  } catch (error) {
    return preparationIssue(error);
  }

  try {
    report(options.onProgress, "optimizing", 35);
    if (options.signal?.aborted) return preparationIssue(new Error("preparation_cancelled"));
    if (decoded.width <= 0 || decoded.height <= 0 || decoded.width * decoded.height > 32_000_000) throw new Error("decode_pixel_budget");
    const resize = planResize({ width: decoded.width, height: decoded.height }, { maxEdge: options.maxEdge ?? DEFAULT_MAX_EDGE, format });
    const swap = source.orientation >= 5 && source.orientation <= 8;
    const canvas = createCanvas(swap ? resize.height : resize.width, swap ? resize.width : resize.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no_canvas");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const enhancePlan = options.enhance ? planEnhancement(options.enhance) : null;
    if (enhancePlan) context.filter = enhancePlan.filter;

    const notes: string[] = [];
    if (source.orientation !== 1) notes.push("Corrected the photo orientation.");
    context.setTransform(...orientationMatrix(source.orientation, resize.width, resize.height));
    context.drawImage(decoded.bitmap, 0, 0, resize.width, resize.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.filter = "none";

    if (options.aspect !== undefined && options.aspect !== "free") {
      const cropCanvas = cropToAspect(canvas, options.aspect, options.focusX, options.focusY);
      return await finish(cropCanvas, {
        source: bytes.length,
        sourceFormat: format,
        notes,
        purpose: options.purpose,
        sharpen: enhancePlan?.sharpen ?? 0,
        quality: enhancePlan?.quality,
        onProgress: options.onProgress,
        resized: target.scaled || resize.scaled,
      });
    }

    return await finish(canvas, {
      source: bytes.length,
      sourceFormat: format,
      notes,
      purpose: options.purpose,
      sharpen: enhancePlan?.sharpen ?? 0,
      quality: enhancePlan?.quality,
      onProgress: options.onProgress,
      resized: target.scaled || resize.scaled,
    });
  } catch (error) {
    return preparationIssue(error);
  } finally {
    decoded.revoke?.();
  }
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
  if (!context) throw new Error("no_canvas");
  context.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return target;
}

async function finish(
  canvas: HTMLCanvasElement,
  options: {
    source: number;
    sourceFormat?: ImageFormat;
    notes: string[];
    purpose?: "upload" | "generated" | "enhanced";
    sharpen: number;
    quality?: number;
    resized: boolean;
    onProgress?: (progress: PipelineProgress) => void;
  },
): Promise<PrepareResult> {
  report(options.onProgress, "optimizing", 70);
  const notes = [...options.notes];
  if (options.sharpen > 0 && sharpenCanvas(canvas, options.sharpen)) {
    notes.push("Sharpened fine detail.");
  }
  const choice = chooseOutputFormat({
    format: options.sourceFormat === "jpeg" ? "jpeg" : "png",
    hasAlpha: options.sourceFormat !== "jpeg",
    width: canvas.width,
    height: canvas.height,
    pixelsSource: options.purpose ?? "upload",
  });
  // Owner uploads go out as WebP when this browser can really encode it (smaller at similar quality).
  // AI-generated and enhanced images keep JPEG. The server re-checks the bytes either way.
  const useWebp = (options.purpose ?? "upload") === "upload" && browserCanEncodeWebp();
  const mime = useWebp ? "image/webp" : choice.mime;
  const { dataUrl, attempts } = await encodeWithinBudget(canvas, mime, options.quality ?? choice.quality);
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
  report(options.onProgress, "optimizing", 85);
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
  const file = new File([blob], `photo.${parsed.format === "jpeg" ? "jpg" : parsed.format}`, { type: parsed.mime });
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
  const file = new File([blob], `photo.${parsed.format === "jpeg" ? "jpg" : parsed.format}`, { type: parsed.mime });
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
