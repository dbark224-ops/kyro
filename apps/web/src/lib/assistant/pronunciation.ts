import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  buildLlmUsageEvents,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  toUsageEventRows,
  usageEventTotals,
} from "../usage/openai";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";

export const PRONUNCIATION_CATEGORIES = [
  "person",
  "place",
  "business",
  "product",
  "acronym",
  "other",
] as const;

export const PRONUNCIATION_STATUSES = [
  "suggested",
  "inferred",
  "approved",
  "ignored",
] as const;

export type PronunciationCategory = (typeof PRONUNCIATION_CATEGORIES)[number];
export type PronunciationStatus = (typeof PRONUNCIATION_STATUSES)[number];

export type AssistantPronunciationEntry = {
  aliases: string[];
  category: PronunciationCategory;
  confidence: number;
  createdAt: string;
  id: string;
  lastSeenAt: string | null;
  metadata: Record<string, unknown>;
  phrase: string;
  pronunciationHint: string | null;
  source: string;
  status: PronunciationStatus;
  updatedAt: string;
  usageCount: number;
};

type AssistantPronunciationRow = {
  aliases: unknown;
  category: unknown;
  confidence: unknown;
  created_at: unknown;
  id: unknown;
  last_seen_at: unknown;
  metadata: unknown;
  phrase: unknown;
  pronunciation_hint: unknown;
  source: unknown;
  status: unknown;
  updated_at: unknown;
};

