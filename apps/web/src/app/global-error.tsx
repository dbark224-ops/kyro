"use client";

import { useEffect, useRef } from "react";

// global-error.tsx replaces the root layout, so globals.css is NOT loaded here.
// Everything below is deliberately self-contained: no imports, no shared classes,
// no CSS variables. This file has to render even when the app shell is broken.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reportedDigest = useRef<string | null>(null);

  useEffect(() => {
    const key = error.digest ?? error.message;

    if (reportedDigest.current === key) {
      return;
    }

    reportedDigest.current = key;

    void fetch("/api/internal/bug-report", {
      body: JSON.stringify({
        context: {
          digest: error.digest ?? null,
          name: error.name,
          stack: error.stack ?? null,
        },
        eventKey: error.digest ?? null,
        kind: "client_root_layout_error",
        pageUrl: window.location.href,
        rawMessage: `${error.name}: ${error.message}`,
        severity: "error",
        source: "web.global_error_boundary",
        visibleMessage: "The Kyro app shell failed to render.",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => {
      // Best-effort only.
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          alignItems: "center",
          background: "#f7f8fb",
          color: "#111114",
          display: "flex",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          justifyContent: "center",
          margin: 0,
          minHeight: "100vh",
          padding: "1.5rem",
        }}
      >
        <style>{`
          @media (prefers-color-scheme: dark) {
            body { background: #07080b !important; color: #f7f8fb !important; }
            .kyro-global-error-card { background: #101219 !important; border-color: rgba(255,255,255,0.12) !important; }
            .kyro-global-error-muted { color: #b2b7c3 !important; }
            .kyro-global-error-button { background: #f7f8fb !important; color: #07080b !important; }
          }
        `}</style>

        <main
          className="kyro-global-error-card"
          style={{
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: "14px",
            maxWidth: "30rem",
            padding: "1.75rem",
            width: "100%",
          }}
        >
          <p
            className="kyro-global-error-muted"
            style={{
              color: "#767d8b",
              fontSize: "0.75rem",
              letterSpacing: "0.08em",
              margin: 0,
              textTransform: "uppercase",
            }}
          >
            Kyro
          </p>

          <h1 style={{ fontSize: "1.35rem", margin: "0.5rem 0 0.75rem" }}>
            Kyro could not start
          </h1>

          <p
            className="kyro-global-error-muted"
            style={{ color: "#767d8b", lineHeight: 1.55, margin: 0 }}
          >
            Something went wrong loading the app. The problem has been reported
            automatically and your data has not been changed. Reloading usually
            fixes it.
          </p>

          <button
            className="kyro-global-error-button"
            onClick={reset}
            style={{
              background: "#111114",
              border: "none",
              borderRadius: "8px",
              color: "#ffffff",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: 600,
              marginTop: "1.5rem",
              padding: "0.6rem 1.1rem",
            }}
            type="button"
          >
            Reload Kyro
          </button>

          {error.digest ? (
            <p
              className="kyro-global-error-muted"
              style={{
                color: "#767d8b",
                fontSize: "0.75rem",
                marginBottom: 0,
                marginTop: "1.25rem",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
