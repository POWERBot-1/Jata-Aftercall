"use client";

/**
 * Root error boundary.
 *
 * Next.js renders this when an error escapes even the root layout, so it must ship its own
 * <html>/<body> and not depend on the stylesheet or any workspace component. The styling is
 * inline and uses the brand palette directly, so the customer still sees an on-brand, legible
 * recovery screen instead of a blank tab or a raw stack trace. The raw error is never shown;
 * `reset()` retries the render and the home link is always available.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#fafaf8",
          color: "#18181b",
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        }}
      >
        <main style={{ width: "100%", maxWidth: "32rem", textAlign: "center" }}>
          <span
            style={{
              display: "inline-block",
              borderRadius: "0.55rem",
              background: "#18181b",
              color: "#ffffff",
              padding: "0.2rem 0.55rem",
              fontSize: "0.8rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            JATA AFTERCALL
          </span>
          <h1 style={{ margin: "1rem 0 0.5rem", fontSize: "1.6rem", letterSpacing: "-0.02em" }}>
            Something went wrong
          </h1>
          <p style={{ margin: 0, color: "#52525b", fontSize: "0.95rem", lineHeight: 1.6 }}>
            The app hit an unexpected problem and could not finish loading this page. Nothing was saved or charged as
            a result. Try again, or head back to the home page.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: "2.75rem",
                padding: "0 1.1rem",
                borderRadius: "999px",
                border: "1px solid #18181b",
                background: "#18181b",
                color: "#ffffff",
                fontSize: "0.9rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* A full-page anchor (not next/link) is intentional: this boundary can render after
                the router/layout has failed, so a hard navigation is the most reliable escape. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                minHeight: "2.75rem",
                display: "inline-flex",
                alignItems: "center",
                padding: "0 1.1rem",
                borderRadius: "999px",
                border: "1px solid #d4d4d8",
                background: "#ffffff",
                color: "#18181b",
                fontSize: "0.9rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Go to home
            </a>
          </div>
          {error?.digest ? (
            <p style={{ marginTop: "1.25rem", fontSize: "0.75rem", color: "#71717a" }}>Reference: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
