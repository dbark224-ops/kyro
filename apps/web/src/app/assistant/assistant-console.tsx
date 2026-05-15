"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  getAssistantResourcePreviewAction,
  runAssistantResourceActionAction,
  sendAssistantManualReplyAction,
  sendAssistantMessageAction,
  updateAssistantDraftReplyAction,
} from "./actions";
import type {
  AssistantLink,
  AssistantResourcePreview,
  AssistantResourcePreviewResult,
  AssistantThreadMessage,
  AssistantThreadState,
} from "../../lib/assistant/types";
import Link from "next/link";

const QUICK_PROMPTS = [
  "Show me leads needing reply",
  "What quote drafts are ready?",
  "Create a bathroom quote draft",
  "Summarise my busiest customer",
];
const MAX_ATTACHMENT_TEXT_BYTES = 48 * 1024;
type VoiceCompletionMode = "draft" | "send";

type AssistantAttachment = {
  id: string;
  name: string;
  previewText: string | null;
  size: number;
  type: string;
};

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
  initialState,
}: {
  initialState: AssistantThreadState;
}) {
  const [state, formAction, pending] = useActionState(
    sendAssistantMessageAction,
    initialState,
  );
  const [, startSubmitTransition] = useTransition();
  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const previousLastMessageIdRef = useRef(lastMessageId(state.messages));
  const previewCacheRef = useRef<Map<string, AssistantResourcePreviewResult>>(new Map());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const voiceCompletionModeRef = useRef<VoiceCompletionMode>("draft");
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserAnimationRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [optimisticMessage, setOptimisticMessage] =
    useState<AssistantThreadMessage | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>({
    status: "closed",
  });
  const [previewActionId, setPreviewActionId] = useState<string | null>(null);
  const [linkOverrides, setLinkOverrides] = useState<Record<string, AssistantLink>>({});
  const visibleOptimisticMessage = useMemo(
    () =>
      optimisticMessage && !isOptimisticMessageSaved(state.messages, optimisticMessage)
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

  const appendQuickPrompt = (prompt: string) => {
    setDraft((currentDraft) => {
      const trimmedDraft = currentDraft.trim();

      if (!trimmedDraft) {
        return prompt;
      }

      return `${trimmedDraft}, ${prompt}`;
    });
  };

  const submitAssistantPrompt = (
    rawPrompt: string,
    options: { inputSource?: "typed" | "voice" } = {},
  ) => {
    const prompt = buildPromptWithAttachments(rawPrompt, attachments);

    if (!prompt || isAssistantGenerating) {
      return;
    }

    const formData = new FormData();
    const createdAt = new Date().toISOString();

    formData.set("prompt", prompt);
    formData.set("threadId", state.threadId ?? "");
    formData.set("inputSource", options.inputSource ?? "typed");
    setOptimisticMessage({
      content: prompt,
      createdAt,
      id: `optimistic-user-${Date.now()}`,
      role: "user",
    });
    setDraft("");
    setAttachments([]);
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

    submitAssistantPrompt(draft);
  };

  const chooseAttachments = () => {
    fileInputRef.current?.click();
  };

  const handleAttachmentChange = async () => {
    const files = Array.from(fileInputRef.current?.files ?? []);

    if (files.length === 0) {
      return;
    }

    const nextAttachments = await Promise.all(files.map(fileToAssistantAttachment));

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
      recordingStartedAtRef.current = Date.now();
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
          ? Date.now() - recordingStartedAtRef.current
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

          setDraft((currentDraft) =>
            mergeTranscriptIntoDraft(currentDraft, transcript),
          );
          window.requestAnimationFrame(() => {
            promptInputRef.current?.focus();
          });
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

    if (currentLastMessageId !== previousLastMessageIdRef.current || state.error) {
      setOptimisticMessage(null);
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
      return;
    }

    promptInput.style.height = "auto";
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 150)}px`;
  }, [draft]);

  const isPreviewOpen = previewState.status !== "closed";

  return (
    <section className={`assistant-workspace${isPreviewOpen ? " has-preview" : ""}`}>
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
            <div
              className={`assistant-turn ${message.role}`}
              key={message.id}
            >
              <article className={`assistant-message ${message.role}`}>
                <div className="assistant-message-meta">
                  <strong>{message.role === "assistant" ? "Kyro" : "You"}</strong>
                  {message.createdAt ? (
                    <time dateTime={message.createdAt} title={formatFullMessageTime(message.createdAt)}>
                      {formatMessageTime(message.createdAt)}
                    </time>
                  ) : null}
                  <AssistantProviderPill message={message} />
                </div>
                <p>{assistantMessageContent(message, linkOverrides)}</p>
              </article>
              <AssistantMessageBlocks
                linkOverrides={linkOverrides}
                message={message}
                onOpenPreview={openResourcePreview}
              />
              <AssistantMessageLinks
                linkOverrides={linkOverrides}
                message={message}
                onOpenPreview={openResourcePreview}
              />
            </div>
          ))}
          {isAssistantGenerating ? <AssistantTypingIndicator /> : null}
        </div>

        {state.error ? <p className="form-alert error">{state.error}</p> : null}

        <div className="assistant-suggestions">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              className="filter-pill"
              key={prompt}
              onClick={() => appendQuickPrompt(prompt)}
              type="button"
            >
              {prompt}
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
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              placeholder="Ask Kyro about leads, quotes, customers, or next actions..."
              rows={1}
              value={draft}
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
              disabled={
                isAssistantGenerating ||
                isTranscribing ||
                (!isListening && !draft.trim() && attachments.length === 0)
              }
              title={isListening ? "Transcribe and send voice note" : undefined}
              type="submit"
            >
              {isAssistantGenerating
                ? "Sending"
                : isTranscribing
                  ? "Transcribing"
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

      <AssistantPreviewPane
        actionPendingId={previewActionId}
        onClose={() => setPreviewState({ status: "closed" })}
        onRunAction={runPreviewAction}
        onSaveDraftReply={saveDraftReply}
        onSendManualReply={sendManualReply}
        state={previewState}
      />
    </section>
  );
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

  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
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
    data && typeof data === "object" && "text" in data
      ? data.text
      : null;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("The transcription came back empty.");
  }

  return text.trim();
}

async function fileToAssistantAttachment(file: File): Promise<AssistantAttachment> {
  const shouldReadText =
    file.size <= MAX_ATTACHMENT_TEXT_BYTES && isTextLikeFile(file);
  const previewText = shouldReadText ? await file.text() : null;

  return {
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
    [
      ".csv",
      ".json",
      ".log",
      ".md",
      ".txt",
      ".xml",
      ".yaml",
      ".yml",
    ].some((extension) => lowerName.endsWith(extension))
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
      <span className="assistant-provider-pill fallback" title={message.fallbackReason}>
        Fallback
      </span>
    );
  }

  if (!message.provider) {
    return null;
  }

  return (
    <span className="assistant-provider-pill" title={message.model ?? message.provider}>
      {formatProviderLabel(message.provider)}
    </span>
  );
}

function AssistantTypingIndicator() {
  return (
    <div className="assistant-turn assistant">
      <article
        aria-label="Kyro is typing"
        className="assistant-typing-message"
      >
        <span aria-hidden="true" className="typing-dots">
          <span />
          <span />
          <span />
        </span>
      </article>
    </div>
  );
}

function AssistantDevDiagnostics({
  state,
}: {
  state: AssistantThreadState;
}) {
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
              <strong>Internal quote drafts only</strong>
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
    <Link
      className="assistant-link-card"
      href={link.href}
      prefetch={false}
    >
      <strong>{link.label}</strong>
      {link.meta ? <span>{link.meta}</span> : null}
    </Link>
  );
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
  optimisticMessage: AssistantThreadMessage,
) {
  return messages.some(
    (message) =>
      message.role === "user" &&
      message.content === optimisticMessage.content &&
      message.id !== optimisticMessage.id,
  );
}

function assistantMessageContent(
  message: AssistantThreadMessage,
  linkOverrides: Record<string, AssistantLink>,
) {
  const links = message.links?.map((link) => mergeAssistantLink(link, linkOverrides)) ?? [];

  if (message.intent === "work_queue" && links.length > 0) {
    const visibleLinks = links.filter((link) => shouldRenderAssistantLink(message, link));

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
    return message.content;
  }

  return message.content.replace(
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
  onClose,
  onRunAction,
  onSaveDraftReply,
  onSendManualReply,
  state,
}: {
  actionPendingId: string | null;
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
          <Link className="secondary-button compact" href={href} prefetch={false}>
            Open full screen
          </Link>
          <button className="secondary-button compact" onClick={onClose} type="button">
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
  profile: Extract<AssistantResourcePreview, { type: "conversation" }>["profile"];
}) {
  const messages = profile.messages.slice(-12);
  const actionQueue = profile.actions.filter(
    (action) => isAssistantQueueAction(action),
  );

  return (
    <div className="assistant-preview-body">
      <div className="assistant-preview-status-row">
        <span className="pill">{formatLabel(profile.conversation.status)}</span>
        {profile.conversation.lastMessageAt ? (
          <span>Last message {formatDate(profile.conversation.lastMessageAt)}</span>
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
              <article className={`preview-message ${message.direction}`} key={message.id}>
                <div className="preview-message-meta">
                  <strong>{formatLabel(message.direction)}</strong>
                  <span>{channelLabel(message.channelType, message.channelDisplayName)}</span>
                  <time>{formatDate(message.receivedAt ?? message.sentAt ?? message.createdAt)}</time>
                </div>
                {message.subject ? <strong>{message.subject}</strong> : null}
                <p>{message.bodyText ?? "No message body."}</p>
              </article>
            ))
          ) : (
            <p className="empty-copy">No messages are attached to this inquiry yet.</p>
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
                    {formatLabel(quote.status)} - {quote.lineItems.length} line items
                  </span>
                </div>
                <Link className="secondary-button compact" href={`/documents/${quote.id}`} prefetch={false}>
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
  action: Extract<AssistantResourcePreview, { type: "conversation" }>["profile"]["actions"][number];
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
  const draftSubject = textValue(action.input.subject) ?? "Thanks for reaching out";
  const draftBody = textValue(action.input.body) ?? "";
  const canEditDraft = action.type === "draft_reply" && action.status === "pending_approval";
  const shouldApproveAndSend =
    action.status === "pending_approval" &&
    (action.type === "draft_reply" || action.type === "send_outbound_message");
  const sendLabel = action.type === "draft_reply" ? "Send generated reply" : "Send reply";
  const [subject, setSubject] = useState(draftSubject);
  const [body, setBody] = useState(draftBody);

  return (
    <details
      className="assistant-preview-action-card"
      open={action.type === "draft_reply" || action.type === "send_outbound_message"}
    >
      <summary>
        <div>
          <strong>{formatLabel(action.type)}</strong>
          <span>{formatLabel(action.status)} - {formatDate(action.createdAt)}</span>
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
              {actionPendingId === `save:${action.id}` ? "Saving" : "Save edits"}
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
  contact: Extract<AssistantResourcePreview, { type: "conversation" }>["profile"]["contact"],
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
  const [channelType, setChannelType] = useState<ManualReplyChannel>(preferredChannel);
  const [subject, setSubject] = useState(leadTitle ? `Re: ${leadTitle}` : "Thanks for reaching out");
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
          onChange={(event) => setChannelType(event.target.value as ManualReplyChannel)}
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
        <span className="pill warning">Email sends through Gmail; other channels are internal</span>
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
  action: Extract<AssistantResourcePreview, { type: "conversation" }>["profile"]["actions"][number];
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
        <span className="pill warning">Email sends through Gmail after approval</span>
      </div>
    );
  }

  if (action.type === "ask_missing_info") {
    const missingInfo = stringValues(action.input.missingInfo);

    return (
      <div className="assistant-preview-action-copy">
        <p>{textValue(action.input.prompt) ?? "Ask the customer for missing details."}</p>
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
        <span className="pill warning">Email sends through Gmail after approval</span>
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
              <article className="assistant-preview-row" key={`${action.id}-line-${index}`}>
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
              ["Job", profile.inquiryFacts?.jobType ?? textValue(quote.metadata.jobType)],
              ["Address", profile.inquiryFacts?.address ?? textValue(quote.metadata.jobAddress)],
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
              <article className="assistant-preview-row" key={`${quote.id}-line-${index}`}>
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
            <article className={`preview-message ${message.direction}`} key={message.id}>
              <div className="preview-message-meta">
                <strong>{formatLabel(message.direction)}</strong>
                <time>{formatDate(message.receivedAt ?? message.sentAt ?? message.createdAt)}</time>
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
                <span>{formatLabel(lead.status)} - {lead.nextStep ?? "No next step"}</span>
              </div>
            </article>
          ))}
          {profile.quoteDrafts.slice(0, 5).map((quote) => (
            <article className="assistant-preview-row" key={quote.id}>
              <div>
                <strong>{quote.title}</strong>
                <span>{formatLabel(quote.status)} - {quote.lineItemCount} line items</span>
              </div>
              <Link className="secondary-button compact" href={`/documents/${quote.id}`} prefetch={false}>
                Open
              </Link>
            </article>
          ))}
        </div>
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
  return /^\/(inbox|documents|contacts)\/[^/?#]+(?:[?#].*)?$/.test(href);
}

function isAssistantQueueAction(
  action: Extract<AssistantResourcePreview, { type: "conversation" }>["profile"]["actions"][number],
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

function channelLabel(channelType: string | null, channelDisplayName: string | null) {
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
  const quantity = row.quantity === null || row.quantity === undefined ? null : String(row.quantity);
  const unit = textValue(row.unit);
  const unitPrice =
    row.unitPrice === null || row.unitPrice === undefined ? null : String(row.unitPrice);
  const total = row.total === null || row.total === undefined ? null : String(row.total);

  return [quantity && unit ? `${quantity} ${unit}` : quantity ?? unit, unitPrice, total]
    .filter(Boolean)
    .join(" - ") || "No pricing set";
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

function AssistantMessageBlocks({
  linkOverrides,
  message,
  onOpenPreview,
}: {
  linkOverrides: Record<string, AssistantLink>;
  message: AssistantThreadMessage;
  onOpenPreview: (link: AssistantLink) => void;
}) {
  if (!message.uiBlocks?.length) {
    return null;
  }

  return (
    <>
      {message.uiBlocks.map((block, index) => {
        if (block.type === "memory_notice") {
          return (
            <div className="assistant-memory-notice" key={`${message.id}-memory-${index}`}>
              <strong>{block.title}</strong>
              <span>{block.content}</span>
            </div>
          );
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
