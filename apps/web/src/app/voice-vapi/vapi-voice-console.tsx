"use client";

import Vapi from "@vapi-ai/web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssistantThreadMessage,
  AssistantThreadState,
  AssistantUiBlock,
} from "../../lib/assistant/types";
import {
  linksFromBlocks,
  normalizeAssistantUiBlocks,
} from "../../lib/assistant/ui-blocks";
import type { VapiInternalVoiceSession } from "../../lib/assistant/vapi-internal";
import type { ContactProfile } from "../../lib/crm/queries";
import { ContactProfilePanel } from "../components/contact-profile-panel";

type ConnectionState = "connecting" | "idle" | "listening" | "speaking";
type StartTraceEntry = {
  id: string;
  message: string;
};

type VapiMessage = {
  artifact?: unknown;
  call?: unknown;
  messages?: unknown;
  role?: unknown;
  speaker?: unknown;
  status?: unknown;
  text?: unknown;
  transcript?: unknown;
  transcriptType?: unknown;
  type?: unknown;
  [key: string]: unknown;
};

const VAPI_INTERNAL_MODEL = "vapi-web-internal";
const KYRO_ADDRESSING_VARIANTS =
  "cairo|kairo|kiro|kyra|cara|kara|clare|claire";
const KYRO_ADDRESSING_PREFIX =
  "(?:(?:hey|hi|hello|yo|ok|okay|alright|right|so|what'?s up|sup)[,!.?\\s]+){0,4}";
