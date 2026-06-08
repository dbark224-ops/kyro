"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  getAssistantResourcePreviewAction,
  runAssistantResourceActionAction,
  sendAssistantManualReplyAction,
  sendAssistantMessageAction,
  startAssistantOutboundCallAction,
  updateAssistantMemorySuggestionAction,
  updateAssistantDraftReplyAction,
} from "./actions";
import type {
  AssistantLink,
  AssistantResourcePreview,
  AssistantResourcePreviewResult,
  AssistantThreadMessage,
  AssistantThreadState,
  AssistantUiBlock,
} from "../../lib/assistant/types";
import type { AssistantExternalActivityItem } from "../../lib/assistant/external-activity";
import Image from "next/image";
import Link from "next/link";
import { MessageAttachmentList } from "../components/message-attachments";
import { ContactProfilePanel } from "../components/contact-profile-panel";

const FALLBACK_QUICK_PROMPTS = [
  "Show me leads needing reply",
  "What quote drafts are ready?",
  "Create a bathroom quote draft",
  "Summarise my busiest customer",
];
const MAX_VISIBLE_QUICK_PROMPTS = 3;
const MAX_QUICK_PROMPT_LABEL_CHARS = 34;
const MAX_ATTACHMENT_TEXT_BYTES = 48 * 1024;
type VoiceCompletionMode = "draft" | "send";
type PendingAssistantActivity = "image_generation" | null;

type AssistantAttachment = {
  file: File | null;
  id: string;
  name: string;
  previewText: string | null;
  size: number;
  type: string;
};

type OptimisticAssistantMessage = AssistantThreadMessage & {
  submittedAtMs: number;
};

type GeneratedImageBlock = Extract<
  AssistantUiBlock,
  { type: "generated_image" }
>;
type GeneratedImage = GeneratedImageBlock["images"][number];
type OutboundCallRequestBlock = Extract<
  AssistantUiBlock,
  { type: "outbound_call_request" }
>;
type OutboundCallStatus = {
  message?: string;
  providerCallId?: string | null;
  status: "idle" | "starting" | "started" | "failed";
  voiceCallId?: string;
};
type AssistantDisplayAttachment = {
  contentType: string | null;
  href: string | null;
  name: string;
  sizeLabel: string | null;
};

