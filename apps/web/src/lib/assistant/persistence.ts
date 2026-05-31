import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getConversationList } from "../crm/queries";
import { conversationToAssistantLink } from "./conversation-links";
import { getAssistantContextSnapshots } from "./context-compaction";
import { capturePronunciationSignalsFromText } from "./pronunciation";
import {
  linkCardsBlock,
  linksFromBlocks,
  memoryNoticeBlock,
  memorySuggestionBlock,
  normalizeAssistantUiBlocks,
} from "./ui-blocks";
import type {
  AssistantLink,
  AssistantMemoryItem,
  AssistantThreadSummary,
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
  created_at?: unknown;
  id: unknown;
  status?: unknown;
  summary: unknown;
  title?: unknown;
  updated_at?: unknown;
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
  status?: unknown;
  tags: unknown;
};

export type AssistantMemorySuggestion = {
  content: string;
  id: string;
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
    throw new Error(
      `Unable to load assistant thread: ${existingError.message}`,
    );
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
    ? await getAssistantThread(supabase, workspace.id, threadId, user.id)
    : await getOrCreateAssistantThread(supabase, workspace, user);
  const resolvedThreadId = String(thread.id);
  const [messages, memories, threads] = await Promise.all([
    getAssistantMessages(supabase, workspace.id, resolvedThreadId),
    getAssistantMemories(supabase, workspace.id, user.id),
    getAssistantThreadSummaries(supabase, workspace.id, user.id),
  ]);
  const messagesWithMemoryStatuses =
    await refreshAssistantMemorySuggestionBlocks(
      supabase,
      workspace.id,
      messages,
    );
  const refreshedMessages = await refreshAssistantConversationLinks(
    supabase,
    workspace.id,
    messagesWithMemoryStatuses,
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
    threads,
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
  const [thread, recentMessages, memories, contextSnapshots] =
    await Promise.all([
      getAssistantThread(supabase, workspaceId, threadId, user.id),
      getAssistantMessages(
        supabase,
        workspaceId,
        threadId,
        MODEL_RECENT_MESSAGE_LIMIT,
      ),
      getRelevantMemories(supabase, workspaceId, user.id, prompt),
      getAssistantContextSnapshots({
        prompt,
        supabase,
        threadId,
        userId: user.id,
        workspaceId,
      }),
    ]);

  return {
    contextSnapshots,
    memories,
    recentMessages: recentMessages.map((message) => ({
      content: message.content,
      createdAt: message.createdAt,
      intent: message.intent ?? null,
      links: message.links,
      role: message.role,
      uiBlocks: message.uiBlocks,
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
  const metadataSource = assistantInputSourceMetadataSource(inputSource);
  const { data, error } = await supabase
    .from("assistant_messages")
    .insert({
      content,
      metadata: {
        inputSource,
        source: metadataSource,
      },
      role: "user",
      thread_id: threadId,
      user_id: user.id,
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to save assistant message: ${error?.message ?? "unknown error"}`,
    );
  }

  await touchThread(supabase, workspaceId, threadId);

  try {
    await capturePronunciationSignalsFromText({
      source: assistantVoiceInputSource(inputSource)
        ? metadataSource
        : "assistant.message",
      sourceId: String(data.id),
      supabase,
      text: content,
      user,
      workspaceId,
    });
  } catch {
    // Pronunciation suggestions should never interrupt the assistant turn.
  }

  return String(data.id);
}

export async function appendAssistantTurnMessage({
  memorySaved,
  memorySuggestion,
  result,
  supabase,
  threadId,
  user,
  workspaceId,
}: {
  memorySaved?: string | null;
  memorySuggestion?: AssistantMemorySuggestion | null;
  result: AssistantTurnResult;
  supabase: SupabaseClient;
  threadId: string;
  user: User;
  workspaceId: string;
}) {
  const uiBlocks = [
    ...result.uiBlocks,
    ...(memorySaved ? [memoryNoticeBlock(memorySaved)] : []),
    ...(memorySuggestion
      ? [
          memorySuggestionBlock({
            content: memorySuggestion.content,
            memoryId: memorySuggestion.id,
          }),
        ]
      : []),
  ];
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
  intent = "realtime_voice",
  links = [],
  model,
  provider,
  source = "assistant.realtime_voice",
  supabase,
  threadId,
  uiBlocks = [],
  user,
  workspaceId,
}: {
  content: string;
  intent?: string;
  links?: AssistantLink[];
  model: string;
  provider: string;
  source?: string;
  supabase: SupabaseClient;
  threadId: string;
  uiBlocks?: AssistantUiBlock[];
  user: User;
  workspaceId: string;
}) {
  const persistedUiBlocks = [
    ...normalizeAssistantUiBlocks(uiBlocks),
    ...linkCardsBlock("Web sources", links),
  ];
  const { data, error } = await supabase
    .from("assistant_messages")
    .insert({
      content,
      intent,
      metadata: {
        linkCount: links.length,
        source,
      },
      model,
      provider,
      role: "assistant",
      thread_id: threadId,
      tool_calls: [],
      ui_blocks: persistedUiBlocks,
      user_id: user.id,
      workspace_id: workspaceId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to save realtime assistant response: ${error?.message ?? "unknown error"}`,
    );
  }

  await touchThread(supabase, workspaceId, threadId);

  return String(data.id);
}

function assistantVoiceInputSource(inputSource: string) {
  return ["realtime_voice", "vapi_internal_voice", "voice"].includes(inputSource);
}

function assistantInputSourceMetadataSource(inputSource: string) {
  if (inputSource === "realtime_voice") {
    return "assistant.realtime_voice";
  }

  if (inputSource === "vapi_internal_voice") {
    return "assistant.vapi_internal_voice";
  }

  if (inputSource === "voice") {
    return "assistant.voice_input";
  }

  return "assistant.page";
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

export async function maybeSuggestAssistantMemory({
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
}): Promise<AssistantMemorySuggestion | null> {
  const content = extractSuggestedMemory(prompt);

  if (!content) {
    return null;
  }

  const { data: existing, error: existingError } = await supabase
    .from("assistant_memories")
    .select("id,status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("content", content)
    .in("status", ["active", "pending_approval"])
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to check assistant memory suggestions: ${existingError.message}`,
    );
  }

  if (existing) {
    return null;
  }

  const { data, error } = await supabase
    .from("assistant_memories")
    .insert({
      confidence: "0.55",
      content,
      memory_type: "suggested_preference",
      metadata: {
        approvalRequired: true,
        source: "assistant.suggested_memory",
      },
      source_message_id: sourceMessageId,
      source_thread_id: threadId,
      status: "pending_approval",
      tags: inferMemoryTags(content),
      user_id: user.id,
      workspace_id: workspaceId,
    })
    .select("id,content")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to create assistant memory suggestion: ${error?.message ?? "unknown error"}`,
    );
  }

  return {
    content: String(data.content),
    id: String(data.id),
  };
}

export async function setAssistantMemorySuggestionStatus({
  memoryId,
  status,
  supabase,
  user,
  workspaceId,
}: {
  memoryId: string;
  status: "active" | "rejected";
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const { data: memory, error: loadError } = await supabase
    .from("assistant_memories")
    .select("id,content,status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("id", memoryId)
    .maybeSingle();

  if (loadError) {
    throw new Error(`Unable to load memory suggestion: ${loadError.message}`);
  }

  if (!memory) {
    throw new Error("Memory suggestion was not found.");
  }

  const currentStatus = textValue(memory.status) ?? "pending_approval";

  if (currentStatus !== "pending_approval") {
    return {
      content: String(memory.content),
      id: String(memory.id),
      status: currentStatus,
    };
  }

  const { error: updateError } = await supabase
    .from("assistant_memories")
    .update({
      metadata: {
        approvedByUserId: status === "active" ? user.id : null,
        decisionAt: new Date().toISOString(),
        source: "assistant.suggested_memory",
      },
      status,
    })
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("id", memoryId);

  if (updateError) {
    throw new Error(
      `Unable to update memory suggestion: ${updateError.message}`,
    );
  }

  return {
    content: String(memory.content),
    id: String(memory.id),
    status,
  };
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
  userId: string,
) {
  const { data, error } = await supabase
    .from("assistant_threads")
    .select("id,summary")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
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

export async function createAssistantThread({
  supabase,
  user,
  workspace,
}: {
  supabase: SupabaseClient;
  user: User;
  workspace: WorkspaceInput;
}) {
  const { data, error } = await supabase
    .from("assistant_threads")
    .insert({
      metadata: {
        source: "assistant.new_thread",
      },
      title: `${workspace.name} Assistant`,
      user_id: user.id,
      workspace_id: workspace.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to create assistant thread: ${error?.message ?? "unknown error"}`,
    );
  }

  return String(data.id);
}

export async function archiveAssistantThread({
  supabase,
  threadId,
  user,
  workspaceId,
}: {
  supabase: SupabaseClient;
  threadId: string;
  user: User;
  workspaceId: string;
}) {
  const { error } = await supabase
    .from("assistant_threads")
    .update({
      status: "archived",
    })
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("id", threadId);

  if (error) {
    throw new Error(`Unable to archive assistant thread: ${error.message}`);
  }
}

async function getAssistantThreadSummaries(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<AssistantThreadSummary[]> {
  const { data, error } = await supabase
    .from("assistant_threads")
    .select("id,title,status,summary,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Unable to load assistant threads: ${error.message}`);
  }

  return ((data ?? []) as unknown as AssistantThreadRow[]).map((thread) => ({
    createdAt: textValue(thread.created_at) ?? new Date().toISOString(),
    id: String(thread.id),
    status: textValue(thread.status) ?? "active",
    summary: textValue(thread.summary),
    title: textValue(thread.title) ?? "Assistant thread",
    updatedAt: textValue(thread.updated_at) ?? new Date().toISOString(),
  }));
}

async function getAssistantMessages(
  supabase: SupabaseClient,
  workspaceId: string,
  threadId: string,
  limit = THREAD_MESSAGE_LIMIT,
) {
  const { data, error } = await supabase
    .from("assistant_messages")
    .select(
      "id,role,content,intent,provider,model,ui_blocks,metadata,created_at",
    )
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
      score: tokenSet(memory.content).filter((token) =>
        promptTokens.includes(token),
      ).length,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.memory);

  return ranked.length > 0 ? ranked : memories.slice(0, 3);
}

async function touchThread(
  supabase: SupabaseClient,
  workspaceId: string,
  threadId: string,
) {
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
    for (const link of message.links ??
      linksFromBlocks(message.uiBlocks ?? [])) {
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
      link.meta && refreshedLink?.meta && refreshedLink.meta !== link.meta,
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
  return normalizeAssistantUiBlocks(value);
}

async function refreshAssistantMemorySuggestionBlocks(
  supabase: SupabaseClient,
  workspaceId: string,
  messages: AssistantThreadMessage[],
): Promise<AssistantThreadMessage[]> {
  const memoryIds = [
    ...new Set(
      messages.flatMap((message) =>
        (message.uiBlocks ?? []).flatMap((block) =>
          block.type === "memory_suggestion" ? [block.memoryId] : [],
        ),
      ),
    ),
  ];

  if (memoryIds.length === 0) {
    return messages;
  }

  const { data, error } = await supabase
    .from("assistant_memories")
    .select("id,status")
    .eq("workspace_id", workspaceId)
    .in("id", memoryIds);

  if (error) {
    throw new Error(
      `Unable to refresh memory suggestion status: ${error.message}`,
    );
  }

  const statusById = new Map<
    string,
    "active" | "pending_approval" | "rejected"
  >(
    (data ?? []).map((row) => [
      String(row.id),
      toMemorySuggestionStatus(textValue(row.status)),
    ]),
  );

  return messages.map((message) => ({
    ...message,
    uiBlocks: (message.uiBlocks ?? []).map((block) => {
      if (block.type !== "memory_suggestion") {
        return block;
      }

      const status = statusById.get(block.memoryId);

      return status ? { ...block, status } : block;
    }),
  }));
}

function toMemorySuggestionStatus(
  value: string | null,
): "active" | "pending_approval" | "rejected" {
  return value === "active" || value === "rejected"
    ? value
    : "pending_approval";
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

function extractSuggestedMemory(prompt: string) {
  if (extractExplicitMemory(prompt)) {
    return null;
  }

  const cleaned = prompt.trim().replace(/\s+/g, " ");
  const text = cleaned.toLowerCase();
  const durablePreference =
    /\b(?:i|we)\s+(?:prefer|usually|normally|like|want|don't|do not|always|never)\b/.test(
      text,
    ) ||
    /\b(?:please|can you)\s+(?:always|never)\b/.test(text) ||
    /\b(?:from now on|going forward|default|preference|policy)\b/.test(text);

  if (!durablePreference) {
    return null;
  }

  if (cleaned.length < 16 || cleaned.length > 600) {
    return null;
  }

  if (/[?]/.test(cleaned) && !/\b(?:can you|please)\b/.test(text)) {
    return null;
  }

  return truncate(cleaned, 500);
}

function inferMemoryTags(content: string) {
  const text = content.toLowerCase();
  const tags = [
    text.includes("reply") || text.includes("tone")
      ? "communication_style"
      : null,
    text.includes("quote") || text.includes("invoice") ? "documents" : null,
    text.includes("site visit") || text.includes("schedule")
      ? "scheduling"
      : null,
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
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}...`
    : value;
}
