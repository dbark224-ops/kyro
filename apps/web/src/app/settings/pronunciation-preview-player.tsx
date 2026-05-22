"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PreviewState = "idle" | "connecting" | "playing";

type RealtimeEvent = {
  error?: {
    message?: string;
  };
  type?: string;
};

function eventErrorMessage(event: RealtimeEvent) {
  return typeof event.error?.message === "string" && event.error.message.trim()
    ? event.error.message.trim()
    : null;
}

function parseRealtimeEvent(value: MessageEvent) {
  if (typeof value.data !== "string") {
    return null;
  }

  try {
    return JSON.parse(value.data) as RealtimeEvent;
  } catch {
    return null;
  }
}

export function PronunciationPreviewPlayer({
  entryId,
  fallbackSrc,
}: Readonly<{
  entryId: string;
  fallbackSrc: string;
}>) {
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isBusy = previewState !== "idle";

  const stopPreview = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current.srcObject = null;
    }

    setPreviewState("idle");
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  const playFallbackPreview = useCallback(async () => {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    audioElement.srcObject = null;
    audioElement.src = fallbackSrc;
    audioElement.onended = () => setPreviewState("idle");
    await audioElement.play();
  }, [fallbackSrc]);

  const playPreview = async () => {
    if (isBusy) {
      stopPreview();
      return;
    }

    setError(null);
    setPreviewState("connecting");

    if (typeof RTCPeerConnection === "undefined") {
      try {
        setPreviewState("playing");
        await playFallbackPreview();
      } catch (fallbackError) {
        setError(
          fallbackError instanceof Error
            ? fallbackError.message
            : "Unable to play pronunciation preview.",
        );
        setPreviewState("idle");
      }

      return;
    }

    try {
      const audioElement = audioRef.current;

      if (!audioElement) {
        throw new Error("Pronunciation preview audio is not ready.");
      }

      const peerConnection = new RTCPeerConnection();
      const dataChannel = peerConnection.createDataChannel("oai-events");

      peerConnectionRef.current = peerConnection;
      dataChannelRef.current = dataChannel;
      audioElement.autoplay = true;
      audioElement.onended = () => setPreviewState("idle");
      peerConnection.addTransceiver("audio", { direction: "recvonly" });
      peerConnection.ontrack = (event) => {
        const [stream] = event.streams;

        if (stream) {
          audioElement.srcObject = stream;
          void audioElement.play().catch((playError: unknown) => {
            setError(
              playError instanceof Error
                ? playError.message
                : "Unable to play pronunciation preview.",
            );
          });
        }

        setPreviewState("playing");
      };
      dataChannel.addEventListener("open", () => {
        dataChannel.send(
          JSON.stringify({
            response: {
              conversation: "none",
              input: [],
              metadata: {
                entryId,
                kind: "pronunciation_preview",
              },
              output_modalities: ["audio"],
            },
            type: "response.create",
          }),
        );
      });
      dataChannel.addEventListener("message", (event) => {
        const realtimeEvent = parseRealtimeEvent(event);

        if (!realtimeEvent) {
          return;
        }

        if (realtimeEvent.type === "error") {
          setError(eventErrorMessage(realtimeEvent) ?? "Preview failed.");
          stopPreview();
        }

        if (realtimeEvent.type === "response.done") {
          closeTimerRef.current = window.setTimeout(stopPreview, 2000);
        }
      });

      const offer = await peerConnection.createOffer();

      await peerConnection.setLocalDescription(offer);

      const response = await fetch(
        `/api/assistant/pronunciation/preview/realtime?entryId=${encodeURIComponent(
          entryId,
        )}`,
        {
          body: offer.sdp ?? "",
          headers: {
            "Content-Type": "application/sdp",
          },
          method: "POST",
        },
      );
      const answer = await response.text();

      if (!response.ok) {
        throw new Error(answer || "Unable to start pronunciation preview.");
      }

      await peerConnection.setRemoteDescription({
        sdp: answer,
        type: "answer",
      });
    } catch (previewError) {
      stopPreview();

      try {
        setPreviewState("playing");
        await playFallbackPreview();
      } catch {
        setError(
          previewError instanceof Error
            ? previewError.message
            : "Unable to play pronunciation preview.",
        );
        setPreviewState("idle");
      }
    }
  };

  return (
    <div className="pronunciation-preview-player">
      <button
        aria-label={
          isBusy ? "Stop pronunciation preview" : "Play pronunciation preview"
        }
        className="pronunciation-icon-button pronunciation-play-button"
        onClick={playPreview}
        title={isBusy ? "Stop preview" : "Play preview"}
        type="button"
      >
        <span aria-hidden="true">{isBusy ? "■" : "▶"}</span>
      </button>
      <audio ref={audioRef} />
      {previewState === "connecting" ? (
        <span className="preview-status">Connecting live voice...</span>
      ) : previewState === "playing" ? (
        <span className="preview-status">Playing with Kyro voice</span>
      ) : null}
      {error ? <span className="preview-status error">{error}</span> : null}
    </div>
  );
}
