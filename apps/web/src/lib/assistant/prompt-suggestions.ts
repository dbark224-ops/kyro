import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLlmUsageEvents,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  toUsageEventRows,
  usageEventTotals,
} from "../usage/openai";

export const DEFAULT_ASSISTANT_PROMPT_SUGGESTIONS = [
  "Show me leads needing reply",
  "What quote drafts are ready?",
  "Create a bathroom quote draft",
  "Summarise my busiest customer",
  "Generate a project concept image",
  "Show recent inbound email decisions",
  "Show usage and costs",
  "Help me update Kyro settings",
];

const SUGGESTION_VISIBLE_COUNT = 4;
const MAX_PROMPT_SAMPLE_COUNT = 48;
const MAX_SUGGESTION_COUNT = 8;
const MIN_SUGGESTION_COUNT = 4;

type WorkspaceInput = {
  id: string;
  name: string;
};

type SuggestionSetRow = {
  generated_at?: unknown;
  id: unknown;
  metadata?: unknown;
  model?: unknown;
  source?: unknown;
  suggestions: unknown;
};

type PromptSample = {
  content: string;
  createdAt: string;
  id: string;
  threadId: string;
};

type SuggestionGenerationResult = {
  model: string | null;
  providerUsageId?: string;
  source: "fallback" | "openai";
  suggestions: string[];
  tokenUsage?: ReturnType<typeof openAiUsageFromResponse>;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function suggestionModel() {
  return (
    envValue("ASSISTANT_SUGGESTION_MODEL") ||
    envValue("ASSISTANT_MODEL") ||
    "gpt-4.1-mini"
  );
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dateOr(value: Date | string | null | undefined, fallback: Date) {
  const parsed = value ? new Date(value) : null;

  return parsed && Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function defaultPeriod(now: Date) {
  const periodEnd = new Date(now);
  const periodStart = new Date(now);

  periodStart.setUTCDate(periodStart.getUTCDate() - 7);

  return {
    periodEnd,
    periodStart,
  };
}

function stripAttachmentContext(content: string) {
  return content
    .split(/\n\n(?:Attached file context|Stored Kyro attachment context):/i)[0]
    .trim();
}

export function normalizeAssistantPromptSuggestionText(value: unknown) {
  const text = textValue(value);

  if (!text) {
    return null;
  }

  return text
    .replace(/^[-*+\d.)\s]+/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/g, "");
}

export function containsUnsafeAssistantPromptSuggestionSpecifics(
  value: string,
) {
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /\b(?:\+?\d[\d\s().-]{7,}\d)\b/.test(value) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(
      value,
    ) ||
    /\b(?:file|kyro file|source file)\s+id\b/i.test(value) ||
    /\b(?:about|for|from|with)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/.test(
      value,
    ) ||
    /\bthe\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\s+(?:inquiry|customer|contact|lead|job|quote)\b/.test(
      value,
    )
  );
}

export function normalizeAssistantPromptSuggestions(values: unknown[]) {
  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const value of values) {
    const suggestion = normalizeAssistantPromptSuggestionText(value);

    if (
      !suggestion ||
      suggestion.length < 8 ||
      suggestion.length > 88 ||
      containsUnsafeAssistantPromptSuggestionSpecifics(suggestion)
    ) {
      continue;
    }

    const key = suggestion.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    suggestions.push(suggestion);

    if (suggestions.length >= MAX_SUGGESTION_COUNT) {
      break;
    }
  }

  return suggestions;
}

function suggestionArrayFromRow(value: unknown) {
  const array = Array.isArray(value) ? value : [];
  const strings = array.map((item) => {
    if (typeof item === "string") {
      return item;
    }

    return textValue(objectRecord(item).label);
  });

  return normalizeAssistantPromptSuggestions(strings);
}

export function rotateAssistantPromptSuggestions(
  suggestions: string[],
  now = new Date(),
  visibleCount = SUGGESTION_VISIBLE_COUNT,
) {
  if (suggestions.length <= visibleCount) {
    return suggestions;
  }

  const day = Math.floor(now.getTime() / 86_400_000);
  const start = day % suggestions.length;

  return Array.from({ length: visibleCount }, (_, index) =>
    suggestions[(start + index) % suggestions.length],
  );
}

