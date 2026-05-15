"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { sendAssistantMessageAction } from "../assistant/actions";
import type {
  AssistantThreadMessage,
  AssistantThreadState,
} from "../../lib/assistant/types";

const VOICE_REPLY_PLAYBACK_RATE = 1;
const VOICE_AUTO_SILENCE_MS = 900;
const VOICE_MAX_TURN_MS = 45000;
const VOICE_MIN_CAPTURE_MS = 700;
const VOICE_NOISE_FLOOR_INITIAL_RMS = 0.012;
const VOICE_SPEECH_CONTINUE_RMS = 0.018;
const VOICE_SPEECH_START_RMS = 0.032;

type VoiceCompletionMode = "draft" | "send";

export function VoiceConsole({
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const voiceCompletionModeRef = useRef<VoiceCompletionMode>("send");
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserAnimationRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const liveModeRef = useRef(true);
  const lastSpeechAtRef = useRef<number | null>(null);
  const noiseFloorRmsRef = useRef(VOICE_NOISE_FLOOR_INITIAL_RMS);
  const currentlySpeakingRef = useRef(false);
  const recordingHadSignalRef = useRef(false);
  const shouldResumeAfterSpeechRef = useRef(false);
  const speechAudioContextRef = useRef<AudioContext | null>(null);
  const speechSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const speechAbortControllerRef = useRef<AbortController | null>(null);
  const startRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const previousLastMessageIdRef = useRef(lastMessageId(state.messages));
  const spokenReplyQueuedRef = useRef(false);
  const voiceSignalDetectedRef = useRef(false);
  const spokenAssistantMessageIdsRef = useRef<Set<string>>(
    new Set(
      initialState.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.id),
    ),
  );
  const [draft, setDraft] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [speechStatus, setSpeechStatus] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [liveMode, setLiveMode] = useState(true);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceSignalDetected, setVoiceSignalDetected] = useState(false);
  const [optimisticMessage, setOptimisticMessage] =
    useState<AssistantThreadMessage | null>(null);
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
  const latestAssistantMessage = useMemo(
    () => [...state.messages].reverse().find((message) => message.role === "assistant"),
    [state.messages],
  );
  const isAssistantGenerating = pending || Boolean(visibleOptimisticMessage);
  const isVoiceBusy = isListening || isTranscribing || isAssistantGenerating;
  const statusLabel = isListening
    ? liveMode
      ? "Live listening"
      : "Listening"
    : isTranscribing
      ? "Transcribing"
      : isAssistantGenerating
        ? "Thinking"
        : speakingMessageId
          ? "Speaking"
          : "Ready";
  const statusDetail = isListening
    ? voiceSignalDetected
      ? liveMode
        ? "Audio detected. Kyro will send when you pause."
        : "Audio detected. Tap stop to send this turn."
      : liveMode
        ? "Listening. Start talking and Kyro will send after a pause."
        : "Listening for your voice..."
    : isTranscribing
      ? "Converting your audio into text."
      : isAssistantGenerating
        ? "Kyro is working through the CRM context."
        : speakingMessageId
          ? "Playing Kyro's response."
          : liveMode
            ? "Tap the mic once to start a hands-free voice conversation."
            : "Tap the mic to start a voice turn.";

  const stopAssistantSpeech = useCallback((preserveLiveResume = false) => {
    if (!preserveLiveResume) {
      shouldResumeAfterSpeechRef.current = false;
    }

    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = null;

    try {
      speechSourceRef.current?.stop();
    } catch {
      // The source may already be stopped; that is fine during cleanup.
    }

    speechSourceRef.current?.disconnect();
    speechSourceRef.current = null;
    void speechAudioContextRef.current?.close().catch(() => undefined);
    speechAudioContextRef.current = null;

    setSpeakingMessageId(null);
    setSpeechStatus(null);
  }, []);

  const speakAssistantMessage = useCallback(
    async (message: AssistantThreadMessage) => {
      const text = speechTextFromAssistantMessage(message);

      if (!text) {
        return;
      }

      const resumeAfterSpeech = shouldResumeAfterSpeechRef.current;

      stopAssistantSpeech(true);
      shouldResumeAfterSpeechRef.current = resumeAfterSpeech;

      const controller = new AbortController();
      speechAbortControllerRef.current = controller;
      setSpeakingMessageId(message.id);
      setSpeechStatus("Preparing voice reply...");

      try {
        const response = await fetch("/api/assistant/speech", {
          body: JSON.stringify({
            sourceMessageId: message.id,
            text,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as unknown;

          throw new Error(
            jsonErrorMessage(payload) ?? "Unable to generate assistant speech.",
          );
        }

        const audioBuffer = await response.arrayBuffer();
        const generationSpeed = numberHeader(
          response.headers.get("X-Kyro-TTS-Speed"),
        );
        const generationProvider = textHeader(
          response.headers.get("X-Kyro-TTS-Provider"),
        );
        const contentType = response.headers.get("Content-Type") ?? "audio";
        const playbackRate = VOICE_REPLY_PLAYBACK_RATE;
        const AudioContextConstructor = browserAudioContextConstructor();

        if (!AudioContextConstructor) {
          throw new Error("This browser does not support Web Audio playback.");
        }

        const audioContext = new AudioContextConstructor();
        const decodedAudio = await audioContext.decodeAudioData(audioBuffer.slice(0));
        const source = audioContext.createBufferSource();

        source.buffer = decodedAudio;
        source.playbackRate.value = playbackRate;
        source.connect(audioContext.destination);
        speechAudioContextRef.current = audioContext;
        speechSourceRef.current = source;
        setSpeechStatus(
          speechPlaybackStatus(
            playbackRate,
            generationSpeed,
            generationProvider,
            decodedAudio.duration,
            contentType,
            decodedAudio.duration / playbackRate,
          ),
        );

        source.onended = () => {
          const shouldResume =
            shouldResumeAfterSpeechRef.current && liveModeRef.current;

          shouldResumeAfterSpeechRef.current = false;

          if (speechSourceRef.current === source) {
            speechSourceRef.current = null;
          }

          if (speechAudioContextRef.current === audioContext) {
            void audioContext.close().catch(() => undefined);
            speechAudioContextRef.current = null;
          }

          setSpeakingMessageId(null);
          setSpeechStatus(null);

          if (shouldResume) {
            window.setTimeout(() => {
              void startRecordingRef.current?.();
            }, 360);
          }
        };

        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }

        source.start();
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        try {
          speechSourceRef.current?.stop();
        } catch {
          // The source may already be stopped; that is fine during cleanup.
        }

        speechSourceRef.current?.disconnect();
        speechSourceRef.current = null;
        void speechAudioContextRef.current?.close().catch(() => undefined);
        speechAudioContextRef.current = null;

        setSpeakingMessageId(null);
        setSpeechStatus(
          error instanceof Error
            ? error.message
            : "Unable to generate assistant speech.",
        );
      } finally {
        if (speechAbortControllerRef.current === controller) {
          speechAbortControllerRef.current = null;
        }
      }
    },
    [stopAssistantSpeech],
  );

  const submitAssistantPrompt = (
    rawPrompt: string,
    options: { inputSource?: "typed" | "voice" } = {},
  ) => {
    const prompt = rawPrompt.trim();

    if (!prompt || isAssistantGenerating) {
      return;
    }

    const formData = new FormData();
    const createdAt = new Date().toISOString();
    const inputSource = options.inputSource ?? "typed";

    formData.set("prompt", prompt);
    formData.set("threadId", state.threadId ?? "");
    formData.set("inputSource", inputSource);

    setOptimisticMessage({
      content: prompt,
      createdAt,
      id: `voice-optimistic-user-${Date.now()}`,
      role: "user",
    });
    setDraft("");
    setVoiceStatus(null);
    setSpeechStatus("Voice reply queued...");
    shouldResumeAfterSpeechRef.current = inputSource === "voice" && liveModeRef.current;
    spokenReplyQueuedRef.current = true;

    startSubmitTransition(() => {
      formAction(formData);
    });
  };

  const submitTypedMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isListening) {
      stopRecording("send");
      return;
    }

    submitAssistantPrompt(draft);
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
    currentlySpeakingRef.current = false;
    lastSpeechAtRef.current = null;
    noiseFloorRmsRef.current = VOICE_NOISE_FLOOR_INITIAL_RMS;
    recordingHadSignalRef.current = false;
    setVoiceLevel(0);
    voiceSignalDetectedRef.current = false;
    setVoiceSignalDetected(false);
  };

  const startVoiceAnalysis = (stream: MediaStream) => {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const data = new Uint8Array(analyser.frequencyBinCount);

    analyser.fftSize = 256;
    source.connect(analyser);
    audioContextRef.current = audioContext;

    const tick = () => {
      analyser.getByteTimeDomainData(data);

      const sum = data.reduce((total, value) => {
        const centered = value - 128;

        return total + centered * centered;
      }, 0);
      const rms = Math.sqrt(sum / data.length) / 128;
      const amplifiedLevel = Math.min(1, rms * 12);
      const now = Date.now();
      const noiseFloor = noiseFloorRmsRef.current;
      const speechStartThreshold = Math.max(
        VOICE_SPEECH_START_RMS,
        noiseFloor * 3.2,
      );
      const speechContinueThreshold = Math.max(
        VOICE_SPEECH_CONTINUE_RMS,
        noiseFloor * 2.1,
      );
      const hasSignal = currentlySpeakingRef.current
        ? rms > speechContinueThreshold
        : rms > speechStartThreshold;

      if (hasSignal) {
        currentlySpeakingRef.current = true;
        recordingHadSignalRef.current = true;
        lastSpeechAtRef.current = now;
      } else {
        currentlySpeakingRef.current = false;

        if (!recordingHadSignalRef.current) {
          noiseFloorRmsRef.current = noiseFloor * 0.95 + rms * 0.05;
        }
      }

      if (recordingHadSignalRef.current !== voiceSignalDetectedRef.current) {
        voiceSignalDetectedRef.current = recordingHadSignalRef.current;
        setVoiceSignalDetected(recordingHadSignalRef.current);
      }

      const startedAt = recordingStartedAtRef.current;
      const elapsedMs = startedAt ? now - startedAt : 0;
      const silentMs = lastSpeechAtRef.current ? now - lastSpeechAtRef.current : 0;
      const shouldAutoStopForSilence =
        liveModeRef.current &&
        recordingHadSignalRef.current &&
        !currentlySpeakingRef.current &&
        elapsedMs > VOICE_MIN_CAPTURE_MS &&
        silentMs > VOICE_AUTO_SILENCE_MS;
      const shouldAutoStopForLength =
        liveModeRef.current && elapsedMs > VOICE_MAX_TURN_MS;

      if (shouldAutoStopForSilence || shouldAutoStopForLength) {
        stopRecording("send");
        return;
      }

      setVoiceLevel((currentLevel) => currentLevel * 0.58 + amplifiedLevel * 0.42);
      analyserAnimationRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  };

  const startRecording = async () => {
    if (isAssistantGenerating || isTranscribing || isListening) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceStatus("This browser does not support microphone recording here.");
      return;
    }

    stopAssistantSpeech();

    try {
      setVoiceStatus("Requesting microphone permission...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTrack = stream.getAudioTracks()[0];

      if (!audioTrack) {
        throw new Error("No microphone audio track was found.");
      }

      audioTrack.addEventListener("ended", () => {
        setVoiceStatus("Microphone stream ended.");
      });

      const audioType = preferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        audioType ? { mimeType: audioType } : undefined,
      );

      audioChunksRef.current = [];
      currentlySpeakingRef.current = false;
      lastSpeechAtRef.current = null;
      noiseFloorRmsRef.current = VOICE_NOISE_FLOOR_INITIAL_RMS;
      recordingHadSignalRef.current = false;
      recordingStartedAtRef.current = nowMs();
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      voiceCompletionModeRef.current = "send";
      setRecordingElapsedMs(0);
      setVoiceStatus(null);
      setVoiceSignalDetected(false);
      setIsListening(true);
      startVoiceAnalysis(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
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
        const chunks = [...audioChunksRef.current];
        const durationMs = recordingStartedAtRef.current
          ? Date.now() - recordingStartedAtRef.current
          : null;
        const completionMode = voiceCompletionModeRef.current;

        recordingStartedAtRef.current = null;
        audioChunksRef.current = [];
        stopRecordingTracks();
        stopVoiceAnalysis();
        setIsListening(false);
        setRecordingElapsedMs(0);
        voiceCompletionModeRef.current = "send";

        if (chunks.length === 0) {
          setVoiceStatus("No speech was captured.");
          return;
        }

        const audioBlob = new Blob(chunks, { type: audioType || chunks[0]?.type });

        setIsTranscribing(true);
        setVoiceStatus("Transcribing...");

        try {
          const transcript = await transcribeAudioBlob(audioBlob, durationMs);

          if (completionMode === "send") {
            submitAssistantPrompt(transcript, { inputSource: "voice" });
            return;
          }

          setDraft((currentDraft) =>
            mergeTranscriptIntoDraft(currentDraft, transcript),
          );
          setVoiceStatus("Transcript ready.");
        } catch (error) {
          setVoiceStatus(
            error instanceof Error
              ? error.message
              : "Unable to transcribe voice note.",
          );
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
    } catch (error) {
      recordingStartedAtRef.current = null;
      audioChunksRef.current = [];
      stopRecordingTracks();
      stopVoiceAnalysis();
      setIsListening(false);
      setRecordingElapsedMs(0);
      setVoiceStatus(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone permission was blocked."
          : "Unable to start microphone recording.",
      );
    }
  };

  const stopRecording = (mode: VoiceCompletionMode) => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      return;
    }

    voiceCompletionModeRef.current = mode;
    recorder.stop();
  };

  const toggleVoiceTurn = () => {
    if (isListening) {
      stopRecording("send");
      return;
    }

    void startRecording();
  };

  const draftTranscript = () => {
    if (isListening) {
      shouldResumeAfterSpeechRef.current = false;
      stopRecording("draft");
    }
  };

  const toggleLiveMode = () => {
    setLiveMode((current) => {
      const next = !current;

      liveModeRef.current = next;

      if (!next) {
        shouldResumeAfterSpeechRef.current = false;
      }

      return next;
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
    startRecordingRef.current = startRecording;
  });

  useEffect(() => {
    const currentLastMessageId = lastMessageId(state.messages);

    if (currentLastMessageId !== previousLastMessageIdRef.current || state.error) {
      setOptimisticMessage(null);
    }

    previousLastMessageIdRef.current = currentLastMessageId;
  }, [state.error, state.messages]);

  useEffect(() => {
    if (
      !spokenReplyQueuedRef.current ||
      isAssistantGenerating ||
      !latestAssistantMessage ||
      state.error
    ) {
      return;
    }

    if (spokenAssistantMessageIdsRef.current.has(latestAssistantMessage.id)) {
      return;
    }

    spokenReplyQueuedRef.current = false;
    spokenAssistantMessageIdsRef.current.add(latestAssistantMessage.id);
    void speakAssistantMessage(latestAssistantMessage);
  }, [
    isAssistantGenerating,
    latestAssistantMessage,
    speakAssistantMessage,
    state.error,
  ]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }

      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      shouldResumeAfterSpeechRef.current = false;
      stopVoiceAnalysis();
      stopAssistantSpeech();
    };
  }, [stopAssistantSpeech]);

  useEffect(() => {
    liveModeRef.current = liveMode;

    if (!liveMode) {
      shouldResumeAfterSpeechRef.current = false;
    }
  }, [liveMode]);

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

  return (
    <section className="voice-console" aria-label="Voice assistant">
      <div className="voice-transcript" ref={chatRef}>
        {visibleMessages.map((message) => (
          <VoiceTurn key={message.id} message={message} />
        ))}
        {isAssistantGenerating ? <VoiceThinking /> : null}
        {state.error ? <p className="form-error">{state.error}</p> : null}
      </div>

      <section className="voice-control-panel" aria-label="Voice controls">
        <button
          aria-label={isListening ? "Stop and send voice turn" : "Start voice turn"}
          aria-pressed={isListening}
          className={[
            "voice-orb",
            isListening ? "recording" : null,
            speakingMessageId ? "speaking" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={isTranscribing || isAssistantGenerating}
          onClick={toggleVoiceTurn}
          type="button"
        >
          {isListening ? <StopIcon /> : <MicrophoneIcon />}
        </button>
        <div className="voice-state-copy">
          <p>{statusLabel}</p>
          <span>{voiceStatus ?? speechStatus ?? statusDetail}</span>
          {isListening ? (
            <div className="voice-inline-meter">
              <VoiceLevelMeter level={voiceLevel} />
              <strong>{formatRecordingTime(recordingElapsedMs)}</strong>
            </div>
          ) : null}
        </div>
        <button
          className={liveMode ? "voice-mode-toggle active" : "voice-mode-toggle"}
          onClick={toggleLiveMode}
          type="button"
        >
          {liveMode ? "Live on" : "Manual"}
        </button>
        {isListening ? (
          <button
            className="secondary-button"
            onClick={draftTranscript}
            type="button"
          >
            Stop to text
          </button>
        ) : null}
        {speakingMessageId ? (
          <button
            className="secondary-button"
            onClick={() => stopAssistantSpeech()}
            type="button"
          >
            Stop audio
          </button>
        ) : latestAssistantMessage ? (
          <button
            className="secondary-button"
            disabled={isAssistantGenerating || isTranscribing}
            onClick={() => {
              spokenAssistantMessageIdsRef.current.delete(latestAssistantMessage.id);
              spokenReplyQueuedRef.current = false;
              void speakAssistantMessage(latestAssistantMessage);
            }}
            type="button"
          >
            Replay
          </button>
        ) : null}
      </section>

      <form className="voice-text-composer" onSubmit={submitTypedMessage}>
        <textarea
          className="assistant-prompt-input"
          disabled={isVoiceBusy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Type here if you want to steer the voice assistant..."
          rows={1}
          value={draft}
        />
        <button
          className="primary-button"
          disabled={isVoiceBusy || !draft.trim()}
          type="submit"
        >
          Send text
        </button>
      </form>
    </section>
  );
}

function VoiceTurn({ message }: { message: AssistantThreadMessage }) {
  const isUser = message.role === "user";

  return (
    <article className={isUser ? "voice-turn user" : "voice-turn assistant"}>
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
            <a href={link.href} key={`${message.id}-${link.href}`}>
              {link.label}
              {link.meta ? <span>{link.meta}</span> : null}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function VoiceThinking() {
  return (
    <div className="voice-thinking" aria-label="Kyro is thinking">
      <span />
      <span />
      <span />
    </div>
  );
}

function ClientMessageTime({ value }: { value: string | undefined }) {
  return <span suppressHydrationWarning>{formatMessageTime(value)}</span>;
}

function AssistantProviderPill({ message }: { message: AssistantThreadMessage }) {
  if (message.fallbackReason) {
    return <span className="assistant-provider-pill fallback">Fallback</span>;
  }

  if (!message.provider || !message.model) {
    return null;
  }

  return (
    <span className="assistant-provider-pill">
      {message.provider === "ollama" ? "Ollama" : message.provider}
    </span>
  );
}

function speechTextFromAssistantMessage(message: AssistantThreadMessage) {
  if (message.role !== "assistant") {
    return "";
  }

  return message.content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/[_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

async function transcribeAudioBlob(audioBlob: Blob, durationMs: number | null) {
  const formData = new FormData();

  formData.set("audio", audioBlob, "kyro-voice.webm");

  if (durationMs !== null) {
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
  const transcript =
    data && typeof data === "object" && "text" in data
      ? textValue(data.text)
      : null;

  if (!transcript) {
    throw new Error("No transcript was returned.");
  }

  return transcript;
}

function preferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nowMs() {
  return Date.now();
}

function numberHeader(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function textHeader(value: string | null) {
  return value && value.trim() ? value.trim() : null;
}

function browserAudioContextConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

function speechPlaybackStatus(
  playbackRate: number,
  generationSpeed: number | null,
  generationProvider: string | null,
  duration: number | null = null,
  contentType: string | null = null,
  expectedPlaybackSeconds: number | null = null,
) {
  const playbackLabel = `${playbackRate.toFixed(2)}x playback`;
  const providerLabel = generationProvider ? `${generationProvider}, ` : "";
  const durationLabel =
    typeof duration === "number" && Number.isFinite(duration)
      ? `, ${duration.toFixed(1)}s audio`
      : "";
  const expectedLabel =
    typeof expectedPlaybackSeconds === "number" &&
    Number.isFinite(expectedPlaybackSeconds)
      ? `, ~${expectedPlaybackSeconds.toFixed(1)}s played`
      : "";
  const formatLabel = contentType?.includes("wav")
    ? ", WAV"
    : contentType?.includes("mpeg")
      ? ", MP3"
      : "";

  if (!generationSpeed) {
    return `Speaking (${providerLabel}${playbackLabel}${durationLabel}${expectedLabel}${formatLabel})...`;
  }

  return `Speaking (${providerLabel}${playbackLabel}, ${generationSpeed.toFixed(2)}x voice${durationLabel}${expectedLabel}${formatLabel})...`;
}

function lastMessageId(messages: AssistantThreadMessage[]) {
  return messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null;
}

function isOptimisticMessageSaved(
  messages: AssistantThreadMessage[],
  optimisticMessage: AssistantThreadMessage,
) {
  return messages.some(
    (message) =>
      message.role === optimisticMessage.role &&
      message.content === optimisticMessage.content,
  );
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

function formatRecordingTime(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="2.4"
        width="15"
        x="4.5"
        y="4.5"
      />
    </svg>
  );
}
