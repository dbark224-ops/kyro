import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuthSession } from "@/features/auth/auth-context";
import { kyroApiFetch } from "@/lib/kyro-api";
import {
  mobileAssistantVapiSessionQueryOptions,
  mobileQueryKeys,
} from "@/lib/mobile-query";
import type {
  AssistantLink,
  AssistantThreadMessage,
  AssistantUiBlock,
  MobileAssistantVapiSessionResponse,
  MobileAssistantVapiTurnResponse,
} from "@/lib/mobile-api-types";

export type VapiConnectionState =
  | "connecting"
  | "idle"
  | "listening"
  | "speaking";

type VapiCallContextValue = {
  displayedStatus: string;
  error: string | null;
  isConnected: boolean;
  isSessionLoading: boolean;
  liveTranscript: string;
  localTurns: AssistantThreadMessage[];
  session: MobileAssistantVapiSessionResponse | null;
  sessionError: Error | null;
  setupHint: string | null;
  startVapi: () => Promise<void>;
  statusLabel: string;
  statusText: string;
  stopVapi: () => void;
  voiceLevel: number;
  connectionState: VapiConnectionState;
};

type VapiClient = {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  send: (message: unknown) => void;
  start: (
    assistantId?: string,
    assistantOverrides?: Record<string, unknown>,
  ) => Promise<unknown>;
  stop: () => void;
};

type VapiConstructor = new (publicKey: string) => VapiClient;

const VapiCallContext = createContext<VapiCallContextValue | null>(null);
const isExpoGoRuntime = Constants.appOwnership === "expo";

function loadVapiConstructor(): VapiConstructor {
  const module = require("@vapi-ai/react-native") as {
    default?: VapiConstructor;
  } & VapiConstructor;

  return module.default ?? module;
}

