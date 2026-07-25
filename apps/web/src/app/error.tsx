"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reportedDigest = useRef<string | null>(null);

  useEffect(() => {
    // React remounts effects in development; only report each distinct error once.
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
        kind: "client_visible_error",
        pageUrl: window.location.href,
        rawMessage: `${error.name}: ${error.message}`,
        severity: "error",
        source: "web.error_boundary",
        visibleMessage: "A page failed to render for a signed-in user.",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => {
      // Reporting is best-effort. A signed-out or offline user still sees the
      // recovery UI below; swallowing here keeps the boundary itself safe.
    });
  }, [error]);

  return (
    <main
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "2rem 1.5rem",
      }}
    >
      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "14px",
          maxWidth: "30rem",
          padding: "1.75rem",
          width: "100%",
        }}
      >
        <p
          style={{
            color: "var(--muted)",
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            margin: 0,
            textTransform: "uppercase",
          }}
        >
          Something went wrong
        </p>

        <h1
          style={{
            color: "var(--text)",
            fontSize: "1.35rem",
            margin: "0.5rem 0 0.75rem",
          }}
        >
          This page could not be displayed
        </h1>

        <p style={{ color: "var(--muted)", lineHeight: 1.55, margin: 0 }}>
          The problem has been reported to the Kyro team automatically. Your
          data has not been changed. You can try again, or head back to the
          dashboard.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginTop: "1.5rem",
          }}
        >
          <button
            onClick={reset}
            style={{
              background: "var(--text)",
              border: "none",
              borderRadius: "8px",
              color: "var(--surface)",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: 600,
              padding: "0.6rem 1.1rem",
            }}
            type="button"
          >
            Try again
          </button>

          <Link
            href="/dashboard"
            style={{
              border: "1px solid var(--line)",
              borderRadius: "8px",
              color: "var(--text)",
              fontSize: "0.9rem",
              padding: "0.6rem 1.1rem",
              textDecoration: "none",
            }}
          >
            Back to dashboard
          </Link>
        </div>

        {error.digest ? (
          <p
            style={{
              color: "var(--muted)",
              fontSize: "0.75rem",
              marginBottom: 0,
              marginTop: "1.25rem",
            }}
          >
            Reference: {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
