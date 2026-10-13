"use client";
/** Development only. Local raster preparation; no upload/save/provider function is imported. */
import { useEffect } from "react";
import { prepareUpload } from "@/lib/media/browserImage";

export function LocalMediaChecks() {
  useEffect(() => {
    (window as any).__jataLocalMedia = async (bytes: number[], type: string, name: string, options: any = {}) => {
      const file = new File([new Uint8Array(bytes)], name, { type });
      const progress: number[] = [];
      const controller = new AbortController(); if (options.abort) controller.abort();
      const result = await prepareUpload(file, { ...options, signal: controller.signal, onProgress: step => progress.push(step.percent) });
      const after = new Uint8Array(await file.arrayBuffer());
      return { result, progress, originalUnchanged: after.length === bytes.length && after.every((value, index) => value === bytes[index]) };
    };
    return () => { delete (window as any).__jataLocalMedia; };
  }, []);
  return <p>Local-only pixel checks ready. Provider/persistent-original acceptance BLOCKED by owner deferral. Nothing is uploaded or saved.</p>;
}