export function VapiCallProvider({ children }: { children: ReactNode }) {
  const { session: authSession, status } = useAuthSession();
  const queryClient = useQueryClient();
  const userId = authSession?.user.id;
  const assistantQueryKey = mobileQueryKeys.assistant(userId);
  const vapiSessionQuery = useQuery({
    ...mobileAssistantVapiSessionQueryOptions(authSession),
    enabled: status === "signed-in",
  });
  const session = vapiSessionQuery.data ?? null;
  const vapiRef = useRef<VapiClient | null>(null);
  const currentUserTranscriptRef = useRef("");
  const currentAssistantTranscriptRef = useRef("");
  const persistedSignaturesRef = useRef<Set<string>>(new Set());
  const assistantFinalizeTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [connectionState, setConnectionState] =
    useState<VapiConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [localTurns, setLocalTurns] = useState<AssistantThreadMessage[]>([]);
  const [statusText, setStatusText] = useState("Ready for voice.");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const isConnected =
    connectionState === "connecting" ||
    connectionState === "listening" ||
    connectionState === "speaking";
  const setupMissing = session?.missing?.length
    ? "Voice assistant setup is incomplete."
    : null;
  const setupHint = isExpoGoRuntime
    ? "Live voice calls need a development or standalone build. Expo Go can show this screen, but it cannot run the live voice stack."
    : null;
  const statusLabel = vapiStatusLabel(connectionState, session, error);
  const displayedStatus = error ?? setupMissing ?? statusText;
  const persistVapiTurn = useMutation({
    mutationFn: ({
      assistantTranscript,
      threadId,
      userTranscript,
    }: {
      assistantTranscript: string | null;
      threadId: string | null;
      userTranscript: string | null;
    }) =>
      kyroApiFetch<MobileAssistantVapiTurnResponse>(
        "/api/mobile/assistant/vapi-turn",
        {
          body: {
            assistantTranscript,
            threadId,
            userTranscript,
          },
          method: "POST",
          session: authSession,
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantQueryKey });
    },
  });

  const addLocalTurn = useCallback(
    (
      role: "assistant" | "user",
      rawContent: string,
      extras?: {
        links?: AssistantLink[];
        uiBlocks?: AssistantUiBlock[];
      },
    ) => {
      const content =
        role === "user"
          ? normalizeKyroAddressedTranscript(rawContent)
          : normalizedTranscript(rawContent);
      const links = extras?.links?.filter(Boolean) ?? [];
      const uiBlocks = extras?.uiBlocks?.filter(Boolean) ?? [];

      if (!content && !links.length && !uiBlocks.length) {
        return;
      }

      setLocalTurns((currentTurns) => {
        const existingIndex = currentTurns.findIndex(
          (turn) =>
            turn.role === role &&
            content &&
            sameVoiceTurn(turn.content, content),
        );

        if (existingIndex !== -1) {
          return currentTurns.map((turn, index) =>
            index === existingIndex
              ? {
                  ...turn,
                  content: mergeVoiceTurnContent(turn.content, content),
                  links: mergeAssistantLinks(turn.links, links),
                  uiBlocks: mergeAssistantUiBlocks(turn.uiBlocks, uiBlocks),
                }
              : turn,
          );
        }

        return [
          ...currentTurns,
          {
            content,
            createdAt: new Date().toISOString(),
            id: `vapi-${role}-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`,
            intent: "vapi_internal_voice",
            links: links.length ? links : undefined,
            model: role === "assistant" ? "vapi-mobile-internal" : undefined,
            provider: role === "assistant" ? "vapi" : undefined,
            role,
            uiBlocks: uiBlocks.length ? uiBlocks : undefined,
          },
        ];
      });
    },
    [],
  );

  const persistCurrentTurn = useCallback(
    (assistantTranscript?: string) => {
      const userTranscript = normalizedTranscript(
        currentUserTranscriptRef.current,
      );
      const assistant = normalizedTranscript(
        assistantTranscript ?? currentAssistantTranscriptRef.current,
      );
      const signature = `${session?.threadId ?? "no-thread"}::${userTranscript}::${assistant}`;

      if (
        !session?.threadId ||
        persistedSignaturesRef.current.has(signature) ||
        (!userTranscript && !assistant)
      ) {
        return;
      }

      persistedSignaturesRef.current.add(signature);
      currentUserTranscriptRef.current = "";
      currentAssistantTranscriptRef.current = "";
      persistVapiTurn.mutate({
        assistantTranscript: assistant || null,
        threadId: session.threadId,
        userTranscript: userTranscript || null,
      });
    },
    [persistVapiTurn, session?.threadId],
  );

  const clearAssistantFinalizeTimer = useCallback(() => {
    if (assistantFinalizeTimerRef.current) {
      clearTimeout(assistantFinalizeTimerRef.current);
      assistantFinalizeTimerRef.current = null;
    }
  }, []);

  const finalizeAssistantTurn = useCallback(
    (rawContent?: string) => {
      const content = normalizedTranscript(
        rawContent ?? currentAssistantTranscriptRef.current,
      );

      if (!content) {
        return;
      }

      clearAssistantFinalizeTimer();
      currentAssistantTranscriptRef.current = content;
      addLocalTurn("assistant", content);
      persistCurrentTurn(content);
      setStatusText("Listening...");
    },
    [addLocalTurn, clearAssistantFinalizeTimer, persistCurrentTurn],
  );

  const scheduleAssistantFinalize = useCallback(() => {
    clearAssistantFinalizeTimer();
    assistantFinalizeTimerRef.current = setTimeout(() => {
      assistantFinalizeTimerRef.current = null;
      finalizeAssistantTurn();
    }, 1_000);
  }, [clearAssistantFinalizeTimer, finalizeAssistantTurn]);

  const handleFinalTranscript = useCallback(
    (role: "assistant" | "user", transcript: string) => {
      const content =
        role === "user"
          ? normalizeKyroAddressedTranscript(transcript)
          : normalizedTranscript(transcript);

      if (!content) {
        return;
      }

      if (role === "user") {
        currentUserTranscriptRef.current = content;
        setLiveTranscript("");
        addLocalTurn("user", content);
        setStatusText("Thinking...");
        return;
      }

      finalizeAssistantTurn(content);
    },
    [addLocalTurn, finalizeAssistantTurn],
  );

  const handleToolResult = useCallback(
    (message: Record<string, unknown>) => {
      const result = vapiToolResultRecord(message);
      const blocks = assistantUiBlocksFromUnknown(result.uiBlocks);
      const links = assistantLinksFromUnknown(result.links);

      if (!blocks.length && !links.length) {
        return;
      }

      const content =
        textValue(result.answer) ??
        textValue(result.message) ??
        textValue(result.title) ??
        "Kyro found matching workspace records.";

      addLocalTurn("assistant", content, { links, uiBlocks: blocks });
    },
    [addLocalTurn],
  );

  const handleVapiMessage = useCallback(
    (payload: unknown) => {
      const message = objectRecord(payload);
      const type = textValue(message.type);

      if (type === "tool-calls" || type === "function-call") {
        setStatusText("Using Kyro tools...");
        return;
      }

      if (type === "tool-calls-result" || type === "function-call-result") {
        handleToolResult(message);
        setStatusText("Tool result received.");
        return;
      }

      if (type === "status-update") {
        const callStatus = textValue(message.status);
        const endedReason = textValue(message.endedReason);

        if (callStatus === "ended") {
          persistCurrentTurn();
          setConnectionState("idle");
          setLiveTranscript("");
          setStatusText(
            endedReason
              ? `Call ended: ${humanizeVapiReason(endedReason)}`
              : "Call ended.",
          );
          setVoiceLevel(0);
          vapiRef.current = null;
        }

        return;
      }

      if (type === "speech-update") {
        const nextStatus = textValue(message.status);
        const role = roleFromVapiMessage(message);

        if (role === "assistant" && nextStatus === "started") {
          setConnectionState("speaking");
          setStatusText("Speaking...");
        }

        if (role === "assistant" && nextStatus === "stopped") {
          setConnectionState("listening");
          setStatusText("Listening...");
          scheduleAssistantFinalize();
        }

        return;
      }

      if (type === "model-output") {
        const outputText = modelOutputText(message);

        if (outputText) {
          currentAssistantTranscriptRef.current = mergeAssistantContent(
            currentAssistantTranscriptRef.current,
            outputText,
          );
        }

        setStatusText("Generating voice response...");
        return;
      }

      if (type === "voice-input") {
        setStatusText("Listening...");
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
          lastConversationMessage(message.messagesOpenAIFormatted, "assistant");

        if (lastAssistantMessage) {
          currentAssistantTranscriptRef.current = mergeAssistantContent(
            currentAssistantTranscriptRef.current,
            lastAssistantMessage.content,
          );
        }
      }
    },
    [
      handleFinalTranscript,
      handleToolResult,
      persistCurrentTurn,
      scheduleAssistantFinalize,
    ],
  );

  const stopVapi = useCallback(() => {
    clearAssistantFinalizeTimer();
    persistCurrentTurn();
    vapiRef.current?.stop();
    vapiRef.current = null;
    setConnectionState("idle");
    setLiveTranscript("");
    setStatusText("Voice stopped.");
    setVoiceLevel(0);
  }, [clearAssistantFinalizeTimer, persistCurrentTurn]);

  const startVapi = useCallback(async () => {
    if (isConnected) {
      return;
    }

    if (isExpoGoRuntime) {
      setError(
        "Voice calls cannot run inside Expo Go. Use a development build, simulator build, or TestFlight build.",
      );
      return;
    }

    if (!session?.configured || !session.publicKey || !session.assistantId) {
      setError(
        `Voice assistant setup is missing ${session?.missing.join(", ") || "configuration"}.`,
      );
      return;
    }

    setError(null);
    setConnectionState("connecting");
    setStatusText("Connecting to Kyro...");

    try {
      const Vapi = loadVapiConstructor();
      const vapi = new Vapi(session.publicKey);

      vapiRef.current = vapi;
      vapi.on("call-start", () => {
        setConnectionState("listening");
        setStatusText("Listening...");
      });
      vapi.on("call-start-success", () => {
        setStatusText("Ready.");
      });
      vapi.on("call-start-failed", (event: unknown) => {
        const message = errorMessage(event);

        setError(message);
        setConnectionState("idle");
        setStatusText(`Voice error: ${message}`);
        vapiRef.current = null;
      });
      vapi.on("call-end", () => {
        persistCurrentTurn();
        setConnectionState("idle");
        setStatusText("Call ended.");
        setLiveTranscript("");
        setVoiceLevel(0);
        vapiRef.current = null;
      });
      vapi.on("speech-start", () => {
        setConnectionState("speaking");
        setStatusText("Speaking...");
      });
      vapi.on("speech-end", () => {
        setConnectionState("listening");
        setStatusText("Listening...");
        scheduleAssistantFinalize();
      });
      vapi.on("volume-level", (level: unknown) => {
        const nextLevel = Math.max(0, Math.min(1, Number(level) || 0));

        setVoiceLevel((currentLevel) =>
          Math.max(currentLevel * 0.72, nextLevel),
        );
      });
      vapi.on("message", handleVapiMessage);
      vapi.on("error", (nextError: unknown) => {
        const message = errorMessage(nextError);

        setError(message);
        setConnectionState("idle");
        setStatusText(`Voice error: ${message}`);
      });

      const call = await vapi.start(
        session.assistantId,
        session.assistantOverrides,
      );

      if (!call) {
        throw new Error(
          "Kyro did not return a live voice call. Check the assistant setup and native dev build.",
        );
      }
    } catch (nextError) {
      const message = vapiStartErrorMessage(nextError);

      setError(message);
      setConnectionState("idle");
      setStatusText(`Unable to start voice: ${message}`);
      setVoiceLevel(0);
      vapiRef.current = null;
    }
  }, [
    handleVapiMessage,
    isConnected,
    persistCurrentTurn,
    scheduleAssistantFinalize,
    session,
  ]);

  useEffect(() => {
    if (status !== "signed-in") {
      if (vapiRef.current) {
        stopVapi();
      }

      setLocalTurns((currentTurns) =>
        currentTurns.length ? [] : currentTurns,
      );
      persistedSignaturesRef.current.clear();
    }
  }, [status, stopVapi]);

  useEffect(
    () => () => {
      clearAssistantFinalizeTimer();
      vapiRef.current?.stop();
      vapiRef.current = null;
    },
    [clearAssistantFinalizeTimer],
  );

  const value = useMemo<VapiCallContextValue>(
    () => ({
      connectionState,
      displayedStatus,
      error,
      isConnected,
      isSessionLoading: vapiSessionQuery.isLoading,
      liveTranscript,
      localTurns,
      session,
      sessionError:
        vapiSessionQuery.error instanceof Error ? vapiSessionQuery.error : null,
      setupHint,
      startVapi,
      statusLabel,
      statusText,
      stopVapi,
      voiceLevel,
    }),
    [
      connectionState,
      displayedStatus,
      error,
      isConnected,
      liveTranscript,
      localTurns,
      session,
      setupHint,
      startVapi,
      statusLabel,
      statusText,
      stopVapi,
      vapiSessionQuery.error,
      vapiSessionQuery.isLoading,
      voiceLevel,
    ],
  );

  return (
    <VapiCallContext.Provider value={value}>
      {children}
    </VapiCallContext.Provider>
  );
}

