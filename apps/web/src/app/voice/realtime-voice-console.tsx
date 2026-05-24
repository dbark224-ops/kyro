"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssistantLink,
  AssistantThreadMessage,
  AssistantThreadState,
} from "../../lib/assistant/types";

type ConnectionState = "connected" | "connecting" | "idle" | "speaking";

type RealtimeEvent = {
  item?: {
    id?: string;
  };
  response?: {
    id?: string;
    output?: Array<Record<string, unknown>>;
    usage?: unknown;
  };
  transcript?: string;
  type?: string;
  [key: string]: unknown;
};

const REALTIME_MODEL = "gpt-realtime-2";

function normalizedTranscript(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function RealtimeVoiceConsole({
  initialState,
}: {
  initialState: AssistantThreadState;
}) {
  const [messages, setMessages] = useState(initialState.messages);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [status, setStatus] = useState("Ready for live voice.");
  const [error, setError] = useState<string | null>(initialState.error ?? null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const currentUserTranscriptRef = useRef("");
  const currentAssistantTranscriptRef = useRef("");
  const currentAssistantMessageIdRef = useRef<string | null>(null);
  const currentResponseIdRef = useRef<string | null>(null);
  const pendingAssistantLinksRef = useRef<AssistantLink[]>([]);
  const persistedResponseIdsRef = useRef<Set<string>>(new Set());
  const threadId = initialState.threadId;
  const isConnected = connectionState === "connected" || connectionState === "speaking";
  const latestMessage = messages[messages.length - 1] ?? null;
  const latestMessageSignature = latestMessage
    ? `${latestMessage.id}:${latestMessage.content.length}`
    : "empty";
  const visibleMessages = useMemo(() => [...messages].reverse(), [messages]);
  const statusLabel = useMemo(() => {
    if (connectionState === "connecting") {
      return "Connecting";
    }

    if (connectionState === "speaking") {
      return "Speaking";
    }

    if (connectionState === "connected") {
      return "Live";
    }

    return "Ready";
  }, [connectionState]);

  const stopRealtime = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }

    currentUserTranscriptRef.current = "";
    currentAssistantTranscriptRef.current = "";
    currentAssistantMessageIdRef.current = null;
    currentResponseIdRef.current = null;
    pendingAssistantLinksRef.current = [];
    setLiveTranscript("");
    setConnectionState("idle");
    setStatus("Live voice stopped.");
  }, []);

  const persistRealtimeTurn = useCallback(
    async (
      responseId: string | null,
      assistantTranscript: string,
      usage?: unknown,
    ) => {
      const cleanedAssistantTranscript = assistantTranscript.trim();
      const cleanedUserTranscript = currentUserTranscriptRef.current.trim();
      const stableResponseId = responseId ?? `response-${Date.now()}`;

      if (persistedResponseIdsRef.current.has(stableResponseId)) {
        return;
      }

      if (!threadId || (!cleanedAssistantTranscript && !cleanedUserTranscript)) {
        return;
      }

      const assistantLinks = pendingAssistantLinksRef.current;
      persistedResponseIdsRef.current.add(stableResponseId);
      currentUserTranscriptRef.current = "";
      currentAssistantTranscriptRef.current = "";
      currentAssistantMessageIdRef.current = null;
      currentResponseIdRef.current = null;
      pendingAssistantLinksRef.current = [];

      await fetch("/api/assistant/realtime/persist", {
        body: JSON.stringify({
          assistantTranscript: cleanedAssistantTranscript,
          links: assistantLinks,
          model: REALTIME_MODEL,
          provider: "openai",
          responseId: stableResponseId,
          threadId,
          usage,
          userTranscript: cleanedUserTranscript,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }).catch(() => undefined);
    },
    [threadId],
  );

  const updateAssistantTranscript = useCallback((text: string, replace = false) => {
    const nextTranscript = replace
      ? text.trim()
      : `${currentAssistantTranscriptRef.current}${text}`;
    const normalizedNextTranscript = normalizedTranscript(nextTranscript);
    const assistantLinks = pendingAssistantLinksRef.current;

    currentAssistantTranscriptRef.current = nextTranscript;

    setMessages((currentMessages) => {
      const messageId =
        currentAssistantMessageIdRef.current ??
        `realtime-assistant-${Date.now()}`;
      currentAssistantMessageIdRef.current = messageId;
      const duplicateMessage = normalizedNextTranscript
        ? currentMessages.find(
            (message) =>
              message.id !== messageId &&
              message.role === "assistant" &&
              normalizedTranscript(message.content) === normalizedNextTranscript,
          )
        : null;

      if (duplicateMessage) {
        currentAssistantMessageIdRef.current = duplicateMessage.id;

        return currentMessages.filter((message) => message.id !== messageId);
      }

      const existing = currentMessages.find(
        (message) => message.id === messageId,
      );

      if (existing) {
        return currentMessages.map((message) =>
          message.id === messageId
            ? {
              ...message,
              content: nextTranscript || "Kyro is speaking...",
              links: assistantLinks.length > 0 ? assistantLinks : message.links,
            }
            : message,
        );
      }

      return [
        ...currentMessages,
        {
          content: nextTranscript || "Kyro is speaking...",
          createdAt: new Date().toISOString(),
          id: messageId,
          links: assistantLinks.length > 0 ? assistantLinks : undefined,
          model: REALTIME_MODEL,
          provider: "openai",
          role: "assistant",
        },
      ];
    });
  }, []);

  const addUserTranscript = useCallback((transcript: string) => {
    const cleanedTranscript = transcript.trim();

    if (!cleanedTranscript) {
      return;
    }

    currentUserTranscriptRef.current = cleanedTranscript;
    setLiveTranscript(cleanedTranscript);
    setMessages((currentMessages) => {
      const nextUserMessage: AssistantThreadMessage = {
        content: cleanedTranscript,
        createdAt: new Date().toISOString(),
        id: `realtime-user-${Date.now()}`,
        role: "user",
      };
      const activeAssistantMessageId = currentAssistantMessageIdRef.current;
      const activeAssistantIndex = activeAssistantMessageId
        ? currentMessages.findIndex(
            (message) => message.id === activeAssistantMessageId,
          )
        : -1;

      if (activeAssistantIndex === -1) {
        return [...currentMessages, nextUserMessage];
      }

      return [
        ...currentMessages.slice(0, activeAssistantIndex),
        nextUserMessage,
        ...currentMessages.slice(activeAssistantIndex),
      ];
    });
  }, []);

  const callRealtimeTool = useCallback(
    async (call: Record<string, unknown>) => {
      const dataChannel = dataChannelRef.current;
      const callId = textValue(call.call_id);
      const name = textValue(call.name);

      if (!dataChannel || dataChannel.readyState !== "open" || !callId || !name) {
        return;
      }

      const toolArguments = parseJsonObject(textValue(call.arguments) ?? "{}");
      const response = await fetch("/api/assistant/realtime/tool", {
        body: JSON.stringify({
          arguments: toolArguments,
          name,
          threadId,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({
        error: "Tool call failed.",
      }));
      const sourceLinks = assistantLinksFromPayload(payload);

      if (name === "kyro_web_search" && sourceLinks.length > 0) {
        const nextLinks = mergeAssistantLinks(
          pendingAssistantLinksRef.current,
          sourceLinks,
        );
        const currentAssistantMessageId = currentAssistantMessageIdRef.current;

        pendingAssistantLinksRef.current = nextLinks;

        if (currentAssistantMessageId) {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === currentAssistantMessageId
                ? {
                    ...message,
                    links: nextLinks,
                  }
                : message,
            ),
          );
        }
      }

      dataChannel.send(
        JSON.stringify({
          item: {
            call_id: callId,
            output: JSON.stringify(payload),
            type: "function_call_output",
          },
          type: "conversation.item.create",
        }),
      );
    },
    [threadId],
  );

  const handleRealtimeEvent = useCallback(
    async (event: RealtimeEvent) => {
      switch (event.type) {
        case "session.created":
        case "session.updated":
          setStatus("Live session ready. Start talking naturally.");
          break;
        case "input_audio_buffer.speech_started":
          currentUserTranscriptRef.current = "";
          currentAssistantTranscriptRef.current = "";
          currentAssistantMessageIdRef.current = null;
          currentResponseIdRef.current = null;
          pendingAssistantLinksRef.current = [];
          setConnectionState("connected");
          setStatus("Listening...");
          setLiveTranscript("");
          break;
        case "input_audio_buffer.speech_stopped":
          setStatus("Thinking...");
          break;
        case "conversation.item.input_audio_transcription.completed":
          addUserTranscript(event.transcript ?? "");
          break;
        case "response.output_audio_transcript.delta":
        case "response.output_text.delta":
          currentResponseIdRef.current =
            textValue(event.response?.id) ??
            textValue(event.item?.id) ??
            currentResponseIdRef.current;
          setConnectionState("speaking");
          updateAssistantTranscript(textValue(event.delta) ?? "");
          break;
        case "response.output_audio_transcript.done":
        case "response.output_text.done":
          currentResponseIdRef.current =
            textValue(event.response?.id) ??
            textValue(event.item?.id) ??
            currentResponseIdRef.current;
          updateAssistantTranscript(event.transcript ?? textValue(event.text) ?? "", true);
          break;
        case "response.done": {
          currentResponseIdRef.current =
            textValue(event.response?.id) ?? currentResponseIdRef.current;
          const output = event.response?.output ?? [];
          const functionCalls = output.filter((item) => item.type === "function_call");

          if (functionCalls.length > 0) {
            setStatus("Checking Kyro workspace context...");

            for (const call of functionCalls) {
              await callRealtimeTool(call);
            }

            dataChannelRef.current?.send(JSON.stringify({ type: "response.create" }));
            return;
          }

          const transcript =
            currentAssistantTranscriptRef.current ||
            extractAssistantTranscript(output);

          if (transcript) {
            updateAssistantTranscript(transcript, true);
          }

          await persistRealtimeTurn(
            currentResponseIdRef.current,
            transcript,
            event.response?.usage,
          );
          setConnectionState("connected");
          setStatus("Live. Keep talking, or stop when you are done.");
          break;
        }
        case "error":
          setError(jsonErrorMessage(event) ?? "Realtime voice session failed.");
          setConnectionState("connected");
          break;
        default:
          break;
      }
    },
    [
      addUserTranscript,
      callRealtimeTool,
      persistRealtimeTurn,
      updateAssistantTranscript,
    ],
  );

  const startRealtime = async () => {
    if (!threadId) {
      setError("Assistant thread is not ready yet.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot access the microphone.");
      return;
    }

    setError(null);
    setStatus("Requesting microphone...");
    setConnectionState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const peerConnection = new RTCPeerConnection();
      const audioElement = new Audio();
      const dataChannel = peerConnection.createDataChannel("oai-events");

      audioElement.autoplay = true;
      peerConnection.ontrack = (event) => {
        audioElement.srcObject = event.streams[0];
      };
      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });
      dataChannel.addEventListener("open", () => {
        setConnectionState("connected");
        setStatus("Live session ready. Start talking naturally.");
      });
      dataChannel.addEventListener("message", (messageEvent) => {
        const event = parseJsonObject(messageEvent.data);
        void handleRealtimeEvent(event as RealtimeEvent);
      });
      dataChannel.addEventListener("close", () => {
        if (peerConnectionRef.current === peerConnection) {
          setConnectionState("idle");
          setStatus("Live voice stopped.");
        }
      });

      mediaStreamRef.current = stream;
      peerConnectionRef.current = peerConnection;
      dataChannelRef.current = dataChannel;
      remoteAudioRef.current = audioElement;

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const response = await fetch(
        `/api/assistant/realtime/call?threadId=${encodeURIComponent(threadId)}`,
        {
          body: offer.sdp,
          headers: {
            "Content-Type": "application/sdp",
          },
          method: "POST",
        },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);

        throw new Error(
          jsonErrorMessage(payload) ?? "Unable to start realtime voice.",
        );
      }

      await peerConnection.setRemoteDescription({
        sdp: await response.text(),
        type: "answer",
      });
    } catch (startError) {
      stopRealtime();
      setError(
        startError instanceof Error
          ? startError.message
          : "Unable to start realtime voice.",
      );
    }
  };

  useEffect(() => stopRealtime, [stopRealtime]);

  useEffect(() => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      return;
    }

    const activeTurn =
      transcript.querySelector<HTMLElement>('[data-active-voice-turn="true"]') ??
      transcript.querySelector<HTMLElement>(".voice-turn:last-of-type");

    if (!activeTurn) {
      transcript.scrollTop = 0;
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const transcriptTop = transcript.getBoundingClientRect().top;
      const activeTurnTop = activeTurn.getBoundingClientRect().top;
      const topOffset = activeTurnTop - transcriptTop;
      const nextTop = Math.max(0, transcript.scrollTop + topOffset);

      if (Math.abs(transcript.scrollTop - nextTop) > 1) {
        transcript.scrollTo({
          behavior: "auto",
          top: nextTop,
        });
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [latestMessageSignature, liveTranscript, status]);

  return (
    <section className="voice-console" aria-label="Realtime voice assistant">
      <section className="voice-control-panel" aria-label="Voice controls">
        <button
          aria-label={isConnected ? "Stop live voice" : "Start live voice"}
          aria-pressed={isConnected}
          className={[
            "voice-orb",
            isConnected ? "recording" : null,
            connectionState === "speaking" ? "speaking" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={connectionState === "connecting"}
          onClick={() => {
            if (isConnected || connectionState === "connecting") {
              stopRealtime();
              return;
            }

            void startRealtime();
          }}
          type="button"
        >
          {isConnected ? <StopIcon /> : <MicrophoneIcon />}
        </button>
        <div className="voice-state-copy">
          <p>{statusLabel}</p>
          <span>{status}</span>
        </div>
        <span className="voice-mode-toggle active">Realtime</span>
        {isConnected ? (
          <button
            className="secondary-button"
            onClick={stopRealtime}
            type="button"
          >
            End
          </button>
        ) : null}
      </section>

      <div className="voice-transcript" ref={transcriptRef}>
        {visibleMessages.map((message) => (
          <VoiceTurn
            isActive={message.id === latestMessage?.id}
            key={message.id}
            message={message}
          />
        ))}
        {liveTranscript && isConnected ? (
          <p className="voice-live-caption">{liveTranscript}</p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}

function VoiceTurn({
  isActive,
  message,
}: {
  isActive: boolean;
  message: AssistantThreadMessage;
}) {
  const isUser = message.role === "user";

  return (
    <article
      className={isUser ? "voice-turn user" : "voice-turn assistant"}
      data-active-voice-turn={isActive ? "true" : undefined}
    >
      {!isUser ? (
        <div className="voice-turn-meta">
          <strong>Kyro</strong>
          <ClientMessageTime value={message.createdAt} />
          <AssistantProviderPill message={message} />
        </div>
      ) : null}
      <p>{message.content}</p>
      {!isUser && message.links && message.links.length > 0 ? (
        <div className="voice-link-row">
          {message.links.slice(0, 4).map((link) => (
            <a
              href={link.href}
              key={`${message.id}-${link.href}`}
              rel={isExternalHref(link.href) ? "noreferrer" : undefined}
              target={isExternalHref(link.href) ? "_blank" : undefined}
            >
              {link.label}
              {link.meta ? <span>{link.meta}</span> : null}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ClientMessageTime({ value }: { value: string | undefined }) {
  return <span suppressHydrationWarning>{formatMessageTime(value)}</span>;
}

function AssistantProviderPill({ message }: { message: AssistantThreadMessage }) {
  if (!message.provider || !message.model) {
    return null;
  }

  return <span className="assistant-provider-pill">{message.provider}</span>;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function assistantLinksFromPayload(payload: unknown) {
  const data = parseJsonObject(parseJsonObject(payload).data);
  const sources = data.sources;

  if (!Array.isArray(sources)) {
    return [];
  }

  return mergeAssistantLinks([], sources.flatMap(assistantLinkFromUnknown));
}

function assistantLinkFromUnknown(value: unknown): AssistantLink[] {
  const record = parseJsonObject(value);
  const href = textValue(record.href);
  const label = textValue(record.label);

  if (!href || !label || !isExternalHref(href)) {
    return [];
  }

  return [
    {
      href,
      label,
      meta: textValue(record.meta) ?? undefined,
    },
  ];
}

function mergeAssistantLinks(
  currentLinks: AssistantLink[],
  nextLinks: AssistantLink[],
) {
  const seen = new Set<string>();

  return [...currentLinks, ...nextLinks].filter((link) => {
    if (!link.href || seen.has(link.href)) {
      return false;
    }

    seen.add(link.href);

    return true;
  });
}

function isExternalHref(href: string) {
  try {
    const url = new URL(href);

    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function extractAssistantTranscript(output: Array<Record<string, unknown>>) {
  for (const item of output) {
    const content = item.content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const record = parseJsonObject(part);
      const transcript = textValue(record.transcript) ?? textValue(record.text);

      if (transcript) {
        return transcript;
      }
    }
  }

  return "";
}

function jsonErrorMessage(payload: unknown) {
  const record = parseJsonObject(payload);
  const directError = textValue(record.error);

  if (directError) {
    return directError;
  }

  const error = parseJsonObject(record.error);

  return textValue(error.message);
}

function formatMessageTime(value: string | undefined) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
  }).format(new Date(value));
}

function MicrophoneIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="34"
      viewBox="0 0 24 24"
      width="34"
    >
      <rect
        height="11"
        rx="5.5"
        stroke="currentColor"
        strokeWidth="2"
        width="8"
        x="8"
        y="3"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3M8 21h8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="34"
      viewBox="0 0 24 24"
      width="34"
    >
      <rect
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="2.2"
        width="12"
        x="6"
        y="6"
      />
    </svg>
  );
}
