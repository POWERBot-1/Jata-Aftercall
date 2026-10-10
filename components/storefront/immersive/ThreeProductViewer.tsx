"use client";

/**
 * The Three.js product viewer (Immersive Website Engine, Phase 5)
 *
 * The ONLY module in the application that imports `three`. It is reached through ImmersiveStage's
 * dynamic import, so Lite and Motion pages never download it.
 *
 * Scope is deliberately small: one GLB model, one light rig, a gentle turntable that is disabled
 * for reduced-motion visitors, and full cleanup on unmount. There is no physics, post-processing
 * or custom shader code. Draco, Meshopt and KTX2 decoders are NOT wired in this pass, so only
 * uncompressed GLB is accepted until they are added and tested.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Props = {
  modelUrl: string;
  alt: string;
  reducedMotion: boolean;
  /** Called once the model is on screen, so the stage can replace the static image. */
  onReady: () => void;
  /** Called on any failure. The stage keeps (or returns to) the static image. */
  onFail: () => void;
};

export default function ThreeProductViewer({ modelUrl, alt, reducedMotion, onReady, onFail }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
    } catch {
      // WebGL is refused or unavailable. The stage shows its static fallback instead.
      onFail();
      return;
    }

    const width = Math.max(240, host.clientWidth || 320);
    const height = Math.round(width * 0.75);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.4, 3);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(2, 3, 4);
    scene.add(key);

    let model: THREE.Object3D | null = null;
    let frame = 0;
    let disposed = false;

    const draw = () => renderer.render(scene, camera);
    const tick = () => {
      if (model && !reducedMotion) model.rotation.y += 0.005;
      draw();
      frame = requestAnimationFrame(tick);
    };

    new GLTFLoader().load(
      modelUrl,
      (gltf) => {
        if (disposed) {
          gltf.scene.traverse(disposeObject);
          return;
        }
        model = gltf.scene;
        scene.add(model);
        draw();
        onReady();
      },
      undefined,
      () => {
        if (!disposed) onFail();
      },
    );

    if (reducedMotion) draw();
    else frame = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      scene.traverse(disposeObject);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelUrl, reducedMotion, onFail, onReady]);

  return <div ref={hostRef} className="eb-immersive" role="img" aria-label={alt} />;
}

function disposeObject(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else if (material) material.dispose();
}
