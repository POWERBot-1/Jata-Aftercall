"use client";

/**
 * Development-only wrapper: renders the REAL dashboard error boundary (app/dashboard/error.tsx) with a
 * synthetic error. The `reset` callback cannot be passed from a server page, so this client shim supplies
 * it. It performs no network request and reads no data. Imported only by app/dev/workspace-preview.
 */
import DashboardError from "@/app/dashboard/error";

export function DashboardErrorFixture() {
  return <DashboardError error={Object.assign(new Error("Synthetic fixture error"), { digest: "FIXTURE-0000" })} reset={() => undefined} />;
}