export function useVapiCall() {
  const value = useContext(VapiCallContext);

  if (!value) {
    throw new Error("useVapiCall must be used inside VapiCallProvider.");
  }

  return value;
}

export function voiceLevelToMetering(level: number) {
  return Math.max(-60, Math.min(0, -60 + level * 60));
}

export function mergeVapiTranscriptMessages(
  messages: AssistantThreadMessage[],
) {
  const merged: AssistantThreadMessage[] = [];

  for (const message of messages) {
    const existingIndex = merged.findIndex(
      (currentMessage) =>
        currentMessage.role === message.role &&
        sameVoiceTurn(currentMessage.content, message.content),
    );

    if (existingIndex === -1) {
      merged.push(message);
      continue;
    }

    const existing = merged[existingIndex];

    merged[existingIndex] = {
      ...existing,
      content: mergeVoiceTurnContent(existing.content, message.content),
      links: mergeAssistantLinks(existing.links, message.links),
      uiBlocks: mergeAssistantUiBlocks(existing.uiBlocks, message.uiBlocks),
    };
  }

  return merged;
}

function vapiStatusLabel(
  state: VapiConnectionState,
  session: MobileAssistantVapiSessionResponse | null,
  error: string | null,
) {
  if (error || session?.configured === false) {
    return "Setup needed";
  }

  if (state === "connecting") {
    return "Connecting";
  }

  if (state === "speaking") {
    return "Speaking";
  }

  if (state === "listening") {
    return "Listening";
  }

  return "Ready";
}

