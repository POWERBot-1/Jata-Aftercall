/**
 * Mobile upload, end to end: PHONE → BROWSER → VALIDATION → PROCESSING → STORAGE (§19–§21)
 *
 * The regression this suite exists for: an owner taps "Upload photo" on a phone and the photo
 * never arrives. Here the real browser pipeline (`prepareUpload`) runs against a stubbed DOM
 * with real image bytes, and what it produces is handed to the real `POST /api/media` handler
 * through a fetch shim — so the assertion is not "the function returned something", it is "a
 * phone photo becomes a stored asset the website can use".
 *
 * A valid Android photo must never be answered with "That image could not be read."
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readImageDimensions, sniffImageFormat } from "@/lib/media/imageFormat";
import { dataUrlFor, heicBytes, jpegBytes, pngBytes, textBytes, webpBytes } from "../helpers/imageFixtures";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  guard: { ok: true, status: 200 } as any,
  assets: [] as any[],
  requests: [] as any[],
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  assertBusinessOwnership: vi.fn(async () => {}),
  guardTenantMutation: vi.fn(async () => mocks.guard),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({
  default: {
    mediaAsset: {
      findFirst: vi.fn(async (args: any) => mocks.assets.find((asset) => asset.businessId === args.where.businessId && asset.hash === args.where.hash) ?? null),
      create: vi.fn(async (args: any) => {
        const asset = { id: `asset-${mocks.assets.length + 1}`, createdAt: new Date(), ...args.data };
        mocks.assets.push(asset);
        return asset;
      }),
      findMany: vi.fn(async () => mocks.assets),
      count: vi.fn(async () => mocks.assets.length),
      update: vi.fn(async (args: any) => {
        const asset = mocks.assets.find((entry) => entry.id === args.where.id);
        if (asset) Object.assign(asset, args.data);
        return asset;
      }),
      delete: vi.fn(async () => ({})),
    },
  },
}));

import { POST } from "@/app/api/media/route";
import { prepareUpload, uploadPreparedImage } from "@/lib/media/browserImage";

/** ── A phone-shaped DOM, only as wide as the pipeline actually uses. ───────────── */
type Decoded = { width: number; height: number };

function installBrowserEnvironment(options: { decode?: (file: Blob) => Promise<Decoded>; createImageBitmapAvailable?: boolean } = {}) {
  const objectUrls = new Map<string, Blob>();
  const decoded = options.decode ?? (async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const format = sniffImageFormat(bytes);
    const size = format ? readImageDimensions(bytes, format) : null;
    if (!size) throw new Error("decode_failed");
    return { width: size.width, height: size.height };
  });

  const makeCanvas = () => {
    const context = {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      filter: "none",
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
        width,
        height,
      }),
      putImageData: vi.fn(),
    };
    const canvas: any = {
      width: 0,
      height: 0,
      getContext: () => context,
      // The pipeline's own output is real PNG bytes, so the artifact it produces is a real image.
      toDataURL: () => dataUrlFor(pngBytes({ width: canvas.width, height: canvas.height }), "image/png"),
    };
    return canvas;
  };

  const documentStub = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
      return makeCanvas();
    },
  };

  const globals: Record<string, any> = {
    window: { navigator: { userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7)" } },
    document: documentStub,
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7)" },
    createImageBitmap: options.createImageBitmapAvailable === false ? undefined : async (blob: Blob) => {
      const size = await decoded(blob);
      return { width: size.width, height: size.height, close: () => {} };
    },
    // The route also uses `new URL(...)`, so the real class is extended, not replaced.
    URL: Object.assign(class extends URL {}, {
      createObjectURL: (blob: Blob) => {
        const key = `blob:test-${objectUrls.size}`;
        objectUrls.set(key, blob);
        return key;
      },
      revokeObjectURL: (key: string) => {
        objectUrls.delete(key);
      },
    }),
    Image: class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = "";
      naturalWidth = 0;
      naturalHeight = 0;
      width = 0;
      height = 0;
      #src = "";
      set src(value: string) {
        this.#src = value;
        const blob = objectUrls.get(value) ?? new Blob([new Uint8Array(0)]);
        void decoded(blob).then((size) => {
          this.naturalWidth = size.width;
          this.naturalHeight = size.height;
          this.width = size.width;
          this.height = size.height;
          this.onload?.();
        }).catch(() => this.onerror?.());
      }
      get src() {
        return this.#src;
      }
    },
  };

  // `navigator` is a getter-only global on modern Node, so every stub is installed and restored
  // with defineProperty rather than plain assignment.
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const define = (key: string, value: unknown) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true, enumerable: true });
  };
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      delete (globalThis as any)[key];
      continue;
    }
    define(key, value);
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (!descriptor) delete (globalThis as any)[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
  };
}

function phoneFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], name, { type });
}

/** Sends what the browser prepared to the real route, exactly as `uploadPreparedImage` does. */
async function throughRoute(body: Record<string, unknown>) {
  mocks.requests.push(body);
  const request = new Request("https://jata.test/api/media", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(request);
}

beforeEach(() => {
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.guard = { ok: true, status: 200 };
  mocks.assets = [];
  mocks.requests = [];
});

describe("a phone photo reaches the website", () => {
  it("takes a 12 MP Android JPEG, rotates it, shrinks it, and stores it", async () => {
    const restore = installBrowserEnvironment();
    try {
      const jpeg = jpegBytes({ width: 3000, height: 4000, exifOrientation: 6, padding: 200_000 });
      const file = phoneFile(jpeg, "IMG_20261004_093512.jpg", "image/jpeg");
      expect(file.size).toBeGreaterThan(200_000);

      const prepared = await prepareUpload(file);
      expect(prepared.status).toBe("ok");
      if (prepared.status !== "ok") return;

      // Rotated from 3000×4000 to portrait-safe 4000×3000 then scaled to the upload budget.
      expect(Math.max(prepared.upload.width, prepared.upload.height)).toBeLessThanOrEqual(1600);
      expect(prepared.upload.format).toBe("png");
      expect(prepared.upload.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      expect(prepared.upload.notes.join(" ")).toContain("Optimized");

      const response = await throughRoute({
        businessId: "business-a",
        dataUrl: prepared.upload.dataUrl,
        alt: "Grilled chicken",
        kind: "IMAGE",
        source: "UPLOAD",
        label: "ACTUAL",
        width: prepared.upload.width,
        height: prepared.upload.height,
      });
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.asset.url.startsWith("data:image/png;base64,")).toBe(true);
      expect(data.asset.width).toBe(prepared.upload.width);
      expect(data.asset.label).toBe("ACTUAL");
      expect(mocks.assets).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("never answers a valid JPEG with the old pickup-the-pieces error", async () => {
    const restore = installBrowserEnvironment();
    try {
      const prepared = await prepareUpload(phoneFile(jpegBytes({ width: 1600, height: 1200 }), "photo.jpg", "image/jpeg"));
      expect(prepared.status).toBe("ok");
      if (prepared.status !== "ok") return;
      const data = await (await throughRoute({ businessId: "business-a", dataUrl: prepared.upload.dataUrl })).json();
      expect(JSON.stringify(data)).not.toContain("could not be read");
      expect(JSON.stringify(data)).not.toContain("Upload a JPG, PNG or WebP");
    } finally {
      restore();
    }
  });

  it("accepts a WebP straight from an Android camera and a PNG screenshot", async () => {
    const restore = installBrowserEnvironment();
    try {
      for (const [bytes, name, type] of [
        [webpBytes({ width: 2400, height: 1600 }), "scenery.webp", "image/webp"],
        [pngBytes({ width: 1080, height: 1920 }), "Screenshot_20261004.png", "image/png"],
      ] as Array<[Uint8Array, string, string]>) {
        const prepared = await prepareUpload(phoneFile(bytes, name, type));
        expect(prepared.status, `${name} should prepare`).toBe("ok");
        if (prepared.status !== "ok") continue;
        const response = await throughRoute({ businessId: "business-a", dataUrl: prepared.upload.dataUrl, alt: name });
        expect(response.status, `${name} should store`).toBe(201);
      }
      expect(mocks.assets).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it("still works on an old WebView without createImageBitmap", async () => {
    const restore = installBrowserEnvironment({ createImageBitmapAvailable: false });
    try {
      const prepared = await prepareUpload(phoneFile(jpegBytes({ width: 2400, height: 1800 }), "old-android.jpg", "image/jpeg"));
      expect(prepared.status).toBe("ok");
      if (prepared.status !== "ok") return;
      expect(prepared.upload.bytes).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });
});

describe("failures are explained, recoverable, and never destroy the rest of the form", () => {
  it("names the real format when the extension lies", async () => {
    const restore = installBrowserEnvironment();
    try {
      const prepared = await prepareUpload(phoneFile(pngBytes({ width: 800, height: 600 }), "holiday.jpg", "image/jpeg"));
      expect(prepared.status).toBe("error");
      if (prepared.status !== "error") return;
      expect(prepared.issue.recoverable).toBe(true);
      expect(prepared.issue.message.toLowerCase()).toContain("jpg");
      expect(prepared.issue.message).not.toContain("could not be read");
    } finally {
      restore();
    }
  });

  it("explains a malformed file instead of failing silently", async () => {
    const restore = installBrowserEnvironment();
    try {
      const prepared = await prepareUpload(phoneFile(textBytes(), "notes.jpg", "image/jpeg"));
      expect(prepared.status).toBe("error");
      if (prepared.status !== "error") return;
      expect(prepared.issue.message.length).toBeGreaterThan(20);
      expect(prepared.issue.recoverable).toBe(true);
    } finally {
      restore();
    }
  });

  it("reports a decode failure when the bytes cannot become pixels", async () => {
    const restore = installBrowserEnvironment({ decode: async () => { throw new Error("decode_failed"); } });
    try {
      // A truncated JPEG (no end-of-image marker) cannot be salvaged by uploading the original.
      const full = jpegBytes({ width: 900, height: 700 });
      const prepared = await prepareUpload(phoneFile(full.slice(0, Math.floor(full.length / 2)), "broken.jpg", "image/jpeg"));
      expect(prepared.status).toBe("error");
      if (prepared.status !== "error") return;
      expect(prepared.issue.code).toBe("decode_failed");
      expect(prepared.issue.recoverable).toBe(true);
    } finally {
      restore();
    }
  });

  it("uploads the original when a complete JPEG cannot be optimised (existing photos stay usable)", async () => {
    const restore = installBrowserEnvironment({ decode: async () => { throw new Error("decode_failed"); } });
    try {
      const prepared = await prepareUpload(phoneFile(jpegBytes({ width: 900, height: 700 }), "ok-but-unoptimisable.jpg", "image/jpeg"));
      expect(prepared.status).toBe("ok");
      if (prepared.status !== "ok") return;
      expect(prepared.upload.format).toBe("jpeg");
      expect(prepared.upload.notes.join(" ")).toContain("uploaded the original");
    } finally {
      restore();
    }
  });

  it("tells an iPhone owner exactly what to do with a HEIC on Android", async () => {
    const restore = installBrowserEnvironment();
    try {
      const prepared = await prepareUpload(phoneFile(heicBytes(), "IMG_0001.HEIC", "image/heic"));
      expect(prepared.status).toBe("error");
      if (prepared.status !== "error") return;
      expect(prepared.issue.code).toBe("heic_unsupported");
      expect(prepared.issue.message).toContain("Most Compatible");
    } finally {
      restore();
    }
  });

  it("refuses a file too big to open on a phone, with a next step", async () => {
    const restore = installBrowserEnvironment();
    try {
      const huge = phoneFile(jpegBytes({ width: 4000, height: 3000, padding: 31 * 1024 * 1024 }), "huge.jpg", "image/jpeg");
      const prepared = await prepareUpload(huge);
      expect(prepared.status).toBe("error");
      if (prepared.status !== "error") return;
      expect(prepared.issue.message).toContain("larger than");
      expect(prepared.issue.recoverable).toBe(true);
    } finally {
      restore();
    }
  });

  it("keeps the prepared photo when the upload fails, and succeeds on retry", async () => {
    const restore = installBrowserEnvironment();
    const realFetch = globalThis.fetch;
    try {
      const prepared = await prepareUpload(phoneFile(jpegBytes({ width: 1600, height: 1200 }), "retry.jpg", "image/jpeg"));
      expect(prepared.status).toBe("ok");
      if (prepared.status !== "ok") return;

      let attempt = 0;
      (globalThis as any).fetch = async (_url: string, init: any) => {
        attempt += 1;
        if (attempt === 1) throw new Error("network down");
        return throughRoute(JSON.parse(init.body));
      };

      const first = await uploadPreparedImage({ businessId: "business-a", upload: prepared.upload, alt: "Retry" });
      expect(first.status).toBe("error");
      if (first.status === "error") {
        expect(first.issue?.recoverable).toBe(true);
        expect(first.error).toContain("try again");
      }

      // The same prepared payload is still in hand — nothing is lost, the owner just taps again.
      const second = await uploadPreparedImage({ businessId: "business-a", upload: prepared.upload, alt: "Retry" });
      expect(second.status).toBe("ok");
      if (second.status === "ok") expect(second.asset.url.startsWith("data:image/png;base64,")).toBe(true);
      expect(mocks.assets).toHaveLength(1);
    } finally {
      (globalThis as any).fetch = realFetch;
      restore();
    }
  });

  it("surfaces the server's own words when the upload is refused", async () => {
    const restore = installBrowserEnvironment();
    const realFetch = globalThis.fetch;
    try {
      const prepared = await prepareUpload(phoneFile(jpegBytes({ width: 1200, height: 900 }), "refused.jpg", "image/jpeg"));
      if (prepared.status !== "ok") throw new Error("fixture should prepare");
      mocks.guard = { ok: false, status: 403, error: "You do not have access to this business." };
      (globalThis as any).fetch = async (_url: string, init: any) => throughRoute(JSON.parse(init.body));
      const result = await uploadPreparedImage({ businessId: "business-b", upload: prepared.upload });
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error).toContain("access");
      expect(mocks.assets).toHaveLength(0);
    } finally {
      (globalThis as any).fetch = realFetch;
      restore();
    }
  });
});

describe("existing media and replacement", () => {
  it("reuses the same pixels instead of storing a duplicate", async () => {
    const restore = installBrowserEnvironment();
    try {
      const file = phoneFile(jpegBytes({ width: 1500, height: 1000 }), "same.jpg", "image/jpeg");
      const first = await prepareUpload(file);
      if (first.status !== "ok") throw new Error("fixture should prepare");
      await throughRoute({ businessId: "business-a", dataUrl: first.upload.dataUrl, alt: "First" });

      const again = await prepareUpload(phoneFile(jpegBytes({ width: 1500, height: 1000 }), "same-again.jpg", "image/jpeg"));
      if (again.status !== "ok") throw new Error("fixture should prepare");
      const response = await throughRoute({ businessId: "business-a", dataUrl: again.upload.dataUrl, alt: "Second" });
      const data = await response.json();
      expect(data.reused).toBe(true);
      expect(mocks.assets).toHaveLength(1);
      expect(data.asset.alt).toBe("Second");
    } finally {
      restore();
    }
  });

  it("stores a replacement as a new asset rather than overwriting the old one", async () => {
    const restore = installBrowserEnvironment();
    try {
      const first = await prepareUpload(phoneFile(jpegBytes({ width: 1400, height: 900 }), "before.jpg", "image/jpeg"));
      const second = await prepareUpload(phoneFile(jpegBytes({ width: 1400, height: 901 }), "after.jpg", "image/jpeg"));
      if (first.status !== "ok" || second.status !== "ok") throw new Error("fixtures should prepare");
      const one = await (await throughRoute({ businessId: "business-a", dataUrl: first.upload.dataUrl, alt: "Beef" })).json();
      const two = await (await throughRoute({ businessId: "business-a", dataUrl: second.upload.dataUrl, alt: "Beef (new photo)" })).json();
      expect(two.reused).toBeUndefined();
      expect(two.asset.id).not.toBe(one.asset.id);
      expect(mocks.assets).toHaveLength(2);
    } finally {
      restore();
    }
  });
});