function quickPromptLabel(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();

  if (normalized.length <= MAX_QUICK_PROMPT_LABEL_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_QUICK_PROMPT_LABEL_CHARS - 1).trimEnd()}...`;
}

type PreviewState =
  | {
      status: "closed";
    }
  | {
      href: string;
      status: "loading";
      title: string;
    }
  | {
      preview: AssistantResourcePreview;
      status: "ready";
    }
  | {
      error: string;
      href: string;
      status: "error";
      title: string;
    };

export function AssistantConsole({
  externalActivityItems = [],
  initialPreviewEngineError,
  initialPreviewEngineMessage,
  initialPreview,
  initialState,
  promptSuggestions,
}: {
  externalActivityItems?: AssistantExternalActivityItem[];
  initialPreviewEngineError?: string;
  initialPreviewEngineMessage?: string;
  initialPreview?: AssistantResourcePreview | null;
  initialState: AssistantThreadState;
  promptSuggestions?: string[];
}) {
  const [state, formAction, pending] = useActionState(
    sendAssistantMessageAction,
    initialState,
  );
  const [, startSubmitTransition] = useTransition();
  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef("");
  const submissionInFlightRef = useRef(false);
  const previousLastMessageIdRef = useRef(lastMessageId(state.messages));
  const previewCacheRef = useRef<Map<string, AssistantResourcePreviewResult>>(
    new Map(),
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const voiceCompletionModeRef = useRef<VoiceCompletionMode>("draft");
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserAnimationRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [pendingActivity, setPendingActivity] =
    useState<PendingAssistantActivity>(null);
  const [optimisticMessage, setOptimisticMessage] =
    useState<OptimisticAssistantMessage | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(
    initialPreview
      ? {
          preview: initialPreview,
          status: "ready",
        }
      : {
          status: "closed",
        },
  );
  const [previewActionId, setPreviewActionId] = useState<string | null>(null);
  const [linkOverrides, setLinkOverrides] = useState<
    Record<string, AssistantLink>
  >({});
  const [memorySuggestionStatuses, setMemorySuggestionStatuses] = useState<
    Record<string, "active" | "pending_approval" | "rejected">
  >({});
  const [outboundCallStatuses, setOutboundCallStatuses] = useState<
    Record<string, OutboundCallStatus>
  >({});
  const [expandedImage, setExpandedImage] = useState<GeneratedImage | null>(
    null,
  );
  const visibleOptimisticMessage = useMemo(
    () =>
      optimisticMessage &&
      !isOptimisticMessageSaved(state.messages, optimisticMessage)
        ? optimisticMessage
        : null,
    [optimisticMessage, state.messages],
  );
  const visibleMessages = useMemo(
    () =>
      visibleOptimisticMessage
        ? [...state.messages, visibleOptimisticMessage]
        : state.messages,
    [state.messages, visibleOptimisticMessage],
  );
  const isAssistantGenerating = pending || Boolean(visibleOptimisticMessage);
  const isVoiceBusy = isListening || isTranscribing;
  const quickPrompts = (
    promptSuggestions && promptSuggestions.length > 0
      ? promptSuggestions
      : FALLBACK_QUICK_PROMPTS
  ).slice(0, MAX_VISIBLE_QUICK_PROMPTS);

  const updateMemorySuggestion = (
    memoryId: string,
    status: "active" | "rejected",
  ) => {
    setMemorySuggestionStatuses((current) => ({
      ...current,
      [memoryId]: status,
    }));
    startSubmitTransition(async () => {
      try {
        const result = await updateAssistantMemorySuggestionAction({
          memoryId,
          status,
        });

        setMemorySuggestionStatuses((current) => ({
          ...current,
          [memoryId]:
            result.status === "active" || result.status === "rejected"
              ? result.status
              : status,
        }));
      } catch {
        setMemorySuggestionStatuses((current) => ({
          ...current,
          [memoryId]: "pending_approval",
        }));
      }
    });
  };

  const startOutboundCall = (request: OutboundCallRequestBlock["request"]) => {
    const key = outboundCallRequestKey(request);

    setOutboundCallStatuses((current) => ({
      ...current,
      [key]: {
        message: "Starting the outbound phone call...",
        status: "starting",
      },
    }));

    startSubmitTransition(async () => {
      const result = await startAssistantOutboundCallAction(request);

      if (result.ok) {
        setOutboundCallStatuses((current) => ({
          ...current,
          [key]: {
            message: "Call started and recorded in Kyro activity.",
            providerCallId: result.providerCallId ?? null,
            status: "started",
            voiceCallId: result.voiceCallId,
          },
        }));
        return;
      }

      setOutboundCallStatuses((current) => ({
        ...current,
        [key]: {
          message: result.error ?? "Unable to start the call.",
          status: "failed",
        },
      }));
    });
  };

  const readComposerDraft = () =>
    promptInputRef.current?.value ?? draftRef.current;

  const setComposerDraft = (
    value: string,
    options: { focus?: boolean } = {},
  ) => {
    draftRef.current = value;

    const promptInput = promptInputRef.current;

    if (promptInput && promptInput.value !== value) {
      promptInput.value = value;
    }

    resizePromptInput(promptInput);

    if (options.focus) {
      window.requestAnimationFrame(() => {
        promptInputRef.current?.focus();
      });
    }
  };

  const appendQuickPrompt = (prompt: string) => {
    const trimmedDraft = readComposerDraft().trim();
    const nextDraft = trimmedDraft ? `${trimmedDraft}, ${prompt}` : prompt;

    setComposerDraft(nextDraft, { focus: true });
  };

  const submitAssistantPrompt = (
    rawPrompt: string,
    options: {
      attachmentsOverride?: AssistantAttachment[];
      inputSource?: "typed" | "voice";
    } = {},
  ) => {
    const submissionAttachments = options.attachmentsOverride ?? attachments;
    const prompt = buildPromptWithAttachments(rawPrompt, submissionAttachments);
    const nextPendingActivity = pendingActivityForPrompt({
      attachments: submissionAttachments,
      messages: state.messages,
      rawPrompt,
    });

    if (!prompt || isAssistantGenerating || submissionInFlightRef.current) {
      return;
    }

    const formData = new FormData();
    const { createdAt, submissionId, submittedAtMs } =
      createAssistantSubmissionMetadata();

    formData.set("prompt", prompt);
    formData.set("threadId", state.threadId ?? "");
    formData.set("inputSource", options.inputSource ?? "typed");
    submissionAttachments.forEach((attachment) => {
      if (attachment.file) {
        formData.append("assistantFiles", attachment.file, attachment.name);
      }
    });

    submissionInFlightRef.current = true;
    setOptimisticMessage({
      content: prompt,
      createdAt,
      id: `optimistic-user-${submissionId}`,
      role: "user",
      submittedAtMs,
    });
    setPendingActivity(nextPendingActivity);
    setComposerDraft("");
    if (!options.attachmentsOverride) {
      setAttachments([]);
    }
    setVoiceStatus(null);
    startSubmitTransition(() => {
      formAction(formData);
    });
  };

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isListening) {
      stopVoiceRecording("send");
      return;
    }

    if (isTranscribing) {
      return;
    }

    submitAssistantPrompt(readComposerDraft());
  };

  const chooseAttachments = () => {
    fileInputRef.current?.click();
  };

  const handleAttachmentChange = async () => {
    const files = Array.from(fileInputRef.current?.files ?? []);

    if (files.length === 0) {
      return;
    }

    const nextAttachments = await Promise.all(
      files.map(fileToAssistantAttachment),
    );

    setAttachments((currentAttachments) => [
      ...currentAttachments,
      ...nextAttachments,
    ]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== id),
    );
  };

  const submitImageEdit = (
    prompt: string,
    editAttachments: AssistantAttachment[],
  ) => {
    submitAssistantPrompt(prompt, {
      attachmentsOverride: editAttachments,
      inputSource: "typed",
    });
    setExpandedImage(null);
  };

  const stopRecordingTracks = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  const stopVoiceAnalysis = () => {
    if (analyserAnimationRef.current !== null) {
      window.cancelAnimationFrame(analyserAnimationRef.current);
      analyserAnimationRef.current = null;
    }

    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setVoiceLevel(0);
  };

  const startVoiceAnalysis = (stream: MediaStream) => {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    try {
      const audioContext = new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      const data = new Uint8Array(analyser.fftSize);

      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      audioContextRef.current = audioContext;

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;

        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }

        const rms = Math.sqrt(sum / data.length);
        setVoiceLevel(Math.min(1, rms * 5));
        analyserAnimationRef.current = window.requestAnimationFrame(tick);
      };

      tick();
    } catch {
      stopVoiceAnalysis();
    }
  };

  const stopVoiceRecording = (completionMode: VoiceCompletionMode) => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      voiceCompletionModeRef.current = completionMode;
      setVoiceStatus(
        completionMode === "send"
          ? "Transcribing and sending..."
          : "Transcribing voice note...",
      );
      recorder.stop();
    }
  };

  const toggleVoiceInput = async () => {
    if (isListening) {
      stopVoiceRecording("draft");
      return;
    }

    if (isTranscribing) {
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceStatus("Voice recording is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      voiceCompletionModeRef.current = "draft";
      audioChunksRef.current = [];
      recordingStartedAtRef.current = currentTimestampMs();
      setRecordingElapsedMs(0);
      startVoiceAnalysis(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        mediaRecorderRef.current = null;
        recordingStartedAtRef.current = null;
        audioChunksRef.current = [];
        stopRecordingTracks();
        stopVoiceAnalysis();
        setIsListening(false);
        setIsTranscribing(false);
        setRecordingElapsedMs(0);
        setVoiceStatus("Voice recording failed. Try again.");
      };

      recorder.onstop = async () => {
        const completionMode = voiceCompletionModeRef.current;
        const chunks = audioChunksRef.current;
        const durationMs = recordingStartedAtRef.current
          ? currentTimestampMs() - recordingStartedAtRef.current
          : null;
        const audioType = recorder.mimeType || mimeType || "audio/webm";

        mediaRecorderRef.current = null;
        recordingStartedAtRef.current = null;
        audioChunksRef.current = [];
        stopRecordingTracks();
        stopVoiceAnalysis();
        setIsListening(false);
        setRecordingElapsedMs(0);
        voiceCompletionModeRef.current = "draft";

        if (chunks.length === 0) {
          setVoiceStatus("No speech was captured.");
          return;
        }

        const audioBlob = new Blob(chunks, { type: audioType });

        setIsTranscribing(true);
        setVoiceStatus("Transcribing voice note...");

        try {
          const transcript = await transcribeVoiceBlob(audioBlob, durationMs);

          setIsTranscribing(false);
          setVoiceStatus(null);

          if (completionMode === "send") {
            submitAssistantPrompt(transcript, { inputSource: "voice" });
            return;
          }

          setComposerDraft(
            mergeTranscriptIntoDraft(readComposerDraft(), transcript),
            {
              focus: true,
            },
          );
        } catch (error) {
          setIsTranscribing(false);
          setVoiceStatus(
            error instanceof Error
              ? error.message
              : "Unable to transcribe voice note.",
          );
        }
      };

      recorder.start();
      setIsListening(true);
      setVoiceStatus("Recording...");
    } catch (error) {
      mediaRecorderRef.current = null;
      recordingStartedAtRef.current = null;
      audioChunksRef.current = [];
      stopRecordingTracks();
      stopVoiceAnalysis();
      setIsListening(false);
      setRecordingElapsedMs(0);
      setVoiceStatus(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone permission was blocked."
          : "Unable to start voice recording.",
      );
    }
  };

  const applyRefreshedLink = (result: AssistantResourcePreviewResult) => {
    const refreshedLink = result.refreshedLink;

    if (!refreshedLink) {
      return;
    }

    setLinkOverrides((currentOverrides) => ({
      ...currentOverrides,
      [refreshedLink.href]: {
        ...currentOverrides[refreshedLink.href],
        ...refreshedLink,
      },
    }));
  };

  const openResourcePreview = async (link: AssistantLink) => {
    if (!isPreviewableHref(link.href)) {
      return;
    }

    const cachedResult = previewCacheRef.current.get(link.href);

    if (cachedResult?.preview) {
      setPreviewState({
        preview: cachedResult.preview,
        status: "ready",
      });
    } else {
      setPreviewState({
        href: link.href,
        status: "loading",
        title: link.label,
      });
    }

    const result = await getAssistantResourcePreviewAction(link.href);
    previewCacheRef.current.set(link.href, result);
    applyRefreshedLink(result);

    if (result.preview) {
      setPreviewState({
        preview: result.preview,
        status: "ready",
      });
      return;
    }

    setPreviewState({
      error: result.error ?? "Unable to load this Assistant preview.",
      href: link.href,
      status: "error",
      title: link.label,
    });
  };

  const runPreviewAction = async (
    actionId: string,
    href: string,
    operation: "approve" | "approve_execute" | "execute",
  ) => {
    setPreviewActionId(`${operation}:${actionId}`);

    const result = await runAssistantResourceActionAction({
      actionId,
      href,
      operation,
    });

    setPreviewActionId(null);
    applyRefreshedLink(result);

    if (result.preview) {
      previewCacheRef.current.set(href, result);
      setPreviewState({
        preview: result.preview,
        status: "ready",
      });
      return;
    }

    setPreviewState({
      error: result.error ?? "Unable to update this Assistant preview.",
      href,
      status: "error",
      title: "Preview update failed",
    });
  };

  const saveDraftReply = async ({
    actionId,
    body,
    href,
    subject,
  }: {
    actionId: string;
    body: string;
    href: string;
    subject: string;
  }) => {
    setPreviewActionId(`save:${actionId}`);

    const result = await updateAssistantDraftReplyAction({
      actionId,
      body,
      href,
      subject,
    });

    setPreviewActionId(null);
    applyRefreshedLink(result);

    if (result.preview) {
      previewCacheRef.current.set(href, result);
      setPreviewState({
        preview: result.preview,
        status: "ready",
      });
      return true;
    }

    setPreviewState({
      error: result.error ?? "Unable to save this draft reply.",
      href,
      status: "error",
      title: "Draft save failed",
    });
    return false;
  };

  const sendManualReply = async ({
    body,
    channelType,
    href,
    subject,
  }: {
    body: string;
    channelType: string;
    href: string;
    subject: string;
  }) => {
    setPreviewActionId(`manual:${href}`);

    const result = await sendAssistantManualReplyAction({
      body,
      channelType,
      href,
      subject,
    });

    setPreviewActionId(null);
    applyRefreshedLink(result);

    if (result.preview) {
      setPreviewState({
        preview: result.preview,
        status: "ready",
      });
      return;
    }

    setPreviewState({
      error: result.error ?? "Unable to send this manual reply.",
      href,
      status: "error",
      title: "Manual reply failed",
    });
  };

  useEffect(() => {
    const chat = chatRef.current;

    if (!chat) {
      return;
    }

    const scrollToBottom = () => {
      chat.scrollTop = chat.scrollHeight;
    };

    scrollToBottom();
    const animationFrame = window.requestAnimationFrame(scrollToBottom);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isAssistantGenerating, state.threadId, visibleMessages.length]);

  useEffect(() => {
    const currentLastMessageId = lastMessageId(state.messages);

    if (
      currentLastMessageId !== previousLastMessageIdRef.current ||
      state.error
    ) {
      setOptimisticMessage(null);
      setPendingActivity(null);
      submissionInFlightRef.current = false;
    }

    previousLastMessageIdRef.current = currentLastMessageId;
  }, [state.error, state.messages]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }

      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      stopVoiceAnalysis();
    };
  }, []);

  useEffect(() => {
    if (!isListening) {
      return undefined;
    }

    const updateElapsed = () => {
      setRecordingElapsedMs(
        recordingStartedAtRef.current
          ? Date.now() - recordingStartedAtRef.current
          : 0,
      );
    };
    const interval = window.setInterval(updateElapsed, 250);

    updateElapsed();

    return () => window.clearInterval(interval);
  }, [isListening]);

  useEffect(() => {
    const promptInput = promptInputRef.current;

    if (!promptInput) {
      return undefined;
    }

    const submitOnEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      promptInput.form?.requestSubmit();
    };

    promptInput.addEventListener("keydown", submitOnEnter);

    return () => promptInput.removeEventListener("keydown", submitOnEnter);
  }, []);

  const isPreviewOpen = previewState.status !== "closed";

  return (
    <section
      className={`assistant-workspace${
        isPreviewOpen ? " has-preview" : " has-activity"
      }`}
    >
      <section className="panel assistant-command-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Assistant</p>
            <h2>Kyro command layer</h2>
          </div>
          <span className="pill">Local model</span>
        </div>

        <div className="assistant-chat" aria-live="polite" ref={chatRef}>
          {visibleMessages.map((message) => (
            <div className={`assistant-turn ${message.role}`} key={message.id}>
              <article className={`assistant-message ${message.role}`}>
                <div className="assistant-message-meta">
                  <strong>
                    {message.role === "assistant" ? "Kyro" : "You"}
                  </strong>
                  {message.createdAt ? (
                    <time
                      dateTime={message.createdAt}
                      title={formatFullMessageTime(message.createdAt)}
                    >
                      {formatMessageTime(message.createdAt)}
                    </time>
                  ) : null}
                  <AssistantProviderPill message={message} />
                </div>
                <AssistantMessageBody
                  linkOverrides={linkOverrides}
                  message={message}
                />
              </article>
              <AssistantMessageBlocks
                linkOverrides={linkOverrides}
                memorySuggestionStatuses={memorySuggestionStatuses}
                message={message}
                onOpenImagePreview={setExpandedImage}
                onOpenPreview={openResourcePreview}
                onStartOutboundCall={startOutboundCall}
                onUpdateMemorySuggestion={updateMemorySuggestion}
                outboundCallStatuses={outboundCallStatuses}
              />
              <AssistantMessageLinks
                linkOverrides={linkOverrides}
                message={message}
                onOpenPreview={openResourcePreview}
              />
            </div>
          ))}
          {isAssistantGenerating ? (
            <AssistantTypingIndicator activity={pendingActivity} />
          ) : null}
        </div>

        {state.error ? <p className="form-alert error">{state.error}</p> : null}

        <div className="assistant-suggestions">
          {quickPrompts.map((prompt) => (
            <button
              className="filter-pill"
              key={prompt}
              onClick={() => appendQuickPrompt(prompt)}
              title={prompt}
              type="button"
            >
              {quickPromptLabel(prompt)}
            </button>
          ))}
        </div>

        <form className="assistant-input-form" onSubmit={submitMessage}>
          <input name="threadId" type="hidden" value={state.threadId ?? ""} />
          <input
            ref={fileInputRef}
            className="assistant-file-input"
            multiple
            onChange={handleAttachmentChange}
            type="file"
          />
          <div className="assistant-input-row">
            <button
              aria-label="Attach files"
              className="assistant-tool-button"
              disabled={isAssistantGenerating || isTranscribing}
              onClick={chooseAttachments}
              title="Attach files"
              type="button"
            >
              <PaperclipIcon />
            </button>
            <textarea
              ref={promptInputRef}
              className="assistant-prompt-input"
              autoComplete="off"
              disabled={isAssistantGenerating || isVoiceBusy}
              name="prompt"
              placeholder="Ask Kyro about leads, quotes, customers, or next actions..."
              rows={1}
            />
            <button
              aria-label={
                isListening
                  ? "Stop recording and edit transcript"
                  : isTranscribing
                    ? "Transcribing voice note"
                    : "Start voice input"
              }
              aria-pressed={isListening}
              className={
                isListening
                  ? "assistant-tool-button active"
                  : "assistant-tool-button"
              }
              disabled={isAssistantGenerating || isTranscribing}
              onClick={toggleVoiceInput}
              title={
                isListening
                  ? "Stop recording and edit transcript"
                  : isTranscribing
                    ? "Transcribing voice note"
                    : "Start voice input"
              }
              type="button"
            >
              {isListening ? <StopIcon /> : <MicrophoneIcon />}
            </button>
            <button
              className="primary-button"
              disabled={isAssistantGenerating || isTranscribing}
              title={isListening ? "Transcribe and send voice note" : undefined}
              type="submit"
            >
              {isAssistantGenerating
                ? "Sending"
                : isTranscribing
                  ? "Transcribing"
                  : isListening
                    ? "Send voice"
                    : "Send"}
            </button>
          </div>
          {attachments.length > 0 || voiceStatus ? (
            <div className="assistant-composer-meta">
              {attachments.map((attachment) => (
                <button
                  className="assistant-attachment-pill"
                  key={attachment.id}
                  onClick={() => removeAttachment(attachment.id)}
                  title="Remove attachment"
                  type="button"
                >
                  {attachment.name}
                  <span>{formatBytes(attachment.size)}</span>
                </button>
              ))}
              {voiceStatus ? (
                <VoiceStatus
                  elapsedMs={recordingElapsedMs}
                  isListening={isListening}
                  isVoiceBusy={isVoiceBusy}
                  level={voiceLevel}
                  status={voiceStatus}
                />
              ) : null}
            </div>
          ) : null}
        </form>

        <AssistantDevDiagnostics state={state} />
      </section>

      {isPreviewOpen ? (
        <AssistantPreviewPane
          actionPendingId={previewActionId}
          engineError={initialPreviewEngineError}
          engineMessage={initialPreviewEngineMessage}
          onClose={() => setPreviewState({ status: "closed" })}
          onRunAction={runPreviewAction}
          onSaveDraftReply={saveDraftReply}
          onSendManualReply={sendManualReply}
          state={previewState}
        />
      ) : (
        <AssistantExternalActivityPane
          items={externalActivityItems}
          onOpenPreview={openResourcePreview}
        />
      )}
      <AssistantImageLightbox
        disabled={isAssistantGenerating}
        image={expandedImage}
        key={expandedImage?.fileId ?? "closed"}
        onClose={() => setExpandedImage(null)}
        onSubmitEdit={submitImageEdit}
      />
    </section>
  );
}

function AssistantImageLightbox({
  disabled,
  image,
  onClose,
  onSubmitEdit,
}: {
  disabled: boolean;
  image: GeneratedImage | null;
  onClose: () => void;
  onSubmitEdit: (
    prompt: string,
    attachments: AssistantAttachment[],
  ) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageElementRef = useRef<HTMLImageElement>(null);
  const isDrawingRef = useRef(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [hasAnnotation, setHasAnnotation] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isPreparingEdit, setIsPreparingEdit] = useState(false);

  const resizeAnnotationCanvas = () => {
    const canvas = canvasRef.current;
    const imageElement = imageElementRef.current;

    if (!canvas || !imageElement) {
      return;
    }

    const rect = imageElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const context = canvas.getContext("2d");

    if (context) {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 5;
      context.strokeStyle = "#ff2b57";
    }

    setHasAnnotation(false);
  };

  const clearAnnotation = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasAnnotation(false);
  };

  const pointerPosition = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isEditing) {
      return;
    }

    const context = event.currentTarget.getContext("2d");

    if (!context) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;

    const point = pointerPosition(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasAnnotation(true);
  };

  const continueDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !isEditing) {
      return;
    }

    const context = event.currentTarget.getContext("2d");

    if (!context) {
      return;
    }

    event.preventDefault();
    const point = pointerPosition(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasAnnotation(true);
  };

  const stopDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) {
      return;
    }

    isDrawingRef.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const sendImageEdit = async () => {
    if (!image || disabled || isPreparingEdit) {
      return;
    }

    const request = editPrompt.trim();

    if (!request && !hasAnnotation) {
      setEditError("Add an edit note or draw on the image before sending.");
      return;
    }

    setEditError(null);
    setIsPreparingEdit(true);

    try {
      const attachments: AssistantAttachment[] = [
        await attachmentFromImageUrl({
          contentType: image.contentType,
          filename: `source-${image.filename}`,
          href: image.href,
        }),
      ];

      if (hasAnnotation) {
        attachments.push(
          await attachmentFromCanvas({
            canvas: canvasRef.current,
            filename: `markup-${image.fileId}.png`,
          }),
        );
      }

      const prompt = [
        "Edit the previously generated image using this user feedback.",
        `User edit request: ${
          request || "Use the attached red markup as the edit instructions."
        }`,
        `Kyro file ID: ${image.fileId}`,
        hasAnnotation
          ? "The attached markup image is a transparent red annotation layer showing the requested changes."
          : null,
        "Use the original generated image as the source/reference. Generate and save the edited image; do not only describe the edit.",
      ]
        .filter(Boolean)
        .join("\n");

      onSubmitEdit(prompt, attachments);
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : "Unable to prepare the annotated image edit.",
      );
    } finally {
      setIsPreparingEdit(false);
    }
  };

  useEffect(() => {
    if (!isEditing) {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(resizeAnnotationCanvas);

    window.addEventListener("resize", resizeAnnotationCanvas);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resizeAnnotationCanvas);
    };
  }, [isEditing]);

  if (!image) {
    return null;
  }

  return (
    <div
      aria-label="Generated image preview"
      aria-modal="true"
      className="assistant-image-lightbox"
      role="dialog"
    >
      <button
        aria-label="Close image preview"
        className="assistant-image-lightbox-backdrop"
        onClick={onClose}
        type="button"
      />
      <article className="assistant-image-lightbox-panel">
        <div className="assistant-image-lightbox-header">
          <div>
            <p className="eyebrow">Generated image</p>
          </div>
          <div className="row-actions">
            <button
              className="assistant-generated-image-action"
              disabled={disabled || isPreparingEdit}
              onClick={() => setIsEditing((current) => !current)}
              type="button"
            >
              {isEditing ? "Done marking" : "Edit image"}
            </button>
            <a
              className="assistant-generated-image-action"
              href={image.downloadHref}
            >
              Download
            </a>
            <button
              className="assistant-generated-image-action"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
        <div className="assistant-image-lightbox-media">
          <div
            className={
              isEditing
                ? "assistant-image-annotation-stage is-editing"
                : "assistant-image-annotation-stage"
            }
          >
            <Image
              alt={image.alt}
              height={1536}
              onLoad={resizeAnnotationCanvas}
              ref={imageElementRef}
              src={image.href}
              unoptimized
              width={1536}
            />
            <canvas
              aria-label="Draw red markup on this image"
              className="assistant-image-annotation-canvas"
              onPointerCancel={stopDrawing}
              onPointerDown={startDrawing}
              onPointerLeave={stopDrawing}
              onPointerMove={continueDrawing}
              onPointerUp={stopDrawing}
              ref={canvasRef}
            />
          </div>
        </div>
        {isEditing ? (
          <div className="assistant-image-edit-panel">
            <label>
              <span>Edit note</span>
              <textarea
                disabled={disabled || isPreparingEdit}
                onChange={(event) => setEditPrompt(event.target.value)}
                placeholder="Describe what you want changed, or draw directly on the image."
                rows={3}
                value={editPrompt}
              />
            </label>
            <div className="assistant-image-edit-actions">
              <span className="assistant-image-edit-hint">
                Red pen markup will be sent with the original image.
              </span>
              <div className="row-actions">
                <button
                  className="assistant-generated-image-action"
                  disabled={!hasAnnotation || disabled || isPreparingEdit}
                  onClick={clearAnnotation}
                  type="button"
                >
                  Clear pen
                </button>
                <button
                  className="assistant-generated-image-action primary"
                  disabled={disabled || isPreparingEdit}
                  onClick={sendImageEdit}
                  type="button"
                >
                  {isPreparingEdit ? "Preparing" : "Send edit"}
                </button>
              </div>
            </div>
            {editError ? <p className="form-alert error">{editError}</p> : null}
          </div>
        ) : null}
      </article>
    </div>
  );
}

async function attachmentFromImageUrl({
  contentType,
  filename,
  href,
}: {
  contentType: string | null;
  filename: string;
  href: string;
}) {
  const response = await fetch(href);

  if (!response.ok) {
    throw new Error("Unable to load the original image for editing.");
  }

  const blob = await response.blob();
  const file = new File([blob], safeAssistantFilename(filename, "image.png"), {
    type: blob.type || contentType || "image/png",
  });

  return fileToAssistantAttachment(file);
}

async function attachmentFromCanvas({
  canvas,
  filename,
}: {
  canvas: HTMLCanvasElement | null;
  filename: string;
}) {
  if (!canvas) {
    throw new Error("Unable to read the image markup.");
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );

  if (!blob) {
    throw new Error("Unable to export the image markup.");
  }

  return fileToAssistantAttachment(
    new File([blob], safeAssistantFilename(filename, "markup.png"), {
      type: "image/png",
    }),
  );
}

function safeAssistantFilename(value: string, fallback: string) {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

  return cleaned || fallback;
}

function buildPromptWithAttachments(
  rawPrompt: string,
  attachments: AssistantAttachment[],
) {
  const prompt = rawPrompt.trim();

  if (attachments.length === 0) {
    return prompt;
  }

  const attachmentContext = attachments
    .map((attachment) => {
      const header = `File: ${attachment.name} (${attachment.type || "unknown type"}, ${formatBytes(attachment.size)})`;

      if (!attachment.previewText) {
        return `${header}\nContent: File selected, but browser-side text extraction is not available for this file type yet.`;
      }

      return `${header}\nContent preview:\n${attachment.previewText}`;
    })
    .join("\n\n");

  return `${prompt || "Please review the attached file context."}\n\nAttached file context:\n${attachmentContext}`;
}

function pendingActivityForPrompt({
  attachments,
  messages,
  rawPrompt,
}: {
  attachments: AssistantAttachment[];
  messages: AssistantThreadMessage[];
  rawPrompt: string;
}): PendingAssistantActivity {
  return looksLikePendingImageRequest(rawPrompt, attachments, messages)
    ? "image_generation"
    : null;
}

function looksLikePendingImageRequest(
  rawPrompt: string,
  attachments: AssistantAttachment[],
  messages: AssistantThreadMessage[],
) {
  const text = rawPrompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return attachments.some((attachment) =>
      attachment.type.toLowerCase().startsWith("image/"),
    );
  }

  const hasVisualNoun =
    /\b(image|picture|photo|render|rendering|visual|mockup|mock-up|concept|graphic|poster|flyer|banner|hero|logo)\b/.test(
      text,
    );
  const hasGenerationVerb =
    /\b(create|generate|make|render|draw|produce|design|visualise|visualize|mock|mockup|mock-up)\b/.test(
      text,
    );
  const hasEditVerb =
    /\b(edit|change|update|adjust|modify|redo|regenerate|rework|revise|turn|make)\b/.test(
      text,
    );
  const hasImageAttachment = attachments.some((attachment) =>
    attachment.type.toLowerCase().startsWith("image/"),
  );

  if (hasVisualNoun && (hasGenerationVerb || hasEditVerb)) {
    return true;
  }

  if (hasImageAttachment && (hasGenerationVerb || hasEditVerb || hasVisualNoun)) {
    return true;
  }

  const recentGeneratedImage = messages
    .slice(-8)
    .some(
      (message) =>
        generatedImageBlocksForMessage(message).length > 0 ||
        /\bgenerated (?:an |the )?image\b/i.test(message.content),
    );

  return recentGeneratedImage && hasEditVerb;
}

function resizePromptInput(promptInput: HTMLTextAreaElement | null) {
  if (!promptInput) {
    return;
  }

  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 150)}px`;
}