function normalizedTranscript(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

const KYRO_ADDRESSING_VARIANTS = "cairo|kairo|kiro|kyra|cara|kara|clare|claire";
const KYRO_ADDRESSING_PREFIX =
  "(?:(?:hey|hi|hello|yo|ok|okay|alright|right|so|what'?s up|sup)[,!.?\\s]+){0,4}";

function normalizeKyroAddressedTranscript(value: string) {
  return normalizedTranscript(value).replace(
    new RegExp(
      `^(${KYRO_ADDRESSING_PREFIX})(${KYRO_ADDRESSING_VARIANTS})\\b`,
      "i",
    ),
    (_match, prefix: string) => `${prefix ?? ""}Kyro`,
  );
}

function canonicalTranscript(value: string) {
  return normalizedTranscript(value)
    .toLowerCase()
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2019]/g, "'")
    .replace(/[^a-z0-9'" ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  const shorter = first.length < second.length ? first : second;
  const longer = first.length < second.length ? second : first;

  return shorter.length >= 28 && longer.includes(shorter);
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

  const currentCanonical = canonicalTranscript(current);
  const incomingCanonical = canonicalTranscript(incoming);

  if (incomingCanonical.includes(currentCanonical)) {
    return incoming;
  }

  if (currentCanonical.includes(incomingCanonical)) {
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

  if (incoming.includes(current) || incoming.startsWith(current)) {
    return incoming;
  }

  const needsSpace = !/\s$/.test(current) && !/^\s|^[,.;:!?)]/.test(incoming);

  return `${current}${needsSpace ? " " : ""}${incoming}`.trim();
}

function mergeAssistantLinks(
  currentLinks?: AssistantLink[],
  incomingLinks?: AssistantLink[],
) {
  const merged = [...(currentLinks ?? [])];

  for (const link of incomingLinks ?? []) {
    if (!merged.some((current) => current.href === link.href)) {
      merged.push(link);
    }
  }

  return merged.length ? merged : undefined;
}

function mergeAssistantUiBlocks(
  currentBlocks?: AssistantUiBlock[],
  incomingBlocks?: AssistantUiBlock[],
) {
  const merged = [...(currentBlocks ?? [])];
  const signatures = new Set(
    merged.map((block) => safeJson(block) ?? block.type),
  );

  for (const block of incomingBlocks ?? []) {
    const signature = safeJson(block) ?? block.type;

    if (!signatures.has(signature)) {
      signatures.add(signature);
      merged.push(block);
    }
  }

  return merged.length ? merged : undefined;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roleFromVapiMessage(
  message: Record<string, unknown>,
): "assistant" | "user" | null {
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

function modelOutputText(message: Record<string, unknown>) {
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

  return (
    textValue(record.content) ??
    textValue(record.text) ??
    textValue(record.delta) ??
    textValue(record.token) ??
    textValue(record.message) ??
    textValue(record.output)
  );
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
    const role = roleFromVapiMessage(record);

    if (content && role && (!requiredRole || role === requiredRole)) {
      return { content, role };
    }
  }

  return null;
}

function vapiToolResultRecord(message: Record<string, unknown>) {
  const candidates = [
    objectRecord(message.result),
    objectRecord(objectRecord(message.result).result),
    objectRecord(message.output),
    objectRecord(message.data),
    objectRecord(message.response),
    objectRecord(message),
  ];

  const resultArray = Array.isArray(message.results) ? message.results : [];

  for (const entry of resultArray) {
    const record = objectRecord(entry);
    const nested = objectRecord(record.result);

    candidates.push(nested, record);
  }

  return (
    candidates.find(
      (candidate) =>
        Array.isArray(candidate.uiBlocks) || Array.isArray(candidate.links),
    ) ?? candidates[0]
  );
}

function assistantLinksFromUnknown(value: unknown): AssistantLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = objectRecord(item);
    const href = textValue(record.href);
    const label = textValue(record.label);

    if (!href || !label) {
      return [];
    }

    return [
      {
        href,
        label,
        meta: textValue(record.meta),
      },
    ];
  });
}

