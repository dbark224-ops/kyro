import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioPlayer,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Mic,
  Plus,
  Send,
  Square,
  Volume2,
  Waves,
  X,
} from "lucide-react-native";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DataState } from "@/components/DataState";
import {
  AssistantMessageBlocks,
  type GeneratedImageEditSubmission,
} from "@/features/assistant/AssistantMessageBlocks";
import { mobileAssistantPromptSuggestions } from "@/features/assistant/prompt-suggestions";
import {
  mergeVapiTranscriptMessages,
  useVapiCall,
  voiceLevelToMetering as vapiVoiceLevelToMetering,
} from "@/features/assistant/vapi-call-context";
import { useAuthSession } from "@/features/auth/auth-context";
import { mobileEnv } from "@/lib/env";
import { kyroApiFetch, kyroApiFormFetch } from "@/lib/kyro-api";
import {
  mobileAssistantQueryOptions,
  mobileAssistantPromptSuggestionsQueryOptions,
  mobileFilesQueryOptions,
  mobileQueryKeys,
  mobileSettingsQueryOptions,
} from "@/lib/mobile-query";
import type {
  AssistantThreadMessage,
  MobileFileItem,
  MobileFileLinkResponse,
  MobileAssistantSpeechPayload,
  MobileAssistantState,
  MobileAssistantVapiSessionResponse,
  MobileAssistantVoiceTurnResponse,
} from "@/lib/mobile-api-types";
import { colors, radii, typography } from "@/theme";

type AssistantMode = "text" | "voice" | "vapi";
type MobileAssistantAttachment = {
  id: string;
  mimeType: string;
  name: string;
  size: number | null;
  uri: string;
};
type AssistantDisplayAttachment = {
  contentType: string | null;
  href: string | null;
  name: string;
  sizeLabel: string | null;
};
type VoiceAudioSubmission = {
  durationMs: number;
  mimeType: string;
  name: string;
  uri: string;
};
type VoiceState = "idle" | "recording" | "speaking" | "thinking";
type VapiConnectionState = "connecting" | "idle" | "listening" | "speaking";

const ASSISTANT_MODES: AssistantMode[] = ["text", "vapi"];

const FRESH_PROMPT_INTERVAL_MS = 2 * 60 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 30 * 1000;
const VOICE_TRANSCRIPT_LIMIT = 24;
const MIN_VOICE_DURATION_MS = 1200;
const MIN_VOICE_AUDIO_BYTES = 4096;
const VOICE_MIN_AUTO_SUBMIT_MS = 1800;
const VOICE_SPEECH_THRESHOLD_DB = -45;
const VOICE_SILENCE_HOLD_MS = 1450;
const VOICE_RESTART_DELAY_MS = 360;
const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  bitRate: 96000,
  isMeteringEnabled: true,
  numberOfChannels: 1,
};

const promptAccents = [
  {
    backgroundColor: "rgba(81, 229, 255, 0.1)",
    borderColor: "rgba(81, 229, 255, 0.5)",
    color: colors.cyan,
  },
  {
    backgroundColor: "rgba(236, 54, 141, 0.1)",
    borderColor: "rgba(236, 54, 141, 0.5)",
    color: colors.pink,
  },
  {
    backgroundColor: "rgba(139, 92, 246, 0.12)",
    borderColor: "rgba(139, 92, 246, 0.5)",
    color: colors.purple,
  },
];

