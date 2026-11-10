"use client";

/**
 * QR download control.
 *
 * The symbol is already in the DOM (rendered server-side), so downloading it needs no endpoint:
 * the same SVG is serialised to a file, and a PNG is rasterised in the browser through canvas at
 * 1024 px — no server round-trip, no hidden dependency, and the printed file is the exact code
 * that was previewed.
 */

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

function triggerDownload(href: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function QrDownloadButton({
  targetId,
  filename,
  label = "Download QR",
}: {
  targetId: string;
  filename: string;
  label?: string;
}) {
  const [busy, setBusy] = useState<null | "svg" | "png">(null);
  const [error, setError] = useState<string | null>(null);

  function downloadSvg() {
    const node = document.getElementById(targetId);
    if (!node) {
      setError("The QR code is still loading. Please try again in a moment.");
      return;
    }
    setBusy("svg");
    const markup = new XMLSerializer().serializeToString(node);
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    triggerDownload(url, `${filename}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setBusy(null);
  }

  function downloadPng() {
    const node = document.getElementById(targetId);
    if (!node) {
      setError("The QR code is still loading. Please try again in a moment.");
      return;
    }
    setBusy("png");
    setError(null);
    const markup = new XMLSerializer().serializeToString(node);
    const svgUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    const size = 1024;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(svgUrl);
        setError("Your browser could not prepare the image. The SVG download still works.");
        setBusy(null);
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      try {
        triggerDownload(canvas.toDataURL("image/png"), `${filename}.png`);
      } catch {
        setError("Your browser blocked the image download. Please use the SVG download instead.");
      }
      URL.revokeObjectURL(svgUrl);
      setBusy(null);
    };
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      setError("Your browser could not render the image. The SVG download still works.");
      setBusy(null);
    };
    image.src = svgUrl;
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="jata-btn jata-btn-primary" onClick={downloadPng} disabled={busy !== null}>
          {busy === "png" ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Download size={15} aria-hidden="true" />}
          {busy === "png" ? "Preparing…" : `${label} (PNG)`}
        </button>
        <button type="button" className="jata-btn jata-btn-secondary" onClick={downloadSvg} disabled={busy !== null}>
          <Download size={15} aria-hidden="true" /> SVG
        </button>
      </div>
      {error ? (
        <p className="jata-error mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default QrDownloadButton;
