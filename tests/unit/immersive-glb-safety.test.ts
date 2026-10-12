import { describe, expect, it, vi } from "vitest";
import { validateGlb, loadValidatedGlb, GLB_SAFETY_LIMITS } from "@/lib/experience/immersive/glbSafety";
import { immersiveEligibility, immersiveFeatureEnabled } from "@/lib/experience/immersive/policy";

function graph() { return { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.8, -0.8, 0], max: [0.8, 0.8, 0] }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] } as any; }
function glb(json = graph(), floats = [-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0]) {
  const encoder = new TextEncoder(); let text = JSON.stringify(json); while (encoder.encode(text).length % 4) text += " ";
  const data = encoder.encode(text), bytes = new ArrayBuffer(12 + 8 + data.length + 8 + 36), view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true); view.setUint32(12, data.length, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20, data.length).set(data); const bin = 20 + data.length; view.setUint32(bin, 36, true); view.setUint32(bin + 4, 0x004e4942, true);
  floats.forEach((number, index) => view.setFloat32(bin + 8 + index * 4, number, true)); return bytes;
}
const signal = () => new AbortController().signal;

describe("bounded declarative embedded GLB graph", () => {
  it("validates actual triangle bytes and reports resource counts", () => {
    const bytes = glb(); expect(validateGlb(bytes)).toEqual({ ok: true, bytes: bytes.byteLength, nodes: 1, meshes: 1, vertices: 3, triangles: 1, primitives: 1 });
  });
  it("rejects malformed magic/version/length/truncation/huge bytes", () => {
    for (const bytes of [new ArrayBuffer(0), glb().slice(0, 20), new ArrayBuffer(GLB_SAFETY_LIMITS.bytes + 1)]) expect(validateGlb(bytes).ok).toBe(false);
    for (const [offset, value] of [[0, 0], [4, 3], [8, 999], [12, GLB_SAFETY_LIMITS.jsonBytes + 4], [16, 0]]) { const bytes = glb(); new DataView(bytes).setUint32(offset, value, true); expect(validateGlb(bytes).ok).toBe(false); }
  });
  it("rejects external buffers, images/textures, compression, animation and skin instead of fetching unsupported resources", () => {
    for (const change of [
      (data: any) => data.buffers[0].uri = "https://private.test/buffer.bin",
      (data: any) => data.images = [{ uri: "javascript:alert(1)" }],
      (data: any) => data.textures = [{ source: 0 }],
      (data: any) => data.extensionsUsed = ["KHR_draco_mesh_compression"],
      (data: any) => data.extensionsRequired = ["EXT_meshopt_compression"],
      (data: any) => data.animations = [{ samplers: [] }],
      (data: any) => data.skins = [{ joints: [0] }],
    ]) { const data = graph(); change(data); expect(validateGlb(glb(data)).ok).toBe(false); }
  });
  it("rejects invalid/cyclic/multi-parent node references and explosive instance counts", () => {
    for (const change of [
      (data: any) => data.nodes[0].children = [0],
      (data: any) => data.nodes[0].children = [99],
      (data: any) => { data.nodes = [{ children: [2] }, { children: [2] }, { mesh: 0 }]; },
      (data: any) => { data.nodes = Array.from({ length: 33 }, () => ({ mesh: 0 })); data.scenes[0].nodes = data.nodes.map((_: any, index: number) => index); },
      (data: any) => data.nodes[0].translation = [1000000, 0, 0],
      (data: any) => data.nodes[0].scale = [0, 1, 1],
      (data: any) => data.nodes[0].matrix = Array(16).fill(1),
    ]) { const data = graph(); change(data); expect(validateGlb(glb(data)).ok).toBe(false); }
  });
  it("rejects accessor/view/count/geometry overflows, NaN positions and hidden/custom materials", () => {
    for (const change of [
      (data: any) => data.bufferViews[0].byteLength = 1000,
      (data: any) => data.accessors[0].count = 1000000,
      (data: any) => data.accessors[0].sparse = {},
      (data: any) => data.meshes[0].primitives[0].mode = 1,
      (data: any) => data.meshes[0].primitives[0].attributes.POSITION = 99,
      (data: any) => data.meshes[0].primitives[0].attributes.COLOR_0 = 0,
      (data: any) => { data.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0] } }]; data.meshes[0].primitives[0].material = 0; },
      (data: any) => data.materials = [{ shader: "executable" }],
    ]) { const data = graph(); change(data); expect(validateGlb(glb(data)).ok).toBe(false); }
    expect(validateGlb(glb(graph(), [NaN, 0, 0, 0.8, -0.8, 0, 0, 0.8, 0])).ok).toBe(false);
  });
  it("rejects prototype/deep JSON keys without executing anything", () => {
    const data = graph(); data.extras = JSON.parse('{"__proto__":{"code":"x"}}'); expect(validateGlb(glb(data)).ok).toBe(false);
    let nested: any = {}; data.extras = nested; for (let index = 0; index < 26; index++) { nested.next = {}; nested = nested.next; }
    expect(validateGlb(glb(data)).ok).toBe(false);
  });
});

