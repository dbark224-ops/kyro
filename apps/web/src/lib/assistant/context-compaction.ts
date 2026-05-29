import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateTokens } from "../usage/openai";
import type { AssistantContextSnapshot } from "./types";

const COMPACTION_FETCH_LIMIT = 120;
const COMPACTION_KEEP_RECENT_MESSAGES = 12;
const COMPACTION_MIN_ARCHIVE_MESSAGES = 12;
const CONTEXT_SNAPSHOT_LIMIT = 6;
const HISTORY_SEARCH_LIMIT = 8;

type AssistantMessageForCompaction = {
  id: string;
  content: string;
  createdAt: string;
  intent?: string | null;
  role: "assistant" | "user";
  uiBlocks?: unknown;
};

type AssistantContextSnapshotRow = {
  id: unknown;
  snapshot_type: unknown;
  title: unknown;
  summary: unknown;
  key_points: unknown;
  entities: unknown;
  period_start: unknown;
  period_end: unknown;
  message_count: unknown;
};

export type AssistantHistorySearchItem = {
  id: string;
  type: "message" | "snapshot";
  label: string;
  excerpt: string;
  occurredAt: string;
  score: number;
  meta?: string;
};

export type AssistantHistorySearchResult = {
  query: string;
  items: AssistantHistorySearchItem[];
};

