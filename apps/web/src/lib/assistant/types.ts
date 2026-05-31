import type {
  ContactProfile,
  ConversationReview,
  QuoteDraftProfile,
} from "../crm/queries";
import type { OpenAiTokenUsage } from "../usage/openai";
import type { VoiceCallPreview } from "../voice/calls";

export type AssistantLink = {
  label: string;
  href: string;
  meta?: string;
  refresh?: {
    kind: "conversation";
    liveWorkQueueVisible: boolean;
    workflowBucket: string;
  };
};

export type AssistantUiBlock =
  | {
      type: "link_cards";
      title: string;
      links: AssistantLink[];
    }
  | {
      type: "memory_notice";
      title: string;
      content: string;
    }
  | {
      type: "memory_suggestion";
      title: string;
      content: string;
      memoryId: string;
      status: "active" | "pending_approval" | "rejected";
    }
  | {
      type: "summary_cards";
      title: string;
      cards: Array<{
        detail?: string;
        href?: string;
        label: string;
        tone?: "cyan" | "purple" | "pink" | "warning" | "success" | "neutral";
        value: string;
      }>;
    }
  | {
      type: "timeline";
      title: string;
      items: Array<{
        at?: string | null;
        detail?: string;
        href?: string;
        label: string;
        tone?: "cyan" | "purple" | "pink" | "warning" | "success" | "neutral";
      }>;
    }
  | {
      type: "approval_queue";
      title: string;
      items: Array<{
        actionLabel?: string;
        detail?: string;
        href?: string;
        id: string;
        label: string;
        status: string;
      }>;
    }
  | {
      type: "generated_image";
      title: string;
      images: Array<{
        alt: string;
        contentType: string;
        downloadHref: string;
        editMode: boolean;
        fileId: string;
        filename: string;
        href: string;
        meta?: string;
        model: string;
        prompt: string;
        provider: string;
        quality: string;
        referenceCount: number;
        size: string;
      }>;
    };

export type AssistantCommandResult = {
  intent: string;
  title: string;
  fallbackAnswer: string;
  context: Record<string, unknown>;
  links: AssistantLink[];
  uiBlocks?: AssistantUiBlock[];
  mutation?: {
    entityId: string;
    entityType: string;
    label: string;
  };
};

export type AssistantRecentMessage = {
  content: string;
  createdAt?: string;
  intent?: string | null;
  links?: AssistantLink[];
  role: "assistant" | "user";
  uiBlocks?: AssistantUiBlock[];
};

export type AssistantToolCallRecord = {
  name: string;
  status: "completed" | "proposed" | "blocked";
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type AssistantModelInput = {
  prompt: string;
  command: AssistantCommandResult;
  contextSnapshots?: AssistantContextSnapshot[];
  inputSource?: "typed" | "voice" | string;
  memories?: AssistantMemoryItem[];
  recentMessages?: AssistantRecentMessage[];
  threadSummary?: string | null;
};

export type AssistantModelOutput = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  fallbackReason?: string;
  providerUsageId?: string;
  tokenUsage?: OpenAiTokenUsage;
  webSearchUsed?: boolean;
  webSources?: AssistantLink[];
};

export type AssistantModelRoute = {
  provider: string;
  model: string;
  reason: string;
};

export type AssistantTurnResult = {
  id: string;
  role: "assistant";
  content: string;
  intent: string;
  provider: string;
  model: string;
  links: AssistantLink[];
  toolCalls: AssistantToolCallRecord[];
  uiBlocks: AssistantUiBlock[];
  fallbackReason?: string;
};

export type AssistantThreadMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt?: string;
  intent?: string;
  provider?: string;
  model?: string;
  links?: AssistantLink[];
  uiBlocks?: AssistantUiBlock[];
  fallbackReason?: string;
};

export type AssistantMemoryItem = {
  id: string;
  content: string;
  memoryType: string;
  tags: string[];
};

export type AssistantContextSnapshot = {
  id: string;
  snapshotType: "rolling" | "daily" | "weekly" | "monthly" | "manual" | string;
  title: string;
  summary: string;
  keyPoints: string[];
  entities: string[];
  periodStart: string;
  periodEnd: string;
  messageCount: number;
};

export type AssistantThreadState = {
  memories?: AssistantMemoryItem[];
  messages: AssistantThreadMessage[];
  summary?: string | null;
  threadId?: string | null;
  threads?: AssistantThreadSummary[];
  error?: string | null;
};

export type AssistantThreadSummary = {
  createdAt: string;
  id: string;
  status: string;
  summary: string | null;
  title: string;
  updatedAt: string;
};

export type AssistantResourcePreview =
  | {
      href: string;
      profile: ConversationReview;
      title: string;
      type: "conversation";
    }
  | {
      href: string;
      profile: QuoteDraftProfile;
      title: string;
      type: "quote";
    }
  | {
      href: string;
      profile: ContactProfile;
      title: string;
      type: "contact";
    }
  | {
      href: string;
      profile: VoiceCallPreview;
      title: string;
      type: "voice_call";
    };

export type AssistantResourcePreviewResult = {
  error?: string | null;
  preview?: AssistantResourcePreview;
  refreshedLink?: AssistantLink;
};
