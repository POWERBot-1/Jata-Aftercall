"use client";

import { ErrorState } from "@/components/ui/ErrorState";

/**
 * Dashboard error boundary.
 *
 * A failed data load shows one plain explanation and a retry — never a stack trace, never a
 * blank page, and never a claim that the owner's data was saved.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-6">
      <ErrorState
        title="Your dashboard did not load"
        onRetry={reset}
        backHref="/dashboard"
        reference={error.digest ?? null}
      >
        The connection to JATA failed or the request was declined. Nothing was changed. Try again, and if it keeps
        failing check your internet connection.
      </ErrorState>
    </div>
  );
}