export function compactAssistantMessagesForSnapshot({
  messages,
  periodEnd,
  periodStart,
  snapshotType,
}: {
  messages: AssistantMessageForCompaction[];
  periodEnd: Date;
  periodStart: Date;
  snapshotType: AssistantContextSnapshot["snapshotType"];
}) {
  const sorted = [...messages].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  const userRequests = sorted
    .filter((message) => message.role === "user")
    .map((message) => cleanForSummary(message.content))
    .filter(Boolean)
    .slice(-8);
  const assistantOutcomes = sorted
    .filter((message) => message.role === "assistant")
    .map((message) => {
      const intent = message.intent ? ` (${message.intent})` : "";
      return `${cleanForSummary(message.content)}${intent}`;
    })
    .filter(Boolean)
    .slice(-8);
  const imagePrompts = sorted.flatMap(generatedImagePrompts).slice(-4);
  const keyPoints = uniqueStrings([
    ...userRequests.map((request) => `User asked: ${request}`),
    ...assistantOutcomes.map((outcome) => `Kyro answered: ${outcome}`),
    ...imagePrompts.map((prompt) => `Generated image: ${prompt}`),
  ]).slice(0, 12);
  const entities = extractLikelyEntities(
    sorted.map((message) => message.content).join(" "),
  );
  const trail = sorted
    .slice(-10)
    .map(
      (message) =>
        `${message.role}: ${truncate(cleanForSummary(message.content), 140)}`,
    )
    .join(" | ");
  const periodLabel = periodStart.toISOString().slice(0, 10);
  const summary = [
    `${snapshotType} assistant context for ${periodLabel}.`,
    `${sorted.length} message record${sorted.length === 1 ? "" : "s"} from ${periodStart.toISOString()} to ${periodEnd.toISOString()}.`,
    userRequests.length > 0
      ? `Main user requests: ${userRequests.map((item) => truncate(item, 120)).join("; ")}.`
      : null,
    assistantOutcomes.length > 0
      ? `Assistant outcomes: ${assistantOutcomes.map((item) => truncate(item, 120)).join("; ")}.`
      : null,
    imagePrompts.length > 0
      ? `Image context: ${imagePrompts.map((item) => truncate(item, 120)).join("; ")}.`
      : null,
    trail ? `Recent trail: ${trail}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    entities,
    keyPoints,
    messageCount: sorted.length,
    sourceMessageIds: sorted.map((message) => message.id),
    summary: truncate(summary, 2400),
    title: `${titleCase(snapshotType)} context - ${periodLabel}`,
    tokenEstimate: estimateTokens(summary),
  };
}

export async function maybeCompactAssistantThreadContext({
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}) {
  try {
    return await compactAssistantThreadContext({
      supabase,
      threadId,
      userId,
      workspaceId,
    });
  } catch (error) {
    return {
      compactedDays: 0,
      error: errorMessage(error),
      status: "skipped",
    };
  }
}

async function compactAssistantThreadContext({
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}) {
  const messages = await loadMessagesForCompaction({
    limit: COMPACTION_FETCH_LIMIT,
    supabase,
    threadId,
    workspaceId,
  });
  const archiveCount = Math.max(
    0,
    messages.length - COMPACTION_KEEP_RECENT_MESSAGES,
  );

  if (archiveCount < COMPACTION_MIN_ARCHIVE_MESSAGES) {
    return {
      compactedDays: 0,
      status: "skipped",
    };
  }

  const compactableMessages = messages.slice(0, archiveCount);
  const dailyGroups = groupMessagesByPeriod(compactableMessages, "daily");
  let compactedDays = 0;

  for (const group of dailyGroups) {
    await upsertSnapshot({
      messages: group.messages,
      periodEnd: group.periodEnd,
      periodStart: group.periodStart,
      snapshotType: "daily",
      supabase,
      threadId,
      userId,
      workspaceId,
    });
    compactedDays += 1;
  }

  await buildWeeklyAndMonthlyRollups({
    supabase,
    threadId,
    userId,
    workspaceId,
  });

  return {
    compactedDays,
    status: "compacted",
  };
}

export async function getAssistantContextSnapshots({
  prompt,
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  prompt: string;
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}): Promise<AssistantContextSnapshot[]> {
  const { data, error } = await supabase
    .from("assistant_context_snapshots")
    .select(
      "id,snapshot_type,title,summary,key_points,entities,period_start,period_end,message_count",
    )
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("period_end", { ascending: false })
    .limit(40);

  if (error) {
    return [];
  }

  const tokens = tokenSet(prompt);
  const snapshots = ((data ?? []) as AssistantContextSnapshotRow[]).map(
    toContextSnapshot,
  );
  const ranked = snapshots
    .map((snapshot, index) => ({
      index,
      score: scoreText(
        [snapshot.title, snapshot.summary, ...snapshot.keyPoints].join(" "),
        tokens,
      ),
      snapshot,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    });
  const relevant = ranked
    .filter((item) => item.score > 0)
    .map((item) => item.snapshot)
    .slice(0, CONTEXT_SNAPSHOT_LIMIT);

  return relevant.length > 0
    ? relevant
    : snapshots.slice(0, Math.min(3, CONTEXT_SNAPSHOT_LIMIT));
}

export async function searchAssistantHistory({
  limit = HISTORY_SEARCH_LIMIT,
  query,
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  limit?: number;
  query: string;
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}): Promise<AssistantHistorySearchResult> {
  const tokens = tokenSet(query).slice(0, 5);
  const [snapshotRows, messageRows] = await Promise.all([
    loadSnapshotRowsForHistory({
      supabase,
      threadId,
      userId,
      workspaceId,
    }).catch(() => [] as AssistantContextSnapshotRow[]),
    loadMessageRowsForHistory({
      supabase,
      threadId,
      tokens,
      workspaceId,
    }),
  ]);
  const snapshots = snapshotRows.map(toContextSnapshot).map((snapshot) => ({
    excerpt: truncate(snapshot.summary, 320),
    id: snapshot.id,
    label: snapshot.title,
    meta: `${snapshot.snapshotType} - ${snapshot.messageCount} messages`,
    occurredAt: snapshot.periodEnd,
    score: scoreText(
      [snapshot.title, snapshot.summary, ...snapshot.keyPoints].join(" "),
      tokens,
    ),
    type: "snapshot" as const,
  }));
  const messages = messageRows.map((message) => ({
    excerpt: truncate(cleanForSummary(String(message.content)), 320),
    id: String(message.id),
    label: `${titleCase(String(message.role))} message`,
    meta: textValue(message.intent) ?? undefined,
    occurredAt: textValue(message.created_at) ?? new Date(0).toISOString(),
    score: scoreText(String(message.content), tokens),
    type: "message" as const,
  }));
  const items = [...snapshots, ...messages]
    .filter((item) => tokens.length === 0 || item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime()
      );
    })
    .slice(0, limit);

  return {
    items,
    query,
  };
}

async function buildWeeklyAndMonthlyRollups({
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("assistant_context_snapshots")
    .select(
      "id,snapshot_type,title,summary,key_points,entities,period_start,period_end,message_count",
    )
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .eq("snapshot_type", "daily")
    .order("period_end", { ascending: false })
    .limit(42);

  if (error) {
    throw new Error(`Unable to load assistant daily snapshots: ${error.message}`);
  }

  const dailySnapshots = ((data ?? []) as AssistantContextSnapshotRow[]).map(
    toContextSnapshot,
  );

  await upsertRollups({
    snapshotType: "weekly",
    snapshots: dailySnapshots,
    supabase,
    threadId,
    userId,
    workspaceId,
  });

  const weeklySnapshots = await loadSnapshotRowsByType({
    snapshotType: "weekly",
    supabase,
    threadId,
    userId,
    workspaceId,
  });

  await upsertRollups({
    snapshotType: "monthly",
    snapshots: weeklySnapshots.map(toContextSnapshot),
    supabase,
    threadId,
    userId,
    workspaceId,
  });
}

async function upsertRollups({
  snapshotType,
  snapshots,
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  snapshotType: "monthly" | "weekly";
  snapshots: AssistantContextSnapshot[];
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}) {
  const groups = groupSnapshotsByPeriod(snapshots, snapshotType);

  for (const group of groups) {
    if (group.snapshots.length < 2) {
      continue;
    }

    const keyPoints = uniqueStrings(
      group.snapshots.flatMap((snapshot) => snapshot.keyPoints),
    ).slice(0, 14);
    const entities = uniqueStrings(
      group.snapshots.flatMap((snapshot) => snapshot.entities),
    ).slice(0, 16);
    const summary = truncate(
      [
        `${titleCase(snapshotType)} assistant rollup from ${group.periodStart.toISOString()} to ${group.periodEnd.toISOString()}.`,
        ...group.snapshots
          .slice(0, 8)
          .map((snapshot) => `${snapshot.title}: ${snapshot.summary}`),
      ].join(" "),
      3200,
    );
    const { error } = await supabase
      .from("assistant_context_snapshots")
      .upsert(
        {
          entities,
          key_points: keyPoints,
          message_count: group.snapshots.reduce(
            (total, snapshot) => total + snapshot.messageCount,
            0,
          ),
          metadata: {
            source: "assistant.context_compaction",
            sourceSnapshotIds: group.snapshots.map((snapshot) => snapshot.id),
            sourceSnapshotCount: group.snapshots.length,
          },
          period_end: group.periodEnd.toISOString(),
          period_start: group.periodStart.toISOString(),
          snapshot_type: snapshotType,
          source_message_ids: [],
          summary,
          thread_id: threadId,
          title: `${titleCase(snapshotType)} context - ${group.periodStart.toISOString().slice(0, 10)}`,
          token_estimate: estimateTokens(summary),
          user_id: userId,
          workspace_id: workspaceId,
        },
        {
          onConflict:
            "workspace_id,user_id,thread_id,snapshot_type,period_start",
        },
      );

    if (error) {
      throw new Error(
        `Unable to save assistant ${snapshotType} rollup: ${error.message}`,
      );
    }
  }
}

async function upsertSnapshot({
  messages,
  periodEnd,
  periodStart,
  snapshotType,
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  messages: AssistantMessageForCompaction[];
  periodEnd: Date;
  periodStart: Date;
  snapshotType: "daily";
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}) {
  const snapshot = compactAssistantMessagesForSnapshot({
    messages,
    periodEnd,
    periodStart,
    snapshotType,
  });
  const { error } = await supabase
    .from("assistant_context_snapshots")
    .upsert(
      {
        entities: snapshot.entities,
        key_points: snapshot.keyPoints,
        message_count: snapshot.messageCount,
        metadata: {
          source: "assistant.context_compaction",
        },
        period_end: periodEnd.toISOString(),
        period_start: periodStart.toISOString(),
        snapshot_type: snapshotType,
        source_message_ids: snapshot.sourceMessageIds,
        summary: snapshot.summary,
        thread_id: threadId,
        title: snapshot.title,
        token_estimate: snapshot.tokenEstimate,
        user_id: userId,
        workspace_id: workspaceId,
      },
      {
        onConflict: "workspace_id,user_id,thread_id,snapshot_type,period_start",
      },
    );

  if (error) {
    throw new Error(`Unable to save assistant context snapshot: ${error.message}`);
  }
}

async function loadMessagesForCompaction({
  limit,
  supabase,
  threadId,
  workspaceId,
}: {
  limit: number;
  supabase: SupabaseClient;
  threadId: string;
  workspaceId: string;
}): Promise<AssistantMessageForCompaction[]> {
  const { data, error } = await supabase
    .from("assistant_messages")
    .select("id,role,content,intent,ui_blocks,created_at")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Unable to load assistant messages for compaction: ${error.message}`);
  }

  return ((data ?? []) as Record<string, unknown>[])
    .reverse()
    .map((row) => ({
      content: String(row.content ?? ""),
      createdAt: textValue(row.created_at) ?? new Date(0).toISOString(),
      id: String(row.id),
      intent: textValue(row.intent),
      role: textValue(row.role) === "assistant" ? "assistant" : "user",
      uiBlocks: row.ui_blocks,
    }));
}

