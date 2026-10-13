"use client";
/** Single lazy Three import boundary. Bounded embedded/static GLB graph, finite turntable,
 * touch/keyboard orbit, real resource cleanup. Compression/textures/animation graphs are unsupported.
 * Public activation still requires the existing disabled server/storage gate; this adds no provider.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadValidatedGlb } from "@/lib/experience/immersive/glbSafety";

type Props = { modelUrl: string; alt: string; reducedMotion: boolean; onReady: () => void; onFail: () => void };
export default function ThreeProductViewer({ modelUrl, alt, reducedMotion, onReady, onFail }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{ reset(): void } | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const abort = new AbortController();
    let disposed = false, failed = false, frame = 0, model: THREE.Object3D | null = null, dragging = false, lastX = 0;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" }); }
    catch { onFail(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    host.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", `${alt}. Drag horizontally or use left and right arrow keys to rotate.`);
    renderer.domElement.style.touchAction = "pan-y";
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 100);
    camera.position.set(0, 0.25, 3);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1); key.position.set(2, 3, 4); scene.add(key);
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const fail = () => { if (disposed || failed) return; failed = true; stop(); abort.abort(); onFail(); };
    const draw = () => { if (disposed || failed) return; try { renderer.render(scene, camera); } catch { fail(); } };
    const resize = () => {
      if (disposed || failed) return;
      const width = Math.max(1, host.getBoundingClientRect().width || 320), height = Math.round(width * 0.75);
      try { renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); draw(); } catch { fail(); }
    };
    let resizeObserver: ResizeObserver | null = null;
    try { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); } catch { /* window fallback */ }
    window.addEventListener("resize", resize, { passive: true }); resize();
    const started = performance.now();
    const tick = (now: number) => {
      frame = 0;
      if (disposed || failed || document.hidden || reducedMotion || !model || dragging) return;
      if (now - started < 8000) { model.rotation.y += 0.004; draw(); frame = requestAnimationFrame(tick); }
    };
    const visibility = () => { stop(); if (!document.hidden) { draw(); if (!reducedMotion && model && performance.now() - started < 8000) frame = requestAnimationFrame(tick); } };
    document.addEventListener("visibilitychange", visibility);
    const onLost = (event: Event) => { event.preventDefault(); fail(); };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    const pointerDown = (event: PointerEvent) => { if (!model || failed) return; dragging = true; lastX = event.clientX; stop(); try { renderer.domElement.setPointerCapture(event.pointerId); } catch {} };
    const pointerMove = (event: PointerEvent) => { if (!dragging || !model || failed) return; model.rotation.y += Math.max(-0.2, Math.min(0.2, (event.clientX - lastX) * 0.01)); lastX = event.clientX; draw(); };
    const pointerUp = () => { dragging = false; };
    const onKey = (event: KeyboardEvent) => { if (!model || !["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return; event.preventDefault(); stop(); model.rotation.y = event.key === "Home" ? 0 : model.rotation.y + (event.key === "ArrowLeft" ? -0.15 : 0.15); draw(); };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerUp);
    renderer.domElement.addEventListener("keydown", onKey);
    controlsRef.current = { reset: () => { if (model) { stop(); model.rotation.y = 0; draw(); } } };
    const timeout = window.setTimeout(fail, 10000);
    void loadValidatedGlb(modelUrl, abort.signal).then((bytes) => {
      if (disposed || failed) return;
      new GLTFLoader().parse(bytes, "", (gltf) => {
        if (disposed || failed) { gltf.scene.traverse(disposeObject); return; }
        const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        const largest = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(largest) || largest < 1e-8) { gltf.scene.traverse(disposeObject); fail(); return; }
        const group = new THREE.Group(); gltf.scene.position.sub(center); group.add(gltf.scene); group.scale.setScalar(1.8 / largest);
        model = group; scene.add(model); window.clearTimeout(timeout); resize(); draw();
        if (!failed) { onReady(); if (!reducedMotion && !document.hidden) frame = requestAnimationFrame(tick); }
      }, fail);
    }).catch(() => { if (!disposed) fail(); });
    return () => {
      disposed = true; stop(); abort.abort(); window.clearTimeout(timeout); controlsRef.current = null;
      resizeObserver?.disconnect(); window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.domElement.removeEventListener("pointercancel", pointerUp); renderer.domElement.removeEventListener("keydown", onKey);
      scene.traverse(disposeObject); renderer.dispose(); renderer.domElement.remove();
    };
  }, [modelUrl, alt, reducedMotion, onFail, onReady]);
  return <div className="eb-model-controls">
    <div ref={hostRef} className="eb-immersive" role="img" aria-label={alt} />
    <button type="button" className="eb-btn eb-btn--sm" onClick={() => controlsRef.current?.reset()}>Reset view</button>
    <p className="eb-hint">Drag or use arrow keys to rotate. Static image is kept if this bounded model format is unavailable.</p>
  </div>;
}
function disposeObject(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  mesh.geometry?.dispose();
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose()); else material?.dispose();
}
