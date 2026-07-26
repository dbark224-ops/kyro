"use client";

import { useEffect, useRef, useState } from "react";
import { formatWorkspaceDateTime } from "../../lib/time/format";
import type { VoiceCallPreview } from "../../lib/voice/calls";

type LoadState = "idle" | "loading" | "ready" | "error";

function formatLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null | undefined, timeZone?: string | null) {
  return formatWorkspaceDateTime({ timeZone, value });
}

function formatDuration(seconds: number | null) {
  if (seconds === null || seconds < 0) {
    return "Pending";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

function callParty(profile: VoiceCallPreview) {
  return (
    profile.contact?.name ??
    profile.contact?.company ??
    profile.call.customerNumber ??
    profile.call.fromNumber ??
    profile.call.toNumber ??
    "Unknown caller"
  );
}

function CallFacts({
  facts,
}: {
  facts: Array<[string, string | null | undefined]>;
}) {
  return (
    <dl className="call-log-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CallLogLauncher({
  callId,
  timeZone,
}: {
  callId: string;
  timeZone?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [profile, setProfile] = useState<VoiceCallPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  async function loadCall() {
    const requestId = requestIdRef.current + 1;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    requestIdRef.current = requestId;
    setLoadState("loading");
    setError(null);

    try {
      const response = await fetch(`/api/voice/calls/${encodeURIComponent(callId)}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: abortController.signal,
      });
      const payload = (await response.json()) as {
        data?: VoiceCallPreview;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Unable to load this call record.");
      }

      if (requestIdRef.current === requestId) {
        setProfile(payload.data);
        setLoadState("ready");
      }
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") {
        return;
      }

      if (requestIdRef.current === requestId) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load this call record.",
        );
        setLoadState("error");
      }
    }
  }

  function openCallLog() {
    setIsOpen(true);

    if (!profile && loadState !== "loading") {
      void loadCall();
    }
  }

  return (
    <>
      <div className="call-log-launch-row">
        <div>
          <strong>Call record</strong>
          <span>Transcript, recording, and call details</span>
        </div>
        <button
          className="secondary-button compact call-log-launch-button"
          onClick={openCallLog}
          type="button"
        >
          View details
        </button>
      </div>

      {isOpen ? (
        <div
          className="call-log-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
          role="presentation"
        >
          <section
            aria-busy={loadState === "loading"}
            aria-labelledby={`call-log-title-${callId}`}
            aria-modal="true"
            className="call-log-modal"
            role="dialog"
          >
            <header className="call-log-modal-header">
              <div>
                <p className="eyebrow">Call record</p>
                <h2 id={`call-log-title-${callId}`}>
                  {profile ? callParty(profile) : "Loading call details"}
                </h2>
                {profile ? (
                  <p>
                    {formatLabel(profile.call.direction)} call -{" "}
                    {formatDate(
                      profile.call.startedAt ?? profile.call.createdAt,
                      timeZone,
                    )}
                  </p>
                ) : null}
              </div>
              <button
                className="secondary-button compact"
                onClick={() => setIsOpen(false)}
                ref={closeButtonRef}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="call-log-modal-body">
              {loadState === "loading" ? (
                <div className="call-log-loading" aria-live="polite">
                  <span aria-hidden="true" className="settings-submit-spinner" />
                  <div>
                    <strong>Loading call record</strong>
                    <span>Fetching the transcript and recording...</span>
                  </div>
                </div>
              ) : null}

              {loadState === "error" ? (
                <div className="call-log-error" role="alert">
                  <div>
                    <strong>Call record could not load</strong>
                    <span>{error}</span>
                  </div>
                  <button
                    className="secondary-button compact"
                    onClick={() => void loadCall()}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : null}

              {profile ? (
                <>
                  <section className="call-log-section call-log-overview">
                    <div className="call-log-section-heading">
                      <h3>Overview</h3>
                      <span className="pill">
                        {formatLabel(profile.call.status)}
                      </span>
                    </div>
                    <CallFacts
                      facts={[
                        ["Direction", formatLabel(profile.call.direction)],
                        ["Purpose", formatLabel(profile.call.purpose)],
                        ["Duration", formatDuration(profile.call.durationSeconds)],
                        ["From", profile.call.fromNumber],
                        ["To", profile.call.toNumber],
                        ["Started", formatDate(profile.call.startedAt, timeZone)],
                        ["Ended", formatDate(profile.call.endedAt, timeZone)],
                        ["End reason", formatLabel(profile.call.endedReason)],
                      ]}
                    />
                  </section>

                  <section className="call-log-section">
                    <h3>Linked work</h3>
                    <CallFacts
                      facts={[
                        [
                          "Contact",
                          profile.contact?.name ?? profile.contact?.company,
                        ],
                        ["Phone", profile.contact?.phone],
                        ["Email", profile.contact?.email],
                        ["Address", profile.contact?.address],
                        ["Lead", profile.lead?.title],
                        ["Conversation", formatLabel(profile.conversation?.status)],
                      ]}
                    />
                  </section>

                  <section className="call-log-section">
                    <h3>Summary</h3>
                    <p>
                      {profile.call.summary ??
                        "No separate call summary has been saved yet."}
                    </p>
                  </section>

                  <section className="call-log-section">
                    <h3>Recording</h3>
                    {profile.call.recordingUrl ? (
                      <>
                        <audio
                          className="voice-call-audio"
                          controls
                          preload="metadata"
                          src={profile.call.recordingUrl}
                        />
                        <p className="call-log-retention-copy">
                          Available until{" "}
                          {formatDate(profile.call.recordingExpiresAt, timeZone)}.
                        </p>
                      </>
                    ) : profile.call.recordingDeletedAt ? (
                      <p>
                        The recording was automatically deleted on{" "}
                        {formatDate(profile.call.recordingDeletedAt, timeZone)} after{" "}
                        {profile.call.recordingRetentionDays} days. The transcript
                        and summary remain available.
                      </p>
                    ) : (
                      <p>
                        A recording is not available yet. It may still be
                        processing or the call may not have connected.
                      </p>
                    )}
                  </section>

                  <section className="call-log-section">
                    <h3>Transcript</h3>
                    <p className="voice-call-transcript">
                      {profile.call.transcript ??
                        "No transcript has been saved for this call yet."}
                    </p>
                  </section>

                  <section className="call-log-section">
                    <h3>Call timeline</h3>
                    {profile.events.length > 0 ? (
                      <ol className="call-log-events">
                        {profile.events.map((event) => (
                          <li key={event.id}>
                            <strong>{formatLabel(event.eventType)}</strong>
                            <time>{formatDate(event.createdAt, timeZone)}</time>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No call events have been recorded yet.</p>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