export async function getAssistantPromptSuggestionState({
  now = new Date(),
  supabase,
  userId,
  workspaceId,
}: {
  now?: Date;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const fallback = [...DEFAULT_ASSISTANT_PROMPT_SUGGESTIONS];
  const { data, error } = await supabase
    .from("assistant_prompt_suggestion_sets")
    .select("id,suggestions,source,model,generated_at,metadata")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      generatedAt: null,
      setId: null,
      source: "fallback",
      suggestions: fallback,
      visibleSuggestions: rotateAssistantPromptSuggestions(fallback, now),
    };
  }

  const row = data as SuggestionSetRow;
  const suggestions = suggestionArrayFromRow(row.suggestions);
  const resolved = suggestions.length > 0 ? suggestions : fallback;

  return {
    generatedAt: textValue(row.generated_at),
    model: textValue(row.model),
    setId: String(row.id),
    source: textValue(row.source) ?? "weekly",
    suggestions: resolved,
    visibleSuggestions: rotateAssistantPromptSuggestions(resolved, now),
  };
}

async function loadPromptSamples({
  periodEnd,
  periodStart,
  supabase,
  userId,
  workspaceId,
}: {
  periodEnd: Date;
  periodStart: Date;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const { data, error } = await supabase
    .from("assistant_messages")
    .select("id,content,created_at,thread_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", periodStart.toISOString())
    .lt("created_at", periodEnd.toISOString())
    .order("created_at", { ascending: true })
    .limit(240);

  if (error) {
    throw new Error(`Unable to load assistant prompt history: ${error.message}`);
  }

  const byDay = new Map<string, PromptSample[]>();

  for (const row of data ?? []) {
    const content = stripAttachmentContext(String(row.content ?? ""));

    if (!content || content.length > 500) {
      continue;
    }

    const createdAt = textValue(row.created_at) ?? new Date(0).toISOString();
    const threadId = String(row.thread_id ?? "thread");
    const key = `${threadId}:${createdAt.slice(0, 10)}`;
    const bucket = byDay.get(key) ?? [];

    if (bucket.length >= 3) {
      continue;
    }

    bucket.push({
      content,
      createdAt,
      id: String(row.id),
      threadId,
    });
    byDay.set(key, bucket);
  }

  return [...byDay.values()]
    .flat()
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime(),
    )
    .slice(-MAX_PROMPT_SAMPLE_COUNT);
}

export function deterministicAssistantPromptSuggestionsFromTextSamples(
  samples: string[],
) {
  const scores = new Map<string, number>();

  const add = (suggestion: string, weight = 1) => {
    scores.set(suggestion, (scores.get(suggestion) ?? 0) + weight);
  };

  for (const sample of samples) {
    const text = sample.toLowerCase();

    if (/\b(lead|leads|reply|approval|inbox|work queue)\b/.test(text)) {
      add("Show me leads needing reply");
    }

    if (/\b(quote|quotes|draft|ready|send)\b/.test(text)) {
      add("What quote drafts are ready?");
    }

    if (
      /\b(create|make|draft|generate)\b.*\b(quote|invoice|document)\b/.test(
        text,
      )
    ) {
      add("Create a quote draft");
    }

    if (/\b(image|render|photo|picture|visual|mockup|concept)\b/.test(text)) {
      add("Generate a project concept image");
    }

    if (/\b(customer|client|contact|busiest|summari[sz]e)\b/.test(text)) {
      add("Summarise my busiest customer");
    }

    if (/\b(email|inbound|sync|skipped|sender)\b/.test(text)) {
      add("Show recent inbound email decisions");
    }

    if (/\b(usage|cost|billing|margin|charge)\b/.test(text)) {
      add("Show usage and costs");
    }

    if (/\b(setting|settings|voice|signature|prompt)\b/.test(text)) {
      add("Help me update Kyro settings");
    }
  }

  return normalizeAssistantPromptSuggestions([
    ...[...scores.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([suggestion]) => suggestion),
    ...DEFAULT_ASSISTANT_PROMPT_SUGGESTIONS,
    "Generate a project concept image",
    "Show recent inbound email decisions",
    "Show usage and costs",
    "Help me update Kyro settings",
  ]).slice(0, MAX_SUGGESTION_COUNT);
}