export function normalizePronunciationPhrase(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function splitPronunciationAliases(value: string) {
  return value
    .split(/[\n,]/)
    .map((alias) => alias.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function formatPronunciationAliases(aliases: string[]) {
  return aliases.join(", ");
}

export function defaultPronunciationHint(phrase: string) {
  const value = phrase.trim().replace(/\s+/g, " ");

  if (!value) {
    return "";
  }

  const compactAcronym = value.replace(/[^A-Za-z0-9]/g, "");

  if (
    compactAcronym.length >= 2 &&
    compactAcronym.length <= 10 &&
    compactAcronym === compactAcronym.toUpperCase() &&
    /[A-Z]/.test(compactAcronym)
  ) {
    return compactAcronym.split("").join(" ");
  }

  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._/]+/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function pronunciationAliasModel() {
  return (
    envValue("OPENAI_PRONUNCIATION_ALIAS_MODEL") ||
    envValue("OPENAI_LOW_COST_MODEL") ||
    envValue("OPENAI_ASSISTANT_MODEL") ||
    envValue("OPENAI_MODEL") ||
    "gpt-4.1-mini"
  );
}

function pronunciationAliasTimeoutMs() {
  const parsed = Number(envValue("OPENAI_PRONUNCIATION_ALIAS_TIMEOUT_MS"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4_000;
}

export function pronunciationCategoryValue(
  value: unknown,
): PronunciationCategory {
  return PRONUNCIATION_CATEGORIES.includes(value as PronunciationCategory)
    ? (value as PronunciationCategory)
    : "other";
}

export function pronunciationStatusValue(value: unknown): PronunciationStatus {
  return PRONUNCIATION_STATUSES.includes(value as PronunciationStatus)
    ? (value as PronunciationStatus)
    : "suggested";
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function aliasesValue(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((alias) => (typeof alias === "string" ? alias.trim() : ""))
        .filter(Boolean)
    : [];
}

function metadataValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);

  return (
    textValue(error.message) ?? "OpenAI pronunciation alias request failed."
  );
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function toEntry(row: AssistantPronunciationRow): AssistantPronunciationEntry {
  const metadata = metadataValue(row.metadata);

  return {
    aliases: aliasesValue(row.aliases),
    category: pronunciationCategoryValue(row.category),
    confidence: Math.min(1, Math.max(0, numberValue(row.confidence))),
    createdAt: String(row.created_at),
    id: String(row.id),
    lastSeenAt: textValue(row.last_seen_at),
    metadata,
    phrase: textValue(row.phrase) ?? "",
    pronunciationHint: textValue(row.pronunciation_hint),
    source: textValue(row.source) ?? "manual",
    status: pronunciationStatusValue(row.status),
    updatedAt: String(row.updated_at),
    usageCount: Math.max(0, Math.floor(numberValue(metadata.usageCount))),
  };
}

const PRONUNCIATION_SELECT =
  "id,phrase,pronunciation_hint,category,status,source,aliases,confidence,metadata,last_seen_at,created_at,updated_at";

export async function getPronunciationEntries(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("assistant_pronunciations")
    .select(PRONUNCIATION_SELECT)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(
      `Unable to load pronunciation vocabulary: ${error.message}`,
    );
  }

  return ((data ?? []) as unknown as AssistantPronunciationRow[])
    .map(toEntry)
    .sort((a, b) => {
      const usageDelta = b.usageCount - a.usageCount;

      if (usageDelta !== 0) {
        return usageDelta;
      }

      const aLastSeen = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bLastSeen = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;

      if (bLastSeen !== aLastSeen) {
        return bLastSeen - aLastSeen;
      }

      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

export async function getActivePronunciationEntries(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const entries = await getPronunciationEntries(supabase, workspaceId);

  return entries.filter((entry) => entry.status !== "ignored");
}

export async function getPronunciationEntry(
  supabase: SupabaseClient,
  workspaceId: string,
  entryId: string,
) {
  const { data, error } = await supabase
    .from("assistant_pronunciations")
    .select(PRONUNCIATION_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("id", entryId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load pronunciation entry: ${error.message}`);
  }

  return data ? toEntry(data as unknown as AssistantPronunciationRow) : null;
}

export async function upsertPronunciationEntry({
  aliases,
  category,
  confidence = 1,
  phrase,
  pronunciationHint,
  source = "manual",
  status,
  supabase,
  user,
  workspaceId,
}: {
  aliases: string[];
  category: PronunciationCategory;
  confidence?: number;
  phrase: string;
  pronunciationHint: string | null;
  source?: string;
  status: PronunciationStatus;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const normalizedPhrase = normalizePronunciationPhrase(phrase);

  if (!normalizedPhrase) {
    throw new Error("Pronunciation phrase is required.");
  }

  const { data, error } = await supabase
    .from("assistant_pronunciations")
    .upsert(
      {
        aliases,
        category,
        confidence: String(Math.min(1, Math.max(0, confidence))),
        created_by_user_id: user.id,
        normalized_phrase: normalizedPhrase,
        phrase: phrase.trim().replace(/\s+/g, " "),
        pronunciation_hint: pronunciationHint,
        reviewed_by_user_id:
          status === "approved" || status === "ignored" ? user.id : null,
        source,
        status,
        workspace_id: workspaceId,
      },
      {
        onConflict: "workspace_id,normalized_phrase",
      },
    )
    .select(PRONUNCIATION_SELECT)
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to save pronunciation entry: ${error?.message ?? "unknown error"}`,
    );
  }

  return toEntry(data as unknown as AssistantPronunciationRow);
}

export async function updatePronunciationEntry({
  aliases,
  category,
  entryId,
  phrase,
  pronunciationHint,
  status,
  supabase,
  user,
  workspaceId,
}: {
  aliases: string[];
  category: PronunciationCategory;
  entryId: string;
  phrase: string;
  pronunciationHint: string | null;
  status: PronunciationStatus;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const normalizedPhrase = normalizePronunciationPhrase(phrase);

  if (!normalizedPhrase) {
    throw new Error("Pronunciation phrase is required.");
  }

  const { data, error } = await supabase
    .from("assistant_pronunciations")
    .update({
      aliases,
      category,
      normalized_phrase: normalizedPhrase,
      phrase: phrase.trim().replace(/\s+/g, " "),
      pronunciation_hint: pronunciationHint,
      reviewed_by_user_id:
        status === "approved" || status === "ignored" ? user.id : null,
      status,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", entryId)
    .select(PRONUNCIATION_SELECT)
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to update pronunciation entry: ${error?.message ?? "unknown error"}`,
    );
  }

  return toEntry(data as unknown as AssistantPronunciationRow);
}

export async function setPronunciationEntryStatus({
  entryId,
  status,
  supabase,
  user,
  workspaceId,
}: {
  entryId: string;
  status: PronunciationStatus;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const { error } = await supabase
    .from("assistant_pronunciations")
    .update({
      reviewed_by_user_id:
        status === "approved" || status === "ignored" ? user.id : null,
      status,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", entryId);

  if (error) {
    throw new Error(`Unable to update pronunciation status: ${error.message}`);
  }
}

export function pronunciationGuideLines(
  entries: AssistantPronunciationEntry[],
) {
  return entries
    .filter((entry) => entry.status !== "ignored")
    .slice(0, 40)
    .map((entry) => {
      const defaultHint = defaultPronunciationHint(entry.phrase);
      const hint = entry.pronunciationHint ?? defaultHint;
      const hintText = hint
        ? `say as "${hint}"`
        : "use best-effort pronunciation";
      const aliases = entry.aliases.length
        ? `; related aliases to recognize, not substitute: ${entry.aliases.join(", ")}`
        : "";

      return `- ${entry.phrase} (${entry.category}): ${hintText}${aliases}`;
    });
}

export function pronunciationGuideText(entries: AssistantPronunciationEntry[]) {
  const lines = pronunciationGuideLines(entries);

  return lines.length > 0 ? lines.join("\n") : "";
}

export function pronunciationPreviewText(entry: AssistantPronunciationEntry) {
  return entry.phrase;
}

export function pronunciationPreviewInstructions(
  entry: AssistantPronunciationEntry,
) {
  const phrase = entry.phrase.trim();
  const hint =
    entry.pronunciationHint?.trim() || defaultPronunciationHint(entry.phrase);
  const pronunciationGuidance = hint
    ? [
        `Private pronunciation guide, not spoken text: "${hint}".`,
        "Use that guide only to shape how the target sounds.",
        "Treat hyphens, slashes, dots, and spaces in the guide as approximate syllable boundaries, not as pauses, punctuation, or separate words.",
        "Blend the syllables into one natural spoken word or phrase.",
      ].join(" ")
    : "Use your best natural pronunciation for the target text.";

  return [
    "You are Kyro's live voice pronunciation preview.",
    `Target text to speak aloud: "${phrase}"`,
    pronunciationGuidance,
    "Use the same warm, practical, conversational delivery as Kyro's live voice assistant.",
    "Output only the target text once.",
    "Do not say the private pronunciation guide. Do not say hyphen, dash, slash, dot, quote, or syllable. Do not explain the pronunciation. Do not add any other words.",
  ].join("\n");
}

const CANDIDATE_STOP_WORDS = new Set([
  "About",
  "Actually",
  "Also",
  "Because",
  "Before",
  "Could",
  "Customer",
  "Please",
  "Should",
  "Thanks",
  "There",
  "These",
  "This",
  "Would",
  "You",
]);

const ORDINARY_TITLECASE_WORDS = new Set([
  "champion",
  "champions",
  "correct",
  "english",
  "football",
  "league",
  "latest",
  "premier",
  "result",
  "results",
  "standing",
  "standings",
  "table",
  "team",
  "teams",
]);

function pronunciationCandidateValue(value: string) {
  return value.trim().replace(/[.-]+$/g, "");
}

function hasUnusualPronunciationShape(value: string) {
  const word = pronunciationCandidateValue(value).replace(/[’']s$/i, "");
  const lower = word.toLowerCase();

  if (
    !word ||
    CANDIDATE_STOP_WORDS.has(word) ||
    ORDINARY_TITLECASE_WORDS.has(lower)
  ) {
    return false;
  }

  if (/[^ -~]/.test(word) || /['’.-]/.test(word)) {
    return true;
  }

  if (/[a-z][A-Z]/.test(word) || /^ng/i.test(word)) {
    return true;
  }

  if (/[jqxz]/i.test(word) && word.length >= 6) {
    return true;
  }

  if (/(aa|ee|ii|oo|uu)/i.test(word) && word.length >= 7) {
    return true;
  }

  return word.length >= 12;
}

export function extractPronunciationCandidates(text: string) {
  const acronyms = Array.from(text.matchAll(/\b[A-Z][A-Z0-9&]{1,9}\b/g)).map(
    (match) => match[0],
  );
  const properWords = Array.from(
    text.matchAll(
      /(^|[^\p{L}\p{N}])(\p{Lu}[\p{L}'’.-]{4,})(?=$|[^\p{L}\p{N}])/gu,
    ),
  )
    .map((match) => pronunciationCandidateValue(match[2]))
    .filter(hasUnusualPronunciationShape);
  const candidates = [...acronyms, ...properWords];
  const normalized = new Set<string>();

  return candidates
    .filter((candidate) => {
      const key = normalizePronunciationPhrase(candidate);

      if (!key || normalized.has(key)) {
        return false;
      }

      normalized.add(key);
      return true;
    })
    .slice(0, 8);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termAppearsInText(text: string, term: string) {
  const normalizedTerm = term.trim().replace(/\s+/g, " ");

  if (!normalizedTerm) {
    return false;
  }

  const escaped = normalizedTerm.split(/\s+/).map(escapeRegExp).join("\\s+");
  const startsWordLike = /^[A-Za-z0-9]/.test(normalizedTerm);
  const endsWordLike = /[A-Za-z0-9]$/.test(normalizedTerm);
  const pattern = [
    startsWordLike ? "(^|[^A-Za-z0-9])" : "",
    escaped,
    endsWordLike ? "($|[^A-Za-z0-9])" : "",
  ].join("");

  return new RegExp(pattern, "i").test(text);
}

type AliasEnrichment = {
  aliases: string[];
  category: PronunciationCategory;
  reason: string | null;
};

function aliasKey(value: string) {
  return normalizePronunciationPhrase(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanAlias(value: unknown, phrase: string) {
  if (typeof value !== "string") {
    return null;
  }

  const alias = value
    .trim()
    .replace(/^["'“”]+|["'“”.,!?]+$/g, "")
    .replace(/\s+/g, " ");

  if (!alias || alias.length < 2 || alias.length > 60) {
    return null;
  }

  if (aliasKey(alias) === aliasKey(phrase)) {
    return null;
  }

  return alias;
}

function normalizeAliasEnrichment(
  value: unknown,
  phrase: string,
): AliasEnrichment {
  const record = objectRecord(value);
  const aliases = Array.isArray(record.aliases)
    ? record.aliases
        .map((alias) => cleanAlias(alias, phrase))
        .filter((alias): alias is string => Boolean(alias))
    : [];
  const uniqueAliases = [
    ...new Map(aliases.map((alias) => [aliasKey(alias), alias])).values(),
  ].slice(0, 6);

  return {
    aliases: uniqueAliases,
    category: pronunciationCategoryValue(record.category),
    reason: textValue(record.reason),
  };
}

async function enrichPronunciationCandidatesWithAliases({
  candidates,
  source,
  sourceId,
  sourceText,
  supabase,
  user,
  workspaceId,
}: {
  candidates: string[];
  source: string;
  sourceId: string | null;
  sourceText: string;
  supabase: SupabaseClient;
  user: User;
  workspaceId: string;
}) {
  const apiKey = openAiApiKey();

  if (!apiKey || candidates.length === 0) {
    return new Map<string, AliasEnrichment>();
  }

  const model = pronunciationAliasModel();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    pronunciationAliasTimeoutMs(),
  );
  const prompt = JSON.stringify(
    {
      candidates,
      surroundingText: sourceText.slice(0, 2_400),
      task: "Suggest pronunciation vocabulary aliases for these candidates. Aliases are for matching/context only, not for replacing the spoken text.",
      rules: [
        "Return aliases only when they are likely useful: common nicknames, alternate spellings, misspellings, abbreviations, or speech-to-text mishearings.",
        "For known public places/businesses, use general knowledge cautiously when the surrounding text supports it.",
        "Do not include the phrase itself as an alias.",
        "Do not include generic ordinary words.",
        "If unsure, return an empty aliases array.",
        "Prefer 0-4 aliases. Maximum 6 aliases per candidate.",
      ],
    },
    null,
    2,
  );

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: prompt,
        instructions:
          "You maintain Kyro's pronunciation vocabulary for a trades/service CRM. Return compact JSON matching the schema. Be conservative and useful.",
        max_output_tokens: 520,
        model,
        text: {
          format: {
            name: "kyro_pronunciation_aliases",
            schema: {
              additionalProperties: false,
              properties: {
                enrichments: {
                  items: {
                    additionalProperties: false,
                    properties: {
                      aliases: {
                        items: { type: "string" },
                        type: "array",
                      },
                      category: {
                        enum: PRONUNCIATION_CATEGORIES,
                        type: "string",
                      },
                      phrase: { type: "string" },
                      reason: { type: ["string", "null"] },
                    },
                    required: ["phrase", "category", "aliases", "reason"],
                    type: "object",
                  },
                  type: "array",
                },
              },
              required: ["enrichments"],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(providerErrorMessage(payload));
    }

    const content = responseOutputText(payload);

    if (!content) {
      return new Map<string, AliasEnrichment>();
    }

    const tokenUsage = openAiUsageFromResponse(payload, {
      prompt,
      text: content,
    });
    const usageMarkupRate = await resolveWorkspaceUsageMarkupRate(
      supabase,
      workspaceId,
      "OPENAI_LLM_MARKUP_RATE",
    );
    const usageEvents = buildLlmUsageEvents({
      context: {
        metadata: {
          candidateCount: candidates.length,
          source,
          sourceId,
        },
        providerUsageId: openAiProviderUsageId(payload),
        usageMarkupRate,
        userId: user.id,
        workspaceId,
      },
      model,
      provider: "openai",
      service: "llm",
      usage: tokenUsage,
    });
    const usageTotals = usageEventTotals(usageEvents);
    const { data: aiRun } = await supabase
      .from("ai_runs")
      .insert({
        actual_cost: String(usageTotals.costSnapshot),
        completed_at: new Date().toISOString(),
        estimated_cost: String(usageTotals.costSnapshot),
        input_refs: {
          candidateCount: candidates.length,
          source,
          sourceId,
        },
        mode: "assistant_background",
        model,
        output: {},
        provider: "openai",
        risk_level: "low",
        status: "completed",
        task_type: "pronunciation_alias_enrichment",
        tool_calls: [],
        usage: {
          cachedInputTokens: tokenUsage.cachedInputTokens,
          customerCharge: usageTotals.customerChargeSnapshot,
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          reasoningTokens: tokenUsage.reasoningTokens,
          totalTokens: tokenUsage.totalTokens,
        },
        user_id: user.id,
        workspace_id: workspaceId,
      })
      .select("id")
      .single();

    if (aiRun?.id) {
      const aiRunId = String(aiRun.id);

      await supabase.from("usage_events").insert(
        toUsageEventRows(
          usageEvents.map((event) => ({
            ...event,
            aiRunId,
            sourceId: aiRunId,
            sourceType: "ai_run",
          })),
        ),
      );
    }

    const parsed = extractJsonObject(content);
    const enrichments = Array.isArray(parsed.enrichments)
      ? parsed.enrichments
      : [];
    const byPhrase = new Map<string, AliasEnrichment>();

    for (const enrichment of enrichments) {
      const record = objectRecord(enrichment);
      const phrase = textValue(record.phrase);

      if (!phrase) {
        continue;
      }

      const originalCandidate = candidates.find(
        (candidate) => aliasKey(candidate) === aliasKey(phrase),
      );

      if (!originalCandidate) {
        continue;
      }

      byPhrase.set(
        normalizePronunciationPhrase(originalCandidate),
        normalizeAliasEnrichment(enrichment, originalCandidate),
      );
    }

    return byPhrase;
  } catch {
    return new Map<string, AliasEnrichment>();
  } finally {
    clearTimeout(timeout);
  }
}

export async function recordPronunciationUsageFromText({
  supabase,
  text,
  workspaceId,
}: {
  supabase: SupabaseClient;
  text: string;
  workspaceId: string;
}) {
  if (!text.trim()) {
    return 0;
  }

  const entries = await getPronunciationEntries(supabase, workspaceId);
  const matchedEntries = entries.filter(
    (entry) =>
      entry.status !== "ignored" &&
      [entry.phrase, ...entry.aliases].some((term) =>
        termAppearsInText(text, term),
      ),
  );

  if (matchedEntries.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();

  await Promise.all(
    matchedEntries.map(async (entry) => {
      const { error } = await supabase
        .from("assistant_pronunciations")
        .update({
          last_seen_at: now,
          metadata: {
            ...entry.metadata,
            usageCount: entry.usageCount + 1,
          },
        })
        .eq("workspace_id", workspaceId)
        .eq("id", entry.id);

      if (error) {
        throw new Error(
          `Unable to update pronunciation usage: ${error.message}`,
        );
      }
    }),
  );

  return matchedEntries.length;
}

export async function suggestPronunciationCandidatesFromText({
  source,
  sourceId,
  supabase,
  text,
  user,
  workspaceId,
}: {
  source: string;
  sourceId: string | null;
  supabase: SupabaseClient;
  text: string;
  user: User;
  workspaceId: string;
}) {
  const candidates = extractPronunciationCandidates(text);

  if (candidates.length === 0) {
    return;
  }

  const existingEntries = await getPronunciationEntries(supabase, workspaceId);
  const existingKeys = new Set(
    existingEntries.map((entry) => normalizePronunciationPhrase(entry.phrase)),
  );
  const newCandidates = candidates.filter(
    (candidate) => !existingKeys.has(normalizePronunciationPhrase(candidate)),
  );

  if (newCandidates.length === 0) {
    return;
  }

  const aliasEnrichments = await enrichPronunciationCandidatesWithAliases({
    candidates: newCandidates,
    source,
    sourceId,
    sourceText: text,
    supabase,
    user,
    workspaceId,
  });
  const now = new Date().toISOString();
  const rows = newCandidates.map((phrase) => {
    const isAcronym = /^[A-Z0-9&]{2,10}$/.test(phrase);
    const enrichment = aliasEnrichments.get(
      normalizePronunciationPhrase(phrase),
    );

    return {
      aliases: enrichment?.aliases ?? [],
      category: isAcronym ? "acronym" : (enrichment?.category ?? "other"),
      confidence: enrichment ? "0.55" : "0.35",
      created_by_user_id: user.id,
      last_seen_at: now,
      metadata: {
        aliasEnrichment: enrichment
          ? {
              generatedAt: now,
              model: pronunciationAliasModel(),
              reason: enrichment.reason,
              source: "openai",
            }
          : null,
        sourceId,
        usageCount: 1,
      },
      normalized_phrase: normalizePronunciationPhrase(phrase),
      phrase,
      pronunciation_hint: defaultPronunciationHint(phrase) || null,
      source,
      status: "inferred",
      workspace_id: workspaceId,
    };
  });

  const { error } = await supabase
    .from("assistant_pronunciations")
    .upsert(rows, {
      ignoreDuplicates: true,
      onConflict: "workspace_id,normalized_phrase",
    });

  if (error) {
    throw new Error(
      `Unable to suggest pronunciation candidates: ${error.message}`,
    );
  }
}

export async function capturePronunciationSignalsFromText({
  source,
  sourceId,
  supabase,
  text,
  user,
  workspaceId,
}: {
  source: string;
  sourceId: string | null;
  supabase: SupabaseClient;
  text: string;
  user: User;
  workspaceId: string;
}) {
  await recordPronunciationUsageFromText({
    supabase,
    text,
    workspaceId,
  });

  await suggestPronunciationCandidatesFromText({
    source,
    sourceId,
    supabase,
    text,
    user,
    workspaceId,
  });
}
