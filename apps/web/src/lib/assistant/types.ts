import type {
  ContactProfile,
  ConversationReview,
  QuoteDraftProfile,
} from "../crm/queries";

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
    };

export type AssistantCommandResult = {
  intent: string;
  title: string;
  fallbackAnswer: string;
  context: Record<string, unknown>;
  links: AssistantLink[];
  mutation?: {
    entityId: string;
    entityType: string;
    label: string;
  };
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
  memories?: AssistantMemoryItem[];
  recentMessages?: Array<{
    content: string;
    intent?: string | null;
    role: "assistant" | "user";
  }>;
  threadSummary?: string | null;
};

export type AssistantModelOutput = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  fallbackReason?: string;
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

export type AssistantThreadState = {
  memories?: AssistantMemoryItem[];
  messages: AssistantThreadMessage[];
  summary?: string | null;
  threadId?: string | null;
  error?: string | null;
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
    };

export type AssistantResourcePreviewResult = {
  error?: string | null;
  preview?: AssistantResourcePreview;
  refreshedLink?: AssistantLink;
};
