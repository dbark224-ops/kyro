import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getConversationList } from "../crm/queries";
import { conversationToAssistantLink } from "./conversation-links";
import { linkCardsBlock, linksFromBlocks, memoryNoticeBlock } from "./ui-blocks";
import type {
  AssistantLink,
  AssistantMemoryItem,
  AssistantThreadMessage,
  AssistantThreadState,
  AssistantTurnResult,
  AssistantUiBlock,
} from "./types";

const THREAD_MESSAGE_LIMIT = 40;
const MODEL_RECENT_MESSAGE_LIMIT = 8;
const MEMORY_LIMIT = 8;

type WorkspaceInput = {
  id: string;
  name: string;
};

type AssistantThreadRow = {
  id: unknown;
  summary: unknown;
};

type AssistantMessageRow = {
  created_at: unknown;
  id: unknown;
  role: unknown;
  content: unknown;
  intent: unknown;
  provider: unknown;
  model: unknown;
  ui_blocks: unknown;
  metadata: unknown;
};

type AssistantMemoryRow = {
  id: unknown;
  content: unknown;
  memory_type: unknown;
  tags: unknown;
};

export async function getOrCreateAssistantThread(
  supabase: SupabaseClient,
  workspace: WorkspaceInput,
  user: User,
) {
  const { data: existing, error: existingError } = await supabase
    .from("assistant_threads")
    .select("id,summary")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to load assistant thread: ${existingError.message}`);
  }

  if (existing) {
    return existing as unknown as AssistantThreadRow;
  }

  const { data: created, error: createError } = await supabase
    .from("assistant_threads")
    .insert({
      metadata: {
        source: "assistant.page",
      },
      title: `${workspace.name} Assistant`,
      user_id: user.id,
      workspace_id: workspace.id,
    })
    .select("id,summary")
    .single();

  if (createError || !created) {
    throw new Error(
      `Unable to create assistant thread: ${createError?.message ?? "unknown error"}`,
    );
  }

  return created as unknown as AssistantThreadRow;
}

export async function getAssistantThreadState({
  supabase,
  threadId,
  user,
  welcomeMessage,
  workspace,
}: {
  supabase: SupabaseClient;
  threadId?: string | null;
  user: User;
  welcomeMessage?: AssistantThreadMessage;
  workspace: WorkspaceInput;
}): Promise<AssistantThreadState> {
  const thread = threadId
    ? await getAssistantThread(supabase, workspace.id, threadId)
    : await getOrCreateAssistantThread(supabase, workspace, user);
  const resolvedThreadId = String(thread.id);
  const [messages, memories] = await Promise.all([
    getAssistantMessages(supabase, workspace.id, resolvedThreadId),
    getAssistantMemories(supabase, workspace.id, user.id),
  ]);
  const refreshedMessages = await refreshAssistantConversationLinks(
    supabase,
    workspace.id,
    messages,
  );

  return {
    error: null,
    memories,
    messages:
      refreshedMessages.length > 0
        ? refreshedMessages
        : welcomeMessage
          ? [welcomeMessage]
          : [],
    summary: textValue(thread.summary),
    threadId: resolvedThreadId,
  };
}

export async function getAssistantTurnContext({
  prompt,
  supabase,
  threadId,
  user,
  workspaceId,
}: {
  prompt: string;
  supabase: SupabaseClient;
  threadId: string;
  user: User;
  workspaceId: string;
}) {
  const [thread, recentMessages, memories] = await Promise.all([
    getAssistantThread(supabase, workspaceId, threadId),
    getAssistantMessages(supabase, workspaceId, threadId, MODEL_RECENT_MESSAGE_LIMIT),
    getRelevantMemories(supabase, workspaceId, user.id, prompt),
  ]);

  return {
    memories,
    recentMessages: recentMessages.map((message) => ({
      content: message.content,
      intent: message.intent ?? null,
      role: message.role,
    })),
    summary: textValue(thread.summary),
  };
}

export async function appendUserAssistantMessage({
  content,
  inputSource = "typed",
  supabase,
  threadId,
  user,
  workspaceId,
}: {
  content: string;
  inputSource?: string;
  supabase: SupabaseClient;
  threadId: string;
  user: User;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("assistant_messages")
    .insert({
      content,
      metadata: {
        inputSource,
        source:
          inputSource === "voice"
            ? "assistant.voice_input"
            : "assistant.page",
      },
      role: "user",
      thread_id: threadId,
      user_id: user.id,
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Unable to save assistant message: ${error?.message ?? "unknown error"}`);
  }

  await touchThread(supabase, workspaceId, threadId);

  return String(data.id);
}