function deterministicSuggestionsFromSamples(samples: PromptSample[]) {
  return deterministicAssistantPromptSuggestionsFromTextSamples(
    samples.map((sample) => sample.content),
  );
}

function responseOutputText(payload: unknown) {
  const root = objectRecord(payload);
  const direct = textValue(root.output_text);

  if (direct) {
    return direct;
  }

  const output = Array.isArray(root.output) ? root.output : [];

  for (const item of output) {
    const content = objectRecord(item).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const text = textValue(objectRecord(part).text);

      if (text) {
        return text;
      }
    }
  }

  return null;
}

function suggestionsFromModelText(text: string | null) {
  if (!text) {
    return [];
  }

  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    const root = objectRecord(parsed);
    const values = Array.isArray(parsed)
      ? parsed
      : Array.isArray(root.suggestions)
        ? root.suggestions
        : [];

    return normalizeAssistantPromptSuggestions(values);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);

    if (!match) {
      return normalizeAssistantPromptSuggestions(trimmed.split(/\n+/));
    }

    try {
      const parsed = JSON.parse(match[0]);
      const root = objectRecord(parsed);

      return normalizeAssistantPromptSuggestions(
        Array.isArray(parsed)
          ? parsed
          : Array.isArray(root.suggestions)
            ? root.suggestions
            : [],
      );
    } catch {
      return normalizeAssistantPromptSuggestions(trimmed.split(/\n+/));
    }
  }
}

async function generateSuggestionsWithOpenAi({
  fallbackSuggestions,
  samples,
  workspace,
}: {
  fallbackSuggestions: string[];
  samples: PromptSample[];
  workspace: WorkspaceInput;
}): Promise<SuggestionGenerationResult | null> {
  const apiKey = openAiApiKey();

  if (!apiKey || samples.length < 3) {
    return null;
  }

  const model = suggestionModel();
  const input = JSON.stringify(
    {
      fallbackSuggestions,
      promptSamples: samples.map((sample) => ({
        at: sample.createdAt,
        prompt: sample.content,
      })),
      rules: [
        "Return 4 to 8 assistant prompt suggestions.",
        "Each suggestion must be customer-agnostic and reusable.",
        "Do not include real customer names, addresses, emails, phone numbers, file IDs, or job-specific details.",
        "Prefer the user's repeated first-of-day/session workflows.",
        "Keep each suggestion under 88 characters.",
        "Use direct action wording, e.g. 'Show me leads needing reply'.",
      ],
      workspaceName: workspace.name,
    },
    null,
    2,
  );
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input,
      instructions:
        "You are Kyro's prompt suggestion curator. Output strict JSON only: {\"suggestions\":[\"...\"]}. Never include customer-specific details.",
      max_output_tokens: 420,
      model,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return null;
  }

  const outputText = responseOutputText(payload);
  const suggestions = suggestionsFromModelText(outputText);

  if (suggestions.length < MIN_SUGGESTION_COUNT) {
    return null;
  }

  return {
    model,
    providerUsageId: openAiProviderUsageId(payload) ?? undefined,
    source: "openai",
    suggestions,
    tokenUsage: openAiUsageFromResponse(payload, {
      prompt: input,
      text: outputText ?? JSON.stringify(suggestions),
    }),
  };
}

