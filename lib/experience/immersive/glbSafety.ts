/** Bounded uncompressed GLB2 safety/resource envelope. No Three import, persistence, original upload or provider activation.
 * MVP accepts embedded, untextured static triangle graphs only. Compression/textures/skins/animation are NOT supported.
 */
export const GLB_SAFETY_LIMITS = { bytes: 8 * 1024 * 1024, jsonBytes: 512 * 1024, nodes: 128, meshes: 32, materials: 32, vertices: 50000, triangles: 50000, primitives: 32, worldExtent: 1000 } as const;
export type GlbSafetyReport = { ok: true; bytes: number; nodes: number; meshes: number; vertices: number; triangles: number; primitives: number } | { ok: false; reason: string };
const fail = (reason: string): GlbSafetyReport => ({ ok: false, reason });
const obj = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const array = (value: unknown) => Array.isArray(value) ? value : [];
const index = (value: unknown, size: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < size;
const vector = (value: unknown, count: number, limit: number = GLB_SAFETY_LIMITS.worldExtent) => value === undefined || (Array.isArray(value) && value.length === count && value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) <= limit));
function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 24) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object") return true;
  for (const [key, entry] of Object.entries(value)) if (["__proto__", "prototype", "constructor"].includes(key) || !safeJson(entry, depth + 1)) return false;
  return true;
}
export function validateGlb(bytes: ArrayBuffer): GlbSafetyReport {
  try {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 28 || bytes.byteLength > GLB_SAFETY_LIMITS.bytes) return fail("model-size-invalid");
    const view = new DataView(bytes);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) return fail("model-header-invalid");
    const jsonLength = view.getUint32(12, true);
    if (!jsonLength || jsonLength > GLB_SAFETY_LIMITS.jsonBytes || jsonLength % 4 !== 0 || 20 + jsonLength + 8 > bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) return fail("model-json-invalid");
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, 20, jsonLength)));
    if (!obj(data) || data.asset?.version !== "2.0" || !safeJson(data)) return fail("model-config-invalid");
    const binHeader = 20 + jsonLength, binLength = view.getUint32(binHeader, true), binStart = binHeader + 8;
    if (view.getUint32(binHeader + 4, true) !== 0x004e4942 || binLength % 4 !== 0 || binStart + binLength !== bytes.byteLength) return fail("model-binary-invalid");
    const extensions = [...array(data.extensionsUsed), ...array(data.extensionsRequired)];
    if (extensions.some((extension) => extension !== "KHR_materials_unlit")) return fail("model-extension-unsupported");
    if (array(data.images).length || array(data.textures).length || array(data.samplers).length) return fail("model-textures-unsupported");
    if (array(data.animations).length || array(data.skins).length) return fail("model-animation-unsupported");
    const buffers = array(data.buffers), views = array(data.bufferViews), accessors = array(data.accessors), nodes = array(data.nodes), meshes = array(data.meshes), materials = array(data.materials), scenes = array(data.scenes);
    if (buffers.length !== 1 || buffers[0].uri !== undefined || !Number.isSafeInteger(buffers[0].byteLength) || buffers[0].byteLength <= 0 || buffers[0].byteLength > binLength || binLength - buffers[0].byteLength > 3) return fail("model-external-or-invalid-buffer");
    if (!nodes.length || nodes.length > GLB_SAFETY_LIMITS.nodes || !meshes.length || meshes.length > GLB_SAFETY_LIMITS.meshes || materials.length > GLB_SAFETY_LIMITS.materials || !scenes.length || !index(data.scene ?? 0, scenes.length)) return fail("model-scene-budget-invalid");
    for (const buffer of views) {
      if (!obj(buffer) || buffer.buffer !== 0 || !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || !Number.isSafeInteger(buffer.byteOffset ?? 0) || (buffer.byteOffset ?? 0) < 0 || (buffer.byteOffset ?? 0) + buffer.byteLength > buffers[0].byteLength ||
        (buffer.byteStride !== undefined && (!Number.isSafeInteger(buffer.byteStride) || buffer.byteStride < 4 || buffer.byteStride > 252 || buffer.byteStride % 4))) return fail("model-buffer-view-invalid");
      if (buffer.extensions && Object.keys(buffer.extensions).length) return fail("model-extension-unsupported");
    }
    const components: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const sizes: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    for (const accessor of accessors) {
      if (!obj(accessor) || accessor.sparse !== undefined || !index(accessor.bufferView, views.length) || !components[accessor.componentType] || !sizes[accessor.type] || !Number.isSafeInteger(accessor.count) || accessor.count < 1 || accessor.count > GLB_SAFETY_LIMITS.vertices * 3 || !Number.isSafeInteger(accessor.byteOffset ?? 0) || (accessor.byteOffset ?? 0) < 0) return fail("model-accessor-invalid");
      const buffer = views[accessor.bufferView], elementBytes = components[accessor.componentType] * sizes[accessor.type], stride = buffer.byteStride || elementBytes;
      if (stride < elementBytes || (accessor.byteOffset ?? 0) + (accessor.count - 1) * stride + elementBytes > buffer.byteLength || !vector(accessor.min, sizes[accessor.type]) || !vector(accessor.max, sizes[accessor.type])) return fail("model-accessor-bounds-invalid");
    }
    // No hidden material URI/custom shader payload can ask the loader for another resource.
    for (const material of materials) {
      if (!obj(material) || Object.keys(material).some((key) => /texture|shader|uri/i.test(key))) return fail("model-material-unsupported");
      if (material.alphaMode !== undefined && material.alphaMode !== "OPAQUE") return fail("model-transparency-unsupported");
      const pbr = material.pbrMetallicRoughness;
      if (pbr && (!obj(pbr) || Object.keys(pbr).some((key) => /texture|shader|uri/i.test(key)) || !vector(pbr.baseColorFactor, 4, 1) || (pbr.baseColorFactor && (pbr.baseColorFactor.some((number: number) => number < 0) || pbr.baseColorFactor[3] < 0.1)))) return fail("model-material-unsupported");
      if (material.extensions && Object.keys(material.extensions).some((key) => key !== "KHR_materials_unlit")) return fail("model-extension-unsupported");
    }
    let primitives = 0, triangles = 0, vertices = 0;
    const checkedPositions = new Set<number>();
    for (const mesh of meshes) {
      if (!obj(mesh) || !Array.isArray(mesh.primitives) || !mesh.primitives.length || mesh.weights !== undefined) return fail("model-mesh-invalid");
      for (const primitive of mesh.primitives) {
        primitives += 1;
        if (!obj(primitive) || (primitive.mode ?? 4) !== 4 || primitive.targets !== undefined || !obj(primitive.attributes) || !index(primitive.attributes.POSITION, accessors.length) || (primitive.material !== undefined && !index(primitive.material, materials.length))) return fail("model-primitive-unsupported");
        if (primitive.extensions && Object.keys(primitive.extensions).length) return fail("model-extension-unsupported");
        for (const [name, attribute] of Object.entries(primitive.attributes)) if (!["POSITION", "NORMAL"].includes(name) || !index(attribute, accessors.length)) return fail("model-attribute-invalid");
        const positionIndex = primitive.attributes.POSITION, position = accessors[positionIndex];
        if (position.type !== "VEC3" || position.componentType !== 5126 || position.count > GLB_SAFETY_LIMITS.vertices) return fail("model-position-invalid");
        if (!checkedPositions.has(positionIndex)) {
          checkedPositions.add(positionIndex); vertices += position.count;
          const buffer = views[position.bufferView], offset = binStart + (buffer.byteOffset || 0) + (position.byteOffset || 0), stride = buffer.byteStride || 12;
          for (let count = 0; count < position.count; count++) for (let axis = 0; axis < 3; axis++) {
            const number = view.getFloat32(offset + count * stride + axis * 4, true);
            if (!Number.isFinite(number) || Math.abs(number) > GLB_SAFETY_LIMITS.worldExtent) return fail("model-position-invalid");
          }
        }
        if (primitive.attributes.NORMAL !== undefined) {
          const normal = accessors[primitive.attributes.NORMAL], buffer = views[normal.bufferView];
          if (normal.type !== "VEC3" || normal.componentType !== 5126 || normal.count !== position.count) return fail("model-normal-invalid");
          const offset = binStart + (buffer.byteOffset || 0) + (normal.byteOffset || 0), stride = buffer.byteStride || 12;
          for (let i = 0; i < normal.count; i++) for (let axis = 0; axis < 3; axis++) {
            const value = view.getFloat32(offset + i * stride + axis * 4, true); if (!Number.isFinite(value) || Math.abs(value) > 1.01) return fail("model-normal-invalid");
          }
        }
        let count = position.count;
        if (primitive.indices !== undefined) {
          if (!index(primitive.indices, accessors.length)) return fail("model-index-invalid");
          const indices = accessors[primitive.indices];
          if (indices.type !== "SCALAR" || ![5121, 5123, 5125].includes(indices.componentType)) return fail("model-index-invalid");
          count = indices.count;
          const buffer = views[indices.bufferView], offset = binStart + (buffer.byteOffset || 0) + (indices.byteOffset || 0), size = components[indices.componentType], stride = buffer.byteStride || size;
          for (let i = 0; i < count; i++) {
            const value = size === 1 ? view.getUint8(offset + i * stride) : size === 2 ? view.getUint16(offset + i * stride, true) : view.getUint32(offset + i * stride, true);
            if (value >= position.count) return fail("model-index-invalid");
          }
        }
        if (count % 3) return fail("model-triangle-invalid");
        triangles += count / 3;
      }
    }
    if (primitives > GLB_SAFETY_LIMITS.primitives || vertices > GLB_SAFETY_LIMITS.vertices || triangles > GLB_SAFETY_LIMITS.triangles) return fail("model-geometry-budget-exceeded");
    const parents = new Set<number>();
    let draws = 0, renderedTriangles = 0;
    for (const node of nodes) {
      if (!obj(node) || (node.mesh !== undefined && !index(node.mesh, meshes.length)) || node.skin !== undefined || !vector(node.translation, 3) || !vector(node.rotation, 4, 1) || !vector(node.scale, 3, 100) || !vector(node.matrix, 16)) return fail("model-node-invalid");
      if (node.matrix !== undefined) return fail("model-matrix-unsupported");
      if (node.scale && node.scale.some((number: number) => number < 0.01)) return fail("model-scale-invalid");
      if (node.mesh !== undefined) for (const primitive of meshes[node.mesh].primitives) {
        draws += 1;
        renderedTriangles += (primitive.indices !== undefined ? accessors[primitive.indices].count : accessors[primitive.attributes.POSITION].count) / 3;
      }
      for (const child of array(node.children)) { if (!index(child, nodes.length) || parents.has(child)) return fail("model-node-reference-invalid"); parents.add(child); }
    }
    if (draws > GLB_SAFETY_LIMITS.primitives || renderedTriangles > GLB_SAFETY_LIMITS.triangles) return fail("model-instance-budget-exceeded");
    const visiting = new Set<number>(), depths = new Map<number, number>(), scaleBudget = new Map<number, number>();
    const walk = (node: number): number => {
      if (visiting.has(node)) return -1;
      if (depths.has(node)) return depths.get(node)!;
      visiting.add(node); let depth = 1, childScale = 1;
      for (const child of array(nodes[node].children)) { const value = walk(child); if (value < 0) return -1; depth = Math.max(depth, value + 1); childScale = Math.max(childScale, scaleBudget.get(child)!); }
      const scale = childScale * Math.max(...(nodes[node].scale || [1, 1, 1]));
      if (depth > 16 || scale > 100) return -1;
      visiting.delete(node); depths.set(node, depth); scaleBudget.set(node, scale); return depth;
    };
    for (let i = 0; i < nodes.length; i++) if (walk(i) < 0) return fail("model-node-cycle-or-depth-budget");
    for (const scene of scenes) if (!obj(scene) || !Array.isArray(scene.nodes) || !scene.nodes.length || scene.nodes.some((node) => !index(node, nodes.length))) return fail("model-scene-reference-invalid");
    return { ok: true, bytes: bytes.byteLength, nodes: nodes.length, meshes: meshes.length, vertices, triangles, primitives };
  } catch { return fail("model-config-invalid"); }
}

/** Actual bytes enforce the cap even without/trustworthy Content-Length; caller owns timeout/cancellation. */
export async function loadValidatedGlb(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ArrayBuffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) throw new Error("model-url-invalid");
  const response = await fetcher(url, { signal, credentials: "omit", redirect: "error", mode: "cors" });
  if (!response.ok || !response.body) throw new Error("model-fetch-failed");
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > GLB_SAFETY_LIMITS.bytes)) { await response.body.cancel(); throw new Error("model-too-large"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const result = await reader.read(); if (result.done) break; length += result.value.byteLength; if (length > GLB_SAFETY_LIMITS.bytes) { await reader.cancel(); throw new Error("model-too-large"); } chunks.push(result.value); }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  if (!validateGlb(output.buffer).ok) throw new Error("model-not-supported-or-unsafe");
  return output.buffer;
}