export async function appendAssistantTurnMessage({
  memorySaved,
  result,
  supabase,
  threadId,
  user,
  workspaceId,
}: {
  memorySaved?: string | null;
  result: AssistantTurnResult;
  supabase: SupabaseClient;
  threadId: string;
  user: User;
  workspaceId: string;
}) {
  const uiBlocks = memorySaved
    ? [...result.uiBlocks, memoryNoticeBlock(memorySaved)]
    : result.uiBlocks;
  const { error } = await supabase.from("assistant_messages").insert({
    ai_run_id: result.id,
    content: result.content,
    intent: result.intent,
    metadata: {
      fallbackReason: result.fallbackReason ?? null,
      linkCount: result.links.length,
      source: "assistant.page",
    },
    model: result.model,
    provider: result.provider,
    role: "assistant",
    thread_id: threadId,
    tool_calls: result.toolCalls,
    ui_blocks: uiBlocks,
    user_id: user.id,
    workspace_id: workspaceId,
  });

  if (error) {
    throw new Error(`Unable to save assistant response: ${error.message}`);
  }

  await touchThread(supabase, workspaceId, threadId);
}

export async function appendRealtimeAssistantMessage({
  content,
  links = [],
  model,
  provider,
  supabase,
  threadId,
  user,
  workspaceId,
}: {
  content: string;
  links?: AssistantLink[];
  model: string;
  provider: string;
  supabase: SupabaseClient;
  threadId: string;
  user: User;
  workspaceId: string;
}) {
  const { error } = await supabase.from("assistant_messages").insert({
    content,
    intent: "realtime_voice",
    metadata: {
      linkCount: links.length,
      source: "assistant.realtime_voice",
    },
    model,
    provider,
    role: "assistant",
    thread_id: threadId,
    tool_calls: [],
    ui_blocks: linkCardsBlock("Web sources", links),
    user_id: user.id,
    workspace_id: workspaceId,
  });

  if (error) {
    throw new Error(`Unable to save realtime assistant response: ${error.message}`);
  }

  await touchThread(supabase, workspaceId, threadId);
}

export async function maybeSaveAssistantMemory({
  prompt,
  sourceMessageId,
  supabase,
  threadId,
  user,
  workspaceId,
}: {
  prompt: string;
  sourceMessageId: string;
  supabase: SupabaseClient;
  threadId: string;
  user: User;
  workspaceId: string;
}) {
  const content = extractExplicitMemory(prompt);

  if (!content) {
    return null;
  }

  const { error } = await supabase.from("assistant_memories").insert({
    content,
    memory_type: "user_preference",
    metadata: {
      source: "assistant.explicit_remember",
    },
    source_message_id: sourceMessageId,
    source_thread_id: threadId,
    tags: inferMemoryTags(content),
    user_id: user.id,
    workspace_id: workspaceId,
  });

  if (error) {
    throw new Error(`Unable to save assistant memory: ${error.message}`);
  }

  return content;
}

