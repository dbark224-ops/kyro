import { createServiceSupabaseClient } from "../supabase/service";
import {
  AUSTRALIAN_KNOWLEDGE_COLLECTION_TARGETS,
  type KnowledgeCollectionTarget,
} from "./catalog";

export type LegislationKnowledgeSnippet = {
  content: string;
  heading: string;
  jurisdictionRegion: string | null;
  licensingMode: string;
  officialUrl: string | null;
  source: string;
};

export type LegislationCollectionMatch = {
  documentsToCollect: string[];
  industries: string[];
  jurisdictionRegion: string;
  licensingMode: string;
  notes: string;
  officialUrl: string;
  regulator: string;
  sourceType: string;
  title: string;
};

export type LegislationKnowledgeResult = {
  collectionMatches: LegislationCollectionMatch[];
  hasStructuredContent: boolean;
  snippets: LegislationKnowledgeSnippet[];
};

type KnowledgeChunkRow = {
  chunk_summary: string | null;
  chunk_text: string;
  clause_ref: string | null;
  heading: string | null;
  section_label: string | null;
  topic_tags: string[] | null;
  document: {
    title: string | null;
    source: {
      industry: string | null;
      jurisdiction_region: string | null;
      licensing_mode: string;
      official_url: string | null;
      title: string;
      topic_tags: string[] | null;
    } | null;
  } | null;
};

type KnowledgeDocumentRow = NonNullable<KnowledgeChunkRow["document"]>;
type KnowledgeSourceRow = NonNullable<KnowledgeDocumentRow["source"]>;

const JURISDICTION_ALIASES: Record<string, string[]> = {
  ACT: ["act", "australian capital territory", "canberra"],
  Federal: ["australia", "australian", "commonwealth", "federal", "national"],
  NSW: ["new south wales", "nsw", "sydney"],
  NT: ["nt", "northern territory", "darwin"],
  QLD: ["brisbane", "gold coast", "qld", "queensland", "sunshine coast", "toowoomba"],
  SA: ["adelaide", "sa", "south australia"],
  TAS: ["hobart", "tas", "tasmania"],
  VIC: ["melbourne", "vic", "victoria"],
  WA: ["perth", "wa", "western australia"],
};

const INDUSTRY_ALIASES: Record<string, string[]> = {
  building: [
    "build",
    "builder",
    "building",
    "construction",
    "contractor",
    "renovation",
    "trade",
  ],
  electrical: ["electric", "electrical", "electrician", "switchboard", "wiring"],
  gas: ["appliance", "gas", "gasfit", "gasfitter", "lpg"],
  hvac: ["air con", "air conditioning", "cooling", "heating", "hvac", "refrigeration"],
  plumbing: [
    "backflow",
    "drain",
    "drainage",
    "plumb",
    "plumber",
    "plumbing",
    "sewer",
    "water",
  ],
};

const COMPLIANCE_TERMS = [
  "act",
  "building code",
  "code",
  "codes",
  "compliance",
  "law",
  "laws",
  "legislation",
  "licence",
  "licensing",
  "permit",
  "permits",
  "regulation",
  "regulations",
  "rule",
  "rules",
  "standard",
  "standards",
  "whs",
];

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

function promptTokens(prompt: string) {
  return normalizedText(prompt)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function inferJurisdictions(prompt: string) {
  const text = normalizedText(prompt);
  const matches = Object.entries(JURISDICTION_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => text.includes(alias)))
    .map(([region]) => region);

  return matches.length > 0
    ? matches
    : ["Federal", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
}

function inferIndustries(prompt: string) {
  const text = normalizedText(prompt);

  return Object.entries(INDUSTRY_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => text.includes(alias)))
    .map(([industry]) => industry);
}

function scoreText(text: string, tokens: string[]) {
  const haystack = normalizedText(text);
  let score = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length >= 7 ? 3 : 2;
    }
  }

  return score;
}

function catalogScore(entry: KnowledgeCollectionTarget, tokens: string[]) {
  let score = 0;
  score += scoreText(entry.title, tokens) * 3;
  score += scoreText(entry.notes, tokens) * 2;
  score += scoreText(entry.regulator, tokens) * 2;
  score += scoreText(entry.industries.join(" "), tokens) * 2;
  score += scoreText(entry.topics.join(" "), tokens) * 2;
  score += scoreText(entry.documentsToCollect.join(" "), tokens);
  return score;
}

function chunkScore(row: KnowledgeChunkRow, tokens: string[]) {
  const source = row.document?.source;
  let score = 0;
  score += scoreText(row.heading ?? "", tokens) * 3;
  score += scoreText(row.section_label ?? "", tokens) * 2;
  score += scoreText(row.clause_ref ?? "", tokens) * 2;
  score += scoreText(row.chunk_summary ?? "", tokens) * 2;
  score += scoreText(row.chunk_text, tokens) * 2;
  score += scoreText(row.topic_tags?.join(" ") ?? "", tokens) * 2;
  score += scoreText(source?.title ?? "", tokens) * 2;
  score += scoreText(source?.industry ?? "", tokens) * 2;
  score += scoreText(source?.topic_tags?.join(" ") ?? "", tokens) * 2;
  return score;
}

function matchesAny<T extends string>(values: T[], candidates: T[]) {
  return values.length === 0 || values.some((value) => candidates.includes(value));
}