describe("real byte-loading envelope (mock transport, not provider proof)", () => {
  it("passes safe bytes and explicitly omits credentials/disallows redirects", async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(glb(), { status: 200, headers: { "content-type": "model/gltf-binary" } }));
    const bytes = await loadValidatedGlb("https://models.preview.test/a.glb", signal(), fetcher as any);
    expect(validateGlb(bytes).ok).toBe(true); expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "omit", redirect: "error", mode: "cors" });
  });
  it("rejects unsafe URL/status/binary and declared byte budget before accepting a model", async () => {
    const fetcher = vi.fn(async () => new Response("bad", { status: 200 }));
    for (const url of ["http://host/m.glb", "https://user:secret@host/m.glb", "data:malformed"]) await expect(loadValidatedGlb(url, signal(), fetcher as any)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(loadValidatedGlb("https://host/m.glb", signal(), fetcher as any)).rejects.toThrow("unsafe");
    await expect(loadValidatedGlb("https://host/m.glb", signal(), (async () => new Response("404", { status: 404 })) as any)).rejects.toThrow("failed");
    await expect(loadValidatedGlb("https://host/m.glb", signal(), (async () => new Response(glb(), { headers: { "content-length": String(GLB_SAFETY_LIMITS.bytes + 1) } })) as any)).rejects.toThrow("large");
  });
  it("caps actual streamed bytes without relying on Content-Length", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(GLB_SAFETY_LIMITS.bytes + 1)); }, cancel() { cancelled = true; } });
    await expect(loadValidatedGlb("https://host/m.glb", signal(), (async () => new Response(stream)) as any)).rejects.toThrow("large"); expect(cancelled).toBe(true);
  });
  it("passes the caller cancellation signal; no persistence path exists", async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn(async (_url, options) => { expect(options.signal).toBe(controller.signal); throw new DOMException("Cancelled", "AbortError"); });
    await expect(loadValidatedGlb("https://host/m.glb", controller.signal, fetcher as any)).rejects.toThrow("Cancelled");
  });
});

describe("production provider gate remains off", () => {
  it("cannot activate3D via its flag while provider approval/configuration is deferred", () => {
    expect(immersiveFeatureEnabled({ NODE_ENV: "production", JATA_IMMERSIVE_ENABLED: "true" })).toBe(false);
  });
  it("rejects unknown cores, invalid byte claims and credential URLs without inventing capability", () => {
    const signals = { webgl: true, webgpu: false, deviceMemoryGB: 8, hardwareConcurrency: 8, viewportWidth: 1280, effectiveType: "4g", saveData: false, reducedMotion: false };
    expect(immersiveEligibility({ enabled: true, signals: { ...signals, hardwareConcurrency: null }, asset: { url: "https://host/m.glb", bytes: 20 } }).reason).toBe("cores-unknown");
    for (const bytes of [0, -1, NaN, 1.5]) expect(immersiveEligibility({ enabled: true, signals, asset: { url: "https://host/m.glb", bytes } }).eligible).toBe(false);
    expect(immersiveEligibility({ enabled: true, signals, asset: { url: "https://user:pass@host/m.glb", bytes: 20 } }).eligible).toBe(false);
  });
});
