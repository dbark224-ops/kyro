import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getApiWorkspaceContext } from "../../../lib/workspace/api-context";

export const dynamic = "force-dynamic";

type SearchResultType =
  | "contact"
  | "document"
  | "file"
  | "lead"
  | "message"
  | "quote"
  | "voice";

type SearchResult = {
  description: string | null;
  href: string;
  id: string;
  label: string;
  meta: string;
  timestamp: string | null;
  type: SearchResultType;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

type SearchResponse = {
  data: Record<string, unknown>[] | null;
  error: SupabaseErrorLike | null;
};

const MAX_QUERY_LENGTH = 120;
const RESULT_LIMIT_PER_GROUP = 6;

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanQuery(value: string) {
  return value
    .replace(/[^a-zA-Z0-9@+.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function searchPattern(query: string) {
  const cleaned = cleanQuery(query);

  if (!cleaned || cleaned.length < 2) {
    return null;
  }

  return `%${cleaned.split(" ").slice(0, 5).join("%")}%`;
}

function ilikeAny(fields: string[], pattern: string) {
  return fields.map((field) => `${field}.ilike.${pattern}`).join(",");
}

function compact(value: string | null, fallback: string, maxLength = 140) {
  const text = value?.replace(/\s+/g, " ").trim() || fallback;

  return text.length > maxLength
    ? `${text.slice(0, Math.max(0, maxLength - 1))}...`
    : text;
}

function titleCase(value: string | null, fallback = "Record") {
  const source = value ?? fallback;

  return source
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function joinMeta(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).join(" - ");
}

function isMissingOptionalTable(error: SupabaseErrorLike | null, table: string) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "PGRST205" ||
    (message.includes("schema cache") && message.includes(table))
  );
}

async function collectResults(
  table: string,
  query: PromiseLike<unknown>,
  mapper: (row: Record<string, unknown>) => SearchResult,
) {
  const response = (await query) as SearchResponse;

  if (response.error) {
    if (isMissingOptionalTable(response.error, table)) {
      return [];
    }

    throw new Error(response.error.message ?? `Unable to search ${table}.`);
  }

  return (response.data ?? []).map(mapper);
}

function contactResult(row: Record<string, unknown>): SearchResult {
  const id = String(row.id);
  const name = textValue(row.name) ?? textValue(row.company) ?? "Unnamed contact";

  return {
    description: compact(
      textValue(row.notes) ?? textValue(row.address),
      joinMeta([textValue(row.email), textValue(row.phone), textValue(row.address)]) ||
        "Contact profile",
    ),
    href: `/contacts?contactId=${encodeURIComponent(id)}`,
    id: `contact:${id}`,
    label: name,
    meta: joinMeta([
      titleCase(textValue(row.contact_type), "Contact"),
      textValue(row.company),
      textValue(row.email),
      textValue(row.phone),
    ]),
    timestamp: textValue(row.updated_at),
    type: "contact",
  };
}

function leadResult(row: Record<string, unknown>): SearchResult {
  const id = String(row.id);
  const contactId = textValue(row.contact_id);

  return {
    description: compact(
      textValue(row.description) ?? textValue(row.next_step),
      textValue(row.status) ?? "Lead",
    ),
    href: contactId
      ? `/contacts?filter=leads&contactId=${encodeURIComponent(contactId)}`
      : "/contacts?filter=leads",
    id: `lead:${id}`,
    label: textValue(row.title) ?? "Untitled lead",
    meta: joinMeta([
      "Lead",
      titleCase(textValue(row.status), "New"),
      titleCase(textValue(row.service_type), ""),
    ]),
    timestamp: textValue(row.updated_at),
    type: "lead",
  };
}

function messageResult(row: Record<string, unknown>): SearchResult {
  const id = String(row.id);
  const conversationId = textValue(row.conversation_id);
  const direction = textValue(row.direction) ?? "message";
  const subject = textValue(row.subject);

  return {
    description: compact(textValue(row.body_text), "No message body recorded"),
    href: conversationId
      ? `/inbox?conversationId=${encodeURIComponent(conversationId)}`
      : "/inbox",
    id: `message:${id}`,
    label: subject ?? titleCase(direction, "Message"),
    meta: joinMeta(["Inbox", titleCase(direction, "Message")]),
    timestamp:
      textValue(row.sent_at) ?? textValue(row.received_at) ?? textValue(row.created_at),
    type: "message",
  };
}

function fileResult(row: Record<string, unknown>): SearchResult {
  const id = String(row.id);
  const contentType = textValue(row.content_type);
  const source = textValue(row.source);

  return {
    description: joinMeta([contentType, titleCase(source, "File")]) || "Saved file",
    href: `/api/files/${encodeURIComponent(id)}?disposition=inline`,
    id: `file:${id}`,
    label: textValue(row.filename) ?? "Untitled file",
    meta: "File",
    timestamp: textValue(row.created_at),
    type: "file",
  };
}

function generatedDocumentResult(row: Record<string, unknown>): SearchResult {
  const id = String(row.id);
  const fileId = textValue(row.file_id);
  const quoteDraftId = textValue(row.quote_draft_id);

  return {
    description: joinMeta([
      textValue(row.filename),
      titleCase(textValue(row.lifecycle_status), "Generated"),
    ]),
    href: quoteDraftId
      ? `/files/${encodeURIComponent(quoteDraftId)}`
      : fileId
        ? `/api/files/${encodeURIComponent(fileId)}?disposition=inline`
        : "/files",
    id: `document:${id}`,
    label: textValue(row.title) ?? textValue(row.filename) ?? "Generated document",
    meta: titleCase(textValue(row.document_type), "Document"),
    timestamp: textValue(row.updated_at) ?? textValue(row.created_at),
    type: "document",
  };
}

function quoteDraftResult(row: Record<string, unknown>): SearchResult {
  const id = String(row.id);

  return {
    description: compact(textValue(row.notes), titleCase(textValue(row.status), "Draft")),
    href: `/files/${encodeURIComponent(id)}`,
    id: `quote:${id}`,
    label: textValue(row.title) ?? "Quote draft",
    meta: joinMeta(["Quote", titleCase(textValue(row.status), "Draft")]),
    timestamp: textValue(row.updated_at),
    type: "quote",
  };
}

function voiceCallResult(row: Record<string, unknown>): SearchResult {
  const id = String(row.id);

  return {
    description: compact(
      textValue(row.summary) ?? textValue(row.transcript),
      textValue(row.ended_reason) ?? "Voice call",
    ),
    href: `/voice-vapi?callId=${encodeURIComponent(id)}`,
    id: `voice:${id}`,
    label: titleCase(textValue(row.purpose), "Voice call"),
    meta: joinMeta([
      "Voice",
      titleCase(textValue(row.direction), "Call"),
      textValue(row.customer_number),
    ]),
    timestamp:
      textValue(row.started_at) ?? textValue(row.ended_at) ?? textValue(row.created_at),
    type: "voice",
  };
}

function searchQueries(
  supabase: SupabaseClient,
  workspaceId: string,
  pattern: string,
) {
  return [
    collectResults(
      "contacts",
      supabase
        .from("contacts")
        .select(
          "id,name,email,phone,company,contact_type,address,notes,updated_at",
        )
        .eq("workspace_id", workspaceId)
        .is("merged_into_contact_id", null)
        .or(
          ilikeAny(
            [
              "name",
              "email",
              "phone",
              "company",
              "address",
              "notes",
              "normalized_email",
              "normalized_phone",
              "normalized_company",
            ],
            pattern,
          ),
        )
        .order("updated_at", { ascending: false })
        .limit(RESULT_LIMIT_PER_GROUP),
      contactResult,
    ),
    collectResults(
      "leads",
      supabase
        .from("leads")
        .select(
          "id,contact_id,title,description,status,service_type,next_step,updated_at",
        )
        .eq("workspace_id", workspaceId)
        .or(
          ilikeAny(
            ["title", "description", "status", "service_type", "next_step"],
            pattern,
          ),
        )
        .order("updated_at", { ascending: false })
        .limit(RESULT_LIMIT_PER_GROUP),
      leadResult,
    ),
    collectResults(
      "messages",
      supabase
        .from("messages")
        .select(
          "id,conversation_id,direction,subject,body_text,sent_at,received_at,created_at",
        )
        .eq("workspace_id", workspaceId)
        .or(ilikeAny(["subject", "body_text"], pattern))
        .order("created_at", { ascending: false })
        .limit(RESULT_LIMIT_PER_GROUP),
      messageResult,
    ),
    collectResults(
      "files",
      supabase
        .from("files")
        .select("id,filename,content_type,source,created_at")
        .eq("workspace_id", workspaceId)
        .or(ilikeAny(["filename", "content_type", "source"], pattern))
        .order("created_at", { ascending: false })
        .limit(RESULT_LIMIT_PER_GROUP),
      fileResult,
    ),
    collectResults(
      "generated_documents",
      supabase
        .from("generated_documents")
        .select(
          "id,title,filename,document_type,lifecycle_status,file_id,quote_draft_id,created_at,updated_at",
        )
        .eq("workspace_id", workspaceId)
        .or(ilikeAny(["title", "filename", "document_type", "lifecycle_status"], pattern))
        .order("updated_at", { ascending: false })
        .limit(RESULT_LIMIT_PER_GROUP),
      generatedDocumentResult,
    ),
    collectResults(
      "quote_drafts",
      supabase
        .from("quote_drafts")
        .select("id,title,status,notes,updated_at")
        .eq("workspace_id", workspaceId)
        .or(ilikeAny(["title", "status", "notes"], pattern))
        .order("updated_at", { ascending: false })
        .limit(RESULT_LIMIT_PER_GROUP),
      quoteDraftResult,
    ),
    collectResults(
      "voice_calls",
      supabase
        .from("voice_calls")
        .select(
          "id,direction,purpose,customer_number,status,transcript,summary,ended_reason,started_at,ended_at,created_at",
        )
        .eq("workspace_id", workspaceId)
        .or(
          ilikeAny(
            [
              "purpose",
              "customer_number",
              "status",
              "summary",
              "transcript",
              "ended_reason",
            ],
            pattern,
          ),
        )
        .order("created_at", { ascending: false })
        .limit(RESULT_LIMIT_PER_GROUP),
      voiceCallResult,
    ),
  ];
}

export async function GET(request: NextRequest) {
  const context = await getApiWorkspaceContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const pattern = searchPattern(q);

  if (!pattern) {
    return NextResponse.json({ data: [] });
  }

  try {
    const groups = await Promise.all(
      searchQueries(context.supabase, context.workspace.id, pattern),
    );
    const data = groups
      .flat()
      .sort((left, right) => {
        const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
        const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;

        return rightTime - leftTime;
      })
      .slice(0, 24);

    return NextResponse.json({ data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to search workspace.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
