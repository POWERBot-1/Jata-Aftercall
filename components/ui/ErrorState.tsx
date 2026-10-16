"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./Button";
import { Alert } from "./StateBlocks";

/**
 * Route-level error boundary content.
 *
 * A failure is stated plainly, the customer's work is not implied to be lost unless that is
 * known, and there is always a way forward: retry, go back, or get help. The raw error is never
 * rendered — it is not useful to a shop owner and can leak internals.
 */
export function ErrorState({
  title = "This page could not load",
  children = "The connection to JATA failed or the request was declined. Nothing was changed. Try again, or go back and retry the action.",
  onRetry,
  retryLabel = "Try again",
  backHref,
  backLabel = "Back to dashboard",
  reference,
}: {
  title?: string;
  children?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  backHref?: string;
  backLabel?: string;
  reference?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      if (onRetry) onRetry();
      else router.refresh();
    } finally {
      // The retry either re-renders the route or leaves the customer here; either way the
      // button must return to a usable state.
      setTimeout(() => setBusy(false), 600);
    }
  }

  return (
    <div className="jata-surface jata-surface--raised p-6 text-center" role="alert">
      <p className="text-lg font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-[52ch] text-sm text-[color:var(--jata-muted)]">{children}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button onClick={() => void retry()} disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Retrying…" : retryLabel}
        </Button>
        {backHref ? (
          <Button href={backHref} variant="secondary">
            {backLabel}
          </Button>
        ) : (
          <Link href="/dashboard" className="jata-btn jata-btn-secondary">
            {backLabel}
          </Link>
        )}
      </div>
      {reference ? <p className="mt-3 text-xs text-[color:var(--jata-muted)]">Reference: {reference}</p> : null}
    </div>
  );
}

/** Compact inline failure for a card or panel that failed on its own. */
export function InlineError({
  children,
  onRetry,
  tone = "danger",
}: {
  children: React.ReactNode;
  onRetry?: () => void;
  tone?: "danger" | "warning";
}) {
  return (
    <Alert tone={tone} live action={onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button> : undefined}>
      {children}
    </Alert>
  );
}

export default ErrorState;