export async function updateAssistantThreadSummary({
  prompt,
  result,
  supabase,
  threadId,
  workspaceId,
}: {
  prompt: string;
  result: AssistantTurnResult;
  supabase: SupabaseClient;
  threadId: string;
  workspaceId: string;
}) {
  const messages = await getAssistantMessages(
    supabase,
    workspaceId,
    threadId,
    MODEL_RECENT_MESSAGE_LIMIT,
  );
  const recent = messages
    .slice(-6)
    .map((message) => `${message.role}: ${truncate(message.content, 110)}`)
    .join(" | ");
  const summary = truncate(
    `Recent assistant thread: ${recent}. Latest user request: ${truncate(prompt, 140)}. Latest handled intent: ${result.intent}.`,
    900,
  );

  const { error } = await supabase
    .from("assistant_threads")
    .update({
      summary,
      summary_updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", threadId);

  if (error) {
    throw new Error(`Unable to update assistant summary: ${error.message}`);
  }
}

async function getAssistantThread(
  supabase: SupabaseClient,
  workspaceId: string,
  threadId: string,
) {
  const { data, error } = await supabase
    .from("assistant_threads")
    .select("id,summary")
    .eq("workspace_id", workspaceId)
    .eq("id", threadId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load assistant thread: ${error.message}`);
  }

  if (!data) {
    throw new Error("Assistant thread was not found.");
  }

  return data as unknown as AssistantThreadRow;
}

async function getAssistantMessages(
  supabase: SupabaseClient,
  workspaceId: string,
  threadId: string,
  limit = THREAD_MESSAGE_LIMIT,
) {
  const { data, error } = await supabase
    .from("assistant_messages")
    .select("id,role,content,intent,provider,model,ui_blocks,metadata,created_at")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Unable to load assistant messages: ${error.message}`);
  }

  return ((data ?? []) as unknown as AssistantMessageRow[])
    .reverse()
    .map(toThreadMessage);
}

async function getAssistantMemories(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<AssistantMemoryItem[]> {
  const { data, error } = await supabase
    .from("assistant_memories")
    .select("id,content,memory_type,tags")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(MEMORY_LIMIT);

  if (error) {
    throw new Error(`Unable to load assistant memories: ${error.message}`);
  }

  return ((data ?? []) as unknown as AssistantMemoryRow[]).map(toMemoryItem);
}

async function getRelevantMemories(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  prompt: string,
) {
  const memories = await getAssistantMemories(supabase, workspaceId, userId);
  const promptTokens = tokenSet(prompt);
  const ranked = memories
    .map((memory) => ({
      memory,
      score: tokenSet(memory.content).filter((token) => promptTokens.includes(token)).length,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.memory);

  return ranked.length > 0 ? ranked : memories.slice(0, 3);
}

async function touchThread(supabase: SupabaseClient, workspaceId: string, threadId: string) {
  const { error } = await supabase
    .from("assistant_threads")
    .update({
      metadata: {
        lastTouchedBy: "assistant.page",
      },
    })
    .eq("workspace_id", workspaceId)
    .eq("id", threadId);

  if (error) {
    throw new Error(`Unable to update assistant thread: ${error.message}`);
  }
}

function toThreadMessage(row: AssistantMessageRow): AssistantThreadMessage {
  const metadata = objectRecord(row.metadata);
  const uiBlocks = normalizeUiBlocks(row.ui_blocks);

  return {
    content: String(row.content),
    createdAt: textValue(row.created_at) ?? undefined,
    fallbackReason: textValue(metadata.fallbackReason) ?? undefined,
    id: String(row.id),
    intent: textValue(row.intent) ?? undefined,
    links: linksFromBlocks(uiBlocks),
    model: textValue(row.model) ?? undefined,
    provider: textValue(row.provider) ?? undefined,
    role: textValue(row.role) === "assistant" ? "assistant" : "user",
    uiBlocks,
  };
}

async function refreshAssistantConversationLinks(
  supabase: SupabaseClient,
  workspaceId: string,
  messages: AssistantThreadMessage[],
) {
  const conversationHrefs = new Set<string>();

  for (const message of messages) {
    for (const link of message.links ?? linksFromBlocks(message.uiBlocks ?? [])) {
      const conversationHref = conversationHrefFromHref(link.href);

      if (conversationHref) {
        conversationHrefs.add(conversationHref);
      }
    }
  }

  if (conversationHrefs.size === 0) {
    return messages;
  }

  const conversations = await getConversationList(supabase, workspaceId, {
    ids: [...conversationHrefs]
      .map((href) => conversationIdFromHref(href))
      .filter((id): id is string => Boolean(id)),
  });
  const refreshedLinksByHref = new Map<string, AssistantLink>();

  for (const conversation of conversations) {
    const href = `/inbox/${conversation.id}`;

    if (!conversationHrefs.has(href)) {
      continue;
    }

    refreshedLinksByHref.set(href, conversationToAssistantLink(conversation));
  }

  if (refreshedLinksByHref.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    const originalLinks = linksFromBlocks(message.uiBlocks ?? []);
    const uiBlocks = (message.uiBlocks ?? []).map((block) => {
      if (block.type !== "link_cards") {
        return block;
      }

      return {
        ...block,
        links: block.links.map((link) => {
          const conversationHref = conversationHrefFromHref(link.href);
          const refreshedLink = conversationHref
            ? refreshedLinksByHref.get(conversationHref)
            : null;

          return refreshedLink ? { ...link, ...refreshedLink } : link;
        }),
      };
    });

    return {
      ...message,
      content: refreshAssistantMessageContent(
        message.content,
        originalLinks,
        refreshedLinksByHref,
      ),
      links: linksFromBlocks(uiBlocks),
      uiBlocks,
    };
  });
}

function refreshAssistantMessageContent(
  content: string,
  links: AssistantLink[],
  refreshedLinksByHref: Map<string, AssistantLink>,
) {
  const staleLink = links.find((link) => {
    const conversationHref = conversationHrefFromHref(link.href);
    const refreshedLink = conversationHref
      ? refreshedLinksByHref.get(conversationHref)
      : null;

    return Boolean(
      link.meta &&
        refreshedLink?.meta &&
        refreshedLink.meta !== link.meta,
    );
  });

  if (!staleLink?.meta) {
    return content;
  }

  const conversationHref = conversationHrefFromHref(staleLink.href);
  const refreshedMeta = conversationHref
    ? refreshedLinksByHref.get(conversationHref)?.meta
    : null;

  return content.replace(staleLink.meta, refreshedMeta ?? staleLink.meta);
}

function toMemoryItem(row: AssistantMemoryRow): AssistantMemoryItem {
  return {
    content: String(row.content),
    id: String(row.id),
    memoryType: textValue(row.memory_type) ?? "preference",
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

function conversationIdFromHref(href: string) {
  const [pathname] = href.split("?");
  const match = pathname?.match(/^\/inbox\/([^/]+)$/);

  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function conversationHrefFromHref(href: string) {
  const conversationId = conversationIdFromHref(href);

  return conversationId ? `/inbox/${conversationId}` : null;
}

function normalizeUiBlocks(value: unknown): AssistantUiBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((block): block is AssistantUiBlock => {
    if (!block || typeof block !== "object") {
      return false;
    }

    const record = block as Record<string, unknown>;
    return record.type === "link_cards" || record.type === "memory_notice";
  });
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractExplicitMemory(prompt: string) {
  const patterns = [
    /\bremember(?: that)?\s+(.+)/i,
    /\bfor future(?: reference)?[:,]?\s+(.+)/i,
    /\bnote(?: that)?\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);

    if (match?.[1]) {
      return truncate(match[1].trim(), 500);
    }
  }

  return null;
}

function inferMemoryTags(content: string) {
  const text = content.toLowerCase();
  const tags = [
    text.includes("reply") || text.includes("tone") ? "communication_style" : null,
    text.includes("quote") || text.includes("invoice") ? "documents" : null,
    text.includes("site visit") || text.includes("schedule") ? "scheduling" : null,
    text.includes("customer") || text.includes("client") ? "crm" : null,
  ].filter((tag): tag is string => Boolean(tag));

  return tags.length > 0 ? tags : ["general"];
}

function tokenSet(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 3),
    ),
  ];
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