async function recordSuggestionGenerationUsage({
  generation,
  sampleCount,
  supabase,
  userId,
  workspace,
}: {
  generation: SuggestionGenerationResult;
  sampleCount: number;
  supabase: SupabaseClient;
  userId: string;
  workspace: WorkspaceInput;
}) {
  if (!generation.tokenUsage || !generation.model) {
    return null;
  }

  const { data: aiRun, error: aiRunError } = await supabase
    .from("ai_runs")
    .insert({
      actual_cost: "0",
      estimated_cost: "0",
      input_refs: {
        sampleCount,
        source: "assistant.prompt_suggestions",
      },
      mode: "tool",
      model: generation.model,
      output: {
        suggestions: generation.suggestions,
      },
      provider: "openai",
      risk_level: "low",
      status: "completed",
      task_type: "assistant_prompt_suggestions",
      tool_calls: [
        {
          input: { sampleCount },
          name: "assistant.prompt_suggestions.generate",
          result: { suggestionCount: generation.suggestions.length },
          status: "completed",
        },
      ],
      usage: generation.tokenUsage,
      user_id: userId,
      workspace_id: workspace.id,
    })
    .select("id")
    .single();

  if (aiRunError || !aiRun) {
    return null;
  }

  const aiRunId = String(aiRun.id);
  const usageEvents = buildLlmUsageEvents({
    context: {
      aiRunId,
      metadata: {
        sampleCount,
        source: "assistant.prompt_suggestions",
      },
      providerUsageId: generation.providerUsageId,
      sourceId: aiRunId,
      sourceType: "ai_run",
      userId,
      workspaceId: workspace.id,
    },
    model: generation.model,
    provider: "openai",
    service: "assistant_prompt_suggestions",
    usage: generation.tokenUsage,
  });

  if (usageEvents.length > 0) {
    await supabase.from("usage_events").insert(toUsageEventRows(usageEvents));
  }

  const totals = usageEventTotals(usageEvents);

  await supabase
    .from("ai_runs")
    .update({
      actual_cost: String(totals.costSnapshot),
      estimated_cost: String(totals.customerChargeSnapshot),
    })
    .eq("id", aiRunId);

  return aiRunId;
}

export async function refreshAssistantPromptSuggestionsForUser({
  now = new Date(),
  periodEnd,
  periodStart,
  trigger = "weekly",
  supabase,
  userId,
  workspace,
}: {
  now?: Date;
  periodEnd?: Date | string | null;
  periodStart?: Date | string | null;
  trigger?: "manual" | "weekly";
  supabase: SupabaseClient;
  userId: string;
  workspace: WorkspaceInput;
}) {
  const fallbackPeriod = defaultPeriod(now);
  const resolvedPeriodStart = dateOr(periodStart, fallbackPeriod.periodStart);
  const resolvedPeriodEnd = dateOr(periodEnd, fallbackPeriod.periodEnd);
  const samples = await loadPromptSamples({
    periodEnd: resolvedPeriodEnd,
    periodStart: resolvedPeriodStart,
    supabase,
    userId,
    workspaceId: workspace.id,
  });
  const fallbackSuggestions = deterministicSuggestionsFromSamples(samples);
  const generation =
    (await generateSuggestionsWithOpenAi({
      fallbackSuggestions,
      samples,
      workspace,
    }).catch(() => null)) ??
    ({
      model: null,
      source: "fallback",
      suggestions: fallbackSuggestions,
    } satisfies SuggestionGenerationResult);
  const aiRunId = await recordSuggestionGenerationUsage({
    generation,
    sampleCount: samples.length,
    supabase,
    userId,
    workspace,
  }).catch(() => null);

  await supabase
    .from("assistant_prompt_suggestion_sets")
    .update({ status: "archived" })
    .eq("workspace_id", workspace.id)
    .eq("user_id", userId)
    .eq("status", "active");

  const { data, error } = await supabase
    .from("assistant_prompt_suggestion_sets")
    .insert({
      generated_at: now.toISOString(),
      metadata: {
        aiRunId,
        fallbackSuggestionCount: fallbackSuggestions.length,
        sampleCount: samples.length,
      },
      model: generation.model,
      period_end: resolvedPeriodEnd.toISOString(),
      period_start: resolvedPeriodStart.toISOString(),
      source:
        generation.source === "openai"
          ? `${trigger}_llm`
          : `${trigger}_fallback`,
      status: "active",
      suggestions: generation.suggestions,
      user_id: userId,
      workspace_id: workspace.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to save assistant prompt suggestions: ${error?.message ?? "unknown error"}`,
    );
  }

  return {
    generatedAt: now.toISOString(),
    sampleCount: samples.length,
    setId: String(data.id),
    source:
      generation.source === "openai"
        ? `${trigger}_llm`
        : `${trigger}_fallback`,
    suggestions: generation.suggestions,
    visibleSuggestions: rotateAssistantPromptSuggestions(
      generation.suggestions,
      now,
    ),
  };
}
