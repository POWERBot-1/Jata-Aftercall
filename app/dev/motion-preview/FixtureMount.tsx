"use client";
/** A development harness control to exercise real React unmount/animation cleanup. */
import { useState, type ReactNode } from "react";

export function FixtureMount({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(true);
  return <>
    <button id="qa-unmount-fixture" type="button" onClick={() => setMounted(false)} style={{ padding: 12 }}>Unmount verification fixture</button>
    {mounted ? children : <p id="qa-fixture-unmounted">Verification fixture unmounted.</p>}
  </>;
}