function sourceHeading(row: KnowledgeChunkRow) {
  const pieces = [
    row.document?.source?.title ?? null,
    row.document?.title ?? null,
    row.section_label ?? row.heading ?? row.clause_ref ?? null,
  ].filter((value): value is string => Boolean(value));

  return pieces.join(" - ");
}

function firstRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function looksLikeLegislationKnowledgeRequest(prompt: string) {
  const text = normalizedText(prompt);
  const mentionsCompliance = COMPLIANCE_TERMS.some((term) => text.includes(term));
  const mentionsTradeContext =
    Object.values(INDUSTRY_ALIASES).some((aliases) =>
      aliases.some((alias) => text.includes(alias)),
    ) ||
    Object.values(JURISDICTION_ALIASES).some((aliases) =>
      aliases.some((alias) => text.includes(alias)),
    );

  return mentionsCompliance && mentionsTradeContext;
}

export async function searchLegislationKnowledge(input: {
  prompt: string;
  workspaceId: string;
}): Promise<LegislationKnowledgeResult> {
  const tokens = promptTokens(input.prompt);
  const jurisdictions = inferJurisdictions(input.prompt);
  const industries = inferIndustries(input.prompt);
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("knowledge_chunks")
    .select(
      `
        chunk_summary,
        chunk_text,
        clause_ref,
        heading,
        section_label,
        topic_tags,
        document:knowledge_documents(
          title,
          source:knowledge_sources(
            industry,
            jurisdiction_region,
            licensing_mode,
            official_url,
            title,
            topic_tags
          )
        )
      `,
    )
    .or(`workspace_id.is.null,workspace_id.eq.${input.workspaceId}`)
    .limit(150);

  if (error) {
    throw new Error(`Unable to search legislation knowledge: ${error.message}`);
  }

  const structuredRows = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const document = firstRecord(
        row.document as KnowledgeDocumentRow | KnowledgeDocumentRow[] | null,
      );
      const source = firstRecord(
        document?.source as KnowledgeSourceRow | KnowledgeSourceRow[] | null,
      );

      return {
        chunk_summary:
          typeof row.chunk_summary === "string" ? row.chunk_summary : null,
        chunk_text: String(row.chunk_text ?? ""),
        clause_ref: typeof row.clause_ref === "string" ? row.clause_ref : null,
        heading: typeof row.heading === "string" ? row.heading : null,
        section_label:
          typeof row.section_label === "string" ? row.section_label : null,
        topic_tags: Array.isArray(row.topic_tags)
          ? row.topic_tags.filter((value): value is string => typeof value === "string")
          : null,
        document: document
          ? {
              source: source
                ? {
                    industry:
                      typeof source.industry === "string" ? source.industry : null,
                    jurisdiction_region:
                      typeof source.jurisdiction_region === "string"
                        ? source.jurisdiction_region
                        : null,
                    licensing_mode: String(
                      source.licensing_mode ?? "public_ingest",
                    ),
                    official_url:
                      typeof source.official_url === "string"
                        ? source.official_url
                        : null,
                    title: String(source.title ?? "Knowledge source"),
                    topic_tags: Array.isArray(source.topic_tags)
                      ? source.topic_tags.filter(
                          (value: unknown): value is string =>
                            typeof value === "string",
                        )
                      : null,
                  }
                : null,
              title: typeof document.title === "string" ? document.title : null,
            }
          : null,
      } satisfies KnowledgeChunkRow;
    })
    .filter((row) => row.document?.source)
    .filter((row) => {
      const region = row.document?.source?.jurisdiction_region ?? "Federal";
      const industry = row.document?.source?.industry;
      const regionMatch = jurisdictions.includes("Federal")
        ? true
        : jurisdictions.includes(region);
      const industryMatch = matchesAny(industries, industry ? [industry] : []);
      return regionMatch && industryMatch;
    })
    .map((row) => ({ row, score: chunkScore(row, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map(({ row }) => row);

  const collectionMatches = AUSTRALIAN_KNOWLEDGE_COLLECTION_TARGETS
    .filter((entry) => jurisdictions.includes("Federal") || jurisdictions.includes(entry.jurisdictionRegion))
    .filter((entry) => matchesAny(industries, entry.industries))
    .map((entry) => ({ entry, score: catalogScore(entry, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map(({ entry }) => ({
      documentsToCollect: entry.documentsToCollect,
      industries: entry.industries,
      jurisdictionRegion: entry.jurisdictionRegion,
      licensingMode: entry.licensingMode,
      notes: entry.notes,
      officialUrl: entry.officialUrl,
      regulator: entry.regulator,
      sourceType: entry.sourceType,
      title: entry.title,
    }));

  return {
    collectionMatches,
    hasStructuredContent: structuredRows.length > 0,
    snippets: structuredRows.map((row) => ({
      content: row.chunk_summary?.trim() || row.chunk_text.trim(),
      heading: sourceHeading(row),
      jurisdictionRegion: row.document?.source?.jurisdiction_region ?? null,
      licensingMode: row.document?.source?.licensing_mode ?? "public_ingest",
      officialUrl: row.document?.source?.official_url ?? null,
      source: row.document?.source?.title ?? "Knowledge source",
    })),
  };
}