const VAPI_STARTER_PATTERN =
  /^hey[,\s!.?]+i['’]?m here[,\s!.?]+what do you want to work on[,\s!.?\-–—:]*/i;

function normalizedTranscript(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeKyroAddressedTranscript(value: string) {
  return normalizedTranscript(value).replace(
    new RegExp(`^(${KYRO_ADDRESSING_PREFIX})(${KYRO_ADDRESSING_VARIANTS})\\b`, "i"),
    (_match, prefix: string) => `${prefix ?? ""}Kyro`,
  );
}

function canonicalTranscript(value: string) {
  return normalizedTranscript(value)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'" ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAssistantTranscript(value: string) {
  return normalizedTranscript(value).replace(VAPI_STARTER_PATTERN, "").trim();
}

function isVapiStarterOnly(value: string) {
  const canonical = canonicalTranscript(value);

  return (
    canonical === "hey im here" ||
    canonical === "hey i'm here" ||
    canonical === "hey im here what do you want to work on" ||
    canonical === "hey i'm here what do you want to work on"
  );
}

function isVapiStarterMessage(message: AssistantThreadMessage) {
  return (
    message.role === "assistant" &&
    (message.provider ?? "") === "vapi" &&
    isVapiStarterOnly(message.content)
  );
}

function sameVoiceTurn(firstValue: string, secondValue: string) {
  const first = canonicalTranscript(firstValue);
  const second = canonicalTranscript(secondValue);

  if (!first || !second) {
    return false;
  }

  if (first === second) {
    return true;
  }

  if (
    isVoiceTurnExpansion(firstValue, secondValue) ||
    isVoiceTurnExpansion(secondValue, firstValue)
  ) {
    return true;
  }

  const shorter = first.length < second.length ? first : second;
  const longer = first.length < second.length ? second : first;

  if (shorter.length >= 28 && longer.includes(shorter)) {
    return true;
  }

  if (
    shorter.length >= 42 &&
    longer.slice(0, Math.min(72, shorter.length)) ===
      shorter.slice(0, Math.min(72, shorter.length))
  ) {
    return true;
  }

  const firstWords = first.split(" ").filter((word) => word.length > 2);
  const secondWords = second.split(" ").filter((word) => word.length > 2);

  if (firstWords.length < 4 || secondWords.length < 4) {
    return false;
  }

  const firstSet = new Set(firstWords);
  const secondSet = new Set(secondWords);
  const sharedCount = [...firstSet].filter((word) => secondSet.has(word)).length;
  const smallerCount = Math.min(firstSet.size, secondSet.size);

  return smallerCount > 0 && sharedCount / smallerCount >= 0.86;
}

function isVoiceTurnExpansion(shorterValue: string, longerValue: string) {
  const shorter = canonicalTranscript(shorterValue);
  const longer = canonicalTranscript(longerValue);

  if (!shorter || !longer || shorter === longer || shorter.length > longer.length) {
    return false;
  }

  const shorterWordCount = shorter.split(" ").filter(Boolean).length;

  if (
    longer.startsWith(shorter) &&
    (shorter.length >= 10 || shorterWordCount >= 3)
  ) {
    return true;
  }

  if (shorter.length >= 28 && longer.includes(shorter)) {
    return true;
  }

  if (
    shorter.length >= 42 &&
    longer.slice(0, Math.min(72, shorter.length)) ===
      shorter.slice(0, Math.min(72, shorter.length))
  ) {
    return true;
  }

  return false;
}

type LocalTurnHistoryEntry = {
  at: number;
  content: string;
  role: "assistant" | "user";
};

type VoicePreviewTarget = {
  href: string;
  meta?: string;
  refreshKey?: number;
  title: string;
  value?: string;
};

type VoicePreviewData =
  | {
      href: string;
      type: "link";
    }
  | {
      href: string;
      profile: ContactProfile;
      type: "contact";
    };

export function VapiVoiceConsole({
  initialPreviewEngineError,
  initialPreviewEngineMessage,
  initialPreviewTarget,
  initialState,
  session,
}: {
  initialPreviewEngineError?: string;
  initialPreviewEngineMessage?: string;
  initialPreviewTarget?: VoicePreviewTarget | null;
  initialState: AssistantThreadState;
  session: VapiInternalVoiceSession;
}) {
  const [messages, setMessages] = useState(initialState.messages);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [status, setStatus] = useState(
    session.configured
      ? "Ready for Vapi voice."
      : `Add ${session.missing.join(", ")} to test Vapi voice.`,
  );
  const [error, setError] = useState<string | null>(initialState.error ?? null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [previewTarget, setPreviewTarget] = useState<VoicePreviewTarget | null>(
    initialPreviewTarget ?? null,
  );
  const [, setStartTrace] = useState<StartTraceEntry[]>([]);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const vapiRef = useRef<Vapi | null>(null);
  const currentUserTranscriptRef = useRef("");
  const currentAssistantTranscriptRef = useRef("");
  const persistedTurnSignaturesRef = useRef<Set<string>>(new Set());
  const localTurnHistoryRef = useRef<LocalTurnHistoryEntry[]>([]);
  const lastAssistantSpeechAtRef = useRef(0);
  const lastAssistantFinalizedAtRef = useRef(0);
  const lastAssistantFinalizedContentRef = useRef("");
  const assistantFinalizeTimerRef = useRef<number | null>(null);
  const assistantDraftIdRef = useRef<string | null>(null);
  const assistantDraftRef = useRef("");
  const pendingToolUiBlocksRef = useRef<AssistantUiBlock[]>([]);
  const seenToolBlockEventsRef = useRef<Set<string>>(new Set());
  const toolBlockCursorRef = useRef(new Date().toISOString());
  const callIdRef = useRef<string | null>(null);
  const lastStartErrorRef = useRef<string | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  const meterAudioContextRef = useRef<AudioContext | null>(null);
  const meterSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const threadId = session.threadId ?? initialState.threadId ?? null;
  const isConnected =
    connectionState === "listening" ||
    connectionState === "speaking" ||
    connectionState === "connecting";
  const showVoiceMeter =
    connectionState === "listening" || connectionState === "speaking";
  const dedupedMessages = useMemo(() => dedupeVoiceMessages(messages), [messages]);
  const latestMessage = dedupedMessages[dedupedMessages.length - 1] ?? null;
  const latestMessageSignature = latestMessage
    ? `${latestMessage.id}:${latestMessage.content.length}`
    : "empty";
  const visibleMessages = useMemo(() => {
    const prunedMessages = dedupedMessages.filter((message) => {
      if (!isVapiStarterMessage(message)) {
        return true;
      }

      const messageAt = Date.parse(message.createdAt ?? "");

      if (!Number.isFinite(messageAt)) {
        return true;
      }

      const hasNearbyUsefulTurn = dedupedMessages.some((otherMessage) => {
        if (otherMessage.id === message.id) {
          return false;
        }

        if (
          otherMessage.role !== "user" &&
          (otherMessage.role !== "assistant" ||
            isVapiStarterMessage(otherMessage))
        ) {
          return false;
        }

        const otherAt = Date.parse(otherMessage.createdAt ?? "");

        return (
          Number.isFinite(otherAt) &&
          Math.abs(otherAt - messageAt) <= 45_000
        );
      });

      return !hasNearbyUsefulTurn;
    });

    return [...prunedMessages].reverse();
  }, [dedupedMessages]);
  const statusLabel = useMemo(() => {
    if (!session.configured) {
      return "Setup needed";
    }

    if (connectionState === "connecting") {
      return "Connecting";
    }

    if (connectionState === "speaking") {
      return "Speaking";
    }

    if (connectionState === "listening") {
      return "Listening";
    }

    return "Ready";
  }, [connectionState, session.configured]);
  const displayStatus = useMemo(() => {
    if (error) {
      return error;
    }

    if (!session.configured) {
      return status;
    }

    if (connectionState === "connecting") {
      return "Connecting to Kyro...";
    }

    if (connectionState === "speaking") {
      return "Speaking...";
    }

    if (connectionState === "listening") {
      return "Listening...";
    }

    return status;
  }, [connectionState, error, session.configured, status]);

  const clearAssistantFinalizeTimer = useCallback(() => {
    if (assistantFinalizeTimerRef.current) {
      window.clearTimeout(assistantFinalizeTimerRef.current);
      assistantFinalizeTimerRef.current = null;
    }
  }, []);

  const addLocalMessage = useCallback(
    (
      role: "assistant" | "user",
      content: string,
      provider = "vapi",
      uiBlocks: AssistantUiBlock[] = [],
    ) => {
      const clean = normalizedTranscript(content);

      if (!clean) {
        return;
      }

      setMessages((currentMessages) => {
        const nowIso = new Date().toISOString();
        const now = Date.now();
        const matchingProvider = role === "assistant" ? provider : undefined;

        for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
          const message = currentMessages[index];

          if (
            message.role !== role ||
            (message.provider ?? undefined) !== matchingProvider
          ) {
            continue;
          }

          const messageAt = Date.parse(message.createdAt ?? "");

          if (Number.isFinite(messageAt) && now - messageAt > 30_000) {
            break;
          }

          if (!sameVoiceTurn(message.content, clean)) {
            continue;
          }

          const merged = mergeVoiceTurnContent(message.content, clean);

          return currentMessages.map((currentMessage, currentIndex) =>
            currentIndex === index
              ? {
                  ...currentMessage,
                  content: merged,
                  createdAt: currentMessage.createdAt ?? nowIso,
                  uiBlocks: mergeAssistantUiBlocks(
                    currentMessage.uiBlocks,
                    uiBlocks,
                  ),
                }
              : currentMessage,
          );
        }

        return [
          ...currentMessages,
          {
          content: clean,
          createdAt: nowIso,
          id: `vapi-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          intent: "vapi_internal_voice",
          model: role === "assistant" ? VAPI_INTERNAL_MODEL : undefined,
          provider: role === "assistant" ? provider : undefined,
          role,
          uiBlocks: uiBlocks.length > 0 ? uiBlocks : undefined,
          },
        ];
      });
    },
    [],
  );

  const appendStartTrace = useCallback((message: string) => {
    setStartTrace((currentTrace) => [
      ...currentTrace.slice(-7),
      {
        id: `vapi-trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        message,
      },
    ]);
  }, []);

  const claimLocalTurn = useCallback(
    (role: "assistant" | "user", content: string) => {
      const now = Date.now();
      const duplicateWindowMs = role === "assistant" ? 20_000 : 4_000;
      const recentHistory = localTurnHistoryRef.current.filter(
        (entry) => now - entry.at <= duplicateWindowMs,
      );
      const expandingAssistantEntry = recentHistory.find(
        (entry) =>
          role === "assistant" &&
          entry.role === role &&
          isVoiceTurnExpansion(entry.content, content),
      );

      if (expandingAssistantEntry) {
        expandingAssistantEntry.at = now;
        expandingAssistantEntry.content = content;
        localTurnHistoryRef.current = recentHistory;
        return true;
      }

      const isDuplicate = recentHistory.some((entry) => {
        if (entry.role !== role) {
          return false;
        }

        return sameVoiceTurn(entry.content, content);
      });

      localTurnHistoryRef.current = recentHistory;

      if (isDuplicate) {
        appendStartTrace(`Ignored duplicate ${role} transcript`);
        return false;
      }

      localTurnHistoryRef.current.push({
        at: now,
        content,
        role,
      });

      return true;
    },
    [appendStartTrace],
  );

  const persistVapiTurn = useCallback(
    async (
      assistantTranscript?: string,
      uiBlocks: AssistantUiBlock[] = [],
    ) => {
      const cleanedAssistantTranscript = cleanAssistantTranscript(
        assistantTranscript ?? currentAssistantTranscriptRef.current,
      );
      const cleanedUserTranscript = normalizeKyroAddressedTranscript(
        currentUserTranscriptRef.current,
      );
      const signature = [
        callIdRef.current ?? "web-call",
        cleanedUserTranscript,
        cleanedAssistantTranscript,
      ].join("::");

      if (
        !threadId ||
        persistedTurnSignaturesRef.current.has(signature) ||
        (!cleanedAssistantTranscript && !cleanedUserTranscript)
      ) {
        return;
      }

      persistedTurnSignaturesRef.current.add(signature);
      currentUserTranscriptRef.current = "";
      currentAssistantTranscriptRef.current = "";

      await fetch("/api/assistant/realtime/persist", {
        body: JSON.stringify({
          assistantTranscript: cleanedAssistantTranscript,
          inputSource: "vapi_internal_voice",
          model: VAPI_INTERNAL_MODEL,
          provider: "vapi",
          responseId: `vapi-${Date.now()}`,
          threadId,
          uiBlocks,
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

  const applyToolUiBlocks = useCallback(
    (uiBlocks: AssistantUiBlock[], source = "Kyro tool") => {
      const normalizedBlocks = mergeAssistantUiBlocks([], uiBlocks);

      if (normalizedBlocks.length === 0) {
        return;
      }

      const nextPreviewTarget = previewTargetFromUiBlocks(normalizedBlocks);

      if (nextPreviewTarget) {
        setPreviewTarget((currentTarget) => {
          if (currentTarget?.href === nextPreviewTarget.href) {
            return {
              ...currentTarget,
              meta: nextPreviewTarget.meta ?? currentTarget.meta,
              refreshKey: Date.now(),
              title: nextPreviewTarget.title || currentTarget.title,
              value: currentTarget.value,
            };
          }

          return nextPreviewTarget;
        });
      }

      pendingToolUiBlocksRef.current = mergeAssistantUiBlocks(
        pendingToolUiBlocksRef.current,
        normalizedBlocks,
      );
      const blocksForAttachment = pendingToolUiBlocksRef.current;
      let attachedToFinalMessage = false;
      let attachedToDraft = false;

      setMessages((currentMessages) => {
        const draftId = assistantDraftIdRef.current;

        if (draftId) {
          attachedToDraft = true;
          return currentMessages.map((message) =>
            message.id === draftId
              ? {
                  ...message,
                  uiBlocks: mergeAssistantUiBlocks(
                    message.uiBlocks,
                    blocksForAttachment,
                  ),
                }
              : message,
          );
        }

        if (currentUserTranscriptRef.current || assistantDraftRef.current) {
          return currentMessages;
        }

        const canAttachToRecentFinal =
          Date.now() - lastAssistantFinalizedAtRef.current <= 8_000 &&
          Boolean(lastAssistantFinalizedContentRef.current);

        if (!canAttachToRecentFinal) {
          return currentMessages;
        }

        for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
          const message = currentMessages[index];

          if (
            message.role !== "assistant" ||
            message.provider !== "vapi" ||
            isVapiStarterMessage(message)
          ) {
            continue;
          }

          if (
            !sameVoiceTurn(
              message.content,
              lastAssistantFinalizedContentRef.current,
            )
          ) {
            continue;
          }

          attachedToFinalMessage = true;
          return currentMessages.map((currentMessage, currentIndex) =>
            currentIndex === index
              ? {
                  ...currentMessage,
                  uiBlocks: mergeAssistantUiBlocks(
                    currentMessage.uiBlocks,
                    blocksForAttachment,
                  ),
                }
              : currentMessage,
          );
        }

        return currentMessages;
      });

      if (attachedToDraft || attachedToFinalMessage) {
        pendingToolUiBlocksRef.current = [];
      }

      appendStartTrace(`${source} added ${normalizedBlocks.length} UI block(s)`);
    },
    [appendStartTrace],
  );

  const fetchPendingToolUiBlocks = useCallback(async () => {
    if (!threadId) {
      return;
    }

    const params = new URLSearchParams({ threadId });

    if (callIdRef.current) {
      params.set("callId", callIdRef.current);
    }

    if (toolBlockCursorRef.current) {
      params.set("since", toolBlockCursorRef.current);
    }

    const response = await fetch(`/api/assistant/vapi/tool-blocks?${params}`, {
      cache: "no-store",
    }).catch(() => null);

    if (!response?.ok) {
      return;
    }

    const body = objectRecord(await response.json().catch(() => ({})));
    const rows = Array.isArray(body.data) ? body.data : [];
    let latestCreatedAt = toolBlockCursorRef.current;

    for (const row of rows) {
      const record = objectRecord(row);
      const id = textValue(record.id);

      if (!id || seenToolBlockEventsRef.current.has(id)) {
        continue;
      }

      seenToolBlockEventsRef.current.add(id);
      const uiBlocks = normalizeAssistantUiBlocks(record.uiBlocks);

      if (uiBlocks.length > 0) {
        applyToolUiBlocks(uiBlocks, textValue(record.toolName) ?? "Kyro tool");
      }

      const createdAt = textValue(record.createdAt);

      if (
        createdAt &&
        !Number.isNaN(Date.parse(createdAt)) &&
        Date.parse(createdAt) > Date.parse(latestCreatedAt)
      ) {
        latestCreatedAt = createdAt;
      }
    }

    toolBlockCursorRef.current = latestCreatedAt;
  }, [applyToolUiBlocks, threadId]);

  const captureAssistantDraft = useCallback((content: string) => {
    const clean = cleanAssistantTranscript(content);

    if (!clean) {
      return;
    }

    if (
      Date.now() - lastAssistantFinalizedAtRef.current <= 20_000 &&
      sameVoiceTurn(lastAssistantFinalizedContentRef.current, clean)
    ) {
      appendStartTrace("Ignored stale assistant model output from previous turn");
      return;
    }

    const merged = mergeAssistantContent(assistantDraftRef.current, clean);

    assistantDraftRef.current = merged;
    currentAssistantTranscriptRef.current = merged;
  }, [appendStartTrace]);

  const finalizeAssistantTurn = useCallback(
    (content?: string) => {
      const incomingClean = cleanAssistantTranscript(
        content ?? assistantDraftRef.current,
      );
      const clean =
        content && assistantDraftRef.current
          ? mergeAssistantContent(assistantDraftRef.current, incomingClean)
          : incomingClean;

      if (!clean) {
        assistantDraftIdRef.current = null;
        assistantDraftRef.current = "";
        return;
      }

      if (
        isVapiStarterOnly(clean) &&
        (currentUserTranscriptRef.current ||
          localTurnHistoryRef.current.some((entry) => entry.role === "user"))
      ) {
        assistantDraftIdRef.current = null;
        assistantDraftRef.current = "";
        appendStartTrace("Ignored repeated Vapi starter message");
        return;
      }

      const draftId = assistantDraftIdRef.current;
      const uiBlocks = pendingToolUiBlocksRef.current;
      clearAssistantFinalizeTimer();
      const recentlyFinalized =
        Date.now() - lastAssistantFinalizedAtRef.current <= 20_000 &&
        sameVoiceTurn(lastAssistantFinalizedContentRef.current, clean);

      if (recentlyFinalized) {
        if (isVoiceTurnExpansion(lastAssistantFinalizedContentRef.current, clean)) {
          const merged = mergeVoiceTurnContent(
            lastAssistantFinalizedContentRef.current,
            clean,
          );

          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.role === "assistant" &&
              (message.provider ?? "") === "vapi" &&
              sameVoiceTurn(message.content, lastAssistantFinalizedContentRef.current)
                ? {
                    ...message,
                    content: merged,
                    uiBlocks: mergeAssistantUiBlocks(message.uiBlocks, uiBlocks),
                  }
                : message,
            ),
          );
          pendingToolUiBlocksRef.current = [];
          currentAssistantTranscriptRef.current = merged;
          lastAssistantFinalizedAtRef.current = Date.now();
          lastAssistantFinalizedContentRef.current = merged;
          assistantDraftIdRef.current = null;
          assistantDraftRef.current = "";
          appendStartTrace("Merged expanded assistant transcript from Vapi");
          return;
        }

        if (draftId) {
          setMessages((currentMessages) =>
            currentMessages.filter((message) => message.id !== draftId),
          );
        }

        assistantDraftIdRef.current = null;
        assistantDraftRef.current = "";
        appendStartTrace("Ignored duplicate assistant turn from Vapi event stream");
        return;
      }

      if (!claimLocalTurn("assistant", clean)) {
        if (draftId) {
          setMessages((currentMessages) =>
            currentMessages.filter((message) => message.id !== draftId),
          );
        }

        assistantDraftIdRef.current = null;
        assistantDraftRef.current = "";
        return;
      }

      if (draftId) {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === draftId
              ? {
                  ...message,
                  content: clean,
                  createdAt: message.createdAt ?? new Date().toISOString(),
                  uiBlocks: mergeAssistantUiBlocks(message.uiBlocks, uiBlocks),
                }
              : message,
          ),
        );
      } else {
        addLocalMessage("assistant", clean, "vapi", uiBlocks);
      }

      pendingToolUiBlocksRef.current = [];
      currentAssistantTranscriptRef.current = clean;
      lastAssistantFinalizedAtRef.current = Date.now();
      lastAssistantFinalizedContentRef.current = clean;
      assistantDraftIdRef.current = null;
      assistantDraftRef.current = "";
      setStatus("Listening...");
      appendStartTrace(
        Date.now() - lastAssistantSpeechAtRef.current < 12_000
          ? "Assistant turn finalized after audio started"
          : "Assistant turn finalized from Vapi text stream",
      );
      void persistVapiTurn(clean, uiBlocks);
    },
    [
      addLocalMessage,
      appendStartTrace,
      claimLocalTurn,
      clearAssistantFinalizeTimer,
      persistVapiTurn,
    ],
  );

  const scheduleAssistantFinalize = useCallback(() => {
    clearAssistantFinalizeTimer();
    assistantFinalizeTimerRef.current = window.setTimeout(() => {
      assistantFinalizeTimerRef.current = null;
      finalizeAssistantTurn();
    }, 1_400);
  }, [clearAssistantFinalizeTimer, finalizeAssistantTurn]);

  const handleFinalTranscript = useCallback(
    (role: "assistant" | "user", transcript: string) => {
      const clean =
        role === "user"
          ? normalizeKyroAddressedTranscript(transcript)
          : cleanAssistantTranscript(transcript);

      if (!clean) {
        return;
      }

      if (role === "user") {
        if (!claimLocalTurn(role, clean)) {
          return;
        }

        clearAssistantFinalizeTimer();
        assistantDraftIdRef.current = null;
        assistantDraftRef.current = "";
        currentAssistantTranscriptRef.current = "";
        currentUserTranscriptRef.current = clean;
        setLiveTranscript("");
        addLocalMessage("user", clean);
        setStatus("Thinking...");
        return;
      }

      finalizeAssistantTurn(clean);
    },
    [
      addLocalMessage,
      claimLocalTurn,
      clearAssistantFinalizeTimer,
      finalizeAssistantTurn,
    ],
  );

  const handleVapiMessage = useCallback(
    (payload: unknown) => {
      const message = objectRecord(payload) as VapiMessage;
      const type = textValue(message.type);

      if (type === "tool-calls" || type === "function-call") {
        setStatus("Using Kyro tools...");
        window.setTimeout(() => void fetchPendingToolUiBlocks(), 900);
        window.setTimeout(() => void fetchPendingToolUiBlocks(), 1_900);
        return;
      }

      if (type === "tool-calls-result" || type === "function-call-result") {
        const uiBlocks = extractVapiToolUiBlocks(message);

        if (uiBlocks.length > 0) {
          applyToolUiBlocks(uiBlocks, "Vapi tool result");
        }

        window.setTimeout(() => void fetchPendingToolUiBlocks(), 400);
        setStatus("Tool result received.");
        return;
      }

      if (type === "status-update") {
        const callStatus = textValue(message.status);
        const endedReason = textValue(message.endedReason);

        if (callStatus) {
          appendStartTrace(
            endedReason
              ? `Vapi status: ${callStatus} (${endedReason})`
              : `Vapi status: ${callStatus}`,
          );
        }

        if (callStatus === "ended") {
          setConnectionState("idle");
          setLiveTranscript("");
          setVoiceLevel(0);
          setStatus(
            endedReason ? `Call ended: ${humanizeVapiReason(endedReason)}` : "Call ended.",
          );

          if (endedReason && !isExpectedCallEndReason(endedReason)) {
            setError(humanizeVapiReason(endedReason));
          }
        }

        return;
      }

      if (type === "speech-update") {
        const nextStatus = textValue(message.status);
        const role = roleFromVapiMessage(message);

        if (nextStatus) {
          if (role === "assistant" && nextStatus === "started") {
            lastAssistantSpeechAtRef.current = Date.now();
            setConnectionState("speaking");
          }

          if (role === "assistant" && nextStatus === "stopped") {
            scheduleAssistantFinalize();
            setConnectionState("listening");
          }

          setStatus(role ? `${role} speech ${nextStatus}` : nextStatus);
          appendStartTrace(
            role ? `${role} speech ${nextStatus}` : `speech ${nextStatus}`,
          );
        }

        return;
      }

      if (type === "model-output") {
        const outputText = modelOutputText(message);

        if (outputText) {
          captureAssistantDraft(outputText);
        }

        setStatus("Generating voice response...");
        return;
      }

      if (type === "voice-input") {
        setStatus("Listening...");
        return;
      }

      if (type === "transcript") {
        const transcript =
          textValue(message.transcript) ??
          textValue(message.text) ??
          textValue(message.message);
        const role = roleFromVapiMessage(message);
        const transcriptType =
          textValue(message.transcriptType)?.toLowerCase() ?? "final";

        if (!transcript || !role) {
          return;
        }

        if (transcriptType === "partial") {
          if (role === "user") {
            setLiveTranscript(normalizeKyroAddressedTranscript(transcript));
          }

          return;
        }

        handleFinalTranscript(role, transcript);
        return;
      }

      if (type === "conversation-update") {
        const lastAssistantMessage =
          lastConversationMessage(message.messages, "assistant") ??
          lastConversationMessage(
            message.messagesOpenAIFormatted,
            "assistant",
          );

        if (lastAssistantMessage) {
          captureAssistantDraft(lastAssistantMessage.content);
          return;
        }

        appendStartTrace("Ignored conversation update without assistant text");
        return;
      }
    },
    [
      appendStartTrace,
      applyToolUiBlocks,
      captureAssistantDraft,
      fetchPendingToolUiBlocks,
      handleFinalTranscript,
      scheduleAssistantFinalize,
    ],
  );

  const stopVoiceLevelMeter = useCallback(() => {
    if (meterFrameRef.current) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }

    if (meterSourceRef.current) {
      meterSourceRef.current.disconnect();
      meterSourceRef.current = null;
    }

    if (meterStreamRef.current) {
      for (const track of meterStreamRef.current.getTracks()) {
        track.stop();
      }

      meterStreamRef.current = null;
    }

    if (meterAudioContextRef.current) {
      void meterAudioContextRef.current.close().catch(() => undefined);
      meterAudioContextRef.current = null;
    }

    setVoiceLevel(0);
  }, []);

  const startVoiceLevelMeter = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Browser microphone access is unavailable. Use Chrome/Edge on localhost or HTTPS.",
      );
    }

    stopVoiceLevelMeter();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextCtor =
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextCtor) {
        throw new Error("Browser audio metering is unavailable.");
      }

      const audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.28;
      const waveform = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      meterStreamRef.current = stream;
      meterAudioContextRef.current = audioContext;
      meterSourceRef.current = source;

      const tick = () => {
        analyser.getByteTimeDomainData(waveform);

        let sum = 0;
        for (const sample of waveform) {
          const centeredSample = (sample - 128) / 128;
          sum += centeredSample * centeredSample;
        }

        const rms = Math.sqrt(sum / waveform.length);
        const nextLevel = Math.max(0.035, Math.min(1, rms * 14));

        setVoiceLevel((currentLevel) => {
          const weight = nextLevel > currentLevel ? 0.82 : 0.28;
          return currentLevel * (1 - weight) + nextLevel * weight;
        });
        meterFrameRef.current = window.requestAnimationFrame(tick);
      };

      tick();
    } catch (error) {
      stopVoiceLevelMeter();
      throw new Error(
        `Microphone permission is required before Vapi can start: ${errorMessage(error)}`,
      );
    }
  }, [stopVoiceLevelMeter]);

  const stopVapi = useCallback(() => {
    const vapi = vapiRef.current;

    if (vapi) {
      void persistVapiTurn();
      vapi.removeAllListeners();
      void vapi.stop();
    }

    vapiRef.current = null;
    callIdRef.current = null;
    assistantDraftIdRef.current = null;
    assistantDraftRef.current = "";
    pendingToolUiBlocksRef.current = [];
    clearAssistantFinalizeTimer();
    setLiveTranscript("");
    stopVoiceLevelMeter();
    setConnectionState("idle");
    setStatus("Vapi voice stopped.");
  }, [clearAssistantFinalizeTimer, persistVapiTurn, stopVoiceLevelMeter]);

  const startVapi = useCallback(async () => {
    if (!session.configured || !session.publicKey || !session.assistantId) {
      setError(`Vapi voice is missing ${session.missing.join(", ")}.`);
      return;
    }

    setError(null);
    setStartTrace([]);
    lastStartErrorRef.current = null;
    pendingToolUiBlocksRef.current = [];
    seenToolBlockEventsRef.current.clear();
    toolBlockCursorRef.current = new Date().toISOString();
    setConnectionState("connecting");
    setStatus("Connecting to Kyro...");
    appendStartTrace("Checking microphone permission");

    try {
      await startVoiceLevelMeter();
      setStatus("Connecting to Kyro...");
      appendStartTrace("Microphone permission ready");

      const vapi = new Vapi(session.publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        setConnectionState("listening");
        setStatus("Listening...");
      });
      vapi.on("call-start-success", (event) => {
        callIdRef.current = textValue(event.callId);
        appendStartTrace("Vapi call start succeeded");
      });
      vapi.on("call-start-failed", (event) => {
        const message = errorMessage(event);

        lastStartErrorRef.current = message;
        appendStartTrace(`Vapi call start failed: ${message}`);
        setError(message);
        setConnectionState("idle");
        setStatus(`Vapi voice error: ${message}`);
        stopVoiceLevelMeter();
      });
      vapi.on("call-start-progress", (event) => {
        const stage = textValue(event.stage);
        const eventStatus = textValue(event.status);
        const metadataError = textValue(objectRecord(event.metadata).error);

        if (stage && eventStatus) {
          appendStartTrace(
            metadataError
              ? `${stage}: ${eventStatus} (${metadataError})`
              : `${stage}: ${eventStatus}`,
          );
        }

        if (stage && eventStatus === "failed") {
          const message = metadataError
            ? `${stage}: ${metadataError}`
            : `${stage} failed`;

          lastStartErrorRef.current = message;
          appendStartTrace(message);
          setError(message);
        }
      });
      vapi.on("call-end", () => {
        void persistVapiTurn();
        setConnectionState("idle");
        setStatus("Call ended.");
        setLiveTranscript("");
        stopVoiceLevelMeter();
      });
      vapi.on("speech-start", () => {
        lastAssistantSpeechAtRef.current = Date.now();
        appendStartTrace("Assistant audio started");
        setConnectionState("speaking");
        setStatus("Speaking...");
      });
      vapi.on("speech-end", () => {
        appendStartTrace("Assistant audio ended");
        setConnectionState("listening");
        setStatus("Listening...");
      });
      vapi.on("volume-level", (level) => {
        const nextLevel = Math.max(0, Math.min(1, Number(level) || 0));
        setVoiceLevel((currentLevel) => Math.max(currentLevel * 0.72, nextLevel));
      });
      vapi.on("message", handleVapiMessage);
      vapi.on("error", (nextError) => {
        const message = errorMessage(nextError);

        lastStartErrorRef.current = message;
        appendStartTrace(`Vapi runtime error: ${message}`);
        setError(message);
        setConnectionState("idle");
        setStatus(`Vapi voice error: ${message}`);
        stopVoiceLevelMeter();
      });

      const overrides = session.assistantOverrides;
      let call = await vapi.start(
        session.assistantId,
        overrides as Parameters<Vapi["start"]>[1],
      );

      if (!call && hasVoiceOverride(overrides)) {
        setStatus("Retrying with Vapi fallback voice...");
        call = await vapi.start(
          session.assistantId,
          withoutVoiceOverride(overrides) as Parameters<Vapi["start"]>[1],
        );

        if (call) {
          setError(null);
        }
      }

      if (!call) {
        const message =
          lastStartErrorRef.current ??
          "Vapi did not return a live call. Check browser microphone permission, Vapi account credits, and assistant voice/provider configuration.";

        setConnectionState("idle");
        setStatus(message);
        appendStartTrace(`No live call returned: ${message}`);
        setError(message);
        stopVoiceLevelMeter();
        return;
      }

      callIdRef.current =
        textValue(objectRecord(call).id) ?? callIdRef.current ?? null;
      vapi.send({
        message: {
          content: session.contextMessage,
          role: "system",
        },
        triggerResponseEnabled: false,
        type: "add-message",
      });
    } catch (nextError) {
      const message = errorMessage(nextError);

      lastStartErrorRef.current = message;
      appendStartTrace(`Start threw: ${message}`);
      setError(message);
      setConnectionState("idle");
      setStatus(`Unable to start Vapi voice: ${message}`);
      stopVoiceLevelMeter();
    }
  }, [
    appendStartTrace,
    handleVapiMessage,
    persistVapiTurn,
    session,
    startVoiceLevelMeter,
    stopVoiceLevelMeter,
  ]);

  useEffect(() => stopVapi, [stopVapi]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchPendingToolUiBlocks();
    }, 1_200);

    return () => window.clearInterval(intervalId);
  }, [fetchPendingToolUiBlocks, isConnected]);

  const openVoicePreview = useCallback((target: VoicePreviewTarget) => {
    setPreviewTarget(target);
  }, []);

  useEffect(() => {
    const transcript = transcriptRef.current;
    const activeTurn = transcript?.querySelector<HTMLElement>(
      "[data-active-voice-turn='true']",
    );

    if (!transcript || !activeTurn) {
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
    <section
      className={previewTarget ? "voice-console has-preview" : "voice-console"}
      aria-label="Vapi voice assistant"
    >
      <div className="voice-console-main">
        <section className="voice-control-panel" aria-label="Vapi voice controls">
          <button
            aria-label={isConnected ? "Stop Vapi voice" : "Start Vapi voice"}
            aria-pressed={isConnected}
            className={[
              "voice-orb",
              isConnected ? "recording" : null,
              connectionState === "speaking" ? "speaking" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={connectionState === "connecting" || !session.configured}
            onClick={() => {
              if (isConnected) {
                stopVapi();
                return;
              }

              void startVapi();
            }}
            type="button"
          >
            {isConnected ? <StopIcon /> : <MicrophoneIcon />}
          </button>
          <div className="voice-state-copy">
            <p>{statusLabel}</p>
            <span>{displayStatus}</span>
          </div>
          <div className="voice-meter-panel" aria-hidden="true">
            <VoiceLevelMeter active={showVoiceMeter} level={voiceLevel} />
          </div>
          {isConnected ? (
            <button className="secondary-button" onClick={stopVapi} type="button">
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
              onOpenPreview={openVoicePreview}
            />
          ))}
          {liveTranscript && isConnected ? (
            <p className="voice-live-caption">{liveTranscript}</p>
          ) : null}
          {connectionState === "connecting" ? (
            <div className="voice-thinking" aria-label="Connecting to Kyro">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </div>
      {previewTarget ? (
        <VoicePreviewPanel
          engineError={initialPreviewEngineError}
          engineMessage={initialPreviewEngineMessage}
          onClose={() => setPreviewTarget(null)}
          target={previewTarget}
        />
      ) : null}
    </section>
  );
}

function VoiceTurn({
  isActive,
  message,
  onOpenPreview,
}: {
  isActive: boolean;
  message: AssistantThreadMessage;
  onOpenPreview?: (target: VoicePreviewTarget) => void;
}) {
  const isUser = message.role === "user";
  const shouldShowBlocks = !isUser && !isVapiStarterOnly(message.content);

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
      {shouldShowBlocks ? (
        <VoiceMessageBlocks message={message} onOpenPreview={onOpenPreview} />
      ) : null}
      {shouldShowBlocks &&
      (!message.uiBlocks || message.uiBlocks.length === 0) &&
      message.links &&
      message.links.length > 0 ? (
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

function VoiceMessageBlocks({
  message,
  onOpenPreview,
}: {
  message: AssistantThreadMessage;
  onOpenPreview?: (target: VoicePreviewTarget) => void;
}) {
  const blocks = message.uiBlocks ?? [];

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="voice-blocks">
      {blocks.map((block, index) => {
        if (block.type === "link_cards") {
          if (block.links.length === 0) {
            return null;
          }

          return (
            <div className="voice-known-block" key={`${message.id}-links-${index}`}>
              <strong>{block.title}</strong>
              <div className="voice-card-grid">
                {block.links.slice(0, 6).map((link) => (
                  <VoiceLinkCard
                    href={link.href}
                    key={`${message.id}-${link.href}`}
                    meta={link.meta}
                    onOpenPreview={onOpenPreview}
                    title={link.label}
                  />
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "summary_cards") {
          return (
            <div className="voice-known-block" key={`${message.id}-summary-${index}`}>
              <strong>{block.title}</strong>
              <div className="voice-card-grid">
                {block.cards.map((card) => (
                  <VoiceLinkCard
                    href={card.href}
                    key={`${message.id}-${card.label}-${card.value}`}
                    meta={card.detail}
                    onOpenPreview={onOpenPreview}
                    tone={card.tone}
                    title={card.label}
                    value={card.value}
                  />
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "approval_queue") {
          return (
            <div className="voice-known-block" key={`${message.id}-approval-${index}`}>
              <strong>{block.title}</strong>
              <div className="voice-list-block">
                {block.items.map((item) => (
                  <VoiceLinkCard
                    href={item.href}
                    key={`${message.id}-${item.id}`}
                    meta={item.detail ?? item.status}
                    onOpenPreview={onOpenPreview}
                    title={item.label}
                    value={item.actionLabel ?? item.status}
                  />
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "timeline") {
          return (
            <div className="voice-known-block" key={`${message.id}-timeline-${index}`}>
              <strong>{block.title}</strong>
              <div className="voice-list-block">
                {block.items.slice(0, 6).map((item) => (
                  <VoiceLinkCard
                    href={item.href}
                    key={`${message.id}-${item.label}-${item.at ?? ""}`}
                    meta={item.detail ?? item.at ?? undefined}
                    onOpenPreview={onOpenPreview}
                    title={item.label}
                  />
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "generated_image") {
          return (
            <div
              className="voice-known-block generated-image"
              key={`${message.id}-generated-image-${index}`}
            >
              <strong>{block.title}</strong>
              <div className="voice-generated-image-grid">
                {block.images.map((image) => (
                  <article className="voice-generated-image-card" key={image.fileId}>
                    <a href={image.href} rel="noreferrer" target="_blank">
                      {/* Generated file thumbnails are scoped API images, not LCP media. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={image.alt} src={image.href} />
                    </a>
                    <div className="voice-generated-image-actions">
                      <a href={image.href} rel="noreferrer" target="_blank">
                        Open
                      </a>
                      <a href={image.downloadHref}>Download</a>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "memory_notice" || block.type === "memory_suggestion") {
          return (
            <div className="voice-known-block notice" key={`${message.id}-memory-${index}`}>
              <strong>{block.title}</strong>
              <span>{block.content}</span>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

function VoiceLinkCard({
  href,
  meta,
  onOpenPreview,
  title,
  tone = "neutral",
  value,
}: {
  href?: string;
  meta?: string;
  onOpenPreview?: (target: VoicePreviewTarget) => void;
  title: string;
  tone?: string;
  value?: string;
}) {
  const className = `voice-card ${tone}`;
  const body = (
    <>
      <span>{title}</span>
      {value ? <strong>{value}</strong> : null}
      {meta ? <small>{meta}</small> : null}
    </>
  );

  if (href && onOpenPreview && isPreviewableVoiceHref(href)) {
    return (
      <button
        className={className}
        onClick={() => onOpenPreview({ href, meta, title, value })}
        type="button"
      >
        {body}
      </button>
    );
  }

  if (href) {
    return (
      <a
        className={className}
        href={href}
        rel={isExternalHref(href) ? "noreferrer" : undefined}
        target={isExternalHref(href) ? "_blank" : undefined}
      >
        {body}
      </a>
    );
  }

  return <div className={className}>{body}</div>;
}

function VoicePreviewPanel({
  engineError,
  engineMessage,
  onClose,
  target,
}: {
  engineError?: string;
  engineMessage?: string;
  onClose: () => void;
  target: VoicePreviewTarget;
}) {
  const [data, setData] = useState<VoicePreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    const resetTimeout = window.setTimeout(() => {
      if (!isCancelled) {
        setData(null);
        setError(null);
        setIsLoading(true);
      }
    }, 0);

    fetch(`/api/assistant/vapi/preview?href=${encodeURIComponent(target.href)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = objectRecord(await response.json().catch(() => ({})));

        if (!response.ok) {
          throw new Error(textValue(body.error) ?? "Unable to load preview.");
        }

        return objectRecord(body.data) as VoicePreviewData;
      })
      .then((nextData) => {
        if (!isCancelled) {
          setData(nextData);
        }
      })
      .catch((previewError) => {
        if (!isCancelled) {
          setError(errorMessage(previewError));
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      window.clearTimeout(resetTimeout);
    };
  }, [target.href, target.refreshKey]);

  if (!isLoading && !error && data?.type === "contact") {
    const contactHref = (contactId: string) =>
      `/voice-vapi?contactId=${encodeURIComponent(contactId)}`;
    const contactId = data.profile.contact.id;

    return (
      <ContactProfilePanel
        className="voice-preview-panel voice-contact-profile-panel"
        engineError={engineError}
        engineMessage={engineMessage}
        onClose={onClose}
        profile={data.profile}
        profileHref={contactHref}
        redirectTo={contactHref(contactId)}
        successHref={contactHref}
      />
    );
  }

  return (
    <aside className="voice-preview-panel" aria-label="Voice assistant preview">
      <header className="voice-preview-header">
        <div>
          <span>Preview</span>
          <h2>{target.title}</h2>
          {target.meta ? <p>{target.meta}</p> : null}
        </div>
        <div className="voice-preview-actions">
          <a href={target.href}>Open full screen</a>
          <button onClick={onClose} type="button">
            Close
          </button>
        </div>
      </header>
      <div className="voice-preview-body">
        {isLoading ? <p className="muted-copy">Loading preview...</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!isLoading && !error && data?.type === "link" ? (
          <div className="voice-preview-empty">
            <strong>Open this item full screen</strong>
            <span>This card links to another Kyro surface.</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

// Kept as a compact fallback preview while the primary path uses ContactProfilePanel.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ContactVoicePreview({ data }: { data: Extract<VoicePreviewData, { type: "contact" }> }) {
  const contact = data.profile.contact;

  return (
    <>
      <section className="voice-preview-section">
        <h3>Contact</h3>
        <div className="voice-preview-grid">
          <VoicePreviewFact label="Name" value={contact.name} />
          <VoicePreviewFact label="Type" value={humanizeLabel(contact.contactType)} />
          <VoicePreviewFact label="Email" value={contact.email} />
          <VoicePreviewFact label="Phone" value={contact.phone} />
          <VoicePreviewFact label="Company" value={contact.company} />
          <VoicePreviewFact label="Address" value={contact.address} />
        </div>
      </section>
      <section className="voice-preview-section">
        <h3>Snapshot</h3>
        <div className="voice-preview-counts">
          <VoicePreviewFact label="Leads" value={String(data.profile.counts.leads)} />
          <VoicePreviewFact
            label="Conversations"
            value={String(data.profile.counts.conversations)}
          />
          <VoicePreviewFact label="Messages" value={String(data.profile.counts.messages)} />
          <VoicePreviewFact label="Actions" value={String(data.profile.counts.actions)} />
        </div>
      </section>
      <section className="voice-preview-section">
        <h3>Leads</h3>
        {data.profile.leads.length > 0 ? (
          <div className="voice-preview-list">
            {data.profile.leads.map((lead) => (
              <article className="voice-preview-row" key={lead.id}>
                <strong>{lead.title}</strong>
                <span>
                  {humanizeLabel(lead.status)} · {humanizeLabel(lead.priority)}
                  {lead.nextStep ? ` · ${lead.nextStep}` : ""}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No active leads attached.</p>
        )}
      </section>
      <section className="voice-preview-section">
        <h3>Recent messages</h3>
        {data.profile.messages.length > 0 ? (
          <div className="voice-preview-list">
            {data.profile.messages.map((message) => (
              <article className="voice-preview-row" key={message.id}>
                <strong>
                  {humanizeLabel(message.direction)}
                  {message.subject ? ` · ${message.subject}` : ""}
                </strong>
                <span>{message.bodyText ?? "No message body recorded."}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No recent messages recorded.</p>
        )}
      </section>
    </>
  );
}

function VoicePreviewFact({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="voice-preview-fact">
      <span>{label}</span>
      <strong>{value?.trim() ? value : "-"}</strong>
    </div>
  );
}

function isPreviewableVoiceHref(href: string) {
  try {
    const url = new URL(href, "http://kyro.local");
    return url.pathname === "/contacts" || /^\/contacts\/[^/]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function humanizeLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function ClientMessageTime({ value }: { value: string | undefined }) {
  return <span suppressHydrationWarning>{formatMessageTime(value)}</span>;
}

function AssistantProviderPill({ message }: { message: AssistantThreadMessage }) {
  if (!message.provider) {
    return null;
  }

  return <span className="assistant-provider-pill">{message.provider}</span>;
}

function VoiceLevelMeter({
  active,
  level,
}: {
  active: boolean;
  level: number;
}) {
  if (!active) {
    return null;
  }

  const bars = [0.42, 0.72, 1, 0.62, 0.86];
  const normalizedLevel = Math.max(0.06, Math.min(1, level));
  const boostedLevel = Math.min(1, Math.pow(normalizedLevel, 0.58) * 1.08);

  return (
    <span className="voice-level-meter">
      {bars.map((bar, index) => (
        <span
          key={bar}
          style={{
            height: active
              ? `${Math.max(14, Math.min(100, boostedLevel * 100 * bar + 12))}%`
              : "0%",
            transitionDelay: `${index * 5}ms`,
          }}
        />
      ))}
    </span>
  );
}

function dedupeVoiceMessages(messages: AssistantThreadMessage[]) {
  const keptMessages: AssistantThreadMessage[] = [];
  const recentBySignature = new Map<string, AssistantThreadMessage>();

  for (const message of messages) {
    const createdAt = Date.parse(message.createdAt ?? "");
    const normalizedContent = canonicalTranscript(message.content);
    const signature = `${message.role}:${message.provider ?? ""}:${normalizedContent}`;
    const previous = recentBySignature.get(signature);
    const previousNearMatchIndex = keptMessages.findIndex((keptMessage) => {
      if (
        keptMessage.role !== message.role ||
        (keptMessage.provider ?? "") !== (message.provider ?? "")
      ) {
        return false;
      }

      const keptAt = Date.parse(keptMessage.createdAt ?? "");
      const delta = Math.abs(
        (Number.isFinite(createdAt) ? createdAt : 0) -
          (Number.isFinite(keptAt) ? keptAt : 0),
      );

      return delta <= 30_000 && sameVoiceTurn(keptMessage.content, message.content);
    });

    if (previous) {
      const previousAt = Date.parse(previous.createdAt ?? "");
      const delta = Math.abs(
        (Number.isFinite(createdAt) ? createdAt : 0) -
          (Number.isFinite(previousAt) ? previousAt : 0),
      );

      if (delta <= 10_000) {
        continue;
      }
    }

    if (previousNearMatchIndex !== -1) {
      const previousNearMatch = keptMessages[previousNearMatchIndex];
      keptMessages[previousNearMatchIndex] = {
        ...previousNearMatch,
        content: mergeVoiceTurnContent(previousNearMatch.content, message.content),
        uiBlocks: mergeAssistantUiBlocks(previousNearMatch.uiBlocks, message.uiBlocks),
      };
      continue;
    }

    keptMessages.push(message);
    recentBySignature.set(signature, message);
  }

  return keptMessages;
}

function mergeAssistantUiBlocks(
  currentValue: AssistantUiBlock[] | undefined,
  incomingValue: AssistantUiBlock[] | undefined,
) {
  const current = normalizeAssistantUiBlocks(currentValue ?? []);
  const incoming = normalizeAssistantUiBlocks(incomingValue ?? []);

  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set(current.map((block) => JSON.stringify(block)));
  const merged = [...current];

  for (const block of incoming) {
    const signature = JSON.stringify(block);

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    merged.push(block);
  }

  return merged;
}

function previewTargetFromUiBlocks(blocks: AssistantUiBlock[]) {
  for (const link of linksFromBlocks(blocks)) {
    if (!isPreviewableVoiceHref(link.href)) {
      continue;
    }

    return {
      href: link.href,
      meta: link.meta,
      title: link.label,
    };
  }

  return null;
}

function extractVapiToolUiBlocks(payload: unknown) {
  const found: AssistantUiBlock[] = [];
  const visited = new Set<unknown>();

  function visit(value: unknown, depth: number) {
    if (depth > 7 || value == null) {
      return;
    }

    if (typeof value === "string") {
      const clean = value.trim();

      if (!clean || (!clean.startsWith("{") && !clean.startsWith("["))) {
        return;
      }

      try {
        visit(JSON.parse(clean), depth + 1);
      } catch {
        // Most Vapi result strings are natural language. Ignore non-JSON text.
      }

      return;
    }

    if (typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }

    visited.add(value);

    const blocks = normalizeAssistantUiBlocks(value);

    if (blocks.length > 0) {
      found.push(...blocks);
    }

    const record = objectRecord(value);
    const candidateBlocks =
      normalizeAssistantUiBlocks(record.uiBlocks).length > 0
        ? normalizeAssistantUiBlocks(record.uiBlocks)
        : normalizeAssistantUiBlocks(record.ui_blocks);

    if (candidateBlocks.length > 0) {
      found.push(...candidateBlocks);
    }

    for (const child of Object.values(record)) {
      visit(child, depth + 1);
    }
  }

  visit(payload, 0);

  return mergeAssistantUiBlocks([], found);
}

function mergeVoiceTurnContent(currentValue: string, incomingValue: string) {
  const current = normalizedTranscript(currentValue);
  const incoming = normalizedTranscript(incomingValue);

  if (!current) {
    return incoming;
  }

  if (!incoming || current === incoming) {
    return current;
  }

  if (isVoiceTurnExpansion(current, incoming)) {
    return incoming;
  }

  if (isVoiceTurnExpansion(incoming, current)) {
    return current;
  }

  return incoming.length > current.length ? incoming : current;
}

function mergeAssistantContent(currentValue: string, incomingValue: string) {
  const current = normalizedTranscript(currentValue);
  const incoming = normalizedTranscript(incomingValue);

  if (!current) {
    return incoming;
  }

  if (!incoming || current === incoming || current.includes(incoming)) {
    return current;
  }

  if (isVapiStarterOnly(incoming)) {
    return current;
  }

  if (isVapiStarterOnly(current)) {
    return incoming;
  }

  if (incoming.includes(current) || incoming.startsWith(current)) {
    return incoming;
  }

  if (isVoiceTurnExpansion(current, incoming)) {
    return incoming;
  }

  if (isVoiceTurnExpansion(incoming, current)) {
    return current;
  }

  const overlapped = mergeOverlappingTranscript(current, incoming);

  if (overlapped) {
    return overlapped;
  }

  if (looksLikeAssistantStreamFragment(current, incoming)) {
    return appendAssistantStreamFragment(current, incoming);
  }

  return incoming.length >= current.length ? incoming : current;
}

function mergeOverlappingTranscript(current: string, incoming: string) {
  const maxOverlap = Math.min(current.length, incoming.length);

  for (let size = maxOverlap; size >= 10; size -= 1) {
    if (current.endsWith(incoming.slice(0, size))) {
      return normalizedTranscript(`${current}${incoming.slice(size)}`);
    }
  }

  return null;
}

function looksLikeAssistantStreamFragment(current: string, incoming: string) {
  if (/^[,.;:!?)]/.test(incoming)) {
    return true;
  }

  const incomingWords = incoming.split(" ").filter(Boolean);

  if (incoming.length <= 180 && incomingWords.length <= 28) {
    return true;
  }

  return incoming.length < current.length * 0.8 && incomingWords.length <= 36;
}

function appendAssistantStreamFragment(current: string, incoming: string) {
  if (/^[,.;:!?)]/.test(incoming) || current.endsWith(" ") || incoming.startsWith(" ")) {
    return normalizedTranscript(`${current}${incoming}`);
  }

  return normalizedTranscript(`${current} ${incoming}`);
}

function modelOutputText(message: VapiMessage) {
  return (
    textFromModelOutput(message.output) ??
    textValue(message.text) ??
    textValue(message.message)
  );
}

function textFromModelOutput(value: unknown): string | null {
  const direct = textValue(value);

  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => textFromModelOutput(entry))
      .filter((entry): entry is string => Boolean(entry));

    return parts.length > 0 ? parts.join("") : null;
  }

  const record = objectRecord(value);
  const directFromRecord =
    textValue(record.content) ??
    textValue(record.text) ??
    textValue(record.delta) ??
    textValue(record.token) ??
    textValue(record.message) ??
    textValue(record.output);

  if (directFromRecord) {
    return directFromRecord;
  }

  const delta = objectRecord(record.delta);
  const deltaText =
    textValue(delta.content) ??
    textValue(delta.text) ??
    textValue(delta.token) ??
    textValue(delta.output);

  if (deltaText) {
    return deltaText;
  }

  const nestedMessage = objectRecord(record.message);
  const nestedMessageText =
    textValue(nestedMessage.content) ??
    textValue(nestedMessage.text) ??
    textValue(nestedMessage.output);

  if (nestedMessageText) {
    return nestedMessageText;
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choiceText = choices
    .map((choice) => {
      const choiceRecord = objectRecord(choice);

      return (
        textFromModelOutput(choiceRecord.delta) ??
        textFromModelOutput(choiceRecord.message) ??
        textValue(choiceRecord.text)
      );
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  return choiceText || null;
}

function lastConversationMessage(
  value: unknown,
  requiredRole?: "assistant" | "user",
) {
  if (!Array.isArray(value)) {
    return null;
  }

  const records = value.map(objectRecord);

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const content =
      textValue(record.message) ??
      textValue(record.content) ??
      textValue(record.text);
    const role = roleFromVapiMessage(record as VapiMessage);

    if (content && role && (!requiredRole || role === requiredRole)) {
      return { content, role };
    }
  }

  return null;
}

function isExpectedCallEndReason(value: string) {
  return [
    "assistant-ended-call",
    "customer-ended-call",
    "customer-did-not-answer",
    "silence-timed-out",
    "user-ended-call",
  ].includes(value);
}

function humanizeVapiReason(value: string) {
  return value
    .replace(/^call\.in-progress\.error-/, "")
    .replace(/^pipeline-error-/, "")
    .replace(/^call\.start\.error-/, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasVoiceOverride(value: unknown) {
  return Boolean(objectRecord(value).voice);
}

function withoutVoiceOverride(value: Record<string, unknown>) {
  const rest = { ...value };
  delete rest.voice;

  return rest;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roleFromVapiMessage(message: VapiMessage): "assistant" | "user" | null {
  const rawRole = (
    textValue(message.role) ??
    textValue(message.speaker) ??
    textValue(message.transcriptRole)
  )?.toLowerCase();

  if (rawRole === "assistant" || rawRole === "bot") {
    return "assistant";
  }

  if (rawRole === "user" || rawRole === "customer" || rawRole === "client") {
    return "user";
  }

  return null;
}

function errorMessage(value: unknown) {
  if (value instanceof Error) {
    return value.message;
  }

  const record = objectRecord(value);
  const nestedError = objectRecord(record.error);
  const nestedContext = objectRecord(record.context);
  const nestedMetadata = objectRecord(record.metadata);
  const directMessage =
    textValue(record.message) ??
    textValue(record.error) ??
    textValue(nestedError.message) ??
    textValue(nestedError.error) ??
    textValue(nestedError.errorMsg) ??
    textValue(nestedError.details) ??
    textValue(record.errorMsg) ??
    textValue(record.details) ??
    textValue(record.errorStack) ??
    textValue(nestedContext.error) ??
    textValue(nestedMetadata.error) ??
    textValue(record.stage);

  if (directMessage && directMessage.toLowerCase() !== "unknown") {
    return directMessage;
  }

  const serialized = safeJson(value);

  return serialized ?? directMessage ?? "Vapi voice failed.";
}

function safeJson(value: unknown) {
  try {
    const json = JSON.stringify(value);

    if (!json || json === "{}") {
      return null;
    }

    return json.length > 900 ? `${json.slice(0, 897)}...` : json;
  } catch {
    return null;
  }
}

function isExternalHref(href: string) {
  try {
    const url = new URL(href);

    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
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