function assistantUiBlocksFromUnknown(value: unknown): AssistantUiBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isAssistantUiBlock);
}

function isAssistantUiBlock(value: unknown): value is AssistantUiBlock {
  const record = objectRecord(value);
  const type = textValue(record.type);

  return (
    type === "approval_queue" ||
    type === "generated_image" ||
    type === "link_cards" ||
    type === "memory_notice" ||
    type === "memory_suggestion" ||
    type === "summary_cards" ||
    type === "timeline"
  );
}

function errorMessage(value: unknown) {
  if (value instanceof Error) {
    return publicVapiErrorMessage(value.message) ?? value.message;
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
  const publicMessage = publicVapiErrorMessage(
    [directMessage, safeJson(value)].filter(Boolean).join(" "),
  );

  if (publicMessage) {
    return publicMessage;
  }

  if (directMessage && directMessage.toLowerCase() !== "unknown") {
    return directMessage;
  }

  return directMessage ?? "Voice assistant failed. Please try again.";
}

function vapiStartErrorMessage(value: unknown) {
  const message = errorMessage(value);

  if (
    message.toLowerCase().includes("native") ||
    message.toLowerCase().includes("daily") ||
    message.toLowerCase().includes("webrtc") ||
    message.toLowerCase().includes("module")
  ) {
    return `${message}. Rebuild Kyro with the native voice modules included before testing voice calls.`;
  }

  return message;
}

function publicVapiErrorMessage(value: string | null | undefined) {
  const normalized = value?.toLowerCase() ?? "";

  if (
    normalized.includes("wallet balance") ||
    normalized.includes("purchase more credits") ||
    normalized.includes("upgrade your plan") ||
    normalized.includes("currencyblocked") ||
    normalized.includes("subscriptionlimits")
  ) {
    return "The system is experiencing issues. Our dev team has been notified.";
  }

  return null;
}

function humanizeVapiReason(value: string) {
  return value
    .replace(/^call\.in-progress\.error-/, "")
    .replace(/^pipeline-error-/, "")
    .replace(/^call\.start\.error-/, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
