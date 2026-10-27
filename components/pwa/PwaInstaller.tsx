"use client";

/**
 * Secure PWA lifecycle UI (Phase 8): registers the public service worker, offers a friendly
 * refresh when a new version is ready, shows an honest online/offline indicator and a
 * non-intrusive install prompt. It never caches authentication, business or payment responses —
 * that policy lives in `public/sw.js`.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "jata-pwa-install-dismissed";

// useSyncExternalStore avoids a setState() inside an effect body (and its cascading render),
// while still giving SSR a stable snapshot. The browser subscribes to real online/offline events.
function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
function getOnlineSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
function getServerOnlineSnapshot(): boolean {
  return true;
}
function readInstallDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

export function PwaInstaller() {
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerOnlineSnapshot);
  const [updateReady, setUpdateReady] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(readInstallDismissed);
  const [registered, setRegistered] = useState(false);
  const reloadPending = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // Development HMR serves unversioned chunks; caching them would show stale UI.
    if (process.env.NODE_ENV !== "production") return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((reg) => {
      if (cancelled) return;
      registration = reg;
      setRegistered(true);
      if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
        });
      });
    }).catch(() => { /* registration must never break the app */ });

    const onControllerChange = () => {
      if (!reloadPending.current) return;
      reloadPending.current = false;
      window.location.reload();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => {});
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "dismissed") dismissInstall();
    else setInstallEvent(null);
  }

  function dismissInstall() {
    setInstallEvent(null);
    setInstallDismissed(true);
    try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage blocked */ }
  }

  function applyUpdate() {
    reloadPending.current = true;
    const worker = navigator.serviceWorker.controller;
    // The waiting worker is on the registration; message it through the controller target.
    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      else if (worker) window.location.reload();
      else window.location.reload();
    });
  }

  const showInstall = Boolean(installEvent) && !installDismissed && !updateReady;

  return (
    <div className="jata-pwa" data-pwa-registered={registered ? "true" : "false"}>
      {!online ? (
        <div className="jata-pwa__toast jata-pwa__toast--offline" role="status" data-pwa-online="false">
          <span aria-hidden="true">●</span> You are offline. AI answers, payments, uploads and POS sync need a connection.
        </div>
      ) : null}

      {updateReady ? (
        <div className="jata-pwa__toast" role="status" data-pwa-update="ready">
          <span>A new version of JATA AFTERCALL is ready.</span>
          <button type="button" className="jata-pwa__button" onClick={applyUpdate}>Refresh</button>
        </div>
      ) : null}

      {showInstall ? (
        <div className="jata-pwa__toast" role="status" data-pwa-install="available">
          <span>Install the app for a full-screen shortcut.</span>
          <button type="button" className="jata-pwa__button" onClick={() => void install()}>Install</button>
          <button type="button" className="jata-pwa__button jata-pwa__button--quiet" onClick={dismissInstall}>Not now</button>
          <Link href="/install" className="jata-pwa__link">iPhone / iPad guide</Link>
        </div>
      ) : null}
    </div>
  );
}

export default PwaInstaller;