async function loadSnapshotRowsForHistory({
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("assistant_context_snapshots")
    .select(
      "id,snapshot_type,title,summary,key_points,entities,period_start,period_end,message_count",
    )
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("period_end", { ascending: false })
    .limit(60);

  if (error) {
    throw new Error(`Unable to search assistant context snapshots: ${error.message}`);
  }

  return (data ?? []) as AssistantContextSnapshotRow[];
}

async function loadMessageRowsForHistory({
  supabase,
  threadId,
  tokens,
  workspaceId,
}: {
  supabase: SupabaseClient;
  threadId: string;
  tokens: string[];
  workspaceId: string;
}) {
  let query = supabase
    .from("assistant_messages")
    .select("id,role,content,intent,created_at")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(60);

  const terms = tokens.slice(0, 3).map(escapeIlikeTerm);

  if (terms.length > 0) {
    query = query.or(terms.map((term) => `content.ilike.%${term}%`).join(","));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to search assistant messages: ${error.message}`);
  }

  return (data ?? []) as Record<string, unknown>[];
}

async function loadSnapshotRowsByType({
  snapshotType,
  supabase,
  threadId,
  userId,
  workspaceId,
}: {
  snapshotType: "monthly" | "weekly";
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("assistant_context_snapshots")
    .select(
      "id,snapshot_type,title,summary,key_points,entities,period_start,period_end,message_count",
    )
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .eq("snapshot_type", snapshotType)
    .order("period_end", { ascending: false })
    .limit(24);

  if (error) {
    throw new Error(`Unable to load assistant ${snapshotType} snapshots: ${error.message}`);
  }

  return (data ?? []) as AssistantContextSnapshotRow[];
}

function groupMessagesByPeriod(
  messages: AssistantMessageForCompaction[],
  snapshotType: "daily",
) {
  const groups = new Map<
    string,
    {
      messages: AssistantMessageForCompaction[];
      periodEnd: Date;
      periodStart: Date;
    }
  >();

  for (const message of messages) {
    const createdAt = new Date(message.createdAt);
    const periodStart =
      snapshotType === "daily"
        ? startOfUtcDay(createdAt)
        : startOfUtcWeek(createdAt);
    const key = periodStart.toISOString();
    const existing =
      groups.get(key) ??
      {
        messages: [],
        periodEnd: new Date(periodStart),
        periodStart,
      };

    existing.messages.push(message);
    existing.periodEnd = maxDate(existing.periodEnd, createdAt);
    groups.set(key, existing);
  }

  return [...groups.values()];
}

function groupSnapshotsByPeriod(
  snapshots: AssistantContextSnapshot[],
  snapshotType: "monthly" | "weekly",
) {
  const groups = new Map<
    string,
    {
      snapshots: AssistantContextSnapshot[];
      periodEnd: Date;
      periodStart: Date;
    }
  >();

  for (const snapshot of snapshots) {
    const periodDate = new Date(snapshot.periodStart);
    const periodStart =
      snapshotType === "weekly"
        ? startOfUtcWeek(periodDate)
        : startOfUtcMonth(periodDate);
    const key = periodStart.toISOString();
    const periodEnd = new Date(snapshot.periodEnd);
    const existing =
      groups.get(key) ??
      {
        periodEnd,
        periodStart,
        snapshots: [],
      };

    existing.snapshots.push(snapshot);
    existing.periodEnd = maxDate(existing.periodEnd, periodEnd);
    groups.set(key, existing);
  }

  return [...groups.values()];
}

function toContextSnapshot(
  row: AssistantContextSnapshotRow,
): AssistantContextSnapshot {
  return {
    entities: stringArray(row.entities),
    id: String(row.id),
    keyPoints: stringArray(row.key_points),
    messageCount: numberValue(row.message_count) ?? 0,
    periodEnd: textValue(row.period_end) ?? new Date(0).toISOString(),
    periodStart: textValue(row.period_start) ?? new Date(0).toISOString(),
    snapshotType: textValue(row.snapshot_type) ?? "daily",
    summary: String(row.summary ?? ""),
    title: String(row.title ?? "Assistant context"),
  };
}

function generatedImagePrompts(message: AssistantMessageForCompaction) {
  const blocks = Array.isArray(message.uiBlocks) ? message.uiBlocks : [];

  return blocks.flatMap((block) => {
    const record = objectRecord(block);

    if (record.type !== "generated_image") {
      return [];
    }

    const images = Array.isArray(record.images) ? record.images : [];

    return images
      .map((image) => textValue(objectRecord(image).prompt))
      .filter((value): value is string => Boolean(value));
  });
}

function cleanForSummary(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractLikelyEntities(value: string) {
  const ignored = new Set([
    "Assistant",
    "Generated",
    "Image",
    "Kyro",
    "OpenAI",
    "The",
    "User",
  ]);
  const matches =
    value.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) ?? [];

  return uniqueStrings(matches)
    .filter((match) => !ignored.has(match))
    .slice(0, 16);
}

function scoreText(value: string, tokens: string[]) {
  if (tokens.length === 0) {
    return 1;
  }

  const haystack = tokenSet(value);

  return tokens.filter((token) => haystack.includes(token)).length;
}

function tokenSet(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2)
        .filter(
          (token) =>
            ![
              "and",
              "are",
              "but",
              "can",
              "did",
              "for",
              "has",
              "have",
              "how",
              "the",
              "this",
              "was",
              "what",
              "when",
              "where",
              "with",
              "you",
            ].includes(token),
        ),
    ),
  ];
}

function startOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function startOfUtcWeek(value: Date) {
  const dayStart = startOfUtcDay(value);
  const day = dayStart.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;

  dayStart.setUTCDate(dayStart.getUTCDate() - offset);

  return dayStart;
}

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function maxDate(left: Date, right: Date) {
  return left.getTime() > right.getTime() ? left : right;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function titleCase(value: string) {
  return value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeIlikeTerm(value: string) {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

function truncate(value: string, maxLength: number) {
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}