export default function AssistantScreen() {
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const [mode, setMode] = useState<AssistantMode>("text");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MobileAssistantAttachment[]>(
    [],
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isAttachmentSheetOpen, setIsAttachmentSheetOpen] = useState(false);
  const [isKyroFilePickerOpen, setIsKyroFilePickerOpen] = useState(false);
  const [kyroFilePickerMessage, setKyroFilePickerMessage] = useState<
    string | null
  >(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [showFreshPrompts, setShowFreshPrompts] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [voiceSpeech, setVoiceSpeech] =
    useState<MobileAssistantSpeechPayload | null>(null);
  const { session, status } = useAuthSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const lastActivityWriteRef = useRef(0);
  const promptSuppressedUntilRef = useRef(0);
  const assistantQueryKey = mobileQueryKeys.assistant(userId);
  const assistant = useQuery({
    ...mobileAssistantQueryOptions(session),
    enabled: status === "signed-in",
  });
  const promptSuggestionState = useQuery({
    ...mobileAssistantPromptSuggestionsQueryOptions(session),
    enabled: status === "signed-in",
  });
  const settings = useQuery({
    ...mobileSettingsQueryOptions(session),
    enabled: status === "signed-in",
  });
  const showDeveloperMetadata = Boolean(settings.data?.developer.enabled);
  const kyroFiles = useQuery({
    ...mobileFilesQueryOptions(session),
    enabled: status === "signed-in" && isKyroFilePickerOpen,
  });
  const attachKyroFile = useMutation({
    mutationFn: async (file: MobileFileItem) => {
      const link = await kyroApiFetch<MobileFileLinkResponse>(
        "/api/mobile/file-link",
        {
          query: { fileId: file.id },
          session,
        },
      );
      const cacheDirectory =
        FileSystem.cacheDirectory ?? FileSystem.documentDirectory;

      if (!cacheDirectory) {
        throw new Error("Kyro could not prepare that file on this device.");
      }

      const localName = safeLocalFilename(link.filename || file.filename);
      const download = await FileSystem.downloadAsync(
        link.url,
        `${cacheDirectory}kyro-attach-${Date.now()}-${localName}`,
      );

      return {
        id: `${Date.now()}-kyro-file-${file.id}`,
        mimeType:
          link.contentType ||
          file.contentType ||
          mimeTypeFromUri(file.filename),
        name: link.filename || file.filename,
        size: file.sizeBytes,
        uri: download.uri,
      } satisfies MobileAssistantAttachment;
    },
    onError: (error) => {
      setKyroFilePickerMessage(
        error instanceof Error
          ? error.message
          : "Unable to attach that Kyro file.",
      );
    },
    onSuccess: (attachment) => {
      appendAttachments([attachment]);
      setKyroFilePickerMessage(null);
      setIsKyroFilePickerOpen(false);
    },
  });
  const sendMessage = useMutation({
    mutationFn: ({
      attachments: submissionAttachments,
      inputSource,
      prompt,
      threadId,
    }: {
      attachments: MobileAssistantAttachment[];
      inputSource: "typed" | "voice";
      prompt: string;
      threadId: string | null;
    }) => {
      const formData = new FormData();

      formData.append("inputSource", inputSource);
      formData.append("prompt", prompt);
      formData.append("threadId", threadId ?? "");

      for (const attachment of submissionAttachments) {
        formData.append("assistantFiles", {
          name: attachment.name,
          type: attachment.mimeType,
          uri: attachment.uri,
        } as unknown as Blob);
      }

      return kyroApiFormFetch<MobileAssistantState>(
        "/api/mobile/assistant",
        formData,
        { session },
      );
    },
    onError: (_error, variables) => {
      setDraft((current) => (current.trim() ? current : variables.prompt));
      setAttachments((current) =>
        current.length ? current : variables.attachments,
      );
      setPendingPrompt(null);
    },
    onSuccess: (nextState) => {
      queryClient.setQueryData(assistantQueryKey, nextState);
      setAttachmentError(null);
      setPendingPrompt(null);
    },
  });
  const sendVoiceTurn = useMutation({
    mutationFn: ({ durationMs, mimeType, name, uri }: VoiceAudioSubmission) => {
      const formData = new FormData();

      formData.append("durationMs", String(durationMs));
      formData.append("audio", {
        name,
        type: mimeType,
        uri,
      } as unknown as Blob);

      return kyroApiFormFetch<MobileAssistantVoiceTurnResponse>(
        "/api/mobile/assistant/voice-turn",
        formData,
        { session },
      );
    },
    onError: (error) => {
      setVoiceSpeech(null);
      setVoiceNotice(
        error instanceof Error
          ? error.message
          : "Unable to process voice turn.",
      );
    },
    onSuccess: (result) => {
      queryClient.setQueryData(assistantQueryKey, result.state);
      setVoiceSpeech(result.speech);
      setVoiceNotice(result.speechError);
    },
  });
  const messages = useMemo(
    () => (assistant.data?.messages ?? []).filter(hasRenderableMessage),
    [assistant.data?.messages],
  );
  const promptSuggestions = useMemo(
    () =>
      mobileAssistantPromptSuggestions({
        messages,
        remoteSuggestions:
          promptSuggestionState.data?.visibleSuggestions ??
          promptSuggestionState.data?.suggestions,
      }),
    [
      messages,
      promptSuggestionState.data?.suggestions,
      promptSuggestionState.data?.visibleSuggestions,
    ],
  );
  const isAssistantLoading =
    status === "loading" || (status === "signed-in" && assistant.isLoading);
  const lastMessage = messages[messages.length - 1];
  const shouldShowPendingPrompt =
    Boolean(pendingPrompt) &&
    !(
      lastMessage?.role === "user" &&
      normalizedPendingPrompt(lastMessage.content) ===
        normalizedPendingPrompt(pendingPrompt)
    );
  const visibleMessages = useMemo(
    () =>
      shouldShowPendingPrompt
        ? [
            ...messages,
            {
              content: pendingPrompt ?? "",
              id: "pending-user-message",
              role: "user" as const,
            },
          ]
        : messages,
    [messages, pendingPrompt, shouldShowPendingPrompt],
  );

  useEffect(() => {
    const requestedMode = Array.isArray(params.mode)
      ? params.mode[0]
      : params.mode;

    if (
      requestedMode &&
      ASSISTANT_MODES.includes(requestedMode as AssistantMode)
    ) {
      setMode(requestedMode as AssistantMode);
    }
  }, [params.mode]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      async function refreshPromptVisibility() {
        if (status !== "signed-in" || !userId) {
          setShowFreshPrompts(false);
          return;
        }

        const [lastActivityAt, suggestionsShownAt] = await Promise.all([
          SecureStore.getItemAsync(assistantActivityKey(userId)).catch(
            () => null,
          ),
          SecureStore.getItemAsync(assistantSuggestionsShownKey(userId)).catch(
            () => null,
          ),
        ]);
        const shouldShow = shouldShowFreshPromptSuggestions({
          lastActivityAt,
          localSuppressedUntil: promptSuppressedUntilRef.current,
          latestThreadActivityAt: latestPersistedThreadActivity(messages),
          suggestionsShownAt,
        });

        if (isActive) {
          setShowFreshPrompts(shouldShow);
        }

        if (shouldShow) {
          await SecureStore.setItemAsync(
            assistantSuggestionsShownKey(userId),
            new Date().toISOString(),
          ).catch(() => undefined);
        }
      }

      void refreshPromptVisibility();

      return () => {
        isActive = false;
      };
    }, [messages, status, userId]),
  );

  const markAssistantActivity = useCallback(
    (options: { force?: boolean } = {}) => {
      if (!userId) {
        return;
      }

      const now = Date.now();

      promptSuppressedUntilRef.current = now + FRESH_PROMPT_INTERVAL_MS;
      setShowFreshPrompts(false);

      if (
        !options.force &&
        now - lastActivityWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS
      ) {
        return;
      }

      lastActivityWriteRef.current = now;
      const timestamp = new Date(now).toISOString();

      void Promise.all([
        SecureStore.setItemAsync(assistantActivityKey(userId), timestamp),
        SecureStore.setItemAsync(
          assistantSuggestionsShownKey(userId),
          timestamp,
        ),
      ]).catch(() => undefined);
    },
    [userId],
  );

  const handleDraftChange = useCallback(
    (value: string) => {
      setDraft(value);

      if (value.trim()) {
        markAssistantActivity();
      }
    },
    [markAssistantActivity],
  );

  const handlePromptPress = useCallback(
    (prompt: string) => {
      markAssistantActivity({ force: true });
      setDraft(prompt);
    },
    [markAssistantActivity],
  );

  const appendAttachments = useCallback(
    (nextAttachments: MobileAssistantAttachment[]) => {
      if (!nextAttachments.length) {
        return;
      }

      markAssistantActivity({ force: true });
      setAttachments((current) => [...current, ...nextAttachments].slice(0, 8));
    },
    [markAssistantActivity],
  );

  const openAttachmentSheet = useCallback(() => {
    if (status !== "signed-in") {
      return;
    }

    setAttachmentError(null);
    markAssistantActivity();
    setIsAttachmentSheetOpen(true);
  }, [markAssistantActivity, status]);

  const takePhoto = useCallback(async () => {
    if (status !== "signed-in") {
      return;
    }

    setAttachmentError(null);
    setIsAttachmentSheetOpen(false);

    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      setAttachmentError("Camera permission is needed to take a photo.");
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        mediaTypes: ["images"],
        quality: 0.9,
      });

      if (result.canceled) {
        return;
      }

      appendAttachments(
        result.assets
          .filter((asset) => asset.uri)
          .map((asset, index) =>
            attachmentFromImageAsset(asset, "camera", index),
          ),
      );
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Unable to take that photo.",
      );
    }
  }, [appendAttachments, status]);

  const selectPhotos = useCallback(async () => {
    if (status !== "signed-in") {
      return;
    }

    setAttachmentError(null);
    setIsAttachmentSheetOpen(false);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setAttachmentError(
        "Photo library permission is needed to select images.",
      );
      return;
    }

    try {
      showNativeAttachmentPickerHint("photo");
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        allowsMultipleSelection: true,
        mediaTypes: ["images"],
        orderedSelection: true,
        quality: 1,
        selectionLimit: 8,
      });

      if (result.canceled) {
        return;
      }

      appendAttachments(
        result.assets
          .filter((asset) => asset.uri)
          .map((asset, index) =>
            attachmentFromImageAsset(asset, "photo", index),
          ),
      );
    } catch (error) {
      setAttachmentError(
        error instanceof Error
          ? error.message
          : "Unable to select those photos.",
      );
    }
  }, [appendAttachments, status]);

  const chooseFiles = useCallback(async () => {
    if (status !== "signed-in") {
      return;
    }

    setAttachmentError(null);
    setIsAttachmentSheetOpen(false);
    setKyroFilePickerMessage(null);
    setIsKyroFilePickerOpen(true);
    markAssistantActivity();
  }, [markAssistantActivity, status]);

  const chooseDeviceFiles = useCallback(async () => {
    if (status !== "signed-in") {
      return;
    }

    setAttachmentError(null);
    setKyroFilePickerMessage(null);
    setIsKyroFilePickerOpen(false);

    try {
      showNativeAttachmentPickerHint("file");
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: "*/*",
      });

      if (result.canceled) {
        return;
      }

      appendAttachments(
        result.assets
          .filter((asset) => asset.uri && asset.name)
          .map((asset, index) => attachmentFromDocumentAsset(asset, index)),
      );
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Unable to attach that file.",
      );
    }
  }, [appendAttachments, status]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
  }, []);

  const submitPrompt = (inputSource: "typed" | "voice" = "typed") => {
    const prompt = draft.trim();
    const submissionAttachments = attachments;

    if (
      (!prompt && submissionAttachments.length === 0) ||
      sendMessage.isPending ||
      status !== "signed-in"
    ) {
      return;
    }

    markAssistantActivity({ force: true });
    setPendingPrompt(buildPendingPromptContent(prompt, submissionAttachments));
    setDraft("");
    setAttachments([]);
    setAttachmentError(null);
    sendMessage.mutate({
      attachments: submissionAttachments,
      inputSource,
      prompt,
      threadId: assistant.data?.threadId ?? null,
    });
  };

  const submitGeneratedImageEdit = useCallback(
    (submission: GeneratedImageEditSubmission) => {
      if (sendMessage.isPending || status !== "signed-in") {
        return;
      }

      const request = submission.request.trim();
      const submissionAttachments = submission.markupAttachment
        ? [submission.markupAttachment]
        : [];
      const prompt = [
        "Edit the previously generated image using this user feedback.",
        `User edit request: ${
          request || "Use the attached red markup as the edit instructions."
        }`,
        `Kyro file ID: ${submission.image.fileId}`,
        submission.hasMarkup
          ? "The attached markup image is a transparent red annotation layer showing the requested changes."
          : null,
        "Use the original generated image as the source/reference. Generate and save the edited image; do not only describe the edit.",
      ]
        .filter(Boolean)
        .join("\n");

      markAssistantActivity({ force: true });
      setPendingPrompt(
        buildPendingPromptContent(prompt, submissionAttachments),
      );
      setDraft("");
      setAttachments([]);
      setAttachmentError(null);
      sendMessage.mutate({
        attachments: submissionAttachments,
        inputSource: "typed",
        prompt,
        threadId: assistant.data?.threadId ?? null,
      });
    },
    [assistant.data?.threadId, markAssistantActivity, sendMessage, status],
  );
  const submitVoiceAudio = useCallback(
    (submission: VoiceAudioSubmission) => {
      if (
        sendMessage.isPending ||
        sendVoiceTurn.isPending ||
        status !== "signed-in"
      ) {
        return false;
      }

      markAssistantActivity({ force: true });
      setVoiceNotice(null);
      setVoiceSpeech(null);
      sendVoiceTurn.mutate(submission);
      return true;
    },
    [markAssistantActivity, sendMessage.isPending, sendVoiceTurn, status],
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", default: undefined })}
        style={styles.keyboard}
      >
        <View style={styles.shell}>
          <View style={styles.topBar}>
            <LinearGradient
              colors={[
                "rgba(81, 229, 255, 0.78)",
                "rgba(139, 92, 246, 0.68)",
                "rgba(236, 54, 141, 0.78)",
              ]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.modePillFrame}
            >
              <View style={styles.modePill}>
                {ASSISTANT_MODES.map((item) => (
                  <Pressable
                    accessibilityRole="button"
                    key={item}
                    onPress={() => setMode(item)}
                    style={[
                      styles.modeOption,
                      mode === item ? styles.modeOptionActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeText,
                        mode === item ? styles.modeTextActive : null,
                      ]}
                    >
                      {assistantModeLabel(item)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </LinearGradient>
          </View>

          {isAssistantLoading ? (
            <AssistantLoadingCanvas />
          ) : (
            <DataState
              error={assistant.error ?? sendMessage.error}
              loading={false}
              title="Loading Assistant"
            />
          )}
          {status === "signed-in" && !isAssistantLoading ? (
            mode === "text" ? (
              <TextCanvas
                attachmentError={attachmentError}
                attachments={attachments}
                draft={draft}
                isSending={sendMessage.isPending}
                messages={visibleMessages}
                onAttachPress={openAttachmentSheet}
                onDraftChange={handleDraftChange}
                onGeneratedImageEdit={submitGeneratedImageEdit}
                onPromptPress={handlePromptPress}
                onRemoveAttachment={removeAttachment}
                promptSuggestions={promptSuggestions}
                showDeveloperMetadata={showDeveloperMetadata}
                showPromptSuggestions={showFreshPrompts}
                onSubmit={() => submitPrompt("typed")}
              />
            ) : mode === "vapi" ? (
              <VapiVoiceCanvas
                messages={visibleMessages}
                showDeveloperMetadata={showDeveloperMetadata}
              />
            ) : (
              <VoiceCanvas
                isProcessing={sendVoiceTurn.isPending}
                messages={visibleMessages}
                notice={voiceNotice}
                onSubmitVoiceAudio={submitVoiceAudio}
                showDeveloperMetadata={showDeveloperMetadata}
                speech={voiceSpeech}
              />
            )
          ) : null}
        </View>
      </KeyboardAvoidingView>
      <AttachmentOptionsSheet
        disabled={status !== "signed-in"}
        onChooseFile={chooseFiles}
        onClose={() => setIsAttachmentSheetOpen(false)}
        onSelectPhoto={selectPhotos}
        onTakePhoto={takePhoto}
        visible={isAttachmentSheetOpen}
      />
      <KyroFilePickerModal
        disabled={attachKyroFile.isPending}
        error={kyroFiles.error}
        files={(kyroFiles.data?.files ?? []).filter(
          (file) => file.kind !== "system",
        )}
        loading={kyroFiles.isLoading}
        message={kyroFilePickerMessage}
        onAttach={(file) => attachKyroFile.mutate(file)}
        onClose={() => {
          setKyroFilePickerMessage(null);
          setIsKyroFilePickerOpen(false);
        }}
        onOpenDeviceFiles={chooseDeviceFiles}
        visible={isKyroFilePickerOpen}
      />
    </SafeAreaView>
  );
}

function assistantModeLabel(mode: AssistantMode) {
  if (mode === "vapi") {
    return "Voice";
  }

  return mode === "text" ? "Text" : "Voice";
}

function TextCanvas({
  attachmentError,
  attachments,
  draft,
  isSending,
  messages,
  onAttachPress,
  onDraftChange,
  onGeneratedImageEdit,
  onPromptPress,
  onRemoveAttachment,
  promptSuggestions,
  showDeveloperMetadata,
  showPromptSuggestions,
  onSubmit,
}: {
  attachmentError: string | null;
  attachments: MobileAssistantAttachment[];
  draft: string;
  isSending: boolean;
  messages: AssistantThreadMessage[];
  onAttachPress: () => void;
  onDraftChange: (value: string) => void;
  onGeneratedImageEdit: (submission: GeneratedImageEditSubmission) => void;
  onPromptPress: (value: string) => void;
  onRemoveAttachment: (id: string) => void;
  promptSuggestions: string[];
  showDeveloperMetadata: boolean;
  showPromptSuggestions: boolean;
  onSubmit: () => void;
}) {
  const shouldShowPrompts =
    showPromptSuggestions &&
    promptSuggestions.length > 0 &&
    !draft.trim() &&
    !isSending;
  const { scrollRef, scrollToLatest } = useAutoScrollToLatest(
    messages.length,
    isSending,
  );

  return (
    <View style={styles.canvas}>
      <ScrollView
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollToLatest(false)}
        onLayout={() => scrollToLatest(false)}
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={styles.scrollArea}
      >
        {messages.length === 0 ? <View style={styles.spacer} /> : null}
        {messages.map((message) => (
          <AssistantTurn
            isSending={isSending}
            key={message.id}
            message={message}
            onGeneratedImageEdit={onGeneratedImageEdit}
            showDeveloperMetadata={showDeveloperMetadata}
          />
        ))}
        {isSending ? <AssistantTypingIndicator /> : null}
      </ScrollView>

      <View style={styles.bottomStack}>
        <AnimatedPromptSuggestions
          onPromptPress={onPromptPress}
          prompts={promptSuggestions}
          visible={shouldShowPrompts}
        />

        <Composer
          action="send"
          attachmentError={attachmentError}
          attachments={attachments}
          disabled={false}
          isSending={isSending}
          onAttachPress={onAttachPress}
          onChangeText={onDraftChange}
          onRemoveAttachment={onRemoveAttachment}
          onSubmit={onSubmit}
          placeholder="Ask Kyro"
          value={draft}
        />
      </View>
    </View>
  );
}

function VoiceCanvas({
  isProcessing,
  messages,
  notice,
  onSubmitVoiceAudio,
  showDeveloperMetadata,
  speech,
}: {
  isProcessing: boolean;
  messages: AssistantThreadMessage[];
  notice: string | null;
  onSubmitVoiceAudio: (submission: VoiceAudioSubmission) => boolean;
  showDeveloperMetadata: boolean;
  speech: MobileAssistantSpeechPayload | null;
}) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);
  const playerRef = useRef<AudioPlayer | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRecordingRef = useRef<() => Promise<void>>(async () => undefined);
  const sessionActiveRef = useRef(false);
  const awaitingReplyRef = useRef(false);
  const wasProcessingRef = useRef(false);
  const autoStopRef = useRef(false);
  const hasHeardSpeechRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [isPlayingSpeech, setIsPlayingSpeech] = useState(false);
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  const isRecording = recorderState.isRecording;
  const displayedNotice = isRecording ? localNotice : (localNotice ?? notice);
  const transcriptMessages = useMemo(
    () => messages.slice(-VOICE_TRANSCRIPT_LIMIT),
    [messages],
  );
  const { scrollRef, scrollToLatest } = useAutoScrollToLatest(
    transcriptMessages.length,
    isProcessing || isRecording || isPlayingSpeech,
  );
  const voiceState: VoiceState = isRecording
    ? "recording"
    : isProcessing
      ? "thinking"
      : isPlayingSpeech
        ? "speaking"
        : "idle";
  const shouldShowVoiceActivity = voiceState !== "idle";

  useEffect(() => {
    sessionActiveRef.current = isVoiceSessionActive;
  }, [isVoiceSessionActive]);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const queueRestart = useCallback(
    (delay = VOICE_RESTART_DELAY_MS) => {
      clearRestartTimer();

      if (!sessionActiveRef.current) {
        return;
      }

      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        void startRecordingRef.current();
      }, delay);
    },
    [clearRestartTimer],
  );

  const resetVoiceDetection = useCallback(() => {
    autoStopRef.current = false;
    hasHeardSpeechRef.current = false;
    lastSpeechAtRef.current = 0;
  }, []);

  const startRecording = useCallback(async () => {
    if (isProcessing || isPlayingSpeech || isRecording) {
      return;
    }

    clearRestartTimer();
    resetVoiceDetection();
    setLocalNotice(null);

    try {
      const permission = await requestRecordingPermissionsAsync();

      if (!permission.granted) {
        setIsVoiceSessionActive(false);
        sessionActiveRef.current = false;
        setLocalNotice("Microphone permission is required.");
        return;
      }

      playerRef.current?.pause();
      setIsPlayingSpeech(false);
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      setIsVoiceSessionActive(false);
      sessionActiveRef.current = false;
      setLocalNotice(
        error instanceof Error ? error.message : "Unable to start recording.",
      );
      await setAudioModeAsync({ allowsRecording: false }).catch(
        () => undefined,
      );
    }
  }, [
    clearRestartTimer,
    isPlayingSpeech,
    isProcessing,
    isRecording,
    recorder,
    resetVoiceDetection,
  ]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  const stopRecording = useCallback(
    async ({ submit }: { submit: boolean }) => {
      if (!isRecording) {
        return;
      }

      clearRestartTimer();
      const beforeStopStatus = recorder.getStatus();

      try {
        await recorder.stop();
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          shouldRouteThroughEarpiece: false,
        });

        const afterStopStatus = recorder.getStatus();
        const uri = recorder.uri ?? afterStopStatus.url ?? beforeStopStatus.url;
        const durationMs = Math.max(
          beforeStopStatus.durationMillis,
          afterStopStatus.durationMillis,
        );
        resetVoiceDetection();

        if (!submit) {
          return;
        }

        if (!uri) {
          setLocalNotice("Kyro could not access that recording.");
          setIsVoiceSessionActive(false);
          sessionActiveRef.current = false;
          return;
        }

        if (durationMs < MIN_VOICE_DURATION_MS) {
          setLocalNotice("I didn't quite catch that.");
          queueRestart(700);
          return;
        }

        const fileReady = await waitForVoiceFileReady(uri);

        if (!fileReady) {
          setLocalNotice("That recording did not save cleanly.");
          queueRestart(900);
          return;
        }

        setLocalNotice(null);
        const submitted = onSubmitVoiceAudio({
          durationMs,
          mimeType: mimeTypeForAudioUri(uri),
          name: voiceRecordingName(uri),
          uri,
        });

        if (submitted) {
          awaitingReplyRef.current = true;
          wasProcessingRef.current = false;
          return;
        }

        setIsVoiceSessionActive(false);
        sessionActiveRef.current = false;
      } catch (error) {
        resetVoiceDetection();
        setIsVoiceSessionActive(false);
        sessionActiveRef.current = false;
        setLocalNotice(
          error instanceof Error ? error.message : "Unable to stop recording.",
        );
        await setAudioModeAsync({ allowsRecording: false }).catch(
          () => undefined,
        );
      }
    },
    [
      clearRestartTimer,
      isRecording,
      onSubmitVoiceAudio,
      queueRestart,
      recorder,
      resetVoiceDetection,
    ],
  );

  useEffect(() => {
    if (!isRecording || !isVoiceSessionActive || autoStopRef.current) {
      return;
    }

    const metering = recorderState.metering;
    const now = Date.now();

    if (
      typeof metering === "number" &&
      Number.isFinite(metering) &&
      metering >= VOICE_SPEECH_THRESHOLD_DB
    ) {
      hasHeardSpeechRef.current = true;
      lastSpeechAtRef.current = now;
    }

    if (
      hasHeardSpeechRef.current &&
      recorderState.durationMillis >= VOICE_MIN_AUTO_SUBMIT_MS &&
      now - lastSpeechAtRef.current >= VOICE_SILENCE_HOLD_MS
    ) {
      autoStopRef.current = true;
      void stopRecording({ submit: true });
    }
  }, [
    isRecording,
    isVoiceSessionActive,
    recorderState.durationMillis,
    recorderState.metering,
    stopRecording,
  ]);

  useEffect(() => {
    if (!speech?.audioBase64) {
      return undefined;
    }

    const currentSpeech = speech;
    let isCancelled = false;
    let playbackSubscription: { remove: () => void } | null = null;

    async function playSpeech() {
      const uri = await writeSpeechToCache(currentSpeech);

      if (isCancelled) {
        return;
      }

      playerRef.current?.remove();
      const player = createAudioPlayer(
        { uri },
        { keepAudioSessionActive: false, updateInterval: 250 },
      );
      playerRef.current = player;
      setIsPlayingSpeech(true);
      playbackSubscription = player.addListener(
        "playbackStatusUpdate",
        (status) => {
          if (status.didJustFinish || status.error) {
            setIsPlayingSpeech(false);
            awaitingReplyRef.current = false;
            queueRestart(status.error ? 700 : VOICE_RESTART_DELAY_MS);
          }
        },
      );
      player.play();
    }

    void playSpeech().catch((error) => {
      setIsPlayingSpeech(false);
      awaitingReplyRef.current = false;
      setLocalNotice(
        error instanceof Error ? error.message : "Unable to play voice reply.",
      );
      queueRestart(700);
    });

    return () => {
      isCancelled = true;
      playbackSubscription?.remove();
    };
  }, [queueRestart, speech]);

  useEffect(() => {
    if (!notice || !awaitingReplyRef.current || speech?.audioBase64) {
      return;
    }

    awaitingReplyRef.current = false;
    wasProcessingRef.current = false;
    setIsVoiceSessionActive(false);
    sessionActiveRef.current = false;
    clearRestartTimer();
  }, [clearRestartTimer, notice, speech?.audioBase64]);

  useEffect(() => {
    if (isProcessing) {
      wasProcessingRef.current = true;
      return;
    }

    if (
      !wasProcessingRef.current ||
      !awaitingReplyRef.current ||
      isRecording ||
      isPlayingSpeech ||
      !isVoiceSessionActive ||
      speech?.audioBase64 ||
      notice
    ) {
      return;
    }

    wasProcessingRef.current = false;
    awaitingReplyRef.current = false;
    queueRestart();
  }, [
    isProcessing,
    isPlayingSpeech,
    isRecording,
    isVoiceSessionActive,
    notice,
    queueRestart,
    speech?.audioBase64,
  ]);

  useEffect(
    () => () => {
      clearRestartTimer();
      playerRef.current?.remove();
      void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    },
    [clearRestartTimer, recorder],
  );

  const handleVoicePress = useCallback(() => {
    if (isVoiceSessionActive || isRecording || isPlayingSpeech) {
      setIsVoiceSessionActive(false);
      sessionActiveRef.current = false;
      awaitingReplyRef.current = false;
      wasProcessingRef.current = false;
      clearRestartTimer();

      if (isRecording) {
        void stopRecording({ submit: false });
      }

      if (isPlayingSpeech) {
        playerRef.current?.pause();
        setIsPlayingSpeech(false);
      }

      return;
    }

    setIsVoiceSessionActive(true);
    sessionActiveRef.current = true;
    void startRecording();
  }, [
    clearRestartTimer,
    isPlayingSpeech,
    isRecording,
    isVoiceSessionActive,
    startRecording,
    stopRecording,
  ]);

  return (
    <View style={styles.canvas}>
      <ScrollView
        contentContainerStyle={styles.transcriptContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollToLatest(false)}
        onLayout={() => scrollToLatest(false)}
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={styles.scrollArea}
      >
        <Text style={styles.transcriptEyebrow}>Live transcript</Text>
        {transcriptMessages.map((message) => (
          <VoiceTranscriptTurn
            key={message.id}
            message={message}
            showDeveloperMetadata={showDeveloperMetadata}
          />
        ))}
        {displayedNotice ? (
          <View style={styles.voiceNotice}>
            <Text style={styles.voiceNoticeText}>{displayedNotice}</Text>
          </View>
        ) : null}
      </ScrollView>

      <LinearGradient
        colors={[
          "rgba(81, 229, 255, 0.68)",
          "rgba(139, 92, 246, 0.42)",
          "rgba(236, 54, 141, 0.68)",
        ]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.voiceDockFrame}
      >
        <View style={styles.voiceDock}>
          <View style={styles.voiceDockTop}>
            <View style={styles.voiceCopy}>
              <Text style={styles.voiceTitle}>
                {voiceStatusTitle(voiceState)}
              </Text>
              <Text style={styles.voiceText}>
                {voiceStatusText(voiceState)}
              </Text>
            </View>
            {isRecording ? (
              <Text style={styles.voiceTimer}>
                {formatVoiceDuration(recorderState.durationMillis)}
              </Text>
            ) : null}
          </View>
          {shouldShowVoiceActivity ? (
            <VoiceMeter
              active={voiceState === "recording" || voiceState === "speaking"}
              level={recorderState.metering}
            />
          ) : (
            <Text style={styles.voiceIdleHint}>
              Tap once, speak naturally, then Kyro sends when you pause.
            </Text>
          )}
          <Pressable
            accessibilityLabel={
              isVoiceSessionActive ? "End voice session" : "Start voice session"
            }
            accessibilityRole="button"
            onPress={handleVoicePress}
            style={({ pressed }) => [
              styles.voiceOrbButton,
              isVoiceSessionActive || isRecording
                ? styles.voiceOrbButtonRecording
                : null,
              pressed ? styles.pressed : null,
            ]}
          >
            {isVoiceSessionActive || isRecording ? (
              <Square
                color={colors.background}
                fill={colors.background}
                size={28}
              />
            ) : isPlayingSpeech ? (
              <Volume2 color={colors.background} size={31} strokeWidth={2.8} />
            ) : (
              <Mic color={colors.background} size={31} strokeWidth={2.8} />
            )}
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

function VapiVoiceCanvas({
  messages,
  showDeveloperMetadata,
}: {
  messages: AssistantThreadMessage[];
  showDeveloperMetadata: boolean;
}) {
  const vapi = useVapiCall();
  const transcriptMessages = useMemo(
    () =>
      mergeVapiTranscriptMessages([...messages, ...vapi.localTurns]).slice(
        -VOICE_TRANSCRIPT_LIMIT,
      ),
    [messages, vapi.localTurns],
  );
  const { scrollRef, scrollToLatest } = useAutoScrollToLatest(
    transcriptMessages.length + (vapi.liveTranscript ? 1 : 0),
    vapi.isConnected,
  );

  if (vapi.isSessionLoading && !vapi.session) {
    return <AssistantLoadingCanvas />;
  }

  return (
    <View style={styles.canvas}>
      <ScrollView
        contentContainerStyle={styles.transcriptContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollToLatest(false)}
        onLayout={() => scrollToLatest(false)}
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={styles.scrollArea}
      >
        <Text style={styles.transcriptEyebrow}>Voice Assistant transcript</Text>
        {transcriptMessages.map((message) => (
          <VoiceTranscriptTurn
            key={message.id}
            message={message}
            showDeveloperMetadata={showDeveloperMetadata}
          />
        ))}
        {vapi.liveTranscript ? (
          <View style={styles.voiceLiveTurn}>
            <Text style={styles.voiceLiveMeta}>You</Text>
            <Text style={styles.voiceLiveText}>{vapi.liveTranscript}</Text>
          </View>
        ) : null}
        {vapi.setupHint && !vapi.isConnected ? (
          <View style={styles.voiceNotice}>
            <Text style={styles.voiceNoticeText}>{vapi.setupHint}</Text>
          </View>
        ) : null}
        {vapi.sessionError && !vapi.isConnected ? (
          <View style={styles.voiceNotice}>
            <Text style={styles.voiceNoticeText}>
              {vapi.sessionError.message}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <LinearGradient
        colors={[
          "rgba(81, 229, 255, 0.68)",
          "rgba(139, 92, 246, 0.42)",
          "rgba(236, 54, 141, 0.68)",
        ]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.voiceDockFrame}
      >
        <View style={styles.voiceDock}>
          <View style={styles.voiceDockTop}>
            <View style={styles.voiceCopy}>
              <Text style={styles.voiceTitle}>{vapi.statusLabel}</Text>
              <Text style={styles.voiceText}>{vapi.displayedStatus}</Text>
            </View>
            {vapi.isConnected ? (
              <Text style={styles.voiceTimer}>Live</Text>
            ) : null}
          </View>
          {vapi.isConnected ? (
            <VoiceMeter
              active={vapi.connectionState !== "connecting"}
              level={vapiVoiceLevelToMetering(vapi.voiceLevel)}
            />
          ) : (
            <Text style={styles.voiceIdleHint}>
              Tap once to start the voice assistant.
            </Text>
          )}
          <Pressable
            accessibilityLabel={
              vapi.isConnected ? "End voice assistant" : "Start voice assistant"
            }
            accessibilityRole="button"
            disabled={vapi.connectionState === "connecting"}
            onPress={() => {
              if (vapi.isConnected) {
                vapi.stopVapi();
                return;
              }

              void vapi.startVapi();
            }}
            style={({ pressed }) => [
              styles.voiceOrbButton,
              vapi.isConnected ? styles.voiceOrbButtonRecording : null,
              pressed ? styles.pressed : null,
              vapi.connectionState === "connecting" ? styles.disabled : null,
            ]}
          >
            {vapi.isConnected ? (
              <Square
                color={colors.background}
                fill={colors.background}
                size={28}
              />
            ) : (
              <Mic color={colors.background} size={31} strokeWidth={2.8} />
            )}
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

function AssistantLoadingCanvas() {
  return (
    <View style={styles.canvas}>
      <View
        accessibilityLabel="Loading assistant conversation"
        accessibilityRole="progressbar"
        style={styles.loadingStack}
      >
        <View style={styles.loadingAssistantTurn}>
          <View style={[styles.skeletonLine, styles.skeletonMeta]} />
          <View style={[styles.skeletonLine, styles.skeletonLong]} />
          <View style={[styles.skeletonLine, styles.skeletonMid]} />
          <View style={styles.skeletonCardRow}>
            <View style={styles.skeletonCard} />
            <View style={styles.skeletonCard} />
          </View>
        </View>

        <View style={styles.loadingUserTurn}>
          <View style={[styles.skeletonLine, styles.skeletonUserLine]} />
          <View style={[styles.skeletonLine, styles.skeletonUserShort]} />
        </View>

        <View style={styles.loadingAssistantTurn}>
          <View style={[styles.skeletonLine, styles.skeletonMeta]} />
          <View style={[styles.skeletonLine, styles.skeletonLong]} />
          <View style={[styles.skeletonLine, styles.skeletonShort]} />
        </View>
      </View>

      <View style={styles.loadingComposerFrame}>
        <View style={styles.loadingComposer}>
          <View style={styles.loadingComposerIcon} />
          <View style={[styles.skeletonLine, styles.loadingInputLine]} />
          <View style={styles.loadingSendButton} />
        </View>
      </View>
    </View>
  );
}

function VoiceMeter({
  active,
  compact = false,
  level,
}: {
  active: boolean;
  compact?: boolean;
  level?: number;
}) {
  const normalized = normalizedVoiceLevel(level);

  return (
    <View
      style={[styles.voiceMeter, compact ? styles.voiceMeterCompact : null]}
    >
      {[0.32, 0.64, 0.92, 0.55, 0.76].map((weight, index) => (
        <View
          key={`${weight}-${index}`}
          style={[
            styles.voiceMeterBar,
            compact ? styles.voiceMeterBarCompact : null,
            {
              height: active
                ? `${Math.max(18, Math.min(100, normalized * 100 * weight + 18))}%`
                : "24%",
            },
          ]}
        />
      ))}
    </View>
  );
}

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

function loadVapiConstructor(): VapiConstructor {
  const module = require("@vapi-ai/react-native") as {
    default?: VapiConstructor;
  } & VapiConstructor;

  return module.default ?? module;
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

function voiceLevelToMetering(level: number) {
  return Math.max(-60, Math.min(0, -60 + level * 60));
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

function mergeTranscriptMessages(messages: AssistantThreadMessage[]) {
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
    };
  }

  return merged;
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

  return safeJson(value) ?? directMessage ?? "Voice assistant failed.";
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

function AssistantTypingIndicator() {
  const dots = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    const animations = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 160),
          Animated.timing(dot, {
            duration: 460,
            easing: Easing.inOut(Easing.ease),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            duration: 460,
            easing: Easing.inOut(Easing.ease),
            toValue: 0,
            useNativeDriver: true,
          }),
          Animated.delay((dots.length - index - 1) * 160),
        ]),
      ),
    );

    animations.forEach((animation) => animation.start());

    return () => animations.forEach((animation) => animation.stop());
  }, [dots]);

  return (
    <View
      accessibilityLabel="Kyro is typing"
      accessibilityRole="progressbar"
      style={styles.typingTurn}
    >
      <View style={styles.typingDots}>
        {dots.map((dot, index) => {
          const opacity = dot.interpolate({
            inputRange: [0, 1],
            outputRange: [0.35, 1],
          });
          const translateY = dot.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -3],
          });

          return (
            <Animated.View
              key={index}
              style={[
                styles.typingDotFrame,
                {
                  opacity,
                  transform: [{ translateY }],
                },
              ]}
            >
              <LinearGradient
                colors={[colors.cyan, colors.pink]}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={styles.typingDot}
              />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

function AnimatedPromptSuggestions({
  onPromptPress,
  prompts,
  visible,
}: {
  onPromptPress: (value: string) => void;
  prompts: string[];
  visible: boolean;
}) {
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [shouldRender, setShouldRender] = useState(visible);
  const expandedHeight = Math.max(0, prompts.length * 39 + 2);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
    }

    Animated.timing(progress, {
      duration: 160,
      easing: Easing.out(Easing.cubic),
      toValue: visible ? 1 : 0,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !visible) {
        setShouldRender(false);
      }
    });
  }, [progress, visible]);

  if (!shouldRender) {
    return null;
  }

  const maxHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, expandedHeight],
  });
  const marginBottom = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 8],
  });
  const opacity = progress;
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.promptListShell,
        {
          marginBottom,
          maxHeight,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.promptList}>
        {prompts.map((prompt, index) => {
          const accent = promptAccents[index % promptAccents.length];

          return (
            <Pressable
              accessibilityRole="button"
              key={prompt}
              onPress={() => onPromptPress(prompt)}
              style={styles.promptRow}
            >
              <View
                style={[
                  styles.promptIconFrame,
                  {
                    backgroundColor: accent.backgroundColor,
                    borderColor: accent.borderColor,
                  },
                ]}
              >
                <Waves color={accent.color} size={18} strokeWidth={2.3} />
              </View>
              <Text numberOfLines={1} style={styles.promptText}>
                {prompt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

function AttachmentOptionsSheet({
  disabled,
  onChooseFile,
  onClose,
  onSelectPhoto,
  onTakePhoto,
  visible,
}: {
  disabled: boolean;
  onChooseFile: () => void;
  onClose: () => void;
  onSelectPhoto: () => void;
  onTakePhoto: () => void;
  visible: boolean;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={styles.attachmentSheetBackdrop}
      >
        <View style={styles.attachmentOptionList}>
          <AttachmentOption
            disabled={disabled}
            icon={<Camera color={colors.cyan} size={18} strokeWidth={2.4} />}
            label="Take photo"
            onPress={onTakePhoto}
          />
          <AttachmentOption
            disabled={disabled}
            icon={<ImageIcon color={colors.pink} size={18} strokeWidth={2.4} />}
            label="Select photo"
            onPress={onSelectPhoto}
          />
          <AttachmentOption
            disabled={disabled}
            icon={
              <FileText color={colors.purple} size={18} strokeWidth={2.4} />
            }
            label="Choose file"
            onPress={onChooseFile}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

function KyroFilePickerModal({
  disabled,
  error,
  files,
  loading,
  message,
  onAttach,
  onClose,
  onOpenDeviceFiles,
  visible,
}: {
  disabled: boolean;
  error: Error | null;
  files: MobileFileItem[];
  loading: boolean;
  message: string | null;
  onAttach: (file: MobileFileItem) => void;
  onClose: () => void;
  onOpenDeviceFiles: () => void;
  visible: boolean;
}) {
  const recentFiles = files.slice(0, 30);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.kyroFileBackdrop}>
        <View style={styles.kyroFileSheet}>
          <View style={styles.kyroFileHeader}>
            <View style={styles.kyroFileHeaderCopy}>
              <Text style={styles.kyroFileEyebrow}>Kyro files</Text>
              <Text style={styles.kyroFileTitle}>Choose file</Text>
            </View>
            <Pressable
              accessibilityLabel="Close Kyro file picker"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.kyroFileClose}
            >
              <X color={colors.text} size={22} strokeWidth={2.4} />
            </Pressable>
          </View>

          {message ? (
            <Text style={styles.kyroFileMessage}>{message}</Text>
          ) : null}
          {error ? (
            <Text style={styles.kyroFileMessage}>
              {error.message || "Unable to load Kyro files."}
            </Text>
          ) : null}

          <ScrollView
            contentContainerStyle={styles.kyroFileList}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <>
                <View style={styles.kyroFileSkeleton} />
                <View style={styles.kyroFileSkeleton} />
                <View style={styles.kyroFileSkeleton} />
              </>
            ) : recentFiles.length ? (
              recentFiles.map((file) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  key={file.id}
                  onPress={() => onAttach(file)}
                  style={({ pressed }) => [
                    styles.kyroFileRow,
                    pressed ? styles.pressed : null,
                    disabled ? styles.disabled : null,
                  ]}
                >
                  <View style={styles.kyroFileIcon}>
                    <FileText
                      color={fileRowTone(file)}
                      size={17}
                      strokeWidth={2.4}
                    />
                  </View>
                  <View style={styles.kyroFileRowCopy}>
                    <Text numberOfLines={1} style={styles.kyroFileName}>
                      {file.filename}
                    </Text>
                    <Text numberOfLines={1} style={styles.kyroFileMeta}>
                      {file.sourceLabel}
                      {formatBytes(file.sizeBytes)
                        ? ` · ${formatBytes(file.sizeBytes)}`
                        : ""}
                    </Text>
                  </View>
                </Pressable>
              ))
            ) : (
              <View style={styles.kyroFileEmpty}>
                <Text style={styles.kyroFileEmptyTitle}>No Kyro files yet</Text>
                <Text style={styles.kyroFileEmptyText}>
                  Generated and uploaded files will appear here.
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.kyroFileFooter}>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={onOpenDeviceFiles}
              style={({ pressed }) => [
                styles.deviceFileButton,
                pressed ? styles.pressed : null,
                disabled ? styles.disabled : null,
              ]}
            >
              <FileText color={colors.muted} size={17} strokeWidth={2.4} />
              <Text style={styles.deviceFileButtonText}>
                Browse device files
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AttachmentOption({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.attachmentOption,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <View style={styles.attachmentOptionIcon}>{icon}</View>
      <View style={styles.attachmentOptionCopy}>
        <Text style={styles.attachmentOptionLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

const VoiceTranscriptTurn = memo(function VoiceTranscriptTurn({
  message,
  showDeveloperMetadata,
}: {
  message: AssistantThreadMessage;
  showDeveloperMetadata: boolean;
}) {
  const isUser = message.role === "user";
  const display = splitAssistantAttachmentContext(message.content);
  const speakerLabel = isUser ? "You" : "Kyro";

  return (
    <View style={styles.transcriptTurn}>
      {display.text ? (
        <Text
          style={isUser ? styles.transcriptLine : styles.transcriptLineMuted}
        >
          {speakerLabel}: {display.text}
        </Text>
      ) : null}
      {display.attachments.length ? (
        <InlineAttachments attachments={display.attachments} />
      ) : null}
      {!isUser ? (
        <AssistantMessageBlocks
          isSending={false}
          message={message}
          showDeveloperMetadata={showDeveloperMetadata}
        />
      ) : null}
    </View>
  );
});

const AssistantTurn = memo(function AssistantTurn({
  isSending,
  message,
  onGeneratedImageEdit,
  showDeveloperMetadata,
}: {
  isSending: boolean;
  message: AssistantThreadMessage;
  onGeneratedImageEdit: (submission: GeneratedImageEditSubmission) => void;
  showDeveloperMetadata: boolean;
}) {
  const isUser = message.role === "user";
  const display = splitAssistantAttachmentContext(message.content);

  return (
    <View
      style={[styles.turn, isUser ? styles.userTurn : styles.assistantTurn]}
    >
      <Text style={styles.turnMeta}>
        {isUser ? "You" : providerLabel(message, showDeveloperMetadata)}
      </Text>
      {display.text ? (
        <Text style={isUser ? styles.userTurnText : styles.turnText}>
          {display.text}
        </Text>
      ) : null}
      {display.attachments.length ? (
        <InlineAttachments attachments={display.attachments} />
      ) : null}
      {!isUser ? (
        <AssistantMessageBlocks
          isSending={isSending}
          message={message}
          onSubmitGeneratedImageEdit={onGeneratedImageEdit}
          showDeveloperMetadata={showDeveloperMetadata}
        />
      ) : null}
    </View>
  );
});

function InlineAttachments({
  attachments,
}: {
  attachments: AssistantDisplayAttachment[];
}) {
  return (
    <View style={styles.inlineAttachmentList}>
      {attachments.map((attachment) => (
        <View
          key={`${attachment.name}-${attachment.sizeLabel ?? "file"}`}
          style={styles.inlineAttachment}
        >
          <Text numberOfLines={1} style={styles.inlineAttachmentName}>
            {attachment.name}
          </Text>
          <Text numberOfLines={1} style={styles.inlineAttachmentMeta}>
            {[attachment.sizeLabel, attachment.contentType]
              .filter(Boolean)
              .join(" - ")}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Composer({
  action,
  attachmentError,
  attachments,
  disabled,
  isSending,
  onAttachPress,
  onChangeText,
  onRemoveAttachment,
  onSubmit,
  placeholder,
  value,
}: {
  action: "mic" | "send";
  attachmentError: string | null;
  attachments: MobileAssistantAttachment[];
  disabled: boolean;
  isSending: boolean;
  onAttachPress: () => void;
  onChangeText: (value: string) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: () => void;
  placeholder: string;
  value: string;
}) {
  const Icon = action === "send" ? Send : Mic;
  const canSubmit = Boolean(value.trim() || attachments.length > 0);

  return (
    <View style={styles.composerBlock}>
      {attachments.length ? (
        <ScrollView
          contentContainerStyle={styles.attachmentRail}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
        >
          {attachments.map((attachment) => (
            <View key={attachment.id} style={styles.attachmentChip}>
              <AttachmentPreview attachment={attachment} />
              <View style={styles.attachmentCopy}>
                <Text numberOfLines={1} style={styles.attachmentName}>
                  {attachment.name}
                </Text>
                <Text numberOfLines={1} style={styles.attachmentMeta}>
                  {[formatBytes(attachment.size), attachment.mimeType]
                    .filter(Boolean)
                    .join(" - ")}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => onRemoveAttachment(attachment.id)}
                style={styles.attachmentRemove}
              >
                <X color={colors.muted} size={14} strokeWidth={2.6} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {attachmentError ? (
        <Text style={styles.attachmentError}>{attachmentError}</Text>
      ) : null}
      <LinearGradient
        colors={[
          "rgba(81, 229, 255, 0.82)",
          "rgba(139, 92, 246, 0.58)",
          "rgba(236, 54, 141, 0.82)",
        ]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.composerFrame}
      >
        <View style={styles.composer}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onAttachPress}
            style={[styles.composerIcon, disabled ? styles.disabled : null]}
          >
            <Plus color={colors.text} size={24} strokeWidth={2.5} />
          </Pressable>
          <TextInput
            editable={!disabled}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            returnKeyType="send"
            style={styles.input}
            value={value}
          />
          <Pressable
            accessibilityRole="button"
            disabled={disabled || isSending || !canSubmit}
            onPress={onSubmit}
            style={[
              styles.actionButton,
              disabled || isSending || !canSubmit ? styles.disabled : null,
            ]}
          >
            <Icon color={colors.background} size={20} strokeWidth={2.6} />
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

function AttachmentPreview({
  attachment,
}: {
  attachment: MobileAssistantAttachment;
}) {
  const [hasPreviewError, setHasPreviewError] = useState(false);
  const isImage = attachment.mimeType.startsWith("image/");

  if (isImage && !hasPreviewError) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        onError={() => setHasPreviewError(true)}
        resizeMode="cover"
        source={{ uri: attachment.uri }}
        style={styles.attachmentThumbnail}
      />
    );
  }

  const Icon = isImage ? ImageIcon : FileText;

  return (
    <View style={styles.attachmentThumbnailFallback}>
      <Icon
        color={isImage ? colors.pink : colors.cyan}
        size={17}
        strokeWidth={2.4}
      />
    </View>
  );
}

function providerLabel(
  message: AssistantThreadMessage,
  showDeveloperMetadata: boolean,
) {
  if (message.provider === "vapi") {
    return "Kyro - Voice";
  }

  return "Kyro - Text";
}

function developerProviderLabel(
  message: AssistantThreadMessage,
  baseLabel: string,
) {
  const parts = [message.provider, message.model].filter(Boolean);
  const suffix = parts.length ? ` / ${parts.join(" / ")}` : "";
  const fallback = message.fallbackReason ? " / fallback" : "";

  return `${baseLabel}${suffix}${fallback}`;
}

function normalizedPendingPrompt(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function hasRenderableMessage(message: AssistantThreadMessage) {
  return Boolean(
    message.content.trim() ||
    (message.links?.length ?? 0) > 0 ||
    (message.uiBlocks?.length ?? 0) > 0,
  );
}

function buildPendingPromptContent(
  prompt: string,
  attachments: MobileAssistantAttachment[],
) {
  if (attachments.length === 0) {
    return prompt;
  }

  const context = attachments
    .map((attachment) =>
      [
        `File: ${attachment.name} (${attachment.mimeType || "unknown type"}, ${
          attachment.size ?? 0
        } bytes)`,
        "Content: File selected and will be uploaded to Kyro files.",
      ].join("\n"),
    )
    .join("\n\n");

  return `${prompt.trim() || "Please review the attached file context."}\n\nAttached file context:\n${context}`;
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
  const [contentType, sizeLabel] = metadata
    .split(",")
    .map((part) => part.trim());

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

  if (!bytesMatch?.[1]) {
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

function attachmentFromDocumentAsset(
  asset: DocumentPicker.DocumentPickerAsset,
  index: number,
): MobileAssistantAttachment {
  return {
    id: `${Date.now()}-file-${index}-${asset.name}`,
    mimeType: asset.mimeType || mimeTypeFromUri(asset.uri),
    name: asset.name || nameFromUri(asset.uri, `file-${index + 1}`),
    size: typeof asset.size === "number" ? asset.size : null,
    uri: asset.uri,
  };
}

function attachmentFromImageAsset(
  asset: ImagePicker.ImagePickerAsset,
  source: "camera" | "photo",
  index: number,
): MobileAssistantAttachment {
  const mimeType = asset.mimeType || mimeTypeFromUri(asset.uri);
  const fallbackName = `kyro-${source}-${Date.now()}-${index + 1}${extensionFromMime(mimeType)}`;

  return {
    id: `${Date.now()}-${source}-${index}-${asset.uri}`,
    mimeType,
    name: asset.fileName || nameFromUri(asset.uri, fallbackName),
    size: typeof asset.fileSize === "number" ? asset.fileSize : null,
    uri: asset.uri,
  };
}

function showNativeAttachmentPickerHint(kind: "file" | "photo") {
  if (Platform.OS !== "android") {
    return;
  }

  ToastAndroid.show(
    kind === "file"
      ? "Android Files is open. Press Back to return to Kyro."
      : "Android photo picker is open. Press Back to return to Kyro.",
    ToastAndroid.LONG,
  );
}

function fileRowTone(file: MobileFileItem) {
  if (file.kind === "image" || file.contentType?.startsWith("image/")) {
    return colors.pink;
  }

  if (file.kind === "generated") {
    return colors.cyan;
  }

  return colors.purple;
}

function safeLocalFilename(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, "-").trim();

  return cleaned || "kyro-file";
}

function nameFromUri(uri: string, fallback: string) {
  const pathname = uri.split("?")[0] ?? "";
  const name = decodeURIComponent(pathname.split("/").pop() ?? "").trim();

  return name || fallback;
}

function mimeTypeFromUri(uri: string) {
  const extension = (uri.split("?")[0] ?? "").split(".").pop()?.toLowerCase();

  switch (extension) {
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function extensionFromMime(mimeType: string) {
  switch (mimeType) {
    case "image/heic":
      return ".heic";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return ".jpg";
  }
}

function formatBytes(bytes: number | null) {
  if (!bytes || bytes <= 0) {
    return null;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function assistantActivityKey(userId: string) {
  return `kyro:assistant:last-activity:${userId}`;
}

function assistantSuggestionsShownKey(userId: string) {
  return `kyro:assistant:suggestions-shown:${userId}`;
}

function shouldShowFreshPromptSuggestions({
  lastActivityAt,
  latestThreadActivityAt,
  localSuppressedUntil,
  suggestionsShownAt,
}: {
  lastActivityAt: string | null;
  latestThreadActivityAt: string | null;
  localSuppressedUntil: number;
  suggestionsShownAt: string | null;
}) {
  const now = new Date();
  const nowTime = now.getTime();
  const activityTime = parseStoredTime(lastActivityAt);
  const latestThreadActivityTime = parseStoredTime(latestThreadActivityAt);
  const suggestionsShownTime = parseStoredTime(suggestionsShownAt);
  const hasRecentActivity =
    activityTime !== null && nowTime - activityTime < FRESH_PROMPT_INTERVAL_MS;
  const hasRecentThreadActivity =
    latestThreadActivityTime !== null &&
    nowTime - latestThreadActivityTime < FRESH_PROMPT_INTERVAL_MS;
  const hasRecentlyShownSuggestions =
    suggestionsShownTime !== null &&
    nowTime - suggestionsShownTime < FRESH_PROMPT_INTERVAL_MS;
  const isLocallySuppressed = localSuppressedUntil > nowTime;

  return (
    !isLocallySuppressed &&
    !hasRecentActivity &&
    !hasRecentThreadActivity &&
    !hasRecentlyShownSuggestions
  );
}

function parseStoredTime(value: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestPersistedThreadActivity(messages: AssistantThreadMessage[]) {
  let latestTime: number | null = null;

  for (const message of messages) {
    if (
      message.id === "assistant-welcome" ||
      message.id === "pending-user-message"
    ) {
      continue;
    }

    const timestamp = parseStoredTime(message.createdAt ?? null);

    if (timestamp !== null && (latestTime === null || timestamp > latestTime)) {
      latestTime = timestamp;
    }
  }

  return latestTime === null ? null : new Date(latestTime).toISOString();
}

function useAutoScrollToLatest(itemCount: number, isSending: boolean) {
  const scrollRef = useRef<ScrollView | null>(null);

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    scrollToLatest(false);
  }, [isSending, itemCount, scrollToLatest]);

  return { scrollRef, scrollToLatest };
}

async function writeSpeechToCache(speech: MobileAssistantSpeechPayload) {
  const fileExtension = audioExtensionForContentType(speech.contentType);
  const cacheDirectory = FileSystem.cacheDirectory;

  if (!cacheDirectory) {
    return `data:${speech.contentType};base64,${speech.audioBase64}`;
  }

  const fileUri = `${cacheDirectory}kyro-voice-${Date.now()}.${fileExtension}`;

  await FileSystem.writeAsStringAsync(fileUri, speech.audioBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return fileUri;
}

async function waitForVoiceFileReady(uri: string) {
  let previousSize = 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);

    if (info?.exists && typeof info.size === "number") {
      const isLargeEnough = info.size >= MIN_VOICE_AUDIO_BYTES;
      const isStable = info.size === previousSize && attempt > 0;

      if (isLargeEnough && isStable) {
        return true;
      }

      previousSize = info.size;
    }

    await pause(180);
  }

  return previousSize >= MIN_VOICE_AUDIO_BYTES;
}

function pause(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function audioExtensionForContentType(contentType: string) {
  if (contentType.includes("wav")) {
    return "wav";
  }

  if (contentType.includes("aac")) {
    return "aac";
  }

  if (contentType.includes("opus")) {
    return "opus";
  }

  if (contentType.includes("mpeg") || contentType.includes("mp3")) {
    return "mp3";
  }

  return "m4a";
}

function mimeTypeForAudioUri(uri: string) {
  const lower = uri.toLowerCase();

  if (lower.endsWith(".wav")) {
    return "audio/wav";
  }

  if (lower.endsWith(".3gp")) {
    return "audio/3gpp";
  }

  if (lower.endsWith(".webm")) {
    return "audio/webm";
  }

  if (lower.endsWith(".aac")) {
    return "audio/aac";
  }

  return "audio/mp4";
}

function voiceRecordingName(uri: string) {
  const extension = uri.split(".").pop()?.split("?")[0] || "m4a";

  return `kyro-voice-${Date.now()}.${extension}`;
}

function formatVoiceDuration(durationMillis: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizedVoiceLevel(level?: number) {
  if (typeof level !== "number" || !Number.isFinite(level)) {
    return 0.28;
  }

  return Math.max(0.12, Math.min(1, (level + 60) / 60));
}

function voiceStatusTitle(state: VoiceState) {
  if (state === "recording") {
    return "Listening";
  }

  if (state === "thinking") {
    return "Thinking";
  }

  if (state === "speaking") {
    return "Speaking";
  }

  return "Ready";
}

function voiceStatusText(state: VoiceState) {
  if (state === "recording") {
    return "Speak normally. Kyro sends when you pause.";
  }

  if (state === "thinking") {
    return "Transcribing and checking Kyro context.";
  }

  if (state === "speaking") {
    return "Kyro is reading the response aloud.";
  }

  return "Tap the mic once to start a live voice session.";
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  assistantTurn: {
    alignSelf: "flex-start",
    borderLeftColor: colors.cyan,
    borderLeftWidth: 3,
    maxWidth: "92%",
    paddingLeft: 13,
  },
  attachmentChip: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    maxWidth: 210,
    minHeight: 48,
    paddingHorizontal: 7,
    paddingVertical: 8,
  },
  attachmentCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  attachmentError: {
    color: colors.warning,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
  },
  attachmentMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
  },
  attachmentName: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  attachmentRail: {
    gap: 8,
    paddingRight: 18,
  },
  attachmentRemove: {
    alignItems: "center",
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  attachmentThumbnail: {
    backgroundColor: colors.background,
    borderColor: "rgba(246, 247, 251, 0.12)",
    borderRadius: 7,
    borderWidth: 1,
    height: 34,
    width: 34,
  },
  attachmentThumbnailFallback: {
    alignItems: "center",
    backgroundColor: "rgba(246, 247, 251, 0.05)",
    borderColor: "rgba(246, 247, 251, 0.1)",
    borderRadius: 7,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  attachmentOption: {
    alignItems: "center",
    backgroundColor: "rgba(13, 15, 22, 0.96)",
    borderColor: "rgba(246, 247, 251, 0.12)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 38,
    paddingLeft: 8,
    paddingRight: 14,
  },
  attachmentOptionCopy: {
    minWidth: 0,
  },
  attachmentOptionIcon: {
    alignItems: "center",
    backgroundColor: "rgba(246, 247, 251, 0.05)",
    borderColor: "rgba(246, 247, 251, 0.08)",
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  attachmentOptionLabel: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  attachmentOptionList: {
    alignItems: "flex-start",
    gap: 7,
  },
  attachmentSheetBackdrop: {
    alignItems: "flex-start",
    backgroundColor: "transparent",
    flex: 1,
    justifyContent: "flex-end",
    paddingBottom: 154,
    paddingHorizontal: 26,
  },
  bottomStack: {
    backgroundColor: colors.background,
    gap: 0,
    paddingBottom: 14,
    paddingTop: 12,
    zIndex: 2,
  },
  canvas: {
    flex: 1,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  chatContent: {
    flexGrow: 1,
    gap: 18,
    paddingBottom: 104,
    paddingTop: 16,
  },
  composer: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: 8,
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  composerBlock: {
    gap: 8,
  },
  composerFrame: {
    borderRadius: radii.pill,
    padding: 1,
  },
  composerIcon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  disabled: {
    opacity: 0.42,
  },
  deviceFileButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 39,
    paddingHorizontal: 13,
  },
  deviceFileButtonText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 17,
    fontWeight: "500",
    minHeight: 42,
  },
  inlineAttachment: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 3,
    minWidth: 150,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineAttachmentList: {
    gap: 6,
    paddingTop: 3,
  },
  inlineAttachmentMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
  },
  inlineAttachmentName: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  loadingAssistantTurn: {
    alignSelf: "flex-start",
    borderLeftColor: colors.cyan,
    borderLeftWidth: 3,
    gap: 8,
    maxWidth: "92%",
    paddingLeft: 13,
    width: "92%",
  },
  loadingComposer: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  loadingComposerFrame: {
    borderColor: "rgba(81, 229, 255, 0.18)",
    borderRadius: radii.pill,
    borderWidth: 1,
    marginBottom: 14,
  },
  loadingComposerIcon: {
    backgroundColor: "rgba(246, 247, 251, 0.1)",
    borderRadius: radii.pill,
    height: 34,
    width: 34,
  },
  loadingInputLine: {
    flex: 1,
    height: 13,
    width: undefined,
  },
  loadingSendButton: {
    backgroundColor: "rgba(246, 247, 251, 0.18)",
    borderRadius: radii.pill,
    height: 42,
    width: 42,
  },
  loadingStack: {
    flex: 1,
    gap: 22,
    justifyContent: "flex-end",
    paddingBottom: 30,
  },
  loadingUserTurn: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(246, 247, 251, 0.07)",
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    gap: 9,
    maxWidth: "80%",
    padding: 14,
    width: "72%",
  },
  keyboard: {
    flex: 1,
  },
  kyroFileBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.66)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 14,
  },
  kyroFileClose: {
    alignItems: "center",
    backgroundColor: "rgba(246, 247, 251, 0.08)",
    borderRadius: radii.pill,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  kyroFileEmpty: {
    alignItems: "flex-start",
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 5,
    padding: 14,
  },
  kyroFileEmptyText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  kyroFileEmptyTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "900",
  },
  kyroFileEyebrow: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  kyroFileFooter: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  kyroFileHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
  },
  kyroFileHeaderCopy: {
    flex: 1,
    gap: 3,
  },
  kyroFileIcon: {
    alignItems: "center",
    backgroundColor: "rgba(246, 247, 251, 0.05)",
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  kyroFileList: {
    gap: 8,
    paddingVertical: 4,
  },
  kyroFileMessage: {
    color: colors.warning,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  kyroFileMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
  },
  kyroFileName: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  kyroFileRow: {
    alignItems: "center",
    backgroundColor: "rgba(246, 247, 251, 0.055)",
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    padding: 10,
  },
  kyroFileRowCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  kyroFileSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    maxHeight: "78%",
    padding: 16,
  },
  kyroFileSkeleton: {
    backgroundColor: "rgba(246, 247, 251, 0.08)",
    borderRadius: radii.md,
    height: 58,
  },
  kyroFileTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 22,
    fontWeight: "900",
  },
  modeOption: {
    alignItems: "center",
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 62,
    paddingHorizontal: 11,
  },
  modeOptionActive: {
    backgroundColor: colors.surfaceStrong,
  },
  modePill: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: 3,
    padding: 4,
  },
  modePillFrame: {
    alignSelf: "center",
    borderRadius: radii.pill,
    paddingBottom: 3,
    paddingHorizontal: 1,
    paddingTop: 1,
  },
  modeText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  modeTextActive: {
    color: colors.background,
  },
  promptList: {
    alignItems: "flex-end",
    gap: 5,
  },
  promptListShell: {
    overflow: "hidden",
  },
  promptRow: {
    alignItems: "center",
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 9,
    minHeight: 34,
    maxWidth: "68%",
    paddingLeft: 6,
  },
  promptIconFrame: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 27,
    justifyContent: "center",
    width: 27,
  },
  promptText: {
    color: colors.text,
    flexShrink: 1,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "600",
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  skeletonCard: {
    backgroundColor: "rgba(246, 247, 251, 0.07)",
    borderColor: "rgba(81, 229, 255, 0.16)",
    borderRadius: radii.md,
    borderWidth: 1,
    height: 54,
    width: 128,
  },
  skeletonCardRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  skeletonLine: {
    backgroundColor: "rgba(246, 247, 251, 0.12)",
    borderRadius: radii.pill,
    height: 12,
  },
  skeletonLong: {
    width: "86%",
  },
  skeletonMeta: {
    backgroundColor: "rgba(81, 229, 255, 0.26)",
    height: 8,
    width: 82,
  },
  skeletonMid: {
    width: "62%",
  },
  skeletonShort: {
    width: "42%",
  },
  skeletonUserLine: {
    width: "88%",
  },
  skeletonUserShort: {
    width: "56%",
  },
  shell: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  spacer: {
    minHeight: 160,
  },
  topBar: {
    alignItems: "center",
    minHeight: 48,
  },
  transcriptChip: {
    backgroundColor: "rgba(81, 229, 255, 0.05)",
    borderColor: "rgba(81, 229, 255, 0.22)",
    borderLeftColor: colors.cyan,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  typingDot: {
    borderRadius: radii.pill,
    height: 9,
    width: 9,
  },
  typingDotFrame: {
    borderRadius: radii.pill,
    height: 12,
    justifyContent: "center",
    width: 12,
  },
  typingDots: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 18,
  },
  typingTurn: {
    alignItems: "center",
    alignSelf: "flex-start",
    minWidth: 58,
    paddingLeft: 13,
    paddingVertical: 8,
  },
  transcriptChipText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  transcriptChipTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  transcriptContent: {
    flexGrow: 1,
    gap: 14,
    justifyContent: "flex-end",
    paddingBottom: 28,
    paddingTop: 18,
  },
  transcriptEyebrow: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  transcriptLine: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 19,
    fontWeight: "700",
    lineHeight: 27,
  },
  transcriptLineMuted: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 25,
  },
  transcriptTurn: {
    gap: 9,
  },
  turn: {
    gap: 5,
  },
  turnMeta: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
  },
  turnText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 27,
  },
  userTurn: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(246, 247, 251, 0.08)",
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: "88%",
    padding: 13,
  },
  userTurnText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 23,
  },
  voiceCopy: {
    alignItems: "flex-start",
    flex: 1,
    gap: 5,
  },
  voiceDock: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 21,
    flex: 1,
    gap: 14,
    justifyContent: "space-between",
    padding: 16,
  },
  voiceDockFrame: {
    borderRadius: 22,
    height: 248,
    marginBottom: 14,
    marginTop: 12,
    padding: 1,
  },
  voiceDockTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  voiceIdleHint: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    maxWidth: 240,
    textAlign: "center",
  },
  voiceLiveFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingTop: 3,
  },
  voiceLiveMeta: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
  },
  voiceLiveText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 19,
    fontWeight: "700",
    lineHeight: 27,
  },
  voiceLiveTime: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
  },
  voiceLiveTurn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(81, 229, 255, 0.06)",
    borderColor: "rgba(81, 229, 255, 0.22)",
    borderLeftColor: colors.cyan,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 5,
    maxWidth: "86%",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  voiceMeter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    height: 44,
    justifyContent: "center",
    width: "100%",
  },
  voiceMeterBar: {
    backgroundColor: colors.cyan,
    borderRadius: radii.pill,
    minHeight: 9,
    opacity: 0.92,
    width: 8,
  },
  voiceMeterBarCompact: {
    width: 5,
  },
  voiceMeterCompact: {
    gap: 4,
    height: 22,
    justifyContent: "flex-start",
    width: 58,
  },
  voiceNotice: {
    alignSelf: "center",
    backgroundColor: "rgba(246, 247, 251, 0.06)",
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  voiceNoticeText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "center",
  },
  voiceOrbButton: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    height: 92,
    justifyContent: "center",
    shadowColor: colors.pink,
    shadowOffset: { height: 16, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    width: 92,
  },
  voiceOrbButtonRecording: {
    backgroundColor: colors.pink,
  },
  voiceText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "left",
  },
  voiceTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 18,
    fontWeight: "900",
  },
  voiceTimer: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
});
