"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Keeps a Settings failure inside Settings.
 *
 * Individual section data already degrades on its own -- see optionalLoad in
 * settings-page-loader -- so reaching here means something failed that no
 * section owns. Without this the app-level boundary would take over and the
 * user would lose the whole page and their place in it. This keeps the
 * navigation intact and offers the way back to the sections that still work.
 */
export default function SettingsError({
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
        kind: "client_visible_error",
        pageUrl: window.location.href,
        rawMessage: `${error.name}: ${error.message}`,
        severity: "error",
        source: "web.settings_error_boundary",
        visibleMessage: "The Settings page failed to render.",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => {
      // Best effort, exactly as in the app-level boundary: reporting must never
      // be the reason the recovery UI does not appear.
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
          Settings
        </p>

        <h1
          style={{
            color: "var(--text)",
            fontSize: "1.35rem",
            margin: "0.5rem 0 0.75rem",
          }}
        >
          This settings area could not be loaded
        </h1>

        <p style={{ color: "var(--muted)", lineHeight: 1.55, margin: 0 }}>
          Nothing has been changed, and your other settings are unaffected. The
          problem has been reported to the Kyro team automatically. Try again,
          or open a different settings area.
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
            href="/settings"
            style={{
              border: "1px solid var(--line)",
              borderRadius: "8px",
              color: "var(--text)",
              fontSize: "0.9rem",
              padding: "0.6rem 1.1rem",
              textDecoration: "none",
            }}
          >
            All settings
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