function createAssistantSubmissionMetadata() {
  const submittedAtMs = currentTimestampMs();
  const createdAt = new Date(submittedAtMs).toISOString();
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return {
    createdAt,
    submissionId: `${submittedAtMs}-${randomId}`,
    submittedAtMs,
  };
}

function currentTimestampMs() {
  return Date.now();
}

function mergeTranscriptIntoDraft(currentDraft: string, transcript: string) {
  const trimmedDraft = currentDraft.trim();
  const trimmedTranscript = transcript.trim();

  if (!trimmedDraft) {
    return trimmedTranscript;
  }

  if (!trimmedTranscript) {
    return trimmedDraft;
  }

  return `${trimmedDraft} ${trimmedTranscript}`;
}

function formatRecordingTime(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function VoiceStatus({
  elapsedMs,
  isListening,
  isVoiceBusy,
  level,
  status,
}: {
  elapsedMs: number;
  isListening: boolean;
  isVoiceBusy: boolean;
  level: number;
  status: string;
}) {
  return (
    <span className={isVoiceBusy ? "voice-status active" : "voice-status"}>
      {isListening ? (
        <>
          <VoiceLevelMeter level={level} />
          <strong>{formatRecordingTime(elapsedMs)}</strong>
        </>
      ) : null}
      <span>{status}</span>
    </span>
  );
}

function VoiceLevelMeter({ level }: { level: number }) {
  const normalizedLevel = Math.min(1, Math.max(0.08, level || 0.08));
  const multipliers = [0.45, 0.78, 1, 0.62, 0.9];

  return (
    <span className="voice-level-meter" aria-hidden="true">
      {multipliers.map((multiplier, index) => (
        <span
          key={index}
          style={{
            transform: `scaleY(${Math.min(1, 0.22 + normalizedLevel * multiplier)})`,
          }}
        />
      ))}
    </span>
  );
}

function preferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"].find(
      (mimeType) => MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

function audioExtensionForType(mimeType: string) {
  if (mimeType.includes("mp4")) {
    return "m4a";
  }

  if (mimeType.includes("mpeg")) {
    return "mp3";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  return "webm";
}

function jsonErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return null;
}

async function transcribeVoiceBlob(audioBlob: Blob, durationMs: number | null) {
  const formData = new FormData();
  const extension = audioExtensionForType(audioBlob.type);
  const audioFile = new File([audioBlob], `kyro-voice.${extension}`, {
    type: audioBlob.type || "audio/webm",
  });

  formData.set("audio", audioFile);

  if (durationMs) {
    formData.set("durationMs", String(durationMs));
  }

  const response = await fetch("/api/assistant/transcribe", {
    body: formData,
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(
      jsonErrorMessage(payload) ?? "Unable to transcribe voice note.",
    );
  }

  const data =
    payload && typeof payload === "object" && "data" in payload
      ? payload.data
      : null;
  const text =
    data && typeof data === "object" && "text" in data ? data.text : null;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("The transcription came back empty.");
  }

  return text.trim();
}

async function fileToAssistantAttachment(
  file: File,
): Promise<AssistantAttachment> {
  const shouldReadText =
    file.size <= MAX_ATTACHMENT_TEXT_BYTES && isTextLikeFile(file);
  const previewText = shouldReadText ? await file.text() : null;

  return {
    file,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${file.name}-${file.lastModified}-${Math.random()}`,
    name: file.name,
    previewText: previewText?.slice(0, MAX_ATTACHMENT_TEXT_BYTES) ?? null,
    size: file.size,
    type: file.type,
  };
}

function isTextLikeFile(file: File) {
  const lowerName = file.name.toLowerCase();

  return (
    file.type.startsWith("text/") ||
    [".csv", ".json", ".log", ".md", ".txt", ".xml", ".yaml", ".yml"].some(
      (extension) => lowerName.endsWith(extension),
    )
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <path
        d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function MicrophoneIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <path
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
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
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <rect
        height="16"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="2"
        width="16"
        x="4"
        y="4"
      />
    </svg>
  );
}

function AssistantProviderPill({
  message,
}: {
  message: AssistantThreadMessage;
}) {
  if (message.role !== "assistant") {
    return null;
  }

  if (message.fallbackReason) {
    return (
      <span
        className="assistant-provider-pill fallback"
        title={message.fallbackReason}
      >
        Fallback
      </span>
    );
  }

  if (!message.provider) {
    return null;
  }

  return (
    <span
      className="assistant-provider-pill"
      title={message.model ?? message.provider}
    >
      {formatProviderLabel(message.provider)}
    </span>
  );
}

function AssistantTypingIndicator({
  activity,
}: {
  activity: PendingAssistantActivity;
}) {
  const label = activity === "image_generation" ? "Generating image" : null;

  return (
    <div className="assistant-turn assistant">
      <article
        aria-label={label ? `Kyro is ${label.toLowerCase()}` : "Kyro is typing"}
        className={
          label
            ? "assistant-typing-message with-label"
            : "assistant-typing-message"
        }
      >
        <span aria-hidden="true" className="typing-dots">
          <span />
          <span />
          <span />
        </span>
        {label ? <span className="typing-status-label">{label}</span> : null}
      </article>
    </div>
  );
}

function AssistantExternalActivityPane({
  items,
  onOpenPreview,
}: {
  items: AssistantExternalActivityItem[];
  onOpenPreview: (link: AssistantLink) => void;
}) {
  return (
    <aside className="panel assistant-external-activity">
      <header className="assistant-activity-header">
        <div>
          <h2>Kyro activity</h2>
        </div>
        <span className="pill">{items.length} shown</span>
      </header>

      {items.length > 0 ? (
        <div className="assistant-activity-list">
          {items.map((item) => {
            const content = (
              <>
                <span className={`assistant-activity-dot ${item.tone}`} />
                <div className="assistant-activity-copy">
                  <div>
                    <span className="assistant-activity-title-row">
                      <strong>{item.title}</strong>
                      <span>{item.meta}</span>
                    </span>
                    <time
                      dateTime={item.at}
                      title={formatFullMessageTime(item.at)}
                    >
                      {formatMessageTime(item.at)}
                    </time>
                  </div>
                  {item.subject ? (
                    <p className="assistant-activity-subject">
                      {item.subject}
                    </p>
                  ) : null}
                  <p
                    className={`assistant-activity-preview${
                      item.subject ? "" : " no-subject"
                    }`}
                  >
                    {item.preview}
                  </p>
                </div>
              </>
            );

            return item.href && isPreviewableHref(item.href) ? (
              <button
                className="assistant-activity-row"
                key={item.id}
                onClick={() =>
                  onOpenPreview({
                    href: item.href ?? "",
                    label: item.title,
                    meta: item.meta,
                  })
                }
                type="button"
              >
                {content}
              </button>
            ) : item.href ? (
              <Link
                className="assistant-activity-row"
                href={item.href}
                key={item.id}
                prefetch={false}
              >
                {content}
              </Link>
            ) : (
              <article className="assistant-activity-row" key={item.id}>
                {content}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-copy">
          External email, SMS, and phone activity will appear here once Kyro
          starts handling it outside the chat thread.
        </p>
      )}
    </aside>
  );
}

function AssistantDevDiagnostics({ state }: { state: AssistantThreadState }) {
  return (
    <details className="assistant-dev-diagnostics">
      <summary>
        <span>Dev diagnostics</span>
        <small>Memory, provider, and scope</small>
      </summary>
      <div className="assistant-dev-grid">
        <article>
          <p className="eyebrow">Memory</p>
          <h3>Thread context</h3>
          <div className="detail-list">
            <div>
              <span>Thread</span>
              <strong>{state.threadId ? "Persistent" : "Not started"}</strong>
            </div>
            <div>
              <span>Summary</span>
              <strong>{state.summary ? "Saved" : "Not built yet"}</strong>
            </div>
            <div>
              <span>Memories</span>
              <strong>{state.memories?.length ?? 0}</strong>
            </div>
          </div>
          {state.summary ? <p className="panel-copy">{state.summary}</p> : null}
        </article>

        <article>
          <p className="eyebrow">Provider</p>
          <h3>Model routing</h3>
          <div className="detail-list">
            <div>
              <span>Current mode</span>
              <strong>Local Ollama first</strong>
            </div>
            <div>
              <span>Fallback</span>
              <strong>Deterministic command result</strong>
            </div>
            <div>
              <span>Writes allowed</span>
              <strong>Known tools and approval gates</strong>
            </div>
          </div>
        </article>

        <article>
          <p className="eyebrow">Scope</p>
          <h3>Safe commands</h3>
          <div className="module-list">
            <span>Work queue</span>
            <span>Inquiry lookup</span>
            <span>Quote lookup</span>
            <span>Contact summaries</span>
            <span>Draft creation</span>
            <span>Remember explicit facts</span>
            <span>Approve memory suggestions</span>
            <span>Known UI blocks</span>
          </div>
        </article>
      </div>
    </details>
  );
}

function AssistantMessageLinks({
  linkOverrides,
  message,
  onOpenPreview,
}: {
  linkOverrides: Record<string, AssistantLink>;
  message: AssistantThreadMessage;
  onOpenPreview: (link: AssistantLink) => void;
}) {
  if (message.uiBlocks?.length || !message.links?.length) {
    return null;
  }
  const visibleLinks = message.links
    .map((link) => mergeAssistantLink(link, linkOverrides))
    .filter((link) => shouldRenderAssistantLink(message, link));

  if (visibleLinks.length === 0) {
    return null;
  }

  return (
    <div className="assistant-links">
      {visibleLinks.map((link) => (
        <AssistantResourceCard
          key={`${message.id}-${link.href}`}
          link={link}
          onOpenPreview={onOpenPreview}
        />
      ))}
    </div>
  );
}

function AssistantResourceCard({
  link,
  onOpenPreview,
}: {
  link: AssistantLink;
  onOpenPreview: (link: AssistantLink) => void;
}) {
  if (isExternalHref(link.href)) {
    return (
      <a
        className="assistant-link-card"
        href={link.href}
        rel="noreferrer"
        target="_blank"
      >
        <strong>{link.label}</strong>
        {link.meta ? <span>{link.meta}</span> : null}
      </a>
    );
  }

  if (isPreviewableHref(link.href)) {
    return (
      <button
        className="assistant-link-card"
        onClick={() => onOpenPreview(link)}
        type="button"
      >
        <strong>{link.label}</strong>
        {link.meta ? <span>{link.meta}</span> : null}
      </button>
    );
  }

  return (
    <Link className="assistant-link-card" href={link.href} prefetch={false}>
      <strong>{link.label}</strong>
      {link.meta ? <span>{link.meta}</span> : null}
    </Link>
  );
}

function AssistantMessageBody({
  linkOverrides,
  message,
}: {
  linkOverrides: Record<string, AssistantLink>;
  message: AssistantThreadMessage;
}) {
  const display = assistantMessageDisplay(message, linkOverrides);

  return (
    <>
      {display.text ? <p>{display.text}</p> : null}
      {display.attachments.length > 0 ? (
        <AssistantInlineAttachments attachments={display.attachments} />
      ) : null}
    </>
  );
}

function AssistantInlineAttachments({
  attachments,
}: {
  attachments: AssistantDisplayAttachment[];
}) {
  return (
    <div className="assistant-message-attachments">
      {attachments.map((attachment) => {
        const body = (
          <>
            <span className="assistant-message-attachment-icon">
              <PaperclipIcon />
            </span>
            <span className="assistant-message-attachment-main">
              <strong>{attachment.name}</strong>
              <span>
                {[attachment.sizeLabel, attachment.contentType]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </>
        );

        return attachment.href ? (
          <a
            className="assistant-message-attachment"
            href={attachment.href}
            key={`${attachment.name}-${attachment.sizeLabel ?? "file"}`}
            rel="noreferrer"
            target="_blank"
          >
            {body}
          </a>
        ) : (
          <span
            className="assistant-message-attachment"
            key={`${attachment.name}-${attachment.sizeLabel ?? "file"}`}
          >
            {body}
          </span>
        );
      })}
    </div>
  );
}

function isExternalHref(href: string) {
  try {
    const url = new URL(href);

    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function mergeAssistantLink(
  link: AssistantLink,
  linkOverrides: Record<string, AssistantLink>,
) {
  const override = linkOverrides[link.href];

  return override ? { ...link, ...override } : link;
}

function lastMessageId(messages: AssistantThreadMessage[]) {
  return messages.at(-1)?.id ?? "";
}

function isOptimisticMessageSaved(
  messages: AssistantThreadMessage[],
  optimisticMessage: OptimisticAssistantMessage,
) {
  const optimisticContent = normalizeAssistantMessageContent(
    optimisticMessage.content,
  );

  return messages.some(
    (message) => {
      if (message.role !== "user" || message.id === optimisticMessage.id) {
        return false;
      }

      const persistedAtMs = Date.parse(message.createdAt ?? "");

      if (
        Number.isFinite(persistedAtMs) &&
        persistedAtMs < optimisticMessage.submittedAtMs - 2000
      ) {
        return false;
      }

      const persistedContent = normalizeAssistantMessageContent(message.content);

      return (
        persistedContent === optimisticContent ||
        persistedContent.startsWith(optimisticContent) ||
        optimisticContent.startsWith(persistedContent)
      );
    },
  );
}

function normalizeAssistantMessageContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

function generatedImageBlocksForMessage(
  message: AssistantThreadMessage,
): GeneratedImageBlock[] {
  const structuredBlocks =
    message.uiBlocks?.filter(
      (block): block is GeneratedImageBlock =>
        block.type === "generated_image",
    ) ?? [];

  if (structuredBlocks.length > 0) {
    return structuredBlocks;
  }

  const legacyBlock = legacyGeneratedImageBlockFromContent(message);

  return legacyBlock ? [legacyBlock] : [];
}

function legacyGeneratedImageBlockFromContent(
  message: AssistantThreadMessage,
): GeneratedImageBlock | null {
  if (message.role !== "assistant") {
    return null;
  }

  const links = [
    ...message.content.matchAll(
      /\[([^\]]+)\]\((\/api\/files\/([0-9a-f-]{36})(?:\?[^)]*)?)\)/gi,
    ),
  ]
    .map((match) => ({
      fileId: match[3],
      href: match[2],
      label: match[1],
    }))
    .filter(
      (link): link is { fileId: string; href: string; label: string } =>
        Boolean(link.fileId && link.href && link.label),
    );

  const imageLink = links.find(
    (link) =>
      /image|picture|photo|render|visual/i.test(link.label) ||
      /[?&]disposition=inline\b/i.test(link.href),
  );

  if (!imageLink) {
    return null;
  }

  const downloadLink = links.find(
    (link) =>
      link.fileId === imageLink.fileId &&
      (/\bdownload\b/i.test(link.label) ||
        !/[?&]disposition=inline\b/i.test(link.href)),
  );
  const downloadHref =
    downloadLink?.href.split("?")[0] ?? `/api/files/${imageLink.fileId}`;
  const href = /[?&]disposition=inline\b/i.test(imageLink.href)
    ? imageLink.href
    : `${downloadHref}?disposition=inline`;

  return {
    images: [
      {
        alt: "Generated image",
        contentType: "image/png",
        downloadHref,
        editMode: false,
        fileId: imageLink.fileId,
        filename: imageLink.label,
        href,
        meta: "Generated image",
        model: "unknown",
        prompt: message.content,
        provider: "kyro",
        quality: "generated",
        referenceCount: 0,
        size: "stored file",
      },
    ],
    title: "Generated image",
    type: "generated_image",
  };
}

function cleanGeneratedImageMessageContent(content: string) {
  const cleaned = content
    .replace(
      /\n?\s*Here(?:'|\u2019)?s your image:\s*\n?\s*\[[^\]]*image[^\]]*\]\(\/api\/files\/[^)]+\)\s*/gi,
      "\nThe image is attached below.",
    )
    .replace(
      /\[[^\]]*(?:download it|download image)[^\]]*\]\(\/api\/files\/[^)]+\)/gi,
      "download it from the image card",
    )
    .replace(
      /\[[^\]]*image[^\]]*\]\(\/api\/files\/[^)]+\)/gi,
      "the image below",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || "I generated the image and saved it to Kyro files.";
}

function assistantMessageDisplay(
  message: AssistantThreadMessage,
  linkOverrides: Record<string, AssistantLink>,
) {
  const content = assistantMessageContent(message, linkOverrides);

  return splitAssistantAttachmentContext(content);
}

function splitAssistantAttachmentContext(content: string): {
  attachments: AssistantDisplayAttachment[];
  text: string;
} {
  const markerPattern =
    /(?:^|\n{2,})(?:Attached file context|Stored Kyro attachment context):\n/gi;
  const markers = [...content.matchAll(markerPattern)];

  if (markers.length === 0) {
    return { attachments: [], text: content };
  }

  const firstMarker = markers[0];
  const text = content.slice(0, firstMarker.index ?? 0).trim();
  const contexts = markers.map((marker, index) => {
    const start = (marker.index ?? 0) + marker[0].length;
    const nextMarker = markers[index + 1];
    const end = nextMarker?.index ?? content.length;

    return content.slice(start, end).trim();
  });
  const attachments = uniqueDisplayAttachments(
    contexts.flatMap(parseAssistantAttachmentContext),
  );

  return {
    attachments,
    text:
      text === "Please review the attached file context." ||
      text === "Please review the stored Kyro attachment context."
        ? ""
        : text,
  };
}

function parseAssistantAttachmentContext(context: string) {
  return context
    .split(/\n{2,}/)
    .map(parseAssistantAttachmentBlock)
    .filter(
      (attachment): attachment is AssistantDisplayAttachment =>
        attachment !== null,
    );
}

function parseAssistantAttachmentBlock(
  block: string,
): AssistantDisplayAttachment | null {
  const lines = block.split(/\r?\n/).map((line) => line.trim());
  const fileLine = lines.find((line) => line.startsWith("File: "));

  if (!fileLine) {
    return null;
  }

  const parsedFile = parseAssistantFileLine(fileLine);

  if (!parsedFile) {
    return null;
  }

  const href =
    lines
      .find((line) => line.startsWith("Kyro file URL: "))
      ?.replace("Kyro file URL: ", "")
      .trim() || null;

  return {
    contentType: parsedFile.contentType,
    href,
    name: parsedFile.name,
    sizeLabel: parsedFile.sizeLabel,
  };
}

function parseAssistantFileLine(fileLine: string) {
  const value = fileLine.replace(/^File:\s+/, "").trim();
  const metadataStart = value.lastIndexOf(" (");

  if (metadataStart === -1 || !value.endsWith(")")) {
    return {
      contentType: null,
      name: value,
      sizeLabel: null,
    };
  }

  const name = value.slice(0, metadataStart).trim();
  const metadata = value.slice(metadataStart + 2, -1);
  const [contentType, sizeLabel] = metadata.split(",").map((part) => part.trim());

  return {
    contentType: contentType || null,
    name,
    sizeLabel: normalizeAttachmentSizeLabel(sizeLabel),
  };
}

function normalizeAttachmentSizeLabel(sizeLabel: string | undefined) {
  if (!sizeLabel) {
    return null;
  }

  const bytesMatch = sizeLabel.match(/^(\d+)\s+bytes?$/i);

  if (!bytesMatch) {
    return sizeLabel;
  }

  return formatBytes(Number(bytesMatch[1]));
}

function uniqueDisplayAttachments(attachments: AssistantDisplayAttachment[]) {
  const byKey = new Map<string, AssistantDisplayAttachment>();

  for (const attachment of attachments) {
    const key = [
      attachment.name.toLowerCase(),
      attachment.contentType?.toLowerCase() ?? "",
      attachment.sizeLabel ?? "",
    ].join("|");
    const existing = byKey.get(key);

    if (!existing || (!existing.href && attachment.href)) {
      byKey.set(key, attachment);
    }
  }

  return [...byKey.values()];
}

function assistantMessageContent(
  message: AssistantThreadMessage,
  linkOverrides: Record<string, AssistantLink>,
) {
  const content =
    generatedImageBlocksForMessage(message).length > 0
      ? cleanGeneratedImageMessageContent(message.content)
      : message.content;
  const links =
    message.links?.map((link) => mergeAssistantLink(link, linkOverrides)) ?? [];

  if (message.intent === "work_queue" && links.length > 0) {
    const visibleLinks = links.filter((link) =>
      shouldRenderAssistantLink(message, link),
    );

    if (visibleLinks.length !== links.length) {
      return visibleLinks.length > 0
        ? `Updated: ${visibleLinks.length} conversation${visibleLinks.length === 1 ? "" : "s"} still need attention in this work queue.`
        : "Updated: the shown work queue is clear.";
    }
  }

  const staleLink = message.links?.find(
    (link) =>
      link.meta &&
      linkOverrides[link.href]?.meta &&
      linkOverrides[link.href]?.meta !== link.meta,
  );

  if (!staleLink?.meta) {
    return content;
  }

  return content.replace(
    staleLink.meta,
    linkOverrides[staleLink.href]?.meta ?? staleLink.meta,
  );
}

function shouldRenderAssistantLink(
  message: Pick<AssistantThreadMessage, "intent">,
  link: AssistantLink,
) {
  if (
    message.intent === "work_queue" &&
    link.refresh?.kind === "conversation" &&
    link.refresh.liveWorkQueueVisible === false
  ) {
    return false;
  }

  return true;
}

function AssistantPreviewPane({
  actionPendingId,
  engineError,
  engineMessage,
  onClose,
  onRunAction,
  onSaveDraftReply,
  onSendManualReply,
  state,
}: {
  actionPendingId: string | null;
  engineError?: string;
  engineMessage?: string;
  onClose: () => void;
  onRunAction: (
    actionId: string,
    href: string,
    operation: "approve" | "approve_execute" | "execute",
  ) => void;
  onSaveDraftReply: (input: {
    actionId: string;
    body: string;
    href: string;
    subject: string;
  }) => Promise<boolean>;
  onSendManualReply: (input: {
    body: string;
    channelType: string;
    href: string;
    subject: string;
  }) => Promise<void>;
  state: PreviewState;
}) {
  if (state.status === "closed") {
    return null;
  }

  if (state.status === "ready" && state.preview.type === "contact") {
    const contactId = state.preview.profile.contact.id;
    const contactHref = (nextContactId: string) =>
      `/assistant?contactId=${encodeURIComponent(nextContactId)}`;

    return (
      <ContactProfilePanel
        className="assistant-inline-preview assistant-contact-profile-panel"
        engineError={engineError}
        engineMessage={engineMessage}
        onClose={onClose}
        profile={state.preview.profile}
        profileHref={contactHref}
        redirectTo={contactHref(contactId)}
        successHref={contactHref}
      />
    );
  }

  const title = state.status === "ready" ? state.preview.title : state.title;
  const href = state.status === "ready" ? state.preview.href : state.href;

  return (
    <section
      aria-label={`${title} preview`}
      className="panel assistant-inline-preview"
    >
      <header className="assistant-preview-header">
        <div>
          <p className="eyebrow">Assistant preview</p>
          <h2>{title}</h2>
        </div>
        <div className="row-actions">
          <Link
            className="secondary-button compact"
            href={href}
            prefetch={false}
          >
            Open full screen
          </Link>
          <button
            className="secondary-button compact"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </header>

      {state.status === "loading" ? (
        <div className="assistant-preview-empty">Loading preview...</div>
      ) : null}

      {state.status === "error" ? (
        <div className="assistant-preview-empty">
          <strong>Preview unavailable</strong>
          <span>{state.error}</span>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <AssistantPreviewContent
          actionPendingId={actionPendingId}
          onRunAction={onRunAction}
          onSaveDraftReply={onSaveDraftReply}
          onSendManualReply={onSendManualReply}
          preview={state.preview}
        />
      ) : null}
    </section>
  );
}

function AssistantPreviewContent({
  actionPendingId,
  onRunAction,
  onSaveDraftReply,
  onSendManualReply,
  preview,
}: {
  actionPendingId: string | null;
  onRunAction: (
    actionId: string,
    href: string,
    operation: "approve" | "approve_execute" | "execute",
  ) => void;
  onSaveDraftReply: (input: {
    actionId: string;
    body: string;
    href: string;
    subject: string;
  }) => Promise<boolean>;
  onSendManualReply: (input: {
    body: string;
    channelType: string;
    href: string;
    subject: string;
  }) => Promise<void>;
  preview: AssistantResourcePreview;
}) {
  if (preview.type === "conversation") {
    return (
      <ConversationPreview
        actionPendingId={actionPendingId}
        href={preview.href}
        onRunAction={onRunAction}
        onSaveDraftReply={onSaveDraftReply}
        onSendManualReply={onSendManualReply}
        profile={preview.profile}
      />
    );
  }

  if (preview.type === "quote") {
    return <QuotePreview profile={preview.profile} />;
  }

  if (preview.type === "voice_call") {
    return <VoiceCallPreview profile={preview.profile} />;
  }

  return <ContactPreview profile={preview.profile} />;
}

function ConversationPreview({
  actionPendingId,
  href,
  onRunAction,
  onSaveDraftReply,
  onSendManualReply,
  profile,
}: {
  actionPendingId: string | null;
  href: string;
  onRunAction: (
    actionId: string,
    href: string,
    operation: "approve" | "approve_execute" | "execute",
  ) => void;
  onSaveDraftReply: (input: {
    actionId: string;
    body: string;
    href: string;
    subject: string;
  }) => Promise<boolean>;
  onSendManualReply: (input: {
    body: string;
    channelType: string;
    href: string;
    subject: string;
  }) => Promise<void>;
  profile: Extract<
    AssistantResourcePreview,
    { type: "conversation" }
  >["profile"];
}) {
  const messages = profile.messages.slice(-12);
  const actionQueue = profile.actions.filter((action) =>
    isAssistantQueueAction(action),
  );

  return (
    <div className="assistant-preview-body">
      <div className="assistant-preview-status-row">
        <span className="pill">{formatLabel(profile.conversation.status)}</span>
        {profile.conversation.lastMessageAt ? (
          <span>
            Last message {formatDate(profile.conversation.lastMessageAt)}
          </span>
        ) : null}
      </div>

      <div className="assistant-preview-grid">
        <PreviewPanel title="Contact">
          <PreviewFacts
            facts={[
              ["Name", profile.contact?.name ?? profile.contact?.company],
              ["Email", profile.contact?.email],
              ["Phone", profile.contact?.phone],
              ["Address", profile.contact?.address],
              ["Type", formatLabel(profile.contact?.contactType)],
            ]}
          />
        </PreviewPanel>

        <PreviewPanel title="Lead">
          <PreviewFacts
            facts={[
              ["Title", profile.lead?.title],
              ["Service", profile.lead?.serviceType],
              ["Status", formatLabel(profile.lead?.status)],
              ["Priority", formatLabel(profile.lead?.priority)],
              ["Next step", profile.lead?.nextStep],
            ]}
          />
        </PreviewPanel>
      </div>

      <PreviewPanel title="Messages">
        <div className="assistant-preview-thread">
          {messages.length > 0 ? (
            messages.map((message) => (
              <article
                className={`preview-message ${message.direction}`}
                key={message.id}
              >
                <div className="preview-message-meta">
                  <strong>{formatLabel(message.direction)}</strong>
                  <span>
                    {channelLabel(
                      message.channelType,
                      message.channelDisplayName,
                    )}
                  </span>
                  <time>
                    {formatDate(
                      message.receivedAt ?? message.sentAt ?? message.createdAt,
                    )}
                  </time>
                </div>
                {message.subject ? <strong>{message.subject}</strong> : null}
                <p>{message.bodyText ?? "No message body."}</p>
                <MessageAttachmentList metadata={message.metadata} />
              </article>
            ))
          ) : (
            <p className="empty-copy">
              No messages are attached to this inquiry yet.
            </p>
          )}
        </div>
      </PreviewPanel>

      <PreviewPanel title="Manual reply">
        <AssistantManualReplyComposer
          href={href}
          isPending={actionPendingId === `manual:${href}`}
          leadTitle={profile.lead?.title}
          onSendManualReply={onSendManualReply}
          preferredChannel={preferredReplyChannel(profile.contact)}
        />
      </PreviewPanel>

      <PreviewPanel title="Action queue">
        <div className="assistant-preview-list">
          {actionQueue.length > 0 ? (
            actionQueue.map((action) => (
              <AssistantPreviewActionCard
                action={action}
                actionPendingId={actionPendingId}
                href={href}
                key={`${action.id}-${action.status}-${textValue(action.input.subject) ?? ""}-${textValue(action.input.body) ?? ""}`}
                onRunAction={onRunAction}
                onSaveDraftReply={onSaveDraftReply}
              />
            ))
          ) : (
            <p className="empty-copy">No pending actions for this inquiry.</p>
          )}
        </div>
      </PreviewPanel>

      {profile.quoteDrafts.length > 0 ? (
        <PreviewPanel title="Quote drafts">
          <div className="assistant-preview-list compact">
            {profile.quoteDrafts.map((quote) => (
              <article className="assistant-preview-row" key={quote.id}>
                <div>
                  <strong>{quote.title}</strong>
                  <span>
                    {formatLabel(quote.status)} - {quote.lineItems.length} line
                    items
                  </span>
                </div>
                <Link
                  className="secondary-button compact"
                  href={`/files/${quote.id}`}
                  prefetch={false}
                >
                  Open
                </Link>
              </article>
            ))}
          </div>
        </PreviewPanel>
      ) : null}

      <details className="assistant-preview-details">
        <summary>Audit and AI diagnostics</summary>
        <PreviewFacts
          facts={[
            ["AI runs", String(profile.aiRuns.length)],
            ["Usage events", String(profile.usageEvents.length)],
            ["Audit logs", String(profile.auditLogs.length)],
            ["Route decisions", String(profile.routeDecisions.length)],
          ]}
        />
      </details>
    </div>
  );
}

function AssistantPreviewActionCard({
  action,
  actionPendingId,
  href,
  onRunAction,
  onSaveDraftReply,
}: {
  action: Extract<
    AssistantResourcePreview,
    { type: "conversation" }
  >["profile"]["actions"][number];
  actionPendingId: string | null;
  href: string;
  onRunAction: (
    actionId: string,
    href: string,
    operation: "approve" | "approve_execute" | "execute",
  ) => void;
  onSaveDraftReply: (input: {
    actionId: string;
    body: string;
    href: string;
    subject: string;
  }) => Promise<boolean>;
}) {
  const draftSubject =
    textValue(action.input.subject) ?? "Thanks for reaching out";
  const draftBody = textValue(action.input.body) ?? "";
  const canEditDraft =
    action.type === "draft_reply" && action.status === "pending_approval";
  const shouldApproveAndSend =
    action.status === "pending_approval" &&
    (action.type === "draft_reply" || action.type === "send_outbound_message");
  const sendLabel =
    action.type === "draft_reply" ? "Send generated reply" : "Send reply";
  const [subject, setSubject] = useState(draftSubject);
  const [body, setBody] = useState(draftBody);

  return (
    <details
      className="assistant-preview-action-card"
      open={
        action.type === "draft_reply" || action.type === "send_outbound_message"
      }
    >
      <summary>
        <div>
          <strong>{formatLabel(action.type)}</strong>
          <span>
            {formatLabel(action.status)} - {formatDate(action.createdAt)}
          </span>
        </div>
        <span className="pill">{formatLabel(action.status)}</span>
      </summary>

      <div className="assistant-preview-action-body">
        <AssistantPreviewActionDetails
          action={action}
          body={body}
          canEditDraft={canEditDraft}
          onBodyChange={setBody}
          onSubjectChange={setSubject}
          subject={subject}
        />

        <div className="action-button-row">
          {canEditDraft ? (
            <button
              className="secondary-button compact"
              disabled={actionPendingId === `save:${action.id}`}
              onClick={() =>
                onSaveDraftReply({
                  actionId: action.id,
                  body,
                  href,
                  subject,
                })
              }
              type="button"
            >
              {actionPendingId === `save:${action.id}`
                ? "Saving"
                : "Save edits"}
            </button>
          ) : null}
          {action.status === "pending_approval" ? (
            <button
              className="primary-button compact"
              disabled={
                actionPendingId === `approve:${action.id}` ||
                actionPendingId === `approve_execute:${action.id}`
              }
              onClick={async () => {
                if (canEditDraft && shouldApproveAndSend) {
                  const saved = await onSaveDraftReply({
                    actionId: action.id,
                    body,
                    href,
                    subject,
                  });

                  if (!saved) {
                    return;
                  }
                }

                onRunAction(
                  action.id,
                  href,
                  shouldApproveAndSend ? "approve_execute" : "approve",
                );
              }}
              type="button"
            >
              {actionPendingId === `approve:${action.id}` ||
              actionPendingId === `approve_execute:${action.id}`
                ? shouldApproveAndSend
                  ? "Sending"
                  : "Approving"
                : shouldApproveAndSend
                  ? sendLabel
                  : "Approve"}
            </button>
          ) : null}
          {action.status === "approved" ? (
            <button
              className="primary-button compact"
              disabled={actionPendingId === `execute:${action.id}`}
              onClick={() => onRunAction(action.id, href, "execute")}
              type="button"
            >
              {actionPendingId === `execute:${action.id}`
                ? "Sending"
                : actionExecuteLabel(action.type)}
            </button>
          ) : null}
        </div>
      </div>
    </details>
  );
}

type ManualReplyChannel = "email" | "sms" | "manual";

function preferredReplyChannel(
  contact: Extract<
    AssistantResourcePreview,
    { type: "conversation" }
  >["profile"]["contact"],
): ManualReplyChannel {
  if (contact?.email) {
    return "email";
  }

  if (contact?.phone) {
    return "sms";
  }

  return "manual";
}

function AssistantManualReplyComposer({
  href,
  isPending,
  leadTitle,
  onSendManualReply,
  preferredChannel,
}: {
  href: string;
  isPending: boolean;
  leadTitle: string | null | undefined;
  onSendManualReply: (input: {
    body: string;
    channelType: string;
    href: string;
    subject: string;
  }) => Promise<void>;
  preferredChannel: ManualReplyChannel;
}) {
  const [channelType, setChannelType] =
    useState<ManualReplyChannel>(preferredChannel);
  const [subject, setSubject] = useState(
    leadTitle ? `Re: ${leadTitle}` : "Thanks for reaching out",
  );
  const [body, setBody] = useState("");
  const canSend = Boolean(body.trim()) && !isPending;

  const sendReply = async () => {
    if (!canSend) {
      return;
    }

    await onSendManualReply({
      body,
      channelType,
      href,
      subject: channelType === "email" ? subject : "",
    });
    setBody("");
  };

  return (
    <div className="assistant-draft-editor">
      <label>
        <span>Channel</span>
        <select
          onChange={(event) =>
            setChannelType(event.target.value as ManualReplyChannel)
          }
          value={channelType}
        >
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      {channelType === "email" ? (
        <label>
          <span>Subject</span>
          <input
            onChange={(event) => setSubject(event.target.value)}
            type="text"
            value={subject}
          />
        </label>
      ) : null}
      <label>
        <span>Reply</span>
        <textarea
          onChange={(event) => setBody(event.target.value)}
          placeholder="Type the reply you want recorded in this conversation..."
          value={body}
        />
      </label>
      <div className="action-button-row">
        <span className="pill warning">
          Email sends through Gmail; other channels are internal
        </span>
        <button
          className="primary-button compact"
          disabled={!canSend}
          onClick={sendReply}
          type="button"
        >
          {isPending ? "Sending" : "Send reply"}
        </button>
      </div>
    </div>
  );
}

function AssistantPreviewActionDetails({
  action,
  body,
  canEditDraft,
  onBodyChange,
  onSubjectChange,
  subject,
}: {
  action: Extract<
    AssistantResourcePreview,
    { type: "conversation" }
  >["profile"]["actions"][number];
  body: string;
  canEditDraft: boolean;
  onBodyChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  subject: string;
}) {
  if (action.type === "draft_reply") {
    const inquiryFacts = objectRecord(action.input.inquiryFacts);
    const missingInfo = stringValues(inquiryFacts.missingInfo);

    return (
      <div className="assistant-draft-editor">
        {missingInfo.length > 0 ? (
          <div className="assistant-missing-info-note">
            <strong>Missing info folded into this reply</strong>
            <div className="module-list">
              {missingInfo.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        ) : null}
        <label>
          <span>Subject</span>
          <input
            onChange={(event) => onSubjectChange(event.target.value)}
            readOnly={!canEditDraft}
            type="text"
            value={subject}
          />
        </label>
        <label>
          <span>Draft reply</span>
          <textarea
            onChange={(event) => onBodyChange(event.target.value)}
            readOnly={!canEditDraft}
            value={body}
          />
        </label>
        <span className="pill warning">
          Email sends through Gmail after approval
        </span>
      </div>
    );
  }

  if (action.type === "ask_missing_info") {
    const missingInfo = stringValues(action.input.missingInfo);

    return (
      <div className="assistant-preview-action-copy">
        <p>
          {textValue(action.input.prompt) ??
            "Ask the customer for missing details."}
        </p>
        {missingInfo.length > 0 ? (
          <div className="module-list">
            {missingInfo.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (action.type === "send_outbound_message") {
    return (
      <div className="assistant-draft-editor">
        <PreviewFacts
          facts={[
            ["Channel", formatLabel(textValue(action.input.channelType))],
            [
              "Attachment",
              textValue(action.input.attachmentQuoteDraftId)
                ? "Quote draft attached"
                : "No attachment",
            ],
            ["Subject", textValue(action.input.subject)],
          ]}
        />
        <label>
          <span>Outbound body</span>
          <textarea readOnly value={textValue(action.input.body) ?? ""} />
        </label>
        <span className="pill warning">
          Email sends through Gmail after approval
        </span>
      </div>
    );
  }

  if (action.type === "schedule_follow_up") {
    return (
      <PreviewFacts
        facts={[
          ["Window", textValue(action.input.followUpWindow)],
          ["Reason", textValue(action.input.reason)],
        ]}
      />
    );
  }

  if (action.type === "create_quote_draft") {
    const quoteDraft = objectRecord(action.input.quoteDraft);
    const lineItems = arrayValue(quoteDraft.lineItems);

    return (
      <div className="assistant-preview-action-copy">
        <p>{textValue(quoteDraft.title) ?? "Quote draft"}</p>
        <div className="assistant-preview-list compact">
          {lineItems.length > 0 ? (
            lineItems.map((item, index) => (
              <article
                className="assistant-preview-row"
                key={`${action.id}-line-${index}`}
              >
                <div>
                  <strong>{lineItemLabel(item)}</strong>
                  <span>{lineItemMeta(item)}</span>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-copy">No line items proposed yet.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="assistant-preview-action-copy">
      <p>{actionSummary(action)}</p>
    </div>
  );
}

function QuotePreview({
  profile,
}: {
  profile: Extract<AssistantResourcePreview, { type: "quote" }>["profile"];
}) {
  const quote = profile.quoteDraft;

  return (
    <div className="assistant-preview-body">
      <div className="assistant-preview-status-row">
        <span className="pill">{formatLabel(quote.status)}</span>
        <span>{quote.lineItemCount} line items</span>
      </div>

      <div className="assistant-preview-grid">
        <PreviewPanel title="Customer">
          <PreviewFacts
            facts={[
              ["Name", quote.contact?.name ?? quote.contact?.company],
              ["Email", quote.contact?.email],
              ["Phone", quote.contact?.phone],
            ]}
          />
        </PreviewPanel>
        <PreviewPanel title="Job">
          <PreviewFacts
            facts={[
              [
                "Job",
                profile.inquiryFacts?.jobType ??
                  textValue(quote.metadata.jobType),
              ],
              [
                "Address",
                profile.inquiryFacts?.address ??
                  textValue(quote.metadata.jobAddress),
              ],
              ["Preferred", profile.inquiryFacts?.preferredTime],
              ["Budget", profile.inquiryFacts?.budget],
            ]}
          />
        </PreviewPanel>
      </div>

      <PreviewPanel title="Line items">
        <div className="assistant-preview-list compact">
          {quote.lineItems.length > 0 ? (
            quote.lineItems.map((item, index) => (
              <article
                className="assistant-preview-row"
                key={`${quote.id}-line-${index}`}
              >
                <div>
                  <strong>{lineItemLabel(item)}</strong>
                  <span>{lineItemMeta(item)}</span>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-copy">No line items have been added.</p>
          )}
        </div>
      </PreviewPanel>

      {quote.notes ? (
        <PreviewPanel title="Notes">
          <p className="panel-copy">{quote.notes}</p>
        </PreviewPanel>
      ) : null}
    </div>
  );
}

function ContactPreview({
  profile,
}: {
  profile: Extract<AssistantResourcePreview, { type: "contact" }>["profile"];
}) {
  return (
    <div className="assistant-preview-body">
      <div className="assistant-preview-grid">
        <PreviewPanel title="Profile">
          <PreviewFacts
            facts={[
              ["Name", profile.contact.name ?? profile.contact.company],
              ["Email", profile.contact.email],
              ["Phone", profile.contact.phone],
              ["Address", profile.contact.address],
              ["Type", formatLabel(profile.contact.contactType)],
            ]}
          />
        </PreviewPanel>
        <PreviewPanel title="Activity">
          <PreviewFacts
            facts={[
              ["Messages", String(profile.counts.messages)],
              ["Leads", String(profile.counts.leads)],
              ["Quotes", String(profile.counts.quoteDrafts)],
              ["Actions", String(profile.counts.actions)],
            ]}
          />
        </PreviewPanel>
      </div>

      <PreviewPanel title="Recent messages">
        <div className="assistant-preview-thread">
          {profile.messages.slice(0, 8).map((message) => (
            <article
              className={`preview-message ${message.direction}`}
              key={message.id}
            >
              <div className="preview-message-meta">
                <strong>{formatLabel(message.direction)}</strong>
                <time>
                  {formatDate(
                    message.receivedAt ?? message.sentAt ?? message.createdAt,
                  )}
                </time>
              </div>
              {message.subject ? <strong>{message.subject}</strong> : null}
              <p>{message.bodyText ?? "No message body."}</p>
            </article>
          ))}
        </div>
      </PreviewPanel>

      <PreviewPanel title="Leads and quotes">
        <div className="assistant-preview-list compact">
          {profile.leads.slice(0, 5).map((lead) => (
            <article className="assistant-preview-row" key={lead.id}>
              <div>
                <strong>{lead.title}</strong>
                <span>
                  {formatLabel(lead.status)} - {lead.nextStep ?? "No next step"}
                </span>
              </div>
            </article>
          ))}
          {profile.quoteDrafts.slice(0, 5).map((quote) => (
            <article className="assistant-preview-row" key={quote.id}>
              <div>
                <strong>{quote.title}</strong>
                <span>
                  {formatLabel(quote.status)} - {quote.lineItemCount} line items
                </span>
              </div>
              <Link
                className="secondary-button compact"
                href={`/files/${quote.id}`}
                prefetch={false}
              >
                Open
              </Link>
            </article>
          ))}
        </div>
      </PreviewPanel>
    </div>
  );
}

function VoiceCallPreview({
  profile,
}: {
  profile: Extract<AssistantResourcePreview, { type: "voice_call" }>["profile"];
}) {
  const call = profile.call;
  const otherParty =
    profile.contact?.name ??
    profile.contact?.company ??
    call.customerNumber ??
    call.fromNumber ??
    call.toNumber ??
    "Unknown caller";

  return (
    <div className="assistant-preview-body voice-call-preview">
      <div className="assistant-preview-status-row">
        <span className="pill">{formatLabel(call.status)}</span>
        <span>{formatLabel(call.purpose)}</span>
        <span>
          {call.durationSeconds
            ? `${call.durationSeconds}s`
            : "Duration pending"}
        </span>
      </div>

      <div className="assistant-preview-grid">
        <PreviewPanel title="Call">
          <PreviewFacts
            facts={[
              ["Other party", otherParty],
              ["Direction", formatLabel(call.direction)],
              ["From", call.fromNumber],
              ["To", call.toNumber],
              ["Started", formatDate(call.startedAt ?? call.createdAt)],
              ["Ended", formatDate(call.endedAt)],
            ]}
          />
        </PreviewPanel>
        <PreviewPanel title="CRM link">
          <PreviewFacts
            facts={[
              ["Contact", profile.contact?.name ?? profile.contact?.company],
              ["Email", profile.contact?.email],
              ["Phone", profile.contact?.phone ?? call.customerNumber],
              ["Lead", profile.lead?.title],
              ["Conversation", profile.conversation?.status],
              ["Provider", call.provider],
            ]}
          />
        </PreviewPanel>
      </div>

      {call.summary ? (
        <PreviewPanel title="Summary">
          <p className="panel-copy">{call.summary}</p>
        </PreviewPanel>
      ) : null}

      {call.recordingUrl ? (
        <PreviewPanel title="Recording">
          <audio className="voice-call-audio" controls src={call.recordingUrl}>
            <track kind="captions" />
          </audio>
        </PreviewPanel>
      ) : null}

      <PreviewPanel title="Transcript">
        <p className="voice-call-transcript">
          {call.transcript ?? "No transcript has been saved for this call yet."}
        </p>
      </PreviewPanel>

      <PreviewPanel title="Events">
        {profile.events.length > 0 ? (
          <div className="assistant-preview-list compact">
            {profile.events.slice(0, 10).map((event) => (
              <article className="assistant-preview-row" key={event.id}>
                <div>
                  <strong>{formatLabel(event.eventType)}</strong>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-copy">No Vapi events recorded yet.</p>
        )}
      </PreviewPanel>
    </div>
  );
}

function PreviewPanel({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="assistant-preview-panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function PreviewFacts({
  facts,
}: {
  facts: Array<[string, string | null | undefined]>;
}) {
  return (
    <div className="assistant-preview-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value && value.trim() ? value : "-"}</strong>
        </div>
      ))}
    </div>
  );
}

function isPreviewableHref(href: string) {
  try {
    const url = new URL(href, "http://kyro.local");

    if (
      url.pathname === "/contacts" &&
      Boolean(url.searchParams.get("contactId"))
    ) {
      return true;
    }
  } catch {
    // Fall through to the path-based matcher.
  }

  return (
    /^\/(inbox|files|documents|contacts)\/[^/?#]+(?:[?#].*)?$/.test(href) ||
    /^\/voice\/calls\/[^/?#]+(?:[?#].*)?$/.test(href)
  );
}

function isAssistantQueueAction(
  action: Extract<
    AssistantResourcePreview,
    { type: "conversation" }
  >["profile"]["actions"][number],
) {
  if (action.status !== "pending_approval" && action.status !== "approved") {
    return false;
  }

  if (action.type === "ask_missing_info") {
    return false;
  }

  if (action.type === "schedule_follow_up") {
    return false;
  }

  return true;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function channelLabel(
  channelType: string | null,
  channelDisplayName: string | null,
) {
  if (channelType === "manual_inbound") {
    return "Manual";
  }

  if (channelType === "sms") {
    return "SMS";
  }

  if (channelType === "phone") {
    return "Phone";
  }

  if (channelType === "email") {
    return "Email";
  }

  return channelDisplayName ?? formatLabel(channelType);
}

function actionSummary(action: {
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  type: string;
}) {
  return (
    textValue(action.input.draftReply) ??
    textValue(action.input.replyText) ??
    textValue(action.input.prompt) ??
    textValue(action.input.reason) ??
    textValue(action.input.title) ??
    textValue(action.result.message) ??
    `${formatLabel(action.type)} is ready for review.`
  );
}

function actionExecuteLabel(type: string) {
  if (type === "draft_reply") {
    return "Send generated reply";
  }

  if (type === "send_outbound_message") {
    return "Send reply";
  }

  if (type === "create_quote_draft") {
    return "Create draft";
  }

  if (type === "book_site_visit") {
    return "Record booking plan";
  }

  if (type === "mark_not_fit") {
    return "Mark not fit";
  }

  return "Execute";
}

function lineItemLabel(item: unknown) {
  const row = objectRecord(item);

  return textValue(row.description) ?? "Draft line item";
}

function lineItemMeta(item: unknown) {
  const row = objectRecord(item);
  const quantity =
    row.quantity === null || row.quantity === undefined
      ? null
      : String(row.quantity);
  const unit = textValue(row.unit);
  const unitPrice =
    row.unitPrice === null || row.unitPrice === undefined
      ? null
      : String(row.unitPrice);
  const total =
    row.total === null || row.total === undefined ? null : String(row.total);

  return (
    [
      quantity && unit ? `${quantity} ${unit}` : (quantity ?? unit),
      unitPrice,
      total,
    ]
      .filter(Boolean)
      .join(" - ") || "No pricing set"
  );
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValues(value: unknown) {
  return arrayValue(value)
    .map((item) => textValue(item))
    .filter((item): item is string => Boolean(item));
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFullMessageTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatProviderLabel(value: string) {
  if (value === "ollama") {
    return "Ollama";
  }

  return formatLabel(value);
}

function outboundCallRequestKey(request: OutboundCallRequestBlock["request"]) {
  return [
    request.contactId ?? "",
    request.conversationId ?? "",
    request.leadId ?? "",
    request.phoneNumber,
    request.instructions,
    request.threadId ?? "",
  ].join("|");
}

function AssistantMessageBlocks({
  linkOverrides,
  memorySuggestionStatuses,
  message,
  onOpenImagePreview,
  onOpenPreview,
  onStartOutboundCall,
  onUpdateMemorySuggestion,
  outboundCallStatuses,
}: {
  linkOverrides: Record<string, AssistantLink>;
  memorySuggestionStatuses: Record<
    string,
    "active" | "pending_approval" | "rejected"
  >;
  message: AssistantThreadMessage;
  onOpenImagePreview: (image: GeneratedImage) => void;
  onOpenPreview: (link: AssistantLink) => void;
  onStartOutboundCall: (request: OutboundCallRequestBlock["request"]) => void;
  onUpdateMemorySuggestion: (
    memoryId: string,
    status: "active" | "rejected",
  ) => void;
  outboundCallStatuses: Record<string, OutboundCallStatus>;
}) {
  const blocks = message.uiBlocks?.length
    ? message.uiBlocks
    : generatedImageBlocksForMessage(message);

  if (!blocks.length) {
    return null;
  }

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "memory_notice") {
          return (
            <div
              className="assistant-memory-notice"
              key={`${message.id}-memory-${index}`}
            >
              <strong>{block.title}</strong>
              <span>{block.content}</span>
            </div>
          );
        }

        if (block.type === "memory_suggestion") {
          const status =
            memorySuggestionStatuses[block.memoryId] ?? block.status;

          return (
            <div
              className="assistant-memory-notice suggestion"
              key={`${message.id}-memory-suggestion-${index}`}
            >
              <strong>{block.title}</strong>
              <span>{block.content}</span>
              {status === "pending_approval" ? (
                <div className="assistant-block-actions">
                  <button
                    className="secondary-button compact"
                    onClick={() =>
                      onUpdateMemorySuggestion(block.memoryId, "active")
                    }
                    type="button"
                  >
                    Remember
                  </button>
                  <button
                    className="ghost-button compact"
                    onClick={() =>
                      onUpdateMemorySuggestion(block.memoryId, "rejected")
                    }
                    type="button"
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <span className="pill">
                  {status === "active" ? "Remembered" : "Dismissed"}
                </span>
              )}
            </div>
          );
        }

        if (block.type === "summary_cards") {
          return (
            <div
              className="assistant-known-block"
              key={`${message.id}-summary-${index}`}
            >
              <strong>{block.title}</strong>
              <div className="assistant-summary-grid">
                {block.cards.map((card) => (
                  <AssistantBlockCard
                    detail={card.detail}
                    href={card.href}
                    key={`${card.label}-${card.value}`}
                    label={card.label}
                    onOpenPreview={onOpenPreview}
                    tone={card.tone}
                    value={card.value}
                  />
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "timeline") {
          return (
            <div
              className="assistant-known-block"
              key={`${message.id}-timeline-${index}`}
            >
              <strong>{block.title}</strong>
              <div className="assistant-timeline-block">
                {block.items.map((item) => (
                  <AssistantTimelineItem
                    detail={item.detail}
                    href={item.href}
                    key={`${item.label}-${item.at ?? ""}`}
                    label={item.label}
                    onOpenPreview={onOpenPreview}
                    time={item.at}
                    tone={item.tone}
                  />
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "approval_queue") {
          return (
            <div
              className="assistant-known-block"
              key={`${message.id}-approval-${index}`}
            >
              <strong>{block.title}</strong>
              <div className="assistant-approval-block">
                {block.items.map((item) => (
                  <AssistantApprovalItem
                    detail={item.detail}
                    href={item.href}
                    key={item.id}
                    label={item.label}
                    onOpenPreview={onOpenPreview}
                    status={item.status}
                  />
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "outbound_call_request") {
          const key = outboundCallRequestKey(block.request);

          return (
            <AssistantOutboundCallRequestCard
              block={block}
              key={`${message.id}-outbound-call-${index}`}
              onStartOutboundCall={onStartOutboundCall}
              status={outboundCallStatuses[key]}
            />
          );
        }

        if (block.type === "generated_image") {
          return (
            <div
              className="assistant-known-block generated-image"
              key={`${message.id}-generated-image-${index}`}
            >
              <strong>{block.title}</strong>
              <div className="assistant-generated-image-grid">
                {block.images.map((image) => (
                  <article
                    className="assistant-generated-image-card"
                    key={image.fileId}
                  >
                    <button
                      className="assistant-generated-image-preview"
                      onClick={() => onOpenImagePreview(image)}
                      type="button"
                    >
                      <Image
                        alt={image.alt}
                        height={1024}
                        src={image.href}
                        unoptimized
                        width={1024}
                      />
                    </button>
                    <div className="assistant-generated-image-actions">
                      <a
                        className="assistant-generated-image-action"
                        href={image.href}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open
                      </a>
                      <a
                        className="assistant-generated-image-action"
                        href={image.downloadHref}
                      >
                        Download
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        }

        if (block.type !== "link_cards") {
          return null;
        }

        const visibleLinks = block.links
          .map((link) => mergeAssistantLink(link, linkOverrides))
          .filter((link) => shouldRenderAssistantLink(message, link));

        if (visibleLinks.length === 0) {
          return null;
        }

        return (
          <div className="assistant-links" key={`${message.id}-links-${index}`}>
            {visibleLinks.map((link) => (
              <AssistantResourceCard
                key={`${message.id}-${link.href}`}
                link={link}
                onOpenPreview={onOpenPreview}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

function AssistantOutboundCallRequestCard({
  block,
  onStartOutboundCall,
  status,
}: {
  block: OutboundCallRequestBlock;
  onStartOutboundCall: (request: OutboundCallRequestBlock["request"]) => void;
  status?: OutboundCallStatus;
}) {
  const request = block.request;
  const started = status?.status === "started";
  const starting = status?.status === "starting";
  const failed = status?.status === "failed";

  return (
    <div className="assistant-known-block outbound-call">
      <article className="assistant-outbound-call-card">
        <div>
          <strong>{block.title}</strong>
          <dl className="assistant-outbound-call-facts">
            <div>
              <dt>Recipient</dt>
              <dd>{request.contactName ?? request.phoneNumber}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{request.phoneNumber}</dd>
            </div>
          </dl>
        </div>
        <div className="assistant-outbound-call-instructions">
          <span>Kyro will say</span>
          <p>{request.instructions}</p>
        </div>
        <div className="assistant-block-actions">
          <button
            className="primary-button compact"
            disabled={starting || started}
            onClick={() => onStartOutboundCall(request)}
            type="button"
          >
            {starting ? "Confirming..." : started ? "Call started" : "Confirm"}
          </button>
          {status?.message ? (
            <span
              className={`assistant-outbound-call-status ${
                failed ? "failed" : started ? "started" : ""
              }`}
            >
              {status.message}
            </span>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function AssistantBlockCard({
  detail,
  href,
  label,
  onOpenPreview,
  tone = "neutral",
  value,
}: {
  detail?: string;
  href?: string;
  label: string;
  onOpenPreview: (link: AssistantLink) => void;
  tone?: string;
  value: string;
}) {
  const className = `assistant-summary-card ${tone}`;

  if (href && isPreviewableHref(href)) {
    return (
      <button
        className={className}
        onClick={() => onOpenPreview({ href, label, meta: detail ?? value })}
        type="button"
      >
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </button>
    );
  }

  if (href) {
    return (
      <Link className={className} href={href} prefetch={false}>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </Link>
    );
  }

  return (
    <div className={className}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function AssistantTimelineItem({
  detail,
  href,
  label,
  onOpenPreview,
  time,
  tone = "neutral",
}: {
  detail?: string;
  href?: string;
  label: string;
  onOpenPreview: (link: AssistantLink) => void;
  time?: string | null;
  tone?: string;
}) {
  const content = (
    <>
      <span className={`assistant-timeline-dot ${tone}`} />
      <div>
        <strong>{label}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
      {time ? <time>{formatDate(time)}</time> : null}
    </>
  );

  if (href && isPreviewableHref(href)) {
    return (
      <button
        className="assistant-timeline-item"
        onClick={() => onOpenPreview({ href, label, meta: detail })}
        type="button"
      >
        {content}
      </button>
    );
  }

  if (href) {
    return (
      <Link className="assistant-timeline-item" href={href} prefetch={false}>
        {content}
      </Link>
    );
  }

  return <div className="assistant-timeline-item">{content}</div>;
}

function AssistantApprovalItem({
  detail,
  href,
  label,
  onOpenPreview,
  status,
}: {
  detail?: string;
  href?: string;
  label: string;
  onOpenPreview: (link: AssistantLink) => void;
  status: string;
}) {
  const content = (
    <>
      <div>
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      <span className="pill warning">{formatLabel(status)}</span>
    </>
  );

  if (href && isPreviewableHref(href)) {
    return (
      <button
        className="assistant-approval-item"
        onClick={() => onOpenPreview({ href, label, meta: detail ?? status })}
        type="button"
      >
        {content}
      </button>
    );
  }

  return <div className="assistant-approval-item">{content}</div>;
}
