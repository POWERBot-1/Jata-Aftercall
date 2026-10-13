import { describe, expect, it, vi } from "vitest";
import { inspectLocalSource, jpegDecodeCopy, orientationMatrix, MAX_SOURCE_PIXELS } from "@/lib/media/sourceSafety";
import { prepareUpload } from "@/lib/media/browserImage";
import { jpegBytes, pngBytes, heicBytes } from "../helpers/imageFixtures";
import { readExifOrientation } from "@/lib/media/imageFormat";

describe("local preparation admission, no provider or original-inline fallback", () => {
  it("admits a source over the5MB derivative budget without claiming decode/persistence", () => {
    const bytes = jpegBytes({ width: 4000, height: 3000, padding: 6_000_000 });
    expect(inspectLocalSource(bytes, { name: "camera.JPG", type: "" }).status).toBe("ok");
  });
  it("refuses hostile pixel counts before invoking any decoder", () => {
    const result = inspectLocalSource(jpegBytes({ width: 12000, height: 12000 }), { name: "photo.jpg" });
    expect(12000 * 12000).toBeGreaterThan(MAX_SOURCE_PIXELS);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.issue.code).toBe("too_large");
  });
  it("refuses MIME/extension lies and incomplete container boundaries", () => {
    for (const [bytes, file] of [
      [jpegBytes(), { name: "photo.png", type: "" }], [jpegBytes(), { name: "photo.jpg", type: "text/html" }],
      [jpegBytes().slice(0, -2), { name: "photo.jpg" }], [pngBytes(), { name: "photo.png" }],
    ] as const) expect(inspectLocalSource(bytes, file).status).toBe("error");
  });
  it("does not enable HEIC or infer support from a browser name", () => {
    const result = inspectLocalSource(heicBytes(), { name: "photo.heic", type: "image/heic" });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.issue.code).toBe("heic_unsupported");
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("strips metadata only in a decode copy, preserving original orientation%d bytes", (orientation) => {
    const bytes = jpegBytes({ width: 80, height: 60, exifOrientation: orientation, padding: 0 });
    const original = new Uint8Array(bytes);
    const copy = jpegDecodeCopy(bytes);
    expect(copy.orientation).toBe(orientation);
    expect(readExifOrientation(copy.bytes)).toBeNull();
    expect(bytes).toEqual(original);
    expect(readExifOrientation(bytes)).toBe(orientation);
    expect(copy.bytes).not.toBe(bytes);
    const [a,b,c,d,e,f] = orientationMatrix(orientation, 80, 60);
    const points = [[0,0],[80,0],[0,60],[80,60]].map(([x,y]) => [a*x+c*y+e,b*x+d*y+f]);
    expect(Math.min(...points.map(p=>p[0]))).toBe(0);expect(Math.min(...points.map(p=>p[1]))).toBe(0);
    expect(Math.max(...points.map(p=>p[0]))).toBe(orientation >= 5 ? 60 : 80);
    expect(Math.max(...points.map(p=>p[1]))).toBe(orientation >= 5 ? 80 : 60);
  });
  it("rejects malformed JPEG marker lengths without modifying input", () => {
    const bytes = new Uint8Array([255,216,255,225,255,255,255,217]);
    expect(() => jpegDecodeCopy(bytes)).toThrow();
    expect(bytes[4]).toBe(255);
  });
  it("cancelled/invalid sizing returns an error, never an original data URL", async () => {
    const file = new File([new Uint8Array(jpegBytes())], "photo.jpg", { type: "image/jpeg" });
    const controller = new AbortController(); controller.abort();
    expect((await prepareUpload(file, { signal: controller.signal })).status).toBe("error");
    for (const maxEdge of [NaN, Infinity, 0, 100000]) expect((await prepareUpload(file, { maxEdge })).status).toBe("error");
  });
});


describe("bounded decode lifecycle (API doubles, not pixel/provider proof)", () => {
  it("closes a bitmap even when canvas preparation fails, never falling back to original", async () => {
    const close = vi.fn(); vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 80, height: 60, close })));
    try {
      const result = await prepareUpload(new File([new Uint8Array(jpegBytes({width:80,height:60,padding:0}))], "photo.jpg", {type:"image/jpeg"}));
      expect(result.status).toBe("error"); expect(close).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it("clears timers/listeners if a partial bitmap API throws synchronously", async () => {
    vi.useFakeTimers(); vi.stubGlobal("createImageBitmap", vi.fn(() => {throw new Error("unsupported_api");}));
    try {
      const result=await prepareUpload(new File([new Uint8Array(jpegBytes({width:80,height:60,padding:0}))],"photo.jpg",{type:"image/jpeg"}));
      expect(result.status).toBe("error"); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
  it("ignores and closes a late bitmap after a real abort signal", async () => {
    let release: (value: any) => void; const close=vi.fn();
    const decode=vi.fn(() => new Promise<any>(resolve => {release=resolve;})); vi.stubGlobal("createImageBitmap",decode);
    try {
      const controller=new AbortController();
      const pending=prepareUpload(new File([new Uint8Array(jpegBytes({width:80,height:60,padding:0}))], "photo.jpg", {type:"image/jpeg"}),{signal:controller.signal});
      await new Promise(resolve=>setImmediate(resolve)); expect(decode).toHaveBeenCalledTimes(1); controller.abort();
      expect((await pending).status).toBe("error"); release!({width:80,height:60,close});
      await new Promise(resolve=>setImmediate(resolve)); expect(close).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
